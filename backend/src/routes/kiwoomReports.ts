import { Router } from 'express';
import {
  fetchKiwoomAccountNo,
  fetchKiwoomDomesticRealized,
  fetchKiwoomTransactions,
  fetchKiwoomUsRealized,
  isKiwoomConfigured,
} from '../brokers/kiwoom/kiwoomClient';
import { mapKiwoomDomesticRealized, mapKiwoomUsRealized, summarizeKiwoomCashFlows } from '../brokers/kiwoom/kiwoomMappers';
import { listAccountLabels } from '../db/accountLabels';
import { withCache } from '../brokers/responseCache';
import { handleBrokerApiError } from '../brokers/errors';

export const kiwoomReportsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_CONFIGURED = '키움증권 API 키가 설정되지 않았습니다.';

// 키움이 계산한 실현손익 — 실현손익 화면 비교 카드(KIS·NH와 같은 모양). 국내 ka10073(매도 건별), 미국 ust21530(원화 기준).
// 미국이 실패해도 국내는 보여준다(overseasRows null). ⚠ 실키 미검증.
kiwoomReportsRouter.get('/realized', async (req, res) => {
  if (!isKiwoomConfigured()) return res.status(409).json({ error: NOT_CONFIGURED });
  const { from, to } = req.query;
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to(YYYY-MM-DD)가 필요합니다.' });
  }
  try {
    const result = await withCache(`kiwoom:realized:${from}:${to}`, 600_000, async () => {
      const accountId = await fetchKiwoomAccountNo();
      const rows = mapKiwoomDomesticRealized(await fetchKiwoomDomesticRealized(from, to));
      const overseasRows = await fetchKiwoomUsRealized(from, to).then(mapKiwoomUsRealized, (err) => {
        console.warn('[kiwoom] 미국 실현손익 조회 실패:', (err as Error).message);
        return null;
      });
      return { accountIds: [accountId], rows, overseasRows };
    });
    res.json(result);
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

// 입금 기준 투자원금 — 위탁종합거래내역 입출금(tp 1) + 입출고(tp 2, 타사 입고 건수). 토스·NH와 같은 모양(계좌 하나).
kiwoomReportsRouter.get('/cash-flows', async (req, res) => {
  if (!isKiwoomConfigured()) return res.status(409).json({ error: NOT_CONFIGURED });
  const forceRefresh = req.query.refresh === 'true';
  try {
    const result = await withCache(
      'kiwoom:cash-flows',
      3600_000,
      async () => {
        const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
        const accountId = await fetchKiwoomAccountNo();
        const [flows, transfers] = await Promise.all([
          fetchKiwoomTransactions('2015-01-01', today, '1', '0'),
          fetchKiwoomTransactions('2015-01-01', today, '2', '0'),
        ]);
        const label = listAccountLabels('kiwoom').find((l) => l.accountId === accountId)?.label ?? null;
        return [{ accountSeq: accountId, accountNo: accountId, label, ...summarizeKiwoomCashFlows(flows, transfers) }];
      },
      { forceRefresh }
    );
    res.json(result);
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
