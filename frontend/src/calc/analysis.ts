// 분석 화면 — 벤치마크 대비 성과, 위험 지표, 분산 현황, 비용 분석. 순수 함수, 테스트 frontend/test/analysis.test.ts.
//
// 내 월간 수익률은 대시보드 "지수와 비교"와 같은 단순 Dietz 근사((그 달 평가 변화 − 투자금 변화) ÷ 전월 평가, calc/overview.ts
// monthlyAmountRows — 최근 12개월, 지금 보유 종목의 매매내역으로 재구성)다. 그래서 기간은 최대 12개월이고, 전량 매도한 종목은 빠진다.
import type { DividendRecord, StoredTrade } from '../types';
import type { FlatHolding, IndexCloses, MonthlyCloses } from './overview';
import type { MonthlyInvestmentRow } from '../components/MonthlyInvestmentChart';

export interface MonthlyReturn {
  month: string;
  r: number;
}

/** 월간 수익률(첫 달은 전월이 없어 빠진다). 전월 평가가 0이면 그 달도 뺀다. */
export function monthlyReturns(rows: MonthlyInvestmentRow[]): MonthlyReturn[] {
  const out: MonthlyReturn[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (!(prev.currentKrw > 0)) continue;
    out.push({ month: cur.month, r: (cur.currentKrw - prev.currentKrw - (cur.investedKrw - prev.investedKrw)) / prev.currentKrw });
  }
  return out;
}

/** 월말 종가 목록 → 월간 수익률. */
export function closesToReturns(list: Array<{ month: string; close: number }>): MonthlyReturn[] {
  const sorted = [...list].sort((a, b) => (a.month < b.month ? -1 : 1));
  const out: MonthlyReturn[] = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i - 1].close > 0) out.push({ month: sorted[i].month, r: sorted[i].close / sorted[i - 1].close - 1 });
  return out;
}

const compound = (rs: number[]) => rs.reduce((acc, r) => acc * (1 + r), 1) - 1;

export interface BenchmarkRow {
  label: string;
  months: number;
  mine: number | null;
  /** 벤치마크 이름 → 같은 기간 누적 수익률(자료가 기간을 다 덮지 못하면 null). */
  bench: Record<string, number | null>;
}

/**
 * 기간별 누적 수익률 — 최근 n개월(마지막 달 포함)의 월간 수익률을 곱한다. 내 수익률이 그 기간을 다 덮지 못하면 null.
 * `ytdMonths`는 올해 들어 지난 달 수(이번 달 포함).
 */
export function benchmarkTable(mine: MonthlyReturn[], benches: Record<string, MonthlyReturn[]>, ytdMonths: number): BenchmarkRow[] {
  const periods: Array<[string, number]> = [
    ['1개월', 1],
    ['3개월', 3],
    ['6개월', 6],
    ['올해', ytdMonths],
    [`전체(${mine.length}개월)`, mine.length],
  ];
  const lastMonth = mine.length ? mine[mine.length - 1].month : null;
  const window = (list: MonthlyReturn[], n: number): number | null => {
    if (!lastMonth) return null;
    const upTo = list.filter((x) => x.month <= lastMonth);
    const slice = upTo.slice(-n);
    if (slice.length < n || slice[slice.length - 1].month !== lastMonth) return null;
    return compound(slice.map((x) => x.r));
  };
  const seen = new Set<number>();
  return periods
    .filter(([, n]) => n >= 1 && !seen.has(n) && (seen.add(n), true))
    .map(([label, n]) => ({
      label,
      months: n,
      mine: window(mine, n),
      bench: Object.fromEntries(Object.entries(benches).map(([k, v]) => [k, window(v, n)])),
    }));
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function covariance(a: number[], b: number[]): number | null {
  if (a.length < 2 || a.length !== b.length) return null;
  const ma = mean(a);
  const mb = mean(b);
  return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / (a.length - 1);
}
export function correlation(a: number[], b: number[]): number | null {
  const c = covariance(a, b);
  const sa = stdev(a);
  const sb = stdev(b);
  return c === null || !sa || !sb ? null : c / (sa * sb);
}

/** 같은 달끼리 맞춘 두 수익률 열. */
function aligned(a: MonthlyReturn[], b: MonthlyReturn[]): [number[], number[]] {
  const bm = new Map(b.map((x) => [x.month, x.r]));
  const xa: number[] = [];
  const xb: number[] = [];
  for (const x of a) {
    const y = bm.get(x.month);
    if (y !== undefined) {
      xa.push(x.r);
      xb.push(y);
    }
  }
  return [xa, xb];
}

export interface RiskSummary {
  months: number;
  /** 연환산 변동성(월간 표준편차 × √12). */
  volatility: number | null;
  /** 최대 낙폭(누적 가치의 고점 대비 최저, 음수). */
  maxDrawdown: number | null;
  best: MonthlyReturn | null;
  worst: MonthlyReturn | null;
  /** 코스피 대비 베타(공분산 ÷ 코스피 분산). */
  betaKospi: number | null;
  correlationKospi: number | null;
}

export function riskSummary(mine: MonthlyReturn[], kospi: MonthlyReturn[]): RiskSummary {
  const rs = mine.map((x) => x.r);
  let peak = 1;
  let value = 1;
  let mdd = 0;
  for (const r of rs) {
    value *= 1 + r;
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
  }
  const sd = stdev(rs);
  const [a, k] = aligned(mine, kospi);
  const vk = stdev(k);
  const cov = covariance(a, k);
  const sorted = [...mine].sort((x, y) => x.r - y.r);
  return {
    months: rs.length,
    volatility: sd === null ? null : sd * Math.sqrt(12),
    maxDrawdown: rs.length ? mdd : null,
    best: sorted.length ? sorted[sorted.length - 1] : null,
    worst: sorted.length ? sorted[0] : null,
    betaKospi: cov !== null && vk ? cov / vk ** 2 : null,
    correlationKospi: correlation(a, k),
  };
}

/** 종목별 연환산 변동성과 상위 종목끼리 상관계수(월말 종가, 6개월 이상 겹친 것만). */
export function holdingRisk(
  symbols: Array<{ symbol: string; name: string }>,
  closes: MonthlyCloses
): { rows: Array<{ symbol: string; name: string; volatility: number | null; months: number }>; matrix: Array<Array<number | null>> } {
  const series = symbols.map((s) => closesToReturns((closes[s.symbol] ?? []).map((c) => ({ month: c.month, close: c.closePrice }))));
  const rows = symbols.map((s, i) => {
    const sd = stdev(series[i].map((x) => x.r));
    return { symbol: s.symbol, name: s.name, volatility: sd === null ? null : sd * Math.sqrt(12), months: series[i].length };
  });
  const matrix = series.map((a, i) =>
    series.map((b, j) => {
      if (i === j) return 1;
      const [x, y] = aligned(a, b);
      return x.length >= 6 ? correlation(x, y) : null;
    })
  );
  return { rows, matrix };
}

// ---- 분산 현황 --------------------------------------------------------------------------------------------------------------

export type AssetClass = '주식' | '채권' | '리츠·인프라' | '커버드콜·옵션' | '원자재' | '현금성';

/** 종목 이름으로 자산군을 짐작한다(공식 분류가 없어서 — 이름에 흔한 낱말 기준). 못 고르면 주식. */
export function assetClassOf(name: string, symbol = ''): AssetClass {
  const n = `${name} ${symbol}`.toUpperCase();
  if (/커버드콜|COVERED CALL|OPTION INCOME|프리미엄|위클리|타겟위클리|YIELDMAX|버퍼|BUFFER/.test(n)) return '커버드콜·옵션';
  if (/리츠|REIT|부동산|인프라|INFRA/.test(n)) return '리츠·인프라';
  if (/채권|국고채|국채|회사채|TREASURY|BOND|단기채|AGGREGATE|크레딧/.test(n)) return '채권';
  if (/MMF|CD금리|머니마켓|KOFR|SOFR|파킹|단기자금/.test(n)) return '현금성';
  if (/금현물|골드|GOLD|은선물|SILVER|원유|OIL|원자재|COMMODITY|구리/.test(n)) return '원자재';
  return '주식';
}

export interface Breakdown {
  label: string;
  valueKrw: number;
  pct: number;
}

export interface Diversification {
  totalKrw: number;
  byCurrency: Breakdown[];
  byAssetClass: Breakdown[];
  byBroker: Breakdown[];
  byTaxType: Breakdown[];
  /** 같은 종목 합친 비중의 제곱합(0~1, 낮을수록 분산). */
  hhi: number;
  /** 1 ÷ HHI — "실질적으로 몇 종목에 똑같이 나눈 것과 같은가". */
  effectiveN: number;
  top1Pct: number;
  top5Pct: number;
  holdingsCount: number;
}

const breakdown = (m: Map<string, number>, total: number): Breakdown[] =>
  [...m.entries()].map(([label, valueKrw]) => ({ label, valueKrw: Math.round(valueKrw), pct: total > 0 ? (valueKrw / total) * 100 : 0 })).sort((a, b) => b.valueKrw - a.valueKrw);

export function diversification(
  holdings: FlatHolding[],
  toKrw: (amount: number, currency: string | null) => number | null,
  brokerLabel: (b: string) => string,
  taxTypeOf: (broker: string, accountId: string) => string
): Diversification {
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const cur = new Map<string, number>();
  const cls = new Map<string, number>();
  const brk = new Map<string, number>();
  const tax = new Map<string, number>();
  const sym = new Map<string, number>();
  let total = 0;
  for (const h of holdings) {
    const v = toKrw(h.quantity * h.lastPrice, h.currency);
    if (v === null || v <= 0) continue;
    total += v;
    add(cur, h.currency === 'USD' ? '달러(미국)' : '원화(국내)', v);
    add(cls, assetClassOf(h.name, h.symbol), v);
    add(brk, brokerLabel(h.broker), v);
    add(tax, taxTypeOf(h.broker, h.accountId), v);
    add(sym, h.symbol, v);
  }
  const weights = [...sym.values()].map((v) => v / (total || 1)).sort((a, b) => b - a);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  return {
    totalKrw: Math.round(total),
    byCurrency: breakdown(cur, total),
    byAssetClass: breakdown(cls, total),
    byBroker: breakdown(brk, total),
    byTaxType: breakdown(tax, total),
    hhi,
    effectiveN: hhi > 0 ? 1 / hhi : 0,
    top1Pct: (weights[0] ?? 0) * 100,
    top5Pct: weights.slice(0, 5).reduce((s, w) => s + w, 0) * 100,
    holdingsCount: weights.length,
  };
}

// ---- 비용 분석 --------------------------------------------------------------------------------------------------------------

export interface CostYear {
  year: string;
  tradedKrw: number;
  commissionKrw: number;
  /** 매매 때 붙은 세금(거래세·양도세 원천징수 등 — 증권사가 준 값). */
  tradeTaxKrw: number;
  /** 배당 원천징수(기록의 세금 칸). */
  dividendTaxKrw: number;
  /** 수수료 + 거래 세금 ÷ 거래금액(%). */
  costRatePct: number | null;
  /** 수수료·세금 칸이 비어 있는 거래 수(증권사가 안 줌 — 실제 비용이 더 클 수 있다). */
  unknownTrades: number;
}

export function costByYear(trades: StoredTrade[], dividends: DividendRecord[], rateFor: (month: string) => number | null): CostYear[] {
  const years = new Map<string, CostYear>();
  const get = (y: string) => {
    let r = years.get(y);
    if (!r) years.set(y, (r = { year: y, tradedKrw: 0, commissionKrw: 0, tradeTaxKrw: 0, dividendTaxKrw: 0, costRatePct: null, unknownTrades: 0 }));
    return r;
  };
  const conv = (v: number, currency: string, month: string) => (currency === 'USD' ? (rateFor(month) ?? 0) * v : v);
  for (const t of trades) {
    const y = get(t.executedAt.slice(0, 4));
    const m = t.executedAt.slice(0, 7);
    y.tradedKrw += conv(t.amount, t.currency, m);
    if (t.commission === null && t.tax === null) y.unknownTrades++;
    y.commissionKrw += conv(t.commission ?? 0, t.currency, m);
    y.tradeTaxKrw += conv(t.tax ?? 0, t.currency, m);
  }
  for (const d of dividends) {
    if (!d.tax) continue;
    get(d.paidDate.slice(0, 4)).dividendTaxKrw += conv(d.tax, d.currency, d.paidDate.slice(0, 7));
  }
  return [...years.values()]
    .map((r) => ({
      ...r,
      tradedKrw: Math.round(r.tradedKrw),
      commissionKrw: Math.round(r.commissionKrw),
      tradeTaxKrw: Math.round(r.tradeTaxKrw),
      dividendTaxKrw: Math.round(r.dividendTaxKrw),
      costRatePct: r.tradedKrw > 0 ? ((r.commissionKrw + r.tradeTaxKrw) / r.tradedKrw) * 100 : null,
    }))
    .sort((a, b) => (a.year < b.year ? 1 : -1));
}

export type { IndexCloses };
