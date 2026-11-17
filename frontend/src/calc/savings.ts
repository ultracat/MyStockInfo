// 적립식 계획 추적(매매내역 화면) — 순수 함수, 테스트 frontend/test/analysis.test.ts.
// 계획마다 최근 12개월(시작 달 이후)의 실제 매수(모든 계좌, 원화 환산)를 계획 금액과 비교한다. 계획의 95% 이상이면 달성, 일부면 부족, 0이면 누락.
// 이번 달은 아직 진행 중이라 "남은 금액"으로 따로 본다.
import type { SavingsPlan, StoredTrade } from '../types';

export type SavingsMonthState = 'met' | 'partial' | 'missed' | 'current';

export interface SavingsPlanStatus {
  plan: SavingsPlan;
  months: Array<{ month: string; boughtKrw: number; state: SavingsMonthState }>;
  /** 지난 달까지(이번 달 제외) 계획 합계와 실제 합계. */
  plannedKrw: number;
  boughtKrw: number;
  /** 지난 달까지 연속 달성 개월 수(최근부터 거꾸로). */
  streak: number;
  thisMonthRemainingKrw: number;
}

const shift = (month: string, d: number) => {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + d;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

export function savingsStatus(plans: SavingsPlan[], trades: StoredTrade[], rateFor: (month: string) => number | null, today: string): SavingsPlanStatus[] {
  const thisMonth = today.slice(0, 7);
  return plans.map((plan) => {
    const bought = new Map<string, number>();
    for (const t of trades) {
      if (t.symbol !== plan.symbol || t.side !== 'BUY') continue;
      const m = t.executedAt.slice(0, 7);
      const rate = t.currency === 'USD' ? rateFor(m) : 1;
      if (!rate) continue;
      bought.set(m, (bought.get(m) ?? 0) + t.amount * rate);
    }
    const first = [shift(thisMonth, -11), plan.startMonth].sort()[1];
    const months: SavingsPlanStatus['months'] = [];
    for (let m = first; m <= thisMonth; m = shift(m, 1)) {
      const b = Math.round(bought.get(m) ?? 0);
      const state: SavingsMonthState = m === thisMonth ? 'current' : b >= plan.monthlyKrw * 0.95 ? 'met' : b > 0 ? 'partial' : 'missed';
      months.push({ month: m, boughtKrw: b, state });
    }
    const past = months.filter((x) => x.state !== 'current');
    let streak = 0;
    for (let i = past.length - 1; i >= 0 && past[i].state === 'met'; i--) streak++;
    const current = months.find((x) => x.state === 'current');
    return {
      plan,
      months,
      plannedKrw: plan.monthlyKrw * past.length,
      boughtKrw: past.reduce((s, x) => s + x.boughtKrw, 0),
      streak,
      thisMonthRemainingKrw: current ? Math.max(0, plan.monthlyKrw - current.boughtKrw) : 0,
    };
  });
}
