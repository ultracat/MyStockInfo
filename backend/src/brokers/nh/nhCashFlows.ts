import { fetchNhAccounts, fetchNhDepositWithdrawals, fetchNhTotalTransactions } from './nhClient';
import { nhNum, nhYmd } from './nhMappers';
import { withCache } from '../responseCache';
import { listAccountLabels } from '../../db/accountLabels';
import type { CashFlowSummary, CashFlowYear } from '../toss/tossCashFlows';
import type { FetchOpts } from '../types';

// NH투자증권(나무) 계좌의 **실제 투자원금** — 입출금내역(`/common/inquiry/v1/depositWithdrawal`, HTS 8207)에서
// 계좌 밖과 오간 원화만 모은다. 토스(tossCashFlows.ts)와 같은 요약 모양이라 화면 카드(PrincipalCard)를 같이 쓴다.
// ⚠ 가정(실데이터 미검증 — 2026-11-09 연동 계좌에 입출금 0건): 명세에 유형·적요 값 목록이 없다.
// - 방향: 계좌거래유형명(`act_trd_tp_nm`)에 "입금"/"출금"이 들어간다고 본다(없으면 적요로).
// - 원금이 아닌 것: 적요나 유형에 배당·분배·이자·환급·세금·수수료·이용료가 들어간 줄(배당 동기화·수익 쪽).
//   다른 계좌에서 옮긴 "대체입금"은 이 계좌로 들어온 돈이라 원금에 넣는다.
// - 통화 필드가 없다 — 원화로 본다. 달러 입출금은 해외 일별거래내역 쪽이라 여기 없다(달러 원금은 집계하지 않음).
// - 타사 주식 입고는 금액이 없어 원금에 못 넣는다 — 종합거래내역 입출고(02)에서 "입고" 적요 건수만 센다.

const NOT_PRINCIPAL = /배당|분배|이자|환급|세금|세액|수수료|이용료|취소|정정/;

export function nhFlowDirection(row: Record<string, unknown>): 'in' | 'out' | null {
  const type = String(row.act_trd_tp_nm ?? '');
  const summary = String(row.sps_cd_krl_anm ?? '');
  if (NOT_PRINCIPAL.test(type) || NOT_PRINCIPAL.test(summary)) return null;
  for (const s of [type, summary]) {
    const inn = s.includes('입금');
    const out = s.includes('출금');
    if (inn !== out) return inn ? 'in' : 'out';
  }
  return null;
}

/** 입출금내역 → 원금 요약. `transferRows`는 종합거래내역 입출고(02) — 입고 건수만 센다. */
export function summarizeNhCashFlows(rows: Record<string, unknown>[], transferRows: Record<string, unknown>[] = []): CashFlowSummary {
  const years = new Map<string, CashFlowYear>();
  const s: CashFlowSummary = {
    firstDate: null, depositKrw: 0, withdrawalKrw: 0, depositUsd: 0, withdrawalUsd: 0,
    netPrincipalKrw: 0, byYear: [], transferIn: 0, transferOut: 0,
  };
  for (const r of rows) {
    const dir = nhFlowDirection(r);
    const date = nhYmd(r.trd_dt);
    const amount = Math.abs(nhNum(r.trd_amt));
    if (!dir || !date || amount <= 0) continue;
    const y = date.slice(0, 4);
    const yr = years.get(y) ?? { year: y, depositKrw: 0, withdrawalKrw: 0, depositUsd: 0, withdrawalUsd: 0 };
    if (dir === 'in') {
      s.depositKrw += amount;
      yr.depositKrw += amount;
    } else {
      s.withdrawalKrw += amount;
      yr.withdrawalKrw += amount;
    }
    years.set(y, yr);
    if (!s.firstDate || date < s.firstDate) s.firstDate = date;
  }
  for (const r of transferRows) {
    const summary = String(r.sps_cd_krl_anm ?? '');
    if (!r.iem_cd || /취소|정정/.test(summary)) continue;
    if (summary.includes('입고')) s.transferIn++;
    else if (summary.includes('출고')) s.transferOut++;
  }
  s.netPrincipalKrw = s.depositKrw - s.withdrawalKrw;
  s.byYear = [...years.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
  return s;
}

export interface NhAccountCashFlows extends CashFlowSummary {
  /** 화면 카드가 계좌를 고르는 키 — 토스의 accountSeq 자리에 NH 계좌번호(어댑터 계좌 id)를 넣는다. */
  accountSeq: string;
  accountNo: string | null;
  label: string | null;
}

const FROM = '2000-01-01';

/** 실전 계좌별 원금 요약(모의투자 제외). 1시간 캐시. */
export function getNhCashFlows(opts: FetchOpts = {}): Promise<NhAccountCashFlows[]> {
  return withCache(
    'nh:cash-flows',
    3600_000,
    async () => {
      const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
      const accounts = await fetchNhAccounts(opts);
      const labels = listAccountLabels().filter((l) => l.broker === 'nh');
      const out: NhAccountCashFlows[] = [];
      for (const a of accounts) {
        const [dw, transfers] = await Promise.all([
          fetchNhDepositWithdrawals(a.accountNo, FROM, today),
          fetchNhTotalTransactions(a.accountNo, FROM, today, '02', opts),
        ]);
        out.push({
          accountSeq: a.accountNo,
          accountNo: a.accountNo,
          label: labels.find((l) => l.accountId === a.accountNo)?.label ?? null,
          ...summarizeNhCashFlows(dw, transfers),
        });
      }
      return out;
    },
    opts
  );
}
