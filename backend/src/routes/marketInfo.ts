import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';
import { resolveUsdKrwRate } from '../exchangeRateResolver';
import { fetchTossMonthlyClosePrices, type MonthlyClosePrice } from '../brokers/toss/tossClient';

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
marketInfoRouter.get('/monthly-close-prices', async (req, res) => {
  const symbolsParam = typeof req.query.symbols === 'string' ? req.query.symbols : '';
  const months = Math.max(1, Math.min(60, Number(req.query.months) || 12));
  const symbols = [...new Set(symbolsParam.split(',').map((s) => s.trim()).filter(Boolean))];

  const entries = await Promise.all(
    symbols.map(async (symbol): Promise<[string, MonthlyClosePrice[]]> => [
      symbol,
      await fetchTossMonthlyClosePrices(symbol, months),
    ])
  );
  res.json(Object.fromEntries(entries));
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
