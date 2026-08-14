import { Router } from 'express';
import { getAdapter, listAdapters } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';

export const accountsRouter = Router();

accountsRouter.get('/', (_req, res) => {
  // isConfigured() is a pure existence check today (see tossClient.ts /
  // kisClient.ts), but wrapping each broker individually means one
  // broker's credential store misbehaving still lets the others list —
  // rather than one throw taking down this whole response.
  const brokers = listAdapters().map((a) => {
    let configured = false;
    try {
      configured = a.isConfigured();
    } catch (err) {
      console.error(`[${a.id}] isConfigured() threw:`, err);
    }
    return { id: a.id, displayName: a.displayName, configured };
  });
  res.json(brokers);
});

accountsRouter.get('/:broker', async (req, res) => {
  const broker = req.params.broker as BrokerId;
  const forceRefresh = req.query.refresh === 'true';
  try {
    const adapter = getAdapter(broker);
    if (!adapter.isConfigured()) {
      return res.status(409).json({ error: `${adapter.displayName} API 키가 설정되지 않았습니다.` });
    }
    res.json(await adapter.listAccounts({ forceRefresh }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
