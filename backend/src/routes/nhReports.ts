import { Router } from 'express';
import { fetchNhAccounts, fetchNhDomesticTradingPnl, isNhConfigured } from '../brokers/nh/nhClient';
import { getNhCashFlows } from '../brokers/nh/nhCashFlows';
import { nhDomesticSymbol, nhNum } from '../brokers/nh/nhMappers';
import { withCache } from '../brokers/responseCache';
import { handleBrokerApiError } from '../brokers/errors';

export const nhReportsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOT_CONFIGURED = 'NH투자증권 API 키가 설정되지 않았습니다.';

// NH가 직접 계산한 국내 실현손익(종목별실현손익현황 `tradingPnl`, HTS 8229) — 실현손익 화면의 "공식 실현손익과 비교"
// 카드가 쓴다. KIS(`/api/kis/realized`)와 같은 행 모양이지만 **기간 합계가 종목별 한 줄**이다(매도 건별이 아님 —
// 카드도 종목별로 합쳐 보여줘서 그대로 맞는다). 실전 계좌 전부(모의투자 제외), 계좌별로 한 줄씩.
// 해외는 기간손익(`periodPnl`) 응답에 종목코드가 없어(주문일·국가 단위) 종목별 비교를 만들 수 없다 — overseasRows는 null.
// ⚠ 실데이터 미검증(연동 계좌 매도 0건). `pls_amt`(손익금액)를 수수료·세금 차감 손익으로 본다.
nhReportsRouter.get('/realized', async (req, res) => {
  if (!isNhConfigured()) return res.status(409).json({ error: NOT_CONFIGURED });
  const { from, to } = req.query;
  if (typeof from !== 'string' || !DATE_RE.test(from) || typeof to !== 'string' || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to(YYYY-MM-DD)가 필요합니다.' });
  }
  try {
    const result = await withCache(`nh:realized:${from}:${to}`, 600_000, async () => {
      const accounts = await fetchNhAccounts();
      const rows = [];
      for (const a of accounts) {
        for (const r of await fetchNhDomesticTradingPnl(a.accountNo, from, to)) {
          if (nhNum(r.sll_qty) <= 0) continue;
          rows.push({
            accountId: a.accountNo,
            date: to,
            symbol: nhDomesticSymbol(r.iem_cd),
            name: String(r.iem_nm ?? r.iem_cd ?? '').trim(),
            quantity: nhNum(r.sll_qty),
            sellAmount: nhNum(r.sll_amt),
            buyAmount: nhNum(r.sll_abk_amt),
            realized: nhNum(r.pls_amt),
            fee: 0,
            tax: nhNum(r.sll_tax_sum),
          });
        }
      }
      return { accountIds: accounts.map((a) => a.accountNo), rows, overseasRows: null };
    });
    res.json(result);
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

// NH 실전 계좌별 입출금 요약(입금 기준 투자원금) — 보유 종목 화면 카드. 토스 /api/toss/cash-flows와 같은 모양.
nhReportsRouter.get('/cash-flows', async (req, res) => {
  if (!isNhConfigured()) return res.status(409).json({ error: NOT_CONFIGURED });
  try {
    res.json(await getNhCashFlows({ forceRefresh: req.query.refresh === 'true' }));
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});
