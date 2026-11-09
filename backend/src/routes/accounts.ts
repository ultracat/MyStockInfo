import { Router } from 'express';
import { getAdapter } from '../brokers/registry';
import { KNOWN_BROKERS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';
import { handleBrokerApiError } from '../brokers/errors';

export const accountsRouter = Router();

accountsRouter.get('/', (_req, res) => {
  // KNOWN_BROKERS(등록된 어댑터 유무와 무관하게 이 앱이 아는 브로커 전체)를 순회한다
  // — CSV 전용 브로커(hasApiIntegration: false)는 자격증명 개념이 없으므로 항상
  // configured: true(프론트가 바로 선택할 수 있게). API 브로커는 isConfigured()로
  // 판단하되, 개별 try/catch로 감싸서 브로커 하나의 자격증명 조회가 죽어도 나머지
  // 목록은 그대로 응답된다.
  const brokers = KNOWN_BROKERS.map((b) => {
    if (!b.hasApiIntegration) {
      return { id: b.id, displayName: b.displayName, configured: true };
    }
    let configured = false;
    try {
      configured = getAdapter(b.id).isConfigured();
    } catch (err) {
      console.error(`[${b.id}] isConfigured() threw:`, err);
    }
    return { id: b.id, displayName: b.displayName, configured };
  });
  res.json(brokers);
});

accountsRouter.get('/:broker', async (req, res) => {
  const broker = req.params.broker as BrokerId;
  const forceRefresh = req.query.refresh === 'true';
  // ?paper=true — 모의투자 계좌도(보유·매매 화면의 계좌 선택용). 합계를 내는 화면은 붙이지 않는다.
  const includePaper = req.query.paper === 'true';
  try {
    const adapter = getAdapter(broker);
    if (!adapter.isConfigured()) {
      return res.status(409).json({ error: `${adapter.displayName} API 키가 설정되지 않았습니다.` });
    }
    res.json(await adapter.listAccounts({ forceRefresh, includePaper }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
