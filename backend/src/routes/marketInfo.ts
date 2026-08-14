import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';

export const marketInfoRouter = Router();

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
