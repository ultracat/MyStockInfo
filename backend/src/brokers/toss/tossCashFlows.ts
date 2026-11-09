import { fetchTossAccounts, fetchTossTransactions, type TossTransaction } from './tossClient';
import { withCache } from '../responseCache';
import { listAccountLabels } from '../../db/accountLabels';

// 토스증권 계좌의 **실제 투자원금** — 거래내역(`GET /api/v1/transactions`)에서 계좌 밖과 오간 현금만 모은다.
// 2026-11-09 실데이터 분류(공식 스펙 v1.2.28의 TransactionType + 실측):
// - 원금으로 센다: `DEPOSIT`/`WITHDRAWAL` 중 **종목·상품이 없는 것**(`assetClass === null`, 은행 이체).
// - 원금이 아니다: 종목이 붙은 `DEPOSIT`(국내 ETF 분배금·외화세금환급 — 배당 동기화가 쓰는 것), 종목이 붙은
//   `WITHDRAWAL`(전부 tax>0 — 분배금 등의 세금 출금으로 보임), 채권(`BOND`) 원리금·세금, `INTEREST`, `FEE`.
// - `EXCHANGE_IN`/`EXCHANGE_OUT`(환전)은 계좌 안에서 통화만 바뀌는 것이라 원금이 아니다.
// - `SECURITIES_TRANSFER_IN`/`OUT`(타사 이관 입고·출고, 주식배당)은 **금액이 null**이라 원금에 넣을 수 없다 —
//   건수만 세서 화면이 "입금 기준 수익이 그만큼 부풀 수 있다"고 알린다.
// - 미결제·취소 거래는 건너뛴다(취소 거래만 목록에 남고 원거래는 빠지므로 — 배당 동기화와 같은 이유).

export interface CashFlowYear {
  year: string;
  depositKrw: number;
  withdrawalKrw: number;
  depositUsd: number;
  withdrawalUsd: number;
}

export interface CashFlowSummary {
  firstDate: string | null;
  depositKrw: number;
  withdrawalKrw: number;
  depositUsd: number;
  withdrawalUsd: number;
  /** 달러 입출금을 그 거래의 환율로 원화 환산한 순입금(KRW 순입금 + USD 순입금×환율). 환율 없는 달러 거래가 있으면 null. */
  netPrincipalKrw: number | null;
  byYear: CashFlowYear[];
  transferIn: number;
  transferOut: number;
}

export function summarizeTossCashFlows(txns: TossTransaction[]): CashFlowSummary {
  const years = new Map<string, CashFlowYear>();
  const s: CashFlowSummary = {
    firstDate: null, depositKrw: 0, withdrawalKrw: 0, depositUsd: 0, withdrawalUsd: 0,
    netPrincipalKrw: 0, byYear: [], transferIn: 0, transferOut: 0,
  };
  let usdKrw = 0;
  let usdUnconvertible = false;
  for (const t of txns) {
    if (!t.settled || t.isCancellation) continue;
    if (t.transactionType === 'SECURITIES_TRANSFER_IN') { s.transferIn++; continue; }
    if (t.transactionType === 'SECURITIES_TRANSFER_OUT') { s.transferOut++; continue; }
    const isDep = t.transactionType === 'DEPOSIT';
    if (!(isDep || t.transactionType === 'WITHDRAWAL') || t.assetClass !== null || t.symbol) continue;
    if (t.currency !== 'KRW' && t.currency !== 'USD') continue;
    const amount = Number(t.amount ?? t.netAmount);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const y = t.settlementDate.slice(0, 4);
    let row = years.get(y);
    if (!row) years.set(y, (row = { year: y, depositKrw: 0, withdrawalKrw: 0, depositUsd: 0, withdrawalUsd: 0 }));
    if (!s.firstDate || t.settlementDate < s.firstDate) s.firstDate = t.settlementDate;
    const sign = isDep ? 1 : -1;
    if (t.currency === 'KRW') {
      if (isDep) { s.depositKrw += amount; row.depositKrw += amount; } else { s.withdrawalKrw += amount; row.withdrawalKrw += amount; }
    } else {
      if (isDep) { s.depositUsd += amount; row.depositUsd += amount; } else { s.withdrawalUsd += amount; row.withdrawalUsd += amount; }
      const fx = Number(t.exchangeRate);
      if (Number.isFinite(fx) && fx > 0) usdKrw += sign * amount * fx;
      else usdUnconvertible = true;
    }
  }
  s.netPrincipalKrw = usdUnconvertible ? null : s.depositKrw - s.withdrawalKrw + usdKrw;
  s.byYear = [...years.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
  return s;
}

export interface TossAccountCashFlows extends CashFlowSummary {
  accountSeq: string;
  accountNo: string | null;
  label: string | null;
}

/** 모든 토스 계좌의 입출금 요약 — 거래내역 전체 기간을 받으므로 1시간 캐시. */
export function getTossCashFlows(opts: { forceRefresh?: boolean } = {}): Promise<TossAccountCashFlows[]> {
  return withCache(
    'toss:cash-flows',
    3600_000,
    async () => {
      const accounts = await fetchTossAccounts();
      const labels = listAccountLabels('toss');
      const out: TossAccountCashFlows[] = [];
      for (const a of accounts) {
        const txns = await fetchTossTransactions(a.accountSeq, {
          types: ['DEPOSIT', 'WITHDRAWAL', 'SECURITIES_TRANSFER_IN', 'SECURITIES_TRANSFER_OUT'],
        });
        const seq = String(a.accountSeq);
        out.push({ accountSeq: seq, accountNo: a.accountNo ?? null, label: labels.find((l) => l.accountId === seq)?.label ?? null, ...summarizeTossCashFlows(txns) });
      }
      return out;
    },
    opts
  );
}
