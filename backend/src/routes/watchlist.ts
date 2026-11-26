import { Router } from 'express';
import { asyncRoute } from './asyncRoute';
import { listWatchlist, removeWatchlistEntry, setWatchlistMemo, upsertWatchlistEntry } from '../db/watchlist';
import { getCachedStockName } from '../db/stockNames';
import { resolveStockNames, resolveStockPrices } from '../stockNameResolver';
import { fetchTossDailyCandles, fetchTossPreviousClose, fetchTossPrices, isTossConfigured } from '../brokers/toss/tossClient';
import { fetchKisDomesticBasePrice, fetchKisOverseasPriceDetail, isKisConfigured } from '../brokers/kis/kisClient';
import { getSymbolDividends } from '../upcomingDividends';
import { redactText } from '../logRedact';

export const watchlistRouter = Router();

// 토스 종목 기본 정보 API가 실제로 허용하는 패턴 — routes/stockInfo.ts의
// TOSS_SYMBOL_PATTERN과 동일(그쪽 주석 참고: 잘못된 문자를 그냥 토스에 넘기면
// 400 + 에러 로그만 남긴다).
// 길이 제한(1~20자) — 종목별 메모리 캐시 키가 끝없이 늘지 않게(2026-11-19 보안 리뷰).
const SYMBOL_PATTERN = /^[A-Za-z0-9.,-]{1,20}$/;

// 등록된 종목 전체의 현재가를 매 조회마다 라이브로 채운다 — 보유종목 CSV의
// lastPrice 자동조회(stockNameResolver.ts)와 같은 원칙으로, 가격은 저장소에
// 저장하지 않는다(시시각각 바뀌는 값이라 저장해두면 바로 stale해짐).
watchlistRouter.get('/', asyncRoute(async (req, res) => {
  const entries = listWatchlist();
  // `?prices=0` — 저장된 목록만(종목 검색 창·종목 링크 화면처럼 코드·이름만 쓰는 곳, 2026-11-19 성능 리뷰: 열 때마다 시세·등락률 호출이 나갔다)
  if (entries.length === 0 || req.query.prices === '0') return res.json(entries);

  const { pricesBySymbol } = await resolveStockPrices(entries.map((e) => e.symbol)).catch(() => ({
    pricesBySymbol: {} as Record<string, number>,
  }));

  // 등락률(직전 거래일 대비, 2026-11-18) — 토스가 있을 때만. 현재가 API엔 전일 종가가 없어 일봉(4시간 캐시)으로 구한다(`previousCloseFrom`).
  // 관심종목은 몇 개뿐이라 종목마다 부른다. 실패한 종목은 null(화면은 "-").
  const changeRateBySymbol: Record<string, number | null> = {};
  if (isTossConfigured()) {
    const times = new Map<string, string | null>();
    try {
      for (const p of await fetchTossPrices(entries.map((e) => e.symbol.toUpperCase()))) times.set(p.symbol.toUpperCase(), p.timestamp);
    } catch {
      // 시각을 모르면 지금 시각 기준
    }
    await Promise.all(
      entries.map(async (e) => {
        const sym = e.symbol.toUpperCase();
        const last = pricesBySymbol[sym];
        if (!last) return void (changeRateBySymbol[sym] = null);
        // 국내 6자리는 KIS 기준가가 있으면 그것 — 토스 일봉 종가는 NXT 시간외 마지막 가격이라 KRX 기준가와 다르다(2026-11-18 대조).
        const kisBase = /^\d{6}$/.test(sym) && isKisConfigured() ? await fetchKisDomesticBasePrice(sym).catch(() => null) : null;
        const prev = kisBase ?? (await fetchTossPreviousClose(sym, times.get(sym) ?? null));
        changeRateBySymbol[sym] = prev ? last / prev - 1 : null;
      })
    );
  }

  res.json(
    entries.map((e) => ({
      ...e,
      lastPrice: pricesBySymbol[e.symbol.toUpperCase()] ?? null,
      changeRate: changeRateBySymbol[e.symbol.toUpperCase()] ?? null,
    }))
  );
}));

watchlistRouter.post('/', asyncRoute(async (req, res) => {
  const { symbol } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof symbol !== 'string' || !symbol.trim()) {
    return res.status(400).json({ error: 'symbol이 필요합니다.' });
  }
  const trimmed = symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(trimmed)) {
    return res.status(400).json({ error: `'${trimmed}'은(는) 올바른 종목코드 형식이 아닙니다.` });
  }

  const { namesBySymbol, unresolved } = await resolveStockNames([trimmed]);
  const name = namesBySymbol[trimmed];
  if (!name) {
    return res.status(404).json({
      error:
        unresolved.has(trimmed) && !isTossConfigured()
          ? `종목명 자동조회 실패: 토스증권 연동이 필요합니다. ('${trimmed}')`
          : `'${trimmed}' 종목 정보를 찾을 수 없습니다. 종목코드를 확인해주세요.`,
    });
  }

  // resolveStockNames가 성공 경로에서 반드시 stockNames 캐시도 같이 채워두므로
  // (stockNameResolver.ts) market/currency는 여기서 다시 조회하지 않고 그 캐시를
  // 그대로 읽는다.
  const cached = getCachedStockName(trimmed);
  // 추가할 때의 현재가 — "넣은 뒤 수익률"의 기준(2026-11-19). 못 구하면 null(화면이 추가한 날 종가로 대신).
  const { pricesBySymbol } = await resolveStockPrices([trimmed]).catch(() => ({ pricesBySymbol: {} as Record<string, number> }));
  const entry = upsertWatchlistEntry({
    symbol: trimmed,
    name,
    market: cached?.market ?? null,
    currency: cached?.currency ?? null,
    addedPrice: pricesBySymbol[trimmed] ?? null,
  });
  res.status(201).json(entry);
}));

// ---- 상세 화면(2026-11-19) ------------------------------------------------------------------------------------------
// 일봉(차트·이동평균·기간 수익률·52주 범위·비교), 배당 이력·다음 배당, 미국 종목 정보, 메모. 관심종목이 아닌 종목(비교 기준 지수 ETF)도
// 일봉은 받는다 — 종목코드 형식만 확인한다.

watchlistRouter.get('/candles/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return res.status(400).json({ error: '올바른 종목코드 형식이 아닙니다.' });
  if (!isTossConfigured()) return res.status(409).json({ error: '일봉은 토스증권 API 키가 있어야 받을 수 있습니다.' });
  const days = Math.min(900, Math.max(30, Number(req.query.days) || 400));
  try {
    res.json({ candles: await fetchTossDailyCandles(symbol, days) });
  } catch (e) {
    res.status(502).json({ error: `일봉을 받지 못했습니다: ${redactText((e as Error).message)}` });
  }
});

watchlistRouter.get('/:symbol/dividends', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return res.status(400).json({ error: '올바른 종목코드 형식이 아닙니다.' });
  if (!isKisConfigured()) return res.status(409).json({ error: '배당 일정은 한국투자증권 API 키가 있어야 받을 수 있습니다.' });
  const currency = req.query.currency === 'USD' ? 'USD' : 'KRW';
  try {
    res.json(await getSymbolDividends(symbol, currency));
  } catch (e) {
    res.status(502).json({ error: redactText((e as Error).message) });
  }
});

watchlistRouter.get('/:symbol/overseas-detail', async (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) return res.status(400).json({ error: '올바른 종목코드 형식이 아닙니다.' });
  if (!isKisConfigured()) return res.status(409).json({ error: '한국투자증권 API 키가 필요합니다.' });
  try {
    const row = await fetchKisOverseasPriceDetail(symbol);
    if (!row) return res.status(404).json({ error: '한국투자증권에서 이 종목을 찾지 못했습니다.' });
    const num = (v: string | undefined) => {
      const n = Number(v);
      return v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
    };
    // ETF는 PER·PBR·EPS·BPS가 0으로 온다(2026-11-19 실측 SPY) — 0은 "없음"으로. 시가총액(`tomv`)은 달러 단위(실측).
    const ratio = (v: string | undefined) => {
      const n = num(v);
      return n === 0 ? null : n;
    };
    res.json({
      per: ratio(row.perx),
      pbr: ratio(row.pbrx),
      eps: ratio(row.epsx),
      bps: ratio(row.bpsx),
      marketCap: num(row.tomv),
      shares: num(row.shar),
      high52: num(row.h52p),
      high52Date: row.h52d || null,
      low52: num(row.l52p),
      low52Date: row.l52d || null,
      sector: row.e_icod || null,
      etpType: row.etyp_nm || null,
    });
  } catch (e) {
    res.status(502).json({ error: redactText((e as Error).message) });
  }
});

watchlistRouter.put('/:symbol/memo', (req, res) => {
  if (!SYMBOL_PATTERN.test(req.params.symbol)) return res.status(400).json({ error: '올바른 종목코드 형식이 아닙니다.' });
  const { memo } = (req.body ?? {}) as Record<string, unknown>;
  if (memo !== null && typeof memo !== 'string') return res.status(400).json({ error: 'memo는 문자열이어야 합니다.' });
  if (typeof memo === 'string' && memo.length > 2000) return res.status(400).json({ error: '메모는 2000자까지입니다.' });
  const entry = setWatchlistMemo(req.params.symbol, memo);
  if (!entry) return res.status(404).json({ error: '해당 관심종목을 찾을 수 없습니다.' });
  res.json(entry);
});

watchlistRouter.delete('/:symbol', (req, res) => {
  if (!SYMBOL_PATTERN.test(req.params.symbol)) return res.status(400).json({ error: '올바른 종목코드 형식이 아닙니다.' });
  const removed = removeWatchlistEntry(req.params.symbol);
  if (!removed) return res.status(404).json({ error: '해당 관심종목을 찾을 수 없습니다.' });
  res.status(204).end();
});
