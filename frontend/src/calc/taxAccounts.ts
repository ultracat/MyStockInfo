// ISA·연금 한도 관리(실현손익 화면) — 순수 함수, 테스트 frontend/test/taxAccounts.test.ts.
//
// - ISA: 비과세 한도는 **계좌 전체 기간**의 순이익(매매 손익 + 배당·분배금, 손익통산) 기준이다 — 만기·해지 때 한도를 넘는 몫만 9.9%
//   분리과세. 그래서 가입일(없으면 기록 전체)부터 합친다. 아직 팔지 않은 평가손익은 "지금 해지한다면"으로 따로 더해 보여 준다.
// - 연금저축·IRP: 세액공제는 **그해 납입액** 기준 — 연금저축은 연 600만원까지, 연금저축 + IRP 합쳐 900만원까지(기본값, 바꿀 수 있음).
//   공제율은 총급여 5,500만원 이하 16.5%, 초과 13.2%(지방소득세 포함) — 소득을 모르므로 둘 다 보여 준다.
// 납입액은 대부분 증권사 API가 주지 않아 사용자가 연도별로 적는다(planner.json).
import type { AccountTaxType, DividendRecord, StoredHolding, TaxAccountPlan, TaxLimits } from '../types';
import type { RealizedSale } from './realizedGains';

export const ISA_OVER_LIMIT_TAX_RATE = 0.099;
export const PENSION_CREDIT_RATE_LOW_INCOME = 0.165;
export const PENSION_CREDIT_RATE_HIGH_INCOME = 0.132;

export interface TaxAccountRef {
  broker: string;
  accountId: string;
  taxType: AccountTaxType;
}

export interface IsaStatus {
  broker: string;
  accountId: string;
  isaType: 'GENERAL' | 'SEOMIN';
  openedOn: string | null;
  realizedKrw: number;
  /** 세전 배당·분배금(ISA는 원천징수가 없어 기록 금액 + 세금 칸). */
  dividendsKrw: number;
  /** 매매 + 배당 — 비과세 한도와 비교하는 값. */
  netIncomeKrw: number;
  /** 지금 보유분의 평가손익(해지하면 더해진다) — 보유 기록이 없으면 null. */
  unrealizedKrw: number | null;
  limitKrw: number;
  /** 한도를 넘는 몫(지금까지 기준) — 0 이상. */
  overKrw: number;
  /** 넘는 몫 × 9.9%. */
  estimatedTaxKrw: number;
  contributionThisYear: number;
  annualContributionLimit: number;
}

export interface PensionStatus {
  year: string;
  accounts: Array<{ broker: string; accountId: string; taxType: 'PENSION_SAVINGS' | 'IRP'; contribution: number }>;
  savingsTotal: number;
  irpTotal: number;
  /** 세액공제 대상 납입액 = min(연금저축, 연금저축 한도) + IRP, 합산 한도까지. */
  deductibleKrw: number;
  /** 합산 한도까지 더 넣을 수 있는 금액(연금저축은 따로 `savingsRoom`). */
  totalRoom: number;
  savingsRoom: number;
  creditLowIncome: number;
  creditHighIncome: number;
}

const planOf = (plans: TaxAccountPlan[], broker: string, accountId: string) =>
  plans.find((p) => p.broker === broker && p.accountId === accountId);

/** ISA 계좌별 비과세 한도 현황. `dividendAccountOf`는 배당 기록의 계좌 칸(표시용 번호일 수 있음)을 내부 계좌 id로 되돌린다. */
export function isaStatuses(
  accounts: TaxAccountRef[],
  plans: TaxAccountPlan[],
  limits: TaxLimits,
  sales: RealizedSale[],
  dividends: DividendRecord[],
  holdings: StoredHolding[],
  dividendAccountOf: (d: DividendRecord) => string | null,
  rateFor: (month: string) => number | null,
  year: string,
  currentMonth: string
): IsaStatus[] {
  return accounts
    .filter((a) => a.taxType === 'ISA')
    .map((a) => {
      const plan = planOf(plans, a.broker, a.accountId);
      const openedOn = plan?.openedOn ?? null;
      const after = (date: string) => !openedOn || date >= openedOn;
      const realizedKrw = Math.round(
        sales.filter((s) => s.broker === a.broker && s.accountId === a.accountId && after(s.date)).reduce((sum, s) => sum + s.gainKrw, 0)
      );
      let dividendsKrw = 0;
      for (const d of dividends) {
        if (d.broker !== a.broker || dividendAccountOf(d) !== a.accountId || !after(d.paidDate)) continue;
        const gross = d.amount + (d.tax ?? 0);
        const rate = d.currency === 'USD' ? rateFor(d.paidDate.slice(0, 7)) : 1;
        if (rate) dividendsKrw += gross * rate;
      }
      dividendsKrw = Math.round(dividendsKrw);
      const held = holdings.filter((h) => h.broker === a.broker && h.accountId === a.accountId);
      let unrealizedKrw: number | null = null;
      if (held.length) {
        unrealizedKrw = 0;
        for (const h of held) {
          const rate = h.currency === 'USD' ? rateFor(currentMonth) : 1;
          if (rate) unrealizedKrw += h.profitLossAmount * rate;
        }
        unrealizedKrw = Math.round(unrealizedKrw);
      }
      const isaType = plan?.isaType ?? 'GENERAL';
      const limitKrw = isaType === 'SEOMIN' ? limits.isaSeomin : limits.isaGeneral;
      const netIncomeKrw = realizedKrw + dividendsKrw;
      const overKrw = Math.max(0, netIncomeKrw - limitKrw);
      return {
        broker: a.broker,
        accountId: a.accountId,
        isaType,
        openedOn,
        realizedKrw,
        dividendsKrw,
        netIncomeKrw,
        unrealizedKrw,
        limitKrw,
        overKrw,
        estimatedTaxKrw: Math.round(overKrw * ISA_OVER_LIMIT_TAX_RATE),
        contributionThisYear: plan?.contributions[year] ?? 0,
        annualContributionLimit: limits.isaAnnualContribution,
      };
    });
}

/** 그해 연금저축·IRP 세액공제 현황. */
export function pensionStatus(accounts: TaxAccountRef[], plans: TaxAccountPlan[], limits: TaxLimits, year: string): PensionStatus {
  const rows = accounts
    .filter((a): a is TaxAccountRef & { taxType: 'PENSION_SAVINGS' | 'IRP' } => a.taxType === 'PENSION_SAVINGS' || a.taxType === 'IRP')
    .map((a) => ({ broker: a.broker, accountId: a.accountId, taxType: a.taxType, contribution: planOf(plans, a.broker, a.accountId)?.contributions[year] ?? 0 }));
  const savingsTotal = rows.filter((r) => r.taxType === 'PENSION_SAVINGS').reduce((s, r) => s + r.contribution, 0);
  const irpTotal = rows.filter((r) => r.taxType === 'IRP').reduce((s, r) => s + r.contribution, 0);
  const deductibleKrw = Math.min(Math.min(savingsTotal, limits.pensionSavings) + irpTotal, limits.pensionTotal);
  return {
    year,
    accounts: rows,
    savingsTotal,
    irpTotal,
    deductibleKrw,
    totalRoom: Math.max(0, limits.pensionTotal - deductibleKrw),
    savingsRoom: Math.max(0, Math.min(limits.pensionSavings - savingsTotal, limits.pensionTotal - deductibleKrw)),
    creditLowIncome: Math.round(deductibleKrw * PENSION_CREDIT_RATE_LOW_INCOME),
    creditHighIncome: Math.round(deductibleKrw * PENSION_CREDIT_RATE_HIGH_INCOME),
  };
}

/** 계획 목록에서 한 계좌를 바꾼 새 목록(없으면 추가). */
export function withAccountPlan(plans: TaxAccountPlan[], next: TaxAccountPlan): TaxAccountPlan[] {
  const idx = plans.findIndex((p) => p.broker === next.broker && p.accountId === next.accountId);
  if (idx === -1) return [...plans, next];
  const out = [...plans];
  out[idx] = next;
  return out;
}
