import { Router } from 'express';
import { fetchKbPortfolio, fetchKbTradeHistory, getKbLinkedAccountId, isKbConfigured } from '../brokers/kb/kbClient';
import { replaceSnapshot } from '../db/holdingsStore';
import { upsertTrades } from '../db/tradesStore';
import { handleBrokerApiError } from '../brokers/errors';
import { resolveStockNames } from '../stockNameResolver';

export const kbRouter = Router();

// KB증권 Open API는 appKey/appSecret 자체가 계좌 하나에 이미 묶여 있고(계좌 목록
// 조회 API가 없음 — kbClient.ts 상단 주석 참고), 사용자는 KB 계좌를 실제로 여러
// 개(종합위탁/신연금저축/IRP 등) 갖고 있을 수 있다. 그래서 다른 브로커처럼
// "실시간 조회 = 항상 최신"인 별도 화면 경로를 두지 않고, CSV 가져오기와 똑같이
// "지금 연결된 계좌의 최신 스냅샷을 로컬 저장소(holdings.json/trades.json)에
// 채워 넣는" 동기화 액션으로만 노출한다 — 그 로컬 저장소 위의 화면(보유종목/
// 매매내역)은 이미 CSV 전용 브로커를 그대로 지원하므로 추가 프론트 분기가
// 필요 없다. accountId는 API가 알려주지 않으므로(계좌번호를 안 돌려줌) Settings의
// KB 자격증명 세 번째 필드(credentialFields.ts)로 미리 등록해둔 값을 기본으로
// 쓰고, 요청 본문에 accountId가 오면 그걸 우선한다(다른 계좌로 한 번만 동기화하고
// 싶은 경우를 위한 탈출구).
function resolveAccountId(body: unknown): { accountId: string } | { error: string } {
  const bodyAccountId = (body as { accountId?: unknown })?.accountId;
  if (typeof bodyAccountId === 'string' && bodyAccountId.trim()) {
    return { accountId: bodyAccountId.trim() };
  }
  const configured = getKbLinkedAccountId();
  if (configured) return { accountId: configured };
  return {
    error: 'accountId가 필요합니다 — 설정 화면의 KB증권 자격증명에 계좌번호를 입력하거나 요청에 accountId를 실어 보내주세요.',
  };
}

kbRouter.post('/sync-holdings', async (req, res) => {
  if (!isKbConfigured()) {
    return res.status(409).json({ error: 'KB증권 API 키가 설정되지 않았습니다.' });
  }
  const resolved = resolveAccountId(req.body);
  if ('error' in resolved) return res.status(400).json({ error: resolved.error });

  try {
    const positions = await fetchKbPortfolio();
    replaceSnapshot('kb', resolved.accountId, positions);
    res.json({ synced: positions.length, accountId: resolved.accountId });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

kbRouter.post('/sync-trades', async (req, res) => {
  if (!isKbConfigured()) {
    return res.status(409).json({ error: 'KB증권 API 키가 설정되지 않았습니다.' });
  }
  const resolved = resolveAccountId(req.body);
  if ('error' in resolved) return res.status(400).json({ error: resolved.error });

  const { from, to } = req.body as { from?: unknown; to?: unknown };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to(YYYY-MM-DD)가 필요합니다.' });
  }

  try {
    let trades = await fetchKbTradeHistory(from, to);

    // KB의 체결 내역(is_nm)이 어쩌다 비어 있는 행이 있으면(실측 미검증 — 연결된
    // 계좌가 비어 있어 non-zero 응답을 아직 못 봄, kbClient.ts 주석 참고) 토스→KIS→KB
    // 순서로 대체 조회한다 — routes/trades.ts와 같은 안전망.
    const missingNameSymbols = Array.from(new Set(trades.filter((t) => !t.name).map((t) => t.symbol)));
    if (missingNameSymbols.length > 0) {
      const { namesBySymbol } = await resolveStockNames(missingNameSymbols);
      trades = trades.map((t) => (t.name ? t : { ...t, name: namesBySymbol[t.symbol.toUpperCase()] ?? null }));
    }

    upsertTrades('kb', resolved.accountId, trades);
    res.json({ synced: trades.length, accountId: resolved.accountId });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
