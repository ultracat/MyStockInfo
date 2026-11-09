import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';
import { resolveUsdKrwRate } from '../exchangeRateResolver';
import { fetchTossMonthlyClosePrices, type MonthlyClosePrice } from '../brokers/toss/tossClient';
import { fetchEximbankMonthlyAvgUsdKrwRate } from '../fx/eximbankClient';
import { getActiveWarnings, getIndexMonthlyCloses, getMarketStatus, getSectorsFor } from '../marketInsights';

export const marketInfoRouter = Router();

// 브로커 무관 USD/KRW 환율 — 토스→수출입은행 순으로 시도한다(exchangeRateResolver.ts
// 참고). 아래 `/:broker/exchange-rate`는 브로커 하나를 지정해야 하고 그 브로커가
// 미연동/실패면 그대로 에러를 던지는 반면, 이 라우트는 프론트가 브로커를 몰라도
// 되고 실패해도 진짜 실패(예외)가 아니라 `{rate: null}`로 응답한다 — 프론트는
// 그걸 보고 설정에 저장된 수동 환율로 마지막 폴백한다(기존 동작 그대로). 경로가
// `/:broker/exchange-rate`와 세그먼트 구조 자체가 달라서(`exchange-rate/usd-krw`
// vs `<broker>/exchange-rate`) 등록 순서와 무관하게 겹치지 않는다.
marketInfoRouter.get('/exchange-rate/usd-krw', async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  const result = await resolveUsdKrwRate({ forceRefresh });
  res.json(result ?? { rate: null });
});

// 여러 종목의 월별 종가를 한 번에 조회한다(Overview.tsx의 "월별 총 투자금 ·
// 총 수입금" 카드가 오늘 현재가 대신 그 달의 실제 종가로 평가금액을 계산하는
// 데 쓴다) — 토스만 종목당 계좌 무관 일봉 조회를 제공해서(tossClient.ts의
// fetchTossMonthlyClosePrices 참고) 브로커 목록이 아니라 종목 심볼 목록을
// 받는다. 심볼마다 독립적으로 실패할 수 있어(상장폐지, 오타, 토스 미연동 등)
// 개별 실패가 다른 심볼까지 막지 않도록 Promise.all이 아니라 항상 성공하는
// 개별 호출(fetchTossMonthlyClosePrices 자체가 실패 시 빈 배열)을 모은다.
const MAX_CLOSE_MONTHS = 600;

marketInfoRouter.get('/monthly-close-prices', async (req, res) => {
  const symbolsParam = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  // months=all → 상장 초기까지(최대 50년, 관심종목 "전체 기간" 보기용).
  const months =
    req.query.months === 'all'
      ? MAX_CLOSE_MONTHS
      : Math.max(1, Math.min(MAX_CLOSE_MONTHS, Number(req.query.months) || 12));
  const symbols = [...new Set(symbolsParam.split(',').map((s) => s.trim()).filter(Boolean))];

  const entries = await Promise.all(
    symbols.map(async (symbol): Promise<[string, MonthlyClosePrice[]]> => [
      symbol,
      await fetchTossMonthlyClosePrices(symbol, months),
    ])
  );
  res.json(Object.fromEntries(entries));
});

// 여러 달의 USD/KRW 월평균 환율을 한 번에 조회한다(Dividends.tsx/Overview.tsx가
// 배당금을 "오늘 환율"이 아니라 "그 배당금이 지급된 달의 평균 환율"로 환산하는
// 데 쓴다) — 토스는 과거 환율을 지원하지 않아(현재가만 있음) 한국수출입은행이
// 유일한 소스다(fx/eximbankClient.ts의 fetchEximbankMonthlyAvgUsdKrwRate 참고).
// 달마다 독립적으로 실패할 수 있어(그 달 데이터를 하나도 못 구함 등) 위
// monthly-close-prices와 같은 패턴으로 개별 호출을 모은다.
marketInfoRouter.get('/exchange-rate/monthly-avg', async (req, res) => {
  const monthsParam = typeof req.query.months === 'string' ? req.query.months : '';
  const months = [...new Set(monthsParam.split(',').map((s) => s.trim()).filter(Boolean))];

  const entries = await Promise.all(
    months.map(
      async (month): Promise<[string, { rate: number; sampleCount: number } | null]> => [
        month,
        await fetchEximbankMonthlyAvgUsdKrwRate(month),
      ]
    )
  );
  res.json(Object.fromEntries(entries));
});

// ---- 토스 시장 정보로 만드는 보조 기능(src/marketInsights.ts) — 전부 토스 키만 있으면 되고 실패해도 예외 대신
//      빈 결과를 준다(화면은 이 정보 없이도 동작해야 한다).
function symbolsQuery(q: unknown): string[] {
  return typeof q === 'string' ? q.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300) : [];
}

// 국내·미국 장 운영 상태(지금 세션, 오늘 휴장 여부) — 보유 종목 화면이 장이 닫혀 있으면 1분 자동 새로고침을 쉰다.
marketInfoRouter.get('/market-status', async (_req, res) => {
  res.json(await getMarketStatus());
});

// 보유·관심 종목의 활성 매수 유의사항(정리매매·투자경고·VI 등) — 경고가 있는 종목만 키로 온다.
marketInfoRouter.get('/warnings', async (req, res) => {
  res.json({ bySymbol: await getActiveWarnings(symbolsQuery(req.query.symbols)) });
});

// 코스피·코스닥 월말 종가(대시보드의 "지수와 비교" 표).
marketInfoRouter.get('/index-monthly', async (req, res) => {
  const months = Math.min(60, Math.max(1, Number(req.query.months) || 12));
  res.json(await getIndexMonthlyCloses(months));
});

// 종목 → 토스 대분류 섹터(대시보드의 "섹터 비중"). 하루 한 번 전체 표를 만들어 디스크에 둔다(첫 호출은 수십 초).
marketInfoRouter.get('/sectors', async (req, res) => {
  res.json(await getSectorsFor(symbolsQuery(req.query.symbols)));
});

marketInfoRouter.get('/:broker/exchange-rate', async (req, res) => {
  const broker = req.params.broker as BrokerId;
  const { base, quote } = req.query;

  if (typeof base !== 'string' || typeof quote !== 'string' || !base || !quote) {
    return res.status(400).json({ error: 'base, quote 쿼리 파라미터가 필요합니다. 예: ?base=USD&quote=KRW' });
  }

  const forceRefresh = req.query.refresh === 'true';
  try {
    const adapter = getAdapter(broker);
    if (!adapter.isConfigured()) {
      return res.status(409).json({ error: `${adapter.displayName} API 키가 설정되지 않았습니다.` });
    }
    if (!adapter.getExchangeRate) {
      return res.status(404).json({ error: `${adapter.displayName}는 환율 조회를 지원하지 않습니다.` });
    }
    res.json(await adapter.getExchangeRate(base, quote, { forceRefresh }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
