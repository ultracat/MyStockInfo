import { Router } from 'express';
import { isTossConfigured } from '../brokers/toss/tossClient';
import { getTossCashFlows } from '../brokers/toss/tossCashFlows';
import { handleBrokerApiError } from '../brokers/errors';

export const tossReportsRouter = Router();

// 토스 계좌별 입출금 요약(실제 투자원금) — 보유 종목 화면의 "입금 기준 수익" 카드가 쓴다. 토스 키가 없으면 409.
tossReportsRouter.get('/cash-flows', async (req, res) => {
  if (!isTossConfigured()) return res.status(409).json({ error: '토스증권 API 키가 설정되지 않았습니다.' });
  try {
    res.json(await getTossCashFlows({ forceRefresh: req.query.refresh === 'true' }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
