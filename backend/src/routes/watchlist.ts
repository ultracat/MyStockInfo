import { Router } from 'express';
import { listWatchlist, removeWatchlistEntry, upsertWatchlistEntry } from '../db/watchlist';
import { getCachedStockName } from '../db/stockNames';
import { resolveStockNames, resolveStockPrices } from '../stockNameResolver';
import { isTossConfigured } from '../brokers/toss/tossClient';

export const watchlistRouter = Router();

// 토스 종목 기본 정보 API가 실제로 허용하는 패턴 — routes/stockInfo.ts의
// TOSS_SYMBOL_PATTERN과 동일(그쪽 주석 참고: 잘못된 문자를 그냥 토스에 넘기면
// 400 + 에러 로그만 남긴다).
const SYMBOL_PATTERN = /^[A-Za-z0-9.,-]+$/;

// 등록된 종목 전체의 현재가를 매 조회마다 라이브로 채운다 — 보유종목 CSV의
// lastPrice 자동조회(stockNameResolver.ts)와 같은 원칙으로, 가격은 저장소에
// 저장하지 않는다(시시각각 바뀌는 값이라 저장해두면 바로 stale해짐).
watchlistRouter.get('/', async (_req, res) => {
  const entries = listWatchlist();
  if (entries.length === 0) return res.json([]);

  const { pricesBySymbol } = await resolveStockPrices(entries.map((e) => e.symbol)).catch(() => ({
    pricesBySymbol: {} as Record<string, number>,
  }));

  res.json(
    entries.map((e) => ({
      ...e,
      lastPrice: pricesBySymbol[e.symbol.toUpperCase()] ?? null,
    }))
  );
});

watchlistRouter.post('/', async (req, res) => {
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
  const entry = upsertWatchlistEntry({
    symbol: trimmed,
    name,
    market: cached?.market ?? null,
    currency: cached?.currency ?? null,
  });
  res.status(201).json(entry);
});

watchlistRouter.delete('/:symbol', (req, res) => {
  const removed = removeWatchlistEntry(req.params.symbol);
  if (!removed) return res.status(404).json({ error: '해당 관심종목을 찾을 수 없습니다.' });
  res.status(204).end();
});
