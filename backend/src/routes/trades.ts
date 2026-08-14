import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';
import { upsertTrades } from '../db/tradesStore';

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
    const trades = await adapter.getTradeHistory(accountId, { from, to }, { forceRefresh });
    // write-through — holdings.ts와 같은 이유(CSV 내보내기, API 연동이 없는
    // 브로커 대비). id 기준 upsert라 같은 구간을 반복 조회해도 중복이 안 쌓인다.
    try {
      upsertTrades(broker, accountId, trades);
    } catch (storeErr) {
      console.error('[trades-store] 로컬 저장 실패:', storeErr);
    }
    res.json(trades);
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
