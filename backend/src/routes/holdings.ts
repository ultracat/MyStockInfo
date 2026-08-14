import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';
import { replaceSnapshot } from '../db/holdingsStore';

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
    const portfolio = await adapter.getPortfolio(accountId, { forceRefresh });
    // write-through: 실시간 조회가 성공할 때마다 로컬 저장소도 최신 스냅샷으로
    // 갱신해둔다(CSV 내보내기/가져오기, API 연동이 없는 브로커 대비용) — 저장
    // 실패가 실시간 응답 자체를 막으면 안 되므로 별도로 감싼다.
    try {
      replaceSnapshot(broker, accountId, portfolio.positions);
    } catch (storeErr) {
      console.error('[holdings-store] 로컬 저장 실패:', storeErr);
    }
    res.json(portfolio);
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
