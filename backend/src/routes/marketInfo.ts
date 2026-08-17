import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';
import { resolveUsdKrwRate } from '../exchangeRateResolver';

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
