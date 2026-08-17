import { Router } from 'express';
import { fetchKbPortfolio, fetchKbTradeHistory, isKbConfigured } from '../brokers/kb/kbClient';
import { replaceSnapshot } from '../db/holdingsStore';
import { upsertTrades } from '../db/tradesStore';
import { handleBrokerApiError } from '../brokers/errors';

export const kbRouter = Router();

// KB증권 Open API는 appKey/appSecret 자체가 계좌 하나에 이미 묶여 있고(계좌 목록
// 조회 API가 없음 — kbClient.ts 상단 주석 참고), 사용자는 KB 계좌를 실제로 여러
// 개(종합위탁/신연금저축/IRP 등) 갖고 있을 수 있다. 그래서 다른 브로커처럼
// "실시간 조회 = 항상 최신"인 별도 화면 경로를 두지 않고, CSV 가져오기와 똑같이
// "지금 연결된 계좌의 최신 스냅샷을 로컬 저장소(holdings.json/trades.json)에
// 채워 넣는" 동기화 액션으로만 노출한다 — 그 로컬 저장소 위의 화면(보유종목/
// 매매내역)은 이미 CSV 전용 브로커를 그대로 지원하므로 추가 프론트 분기가
// 필요 없다. accountId는 API가 알려주지 않으므로(계좌번호를 안 돌려줌)
// 사용자가 Settings에서 직접 지정한다 — 계좌 별칭에 이미 등록해둔 실제
// accountId를 그대로 쓰면 보유종목/매매내역/배당금 화면과 자동으로 연결된다.
kbRouter.post('/sync-holdings', async (req, res) => {
  if (!isKbConfigured()) {
    return res.status(409).json({ error: 'KB증권 API 키가 설정되지 않았습니다.' });
  }
  const { accountId } = req.body as { accountId?: unknown };
  if (typeof accountId !== 'string' || !accountId.trim()) {
    return res.status(400).json({ error: 'accountId가 필요합니다.' });
  }

  try {
    const positions = await fetchKbPortfolio();
    replaceSnapshot('kb', accountId.trim(), positions);
    res.json({ synced: positions.length });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

kbRouter.post('/sync-trades', async (req, res) => {
  if (!isKbConfigured()) {
    return res.status(409).json({ error: 'KB증권 API 키가 설정되지 않았습니다.' });
  }
  const { accountId, from, to } = req.body as { accountId?: unknown; from?: unknown; to?: unknown };
  if (typeof accountId !== 'string' || !accountId.trim()) {
    return res.status(400).json({ error: 'accountId가 필요합니다.' });
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to(YYYY-MM-DD)가 필요합니다.' });
  }

  try {
    const trades = await fetchKbTradeHistory(from, to);
    upsertTrades('kb', accountId.trim(), trades);
    res.json({ synced: trades.length });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
