import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';

export const holdingsRouter = Router();

holdingsRouter.get('/:broker/:accountId', async (req, res) => {
  const broker = req.params.broker as BrokerId;
  const { accountId } = req.params;
  const forceRefresh = req.query.refresh === 'true';
  try {
    const adapter = getAdapter(broker);
    if (!adapter.isConfigured()) {
      return res.status(409).json({ error: `${adapter.displayName} API 키가 설정되지 않았습니다.` });
    }
    res.json(await adapter.getPortfolio(accountId, { forceRefresh }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
