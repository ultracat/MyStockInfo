import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';

export const tradesRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

tradesRouter.get('/:broker/:accountId', async (req, res) => {
  const broker = req.params.broker as BrokerId;
  const { accountId } = req.params;
  const { from, to } = req.query;
  const forceRefresh = req.query.refresh === 'true';

  if (typeof from !== 'string' || typeof to !== 'string' || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from, to 쿼리 파라미터(YYYY-MM-DD)가 필요합니다.' });
  }

  try {
    const adapter = getAdapter(broker);
    if (!adapter.isConfigured()) {
      return res.status(409).json({ error: `${adapter.displayName} API 키가 설정되지 않았습니다.` });
    }
    if (!adapter.getTradeHistory) {
      return res.status(404).json({ error: `${adapter.displayName}는 매매내역 조회를 지원하지 않습니다.` });
    }
    res.json(await adapter.getTradeHistory(accountId, { from, to }, { forceRefresh }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
