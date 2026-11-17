import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';

/**
 * 사용자가 정해 두는 계획·목표 값 한 곳(`planner.json`, 2026-11-17) — 화면 여러 곳이 쓰는 작은 설정이라 저장소를 하나로 모았다.
 * - 월 배당 목표(배당금 화면 "앞으로 12개월 예상 배당")
 * - 세제 혜택 계좌: ISA 유형(일반/서민형)·가입일, 연도별 납입액(실현손익 화면 "ISA·연금 한도")과 한도 수치
 * - 목표 비중(리밸런싱 화면)
 * - 알림 켜기/끄기와 관심종목 목표가(alerts.ts)
 * - 은퇴·목표 시뮬레이션 입력(분석 화면), 적립식 계획(매매내역 화면)
 * 계산은 전부 화면(`frontend/src/calc/*`)이 한다 — 여기는 저장·검증만.
 */
export interface TaxLimits {
  /** ISA 비과세 한도(계좌 전체 기간 손익 합계 기준) — 일반형·서민형. */
  isaGeneral: number;
  isaSeomin: number;
  /** ISA 연간 납입 한도. */
  isaAnnualContribution: number;
  /** 연금저축 세액공제 한도(연). */
  pensionSavings: number;
  /** 연금저축 + IRP 합산 세액공제 한도(연). */
  pensionTotal: number;
}

/** 기본값은 2025년까지 확정된 조세특례제한법 수치다. 2026년 개편(ISA 비과세 500만/1,000만, 납입 4,000만)은 국회 통과·시행을 이 앱이
 *  확인할 수 없어(보도마다 다름) 기본값으로 쓰지 않고 화면에서 바꿀 수 있게 한다. */
export const DEFAULT_TAX_LIMITS: TaxLimits = {
  isaGeneral: 2_000_000,
  isaSeomin: 4_000_000,
  isaAnnualContribution: 20_000_000,
  pensionSavings: 6_000_000,
  pensionTotal: 9_000_000,
};

export interface TaxAccountPlan {
  broker: BrokerId;
  accountId: string;
  /** ISA만 — 비과세 한도가 다르다. */
  isaType?: 'GENERAL' | 'SEOMIN';
  /** ISA 가입일(YYYY-MM-DD) — 비과세 한도는 계좌 전체 기간 합계라 그 날부터 센다. 없으면 기록 전체. */
  openedOn?: string;
  /** 연도별 납입액(원) — 증권사 API가 입금 내역을 주지 않는 계좌가 많아 직접 적는다. */
  contributions: Record<string, number>;
}

export interface TargetWeight {
  symbol: string;
  name: string;
  /** 목표 비중(%) — 합이 100이 아니어도 저장은 된다(화면이 차이를 알린다). */
  weight: number;
}

export interface AlertSettings {
  /** 관심종목 목표가 도달 */
  targetPrice: boolean;
  /** 배당 입금(동기화로 새 배당 기록이 생김) */
  dividendReceived: boolean;
  /** 보유 종목에 새 매수 유의사항 */
  warnings: boolean;
  /** 금요일 저녁 주간 요약 */
  weeklySummary: boolean;
  /** 알림에 종목·금액을 숨기고 종류만(잠금 화면·화면 공유 대비) */
  hideDetails: boolean;
}

/** 은퇴·목표 시뮬레이션 입력(분석 화면) — 화면이 그대로 저장·복원한다. 시작 자산은 비우면 지금 평가금액. */
export interface SimulationPlan {
  startKrw: number | null;
  monthlyKrw: number;
  annualReturnPct: number;
  dividendYieldPct: number;
  reinvest: boolean;
  contributionGrowthPct: number;
  inflationPct: number;
  years: number;
  targetAssetsKrw: number | null;
  targetMonthlyDividendKrw: number | null;
}

/** 적립식 계획 — 이 종목을 매달 얼마씩 산다(매매내역 화면이 실제 매수와 맞춰 본다). */
export interface SavingsPlan {
  symbol: string;
  name: string;
  monthlyKrw: number;
  /** 시작한 달(YYYY-MM) — 그 전 달은 비교하지 않는다. */
  startMonth: string;
}

export interface WatchTarget {
  symbol: string;
  /** 이 값 이상이 되면 알림 */
  above: number | null;
  /** 이 값 이하가 되면 알림 */
  below: number | null;
}

export interface PlannerState {
  dividendGoalMonthlyKrw: number | null;
  taxLimits: TaxLimits;
  taxAccounts: TaxAccountPlan[];
  targets: TargetWeight[];
  alerts: AlertSettings;
  watchTargets: WatchTarget[];
  simulation: SimulationPlan | null;
  savingsPlans: SavingsPlan[];
}

const DEFAULT_STATE: PlannerState = {
  dividendGoalMonthlyKrw: null,
  taxLimits: DEFAULT_TAX_LIMITS,
  taxAccounts: [],
  targets: [],
  alerts: { targetPrice: true, dividendReceived: true, warnings: true, weeklySummary: true, hideDetails: false },
  watchTargets: [],
  simulation: null,
  savingsPlans: [],
};

function store() {
  return new JsonStore<Partial<PlannerState>>('planner.json', getDataDir(), {});
}

/** 저장본 + 기본값(필드가 나중에 늘어도 예전 파일이 그대로 읽히게). */
export function getPlanner(): PlannerState {
  const s = store().read();
  return {
    ...DEFAULT_STATE,
    ...s,
    taxLimits: { ...DEFAULT_TAX_LIMITS, ...(s.taxLimits ?? {}) },
    alerts: { ...DEFAULT_STATE.alerts, ...(s.alerts ?? {}) },
  };
}

export class PlannerValidationError extends Error {}

const money = (v: unknown, what: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e13) throw new PlannerValidationError(`${what}은(는) 0 이상의 숫자여야 합니다.`);
  return Math.round(v);
};
const optMoney = (v: unknown, what: string): number | null => (v === null || v === undefined ? null : money(v, what));
const symbolOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[A-Za-z0-9.\-]{1,20}$/.test(v.trim())) throw new PlannerValidationError('종목코드 형식이 올바르지 않습니다.');
  return v.trim().toUpperCase();
};
const brokerOf = (v: unknown): BrokerId => {
  if (typeof v !== 'string' || !(BROKER_IDS as readonly string[]).includes(v)) throw new PlannerValidationError('증권사가 올바르지 않습니다.');
  return v as BrokerId;
};
const textOf = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new PlannerValidationError(`${what}이(가) 올바르지 않습니다.`);
  return v.trim();
};

/** 평범한 객체만(배열·원시값·null 거절) — `k in t`가 원시값에서 던지거나 배열이 키로 섞이지 않게. */
const plainObject = (v: unknown, what: string): Record<string, unknown> => {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new PlannerValidationError(`${what} 형식이 올바르지 않습니다.`);
  return v as Record<string, unknown>;
};

/** 일부 필드만 바꾼다 — 보낸 필드만 검증해 덮어쓴다. */
export function updatePlanner(patch: Record<string, unknown>): PlannerState {
  const next: Partial<PlannerState> = {};
  if ('dividendGoalMonthlyKrw' in patch) next.dividendGoalMonthlyKrw = optMoney(patch.dividendGoalMonthlyKrw, '월 배당 목표');
  if ('taxLimits' in patch) {
    const t = plainObject(patch.taxLimits, '한도');
    const limits = { ...getPlanner().taxLimits }; // 보낸 한도만 바꾸고 나머지는 지금 값 그대로
    for (const k of Object.keys(DEFAULT_TAX_LIMITS) as Array<keyof TaxLimits>) if (k in t) limits[k] = money(t[k], '한도');
    next.taxLimits = limits;
  }
  if ('taxAccounts' in patch) {
    if (!Array.isArray(patch.taxAccounts) || patch.taxAccounts.length > 100) throw new PlannerValidationError('계좌 목록이 올바르지 않습니다.');
    next.taxAccounts = patch.taxAccounts.map((raw) => {
      const a = plainObject(raw, '계좌');
      const contributions: Record<string, number> = {};
      const entries = Object.entries(plainObject(a.contributions, '납입액'));
      // 연도는 1990~2100, 계좌당 120개까지 — 저장 파일(요청·알림마다 읽는다)이 끝없이 커지지 않게(2026-11-17 보안 점검)
      if (entries.length > 120) throw new PlannerValidationError('납입 연도가 너무 많습니다.');
      for (const [year, amount] of entries) {
        if (!/^\d{4}$/.test(year) || Number(year) < 1990 || Number(year) > 2100) throw new PlannerValidationError('납입 연도 형식이 올바르지 않습니다.');
        contributions[year] = money(amount, '납입액');
      }
      const openedOn = a.openedOn === undefined || a.openedOn === null || a.openedOn === '' ? undefined : String(a.openedOn);
      if (openedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(openedOn)) throw new PlannerValidationError('가입일은 YYYY-MM-DD 형식이어야 합니다.');
      const isaType = a.isaType === 'SEOMIN' ? 'SEOMIN' : a.isaType === 'GENERAL' ? 'GENERAL' : undefined;
      return { broker: brokerOf(a.broker), accountId: textOf(a.accountId, 100, '계좌'), isaType, openedOn, contributions };
    });
  }
  if ('targets' in patch) {
    if (!Array.isArray(patch.targets) || patch.targets.length > 300) throw new PlannerValidationError('목표 비중 목록이 올바르지 않습니다.');
    const seen = new Set<string>();
    next.targets = patch.targets.map((raw) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      const symbol = symbolOf(t.symbol);
      if (seen.has(symbol)) throw new PlannerValidationError(`${symbol}이(가) 두 번 들어 있습니다.`);
      seen.add(symbol);
      const weight = t.weight;
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) throw new PlannerValidationError('목표 비중은 0~100(%)이어야 합니다.');
      return { symbol, name: typeof t.name === 'string' ? t.name.slice(0, 100) : symbol, weight: Math.round(weight * 100) / 100 };
    });
  }
  if ('alerts' in patch) {
    const a = plainObject(patch.alerts, '알림 설정');
    const cur = getPlanner().alerts;
    next.alerts = {
      targetPrice: typeof a.targetPrice === 'boolean' ? a.targetPrice : cur.targetPrice,
      dividendReceived: typeof a.dividendReceived === 'boolean' ? a.dividendReceived : cur.dividendReceived,
      warnings: typeof a.warnings === 'boolean' ? a.warnings : cur.warnings,
      weeklySummary: typeof a.weeklySummary === 'boolean' ? a.weeklySummary : cur.weeklySummary,
      hideDetails: typeof a.hideDetails === 'boolean' ? a.hideDetails : cur.hideDetails,
    };
  }
  if ('watchTargets' in patch) {
    if (!Array.isArray(patch.watchTargets) || patch.watchTargets.length > 300) throw new PlannerValidationError('목표가 목록이 올바르지 않습니다.');
    next.watchTargets = patch.watchTargets
      .map((raw) => {
        const w = (raw ?? {}) as Record<string, unknown>;
        return { symbol: symbolOf(w.symbol), above: optPrice(w.above), below: optPrice(w.below) };
      })
      .filter((w) => w.above !== null || w.below !== null);
  }
  if ('simulation' in patch) {
    const s = patch.simulation as Record<string, unknown> | null;
    if (s === null) next.simulation = null;
    else {
      if (!s || typeof s !== 'object') throw new PlannerValidationError('시뮬레이션 입력이 올바르지 않습니다.');
      const pct = (v: unknown, what: string, lo: number, hi: number) => {
        if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new PlannerValidationError(`${what}은(는) ${lo}~${hi} 사이여야 합니다.`);
        return v;
      };
      next.simulation = {
        startKrw: optMoney(s.startKrw, '시작 자산'),
        monthlyKrw: money(s.monthlyKrw ?? 0, '월 적립액'),
        annualReturnPct: pct(s.annualReturnPct, '연 수익률', -50, 50),
        dividendYieldPct: pct(s.dividendYieldPct, '배당수익률', 0, 30),
        reinvest: s.reinvest !== false,
        contributionGrowthPct: pct(s.contributionGrowthPct ?? 0, '적립 증가율', -50, 50),
        inflationPct: pct(s.inflationPct ?? 0, '물가상승률', -10, 30),
        years: Math.round(pct(s.years, '기간(년)', 1, 60)),
        targetAssetsKrw: optMoney(s.targetAssetsKrw, '목표 자산'),
        targetMonthlyDividendKrw: optMoney(s.targetMonthlyDividendKrw, '목표 월 배당'),
      };
    }
  }
  if ('savingsPlans' in patch) {
    if (!Array.isArray(patch.savingsPlans) || patch.savingsPlans.length > 100) throw new PlannerValidationError('적립 계획 목록이 올바르지 않습니다.');
    const seen = new Set<string>();
    next.savingsPlans = patch.savingsPlans.map((raw) => {
      const p = (raw ?? {}) as Record<string, unknown>;
      const symbol = symbolOf(p.symbol);
      if (seen.has(symbol)) throw new PlannerValidationError(`${symbol} 계획이 두 번 들어 있습니다.`);
      seen.add(symbol);
      const startMonth = String(p.startMonth ?? '');
      if (!/^\d{4}-\d{2}$/.test(startMonth)) throw new PlannerValidationError('시작 달은 YYYY-MM 형식이어야 합니다.');
      return { symbol, name: typeof p.name === 'string' ? p.name.slice(0, 100) : symbol, monthlyKrw: money(p.monthlyKrw, '월 적립액'), startMonth };
    });
  }
  store().update((cur) => ({ ...cur, ...next }));
  return getPlanner();
}

function optPrice(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new PlannerValidationError('목표가는 0보다 큰 숫자여야 합니다.');
  return v;
}
