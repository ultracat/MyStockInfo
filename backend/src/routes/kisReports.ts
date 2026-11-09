import { Router } from 'express';
import { fetchKisPeriodTradeProfit, getKisAccountId, isKisConfigured } from '../brokers/kis/kisClient';
import { handleBrokerApiError } from '../brokers/errors';

export const kisReportsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 한국투자증권이 직접 계산한 국내 매도 실현손익(기간별매매손익현황 `TTTC8715R`) — 실현손익 화면이 앱의 이동평균
// 추정치와 나란히 비교하는 데 쓴다. 매도 체결 한 줄씩, 금액은 원.
kisReportsRouter.get('/realized', async (req, res) => {
  if (!isKisConfigured()) return res.status(409).json({ error: '한국투자증권 API 키가 설정되지 않았습니다.' });
  const { from, to } = req.query;
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to(YYYY-MM-DD)가 필요합니다.' });
  }
  try {
    const rows = await fetchKisPeriodTradeProfit(from, to);
    const n = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    res.json({
      accountId: getKisAccountId(),
      rows: rows
        .filter((r) => n(r.sll_qty) > 0)
        .map((r) => ({
          date: `${r.trad_dt.slice(0, 4)}-${r.trad_dt.slice(4, 6)}-${r.trad_dt.slice(6, 8)}`,
          symbol: r.pdno.trim(),
          name: r.prdt_name.trim(),
          quantity: n(r.sll_qty),
          sellAmount: n(r.sll_amt),
          buyAmount: n(r.buy_amt),
          realized: n(r.rlzt_pfls),
          fee: n(r.fee),
          tax: n(r.tl_tax),
        })),
    });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
