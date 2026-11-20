// 대시보드(Overview.tsx) 계산 — 화면 파일에서 순수 함수로 뺐다(2026-11-17). 환율은 함수로 받는다:
// `toKrw`(오늘/수동 환율, USD인데 환율이 없으면 null), `rateFor(month)`(배당 지급월 평균 환율, 없으면 오늘 환율 대체).
import { accountParts, findAccountLabel } from '../accountLabels';
import { BROKER_LABELS, BROKER_ORDER } from '../brokers';
import { dividendKey, groupDividendsByAccountSymbol } from '../dividendMatch';
import { formatKrwValue } from '../format';
import type { AccountLabel, BrokerId, DividendRecord, MonthlySummaryRow, StoredTrade } from '../types';
import type { DonutSlice } from '../components/DonutChart';
import type { MonthlyInvestmentRow } from '../components/MonthlyInvestmentChart';

export type ToKrw = (amount: number, currency: string | null) => number | null;
export type RateFor = (month: string) => number | null;

export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];
export const OTHER_COLOR = 'var(--baseline)';
export const TOP_N = 5;

export interface FlatHolding {
  /** 보유종목 상세 팝업의 "계좌별" 보기에서 계좌 단위로 묶는 데 쓴다. */
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  /** 오늘 기준 이 보유종목의 총 매입금액(원화 환산 전, currency 기준) — 월별
   * 투자금 차트가 "오늘 실제 매입원가 ÷ 오늘 수량"으로 평단가를 구할 때 쓴다. */
  purchaseAmount: number;
}

/** 종목별 금액 → 상위 5 + "기타 N종목"(회색) 도넛 조각. 0 이하는 뺀다. */
export function topNSlices(bySymbol: Map<string, { name: string; valueKrw: number }>): DonutSlice[] {
  const entries = Array.from(bySymbol.entries())
    .map(([symbol, v]) => ({ symbol, ...v }))
    .filter((e) => e.valueKrw > 0)
    .sort((a, b) => b.valueKrw - a.valueKrw);
  const top = entries.slice(0, TOP_N);
  const rest = entries.slice(TOP_N);
  const slices: DonutSlice[] = top.map((e, i) => ({
    label: `${e.name} (${e.symbol})`,
    value: e.valueKrw,
    color: SERIES_COLORS[i],
  }));
  if (rest.length > 0) {
    slices.push({
      label: `기타 ${rest.length}종목`,
      value: rest.reduce((s, r) => s + r.valueKrw, 0),
      color: OTHER_COLOR,
    });
  }
  return slices;
}

// marketValue를 직접 안 갖고 있어(FlatHolding엔 quantity/lastPrice만 남김) — quantity*lastPrice로 재계산한다
// (평가금액과 사실상 같음, 배당락 등 미세한 차이는 이 요약 화면 목적엔 무시 가능).
const holdingValueKrw = (h: FlatHolding, toKrw: ToKrw) => toKrw(h.quantity * h.lastPrice, h.currency);

/** 전체 계좌 보유종목 비중(도넛). */
export function holdingSlices(holdings: FlatHolding[], toKrw: ToKrw): DonutSlice[] {
  const bySymbol = new Map<string, { name: string; valueKrw: number }>();
  for (const h of holdings) {
    const v = holdingValueKrw(h, toKrw);
    if (v === null) continue;
    const existing = bySymbol.get(h.symbol) ?? { name: h.name, valueKrw: 0 };
    existing.valueKrw += v;
    bySymbol.set(h.symbol, existing);
  }
  return topNSlices(bySymbol);
}

export type SectorWeights = Record<string, Array<{ sector: string | null; weight: number }>>;

/** 섹터 비중(도넛) — 종목 평가금액을 백엔드가 준 섹터 배분(weights)대로 나눈다. 상위 5 섹터 + "기타 섹터 N개" + "분류 안 됨". */
export function sectorSlices(holdings: FlatHolding[], weights: SectorWeights, toKrw: ToKrw): DonutSlice[] {
  const bySector = new Map<string, number>();
  for (const h of holdings) {
    const v = holdingValueKrw(h, toKrw);
    if (v === null || v <= 0) continue;
    const parts = weights[h.symbol];
    if (!parts || parts.length === 0) {
      bySector.set('ETF·기타', (bySector.get('ETF·기타') ?? 0) + v);
      continue;
    }
    for (const p of parts) {
      const key = p.sector ?? 'ETF·기타';
      bySector.set(key, (bySector.get(key) ?? 0) + v * p.weight);
    }
  }
  const sorted = [...bySector.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  // "ETF·기타"는 순위와 상관없이 회색 마지막 조각으로 — 섹터가 아니라 "분류 없음"이라서.
  const other = sorted.find(([k]) => k === 'ETF·기타');
  const named = sorted.filter(([k]) => k !== 'ETF·기타');
  const top = named.slice(0, TOP_N);
  const rest = named.slice(TOP_N).reduce((s, [, v]) => s + v, 0);
  const slices: DonutSlice[] = top.map(([label, value], i) => ({ label, value, color: SERIES_COLORS[i] }));
  if (rest > 0) slices.push({ label: `기타 섹터 ${named.length - TOP_N}개`, value: rest, color: OTHER_COLOR });
  if (other) slices.push({ label: '분류 안 됨', value: other[1], color: OTHER_COLOR });
  return slices;
}

/** 지금 보유 종목 중 ETF를 구성종목으로 쪼갠 수 / 토스 ETF 섹터로 넣은 수(섹터 카드 설명용). */
export function sectorEtfCounts(holdings: FlatHolding[], sources: Record<string, string>) {
  const held = new Set(holdings.map((h) => h.symbol));
  const c = { components: 0, sector: 0 };
  for (const [s, src] of Object.entries(sources)) {
    if (!held.has(s)) continue;
    if (src === 'etf-components') c.components++;
    else if (src === 'etf-sector') c.sector++;
  }
  return c;
}

/** 보유종목 상세 팝업 "종목별" — 도넛은 상위 5로 접지만 여기선 전 종목을 수량까지. */
export function holdingDetailRows(holdings: FlatHolding[], toKrw: ToKrw) {
  const bySymbol = new Map<string, { name: string; valueKrw: number; quantity: number }>();
  for (const h of holdings) {
    const v = holdingValueKrw(h, toKrw);
    if (v === null) continue;
    const existing = bySymbol.get(h.symbol) ?? { name: h.name, valueKrw: 0, quantity: 0 };
    existing.valueKrw += v;
    existing.quantity += h.quantity;
    bySymbol.set(h.symbol, existing);
  }
  return Array.from(bySymbol.entries())
    .map(([symbol, v]) => ({ symbol, ...v }))
    .filter((e) => e.valueKrw > 0)
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

/** 팝업의 계좌 행 제목 — 계좌번호를 보통 글씨(`label`)로, 증권사·별칭을 아래 작은 글씨(`sub`)로(표의 AccountCell과 같은 모양, 2026-11-20). */
const accountTitle = (labels: AccountLabel[], broker: BrokerId, accountId: string | null): { label: string; sub: string } => {
  if (!accountId) return { label: '계좌 미지정', sub: BROKER_LABELS[broker] };
  const { number, label } = accountParts({ id: accountId }, findAccountLabel(labels, broker, accountId));
  return { label: number, sub: [BROKER_LABELS[broker], label].filter(Boolean).join(' · ') };
};

/**
 * 보유종목 상세 팝업 "계좌별" — (증권사, 계좌)로 묶어 계좌마다 평가금액·매입금액·손익률과 그 아래 종목별
 * 수량·평가금액. 평가금액은 종목별 보기와 같은 quantity*lastPrice라 두 보기의 합이 같다. IRP처럼 같은 종목이
 * memo로 나뉜 행(회사/개인 납입분)은 계좌 안에서 한 종목으로 합친다.
 */
export function holdingAccountRows(holdings: FlatHolding[], labels: AccountLabel[], toKrw: ToKrw) {
  const byAccount = new Map<
    string,
    {
      broker: BrokerId;
      accountId: string;
      valueKrw: number;
      purchaseKrw: number;
      bySymbol: Map<string, { name: string; valueKrw: number; quantity: number }>;
    }
  >();
  for (const h of holdings) {
    const v = holdingValueKrw(h, toKrw);
    if (v === null) continue;
    const key = `${h.broker}:${h.accountId}`;
    const entry = byAccount.get(key) ?? { broker: h.broker, accountId: h.accountId, valueKrw: 0, purchaseKrw: 0, bySymbol: new Map() };
    entry.valueKrw += v;
    entry.purchaseKrw += toKrw(h.purchaseAmount, h.currency) ?? 0;
    const sym = entry.bySymbol.get(h.symbol) ?? { name: h.name, valueKrw: 0, quantity: 0 };
    sym.valueKrw += v;
    sym.quantity += h.quantity;
    entry.bySymbol.set(h.symbol, sym);
    byAccount.set(key, entry);
  }
  return Array.from(byAccount.entries())
    .map(([key, e]) => {
      const rate = e.purchaseKrw > 0 ? (e.valueKrw - e.purchaseKrw) / e.purchaseKrw : null;
      return {
        key,
        ...accountTitle(labels, e.broker, e.accountId),
        valueKrw: e.valueKrw,
        meta: `${e.bySymbol.size}개 종목 · 매입 ${formatKrwValue(e.purchaseKrw)}${
          rate === null ? '' : ` · 손익 ${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`
        }`,
        brokerOrder: BROKER_ORDER.indexOf(e.broker),
        details: Array.from(e.bySymbol.entries())
          .map(([symbol, x]) => ({ label: `${x.name} (${symbol}) · ${x.quantity}주`, valueKrw: x.valueKrw }))
          .sort((a, b) => b.valueKrw - a.valueKrw),
      };
    })
    .filter((e) => e.valueKrw > 0)
    .sort((a, b) => b.valueKrw - a.valueKrw || a.brokerOrder - b.brokerOrder);
}

/** 배당 한 건의 원화 금액 — 달러는 지급월 평균 환율(rateFor), 환율이 없으면 null. */
function dividendKrw(d: DividendRecord, rateFor: RateFor): number | null {
  if (d.currency !== 'USD') return d.amount;
  const rate = rateFor(d.paidDate.slice(0, 7));
  return rate ? d.amount * rate : null;
}

/** 월별 배당금(막대) — `year`년, 통화별 원본 금액 그대로(환산은 DividendsChart가 달마다). */
export function dividendMonthlyRows(dividends: DividendRecord[], year: number): MonthlySummaryRow[] {
  const byMonth = new Map<string, { totalKrw: number; totalUsd: number; count: number }>();
  for (const d of dividends) {
    if (!d.paidDate.startsWith(String(year))) continue;
    const month = d.paidDate.slice(0, 7);
    const existing = byMonth.get(month) ?? { totalKrw: 0, totalUsd: 0, count: 0 };
    if (d.currency === 'USD') existing.totalUsd += d.amount;
    else existing.totalKrw += d.amount;
    existing.count += 1;
    byMonth.set(month, existing);
  }
  return Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** 날짜 접두어(`2026-10` 또는 `2026`)에 해당하는 배당을 종목별로 합쳐 큰 순서로(건수 포함). */
export function dividendSymbolRows(dividends: DividendRecord[], datePrefix: string, rateFor: RateFor) {
  const bySymbol = new Map<string, { name: string; valueKrw: number; count: number }>();
  for (const d of dividends) {
    if (!d.paidDate.startsWith(datePrefix)) continue;
    const v = dividendKrw(d, rateFor);
    if (v === null) continue;
    const existing = bySymbol.get(d.symbol) ?? { name: d.name, valueKrw: 0, count: 0 };
    existing.valueKrw += v;
    existing.count += 1;
    bySymbol.set(d.symbol, existing);
  }
  return Array.from(bySymbol.entries())
    .map(([symbol, v]) => ({ symbol, ...v }))
    .filter((e) => e.valueKrw > 0)
    .sort((a, b) => b.valueKrw - a.valueKrw);
}

/** 배당금 비중(도넛) — 종목별 상위 5 + 기타. */
export function dividendSlices(dividends: DividendRecord[], year: number, rateFor: RateFor): DonutSlice[] {
  return topNSlices(new Map(dividendSymbolRows(dividends, String(year), rateFor).map((r) => [r.symbol, r])));
}

/**
 * 배당 상세 팝업의 "계좌별" 보기(월별 배당 내역 / 연간 배당금 상세 공용) — 날짜 접두어에 해당하는 배당을
 * (증권사, 계좌)로 묶고 계좌 안에서 종목별 금액을 펼친다. 배당 기록의 accountId는 자유 입력이라 토스처럼
 * 표시용 계좌번호(별칭의 accountNumber)로 적혀 있을 수도 있어서, 같은 계좌가 두 줄로 갈리지 않도록
 * 그 경우 내부 accountId로 되돌려 묶는다.
 */
export function accountDividendRows(dividends: DividendRecord[], labels: AccountLabel[], datePrefix: string, rateFor: RateFor) {
  const byAccount = new Map<
    string,
    {
      broker: BrokerId;
      accountId: string | null;
      valueKrw: number;
      count: number;
      bySymbol: Map<string, { name: string; valueKrw: number; count: number }>;
    }
  >();
  for (const d of dividends) {
    if (!d.paidDate.startsWith(datePrefix)) continue;
    const v = dividendKrw(d, rateFor);
    if (v === null) continue;
    const byNumber = d.accountId ? labels.find((l) => l.broker === d.broker && l.accountNumber === d.accountId) : undefined;
    const accountId = byNumber ? byNumber.accountId : d.accountId;
    const key = `${d.broker}:${accountId ?? ''}`;
    const entry = byAccount.get(key) ?? { broker: d.broker, accountId, valueKrw: 0, count: 0, bySymbol: new Map() };
    entry.valueKrw += v;
    entry.count += 1;
    const sym = entry.bySymbol.get(d.symbol) ?? { name: d.name, valueKrw: 0, count: 0 };
    sym.valueKrw += v;
    sym.count += 1;
    entry.bySymbol.set(d.symbol, sym);
    byAccount.set(key, entry);
  }
  return Array.from(byAccount.entries())
    .map(([key, e]) => ({
      key,
      ...accountTitle(labels, e.broker, e.accountId),
      valueKrw: e.valueKrw,
      count: e.count,
      brokerOrder: BROKER_ORDER.indexOf(e.broker),
      details: Array.from(e.bySymbol.entries())
        .map(([symbol, x]) => ({
          // 연간 보기에선 한 종목이 여러 번 배당하므로 건수를 붙인다(월별은 대개 1건).
          label: `${x.name} (${symbol})${x.count > 1 ? ` · 배당 ${x.count}건` : ''}`,
          valueKrw: x.valueKrw,
        }))
        .sort((a, b) => b.valueKrw - a.valueKrw),
    }))
    .filter((e) => e.valueKrw > 0)
    .sort((a, b) => b.valueKrw - a.valueKrw || a.brokerOrder - b.brokerOrder);
}

/** 그 해 배당금 원화 합계 + 환율이 없어 빠진 달러 배당이 있는지. */
export function yearDividendTotal(rows: MonthlySummaryRow[], rateFor: RateFor) {
  const totalKrw = rows.reduce((sum, r) => {
    const rate = rateFor(r.month);
    return sum + r.totalKrw + (rate ? r.totalUsd * rate : 0);
  }, 0);
  return { totalKrw, hasUnconvertedUsd: rows.some((r) => r.totalUsd > 0 && !rateFor(r.month)) };
}

/**
 * "총 손익금액(배당 포함)" 카드의 배당 — 지금 보유 중인 (증권사, 계좌, 종목)마다 그 계좌의 그 종목에서 받은
 * 배당만 더한다. 보유 종목 화면의 "배당 포함 손익금액"과 같은 매칭 규칙(dividendMatch.ts)이라, 증권사별 보유 종목
 * 화면 값을 다 더하면 이 값과 같다. 전량 매도한 종목·그 종목을 이제 안 갖고 있는 계좌의 배당은 빠진다.
 */
export function heldDividendTotal(holdings: FlatHolding[], dividends: DividendRecord[], labels: AccountLabel[], rateFor: RateFor) {
  const accountsByBroker = new Map<BrokerId, Set<string>>();
  const heldKeys = new Set<string>();
  for (const h of holdings) {
    if (!h.accountId) continue;
    heldKeys.add(dividendKey(h.broker, h.accountId, h.symbol));
    const set = accountsByBroker.get(h.broker) ?? new Set<string>();
    set.add(h.accountId);
    accountsByBroker.set(h.broker, set);
  }
  const grouped = groupDividendsByAccountSymbol(dividends, labels, (broker) => {
    const set = accountsByBroker.get(broker);
    return set && set.size === 1 ? [...set][0] : null;
  });
  let totalKrw = 0;
  let unconverted = false;
  for (const [key, list] of grouped) {
    if (!heldKeys.has(key)) continue;
    for (const d of list) {
      if (d.currency !== 'USD') {
        totalKrw += d.amount;
        continue;
      }
      const rate = rateFor(d.paidDate.slice(0, 7));
      if (rate === null) unconverted = true;
      else totalKrw += d.amount * rate;
    }
  }
  return { totalKrw, unconverted };
}

export type MonthlyCloses = Record<string, { month: string; closePrice: number; currency: string }[]>;

/**
 * 매월 보유종목 투자금·평가금액(최근 12개월). 지금 보유 중인 종목만, 그 매매내역을 시간순으로 훑어 "그 달 말
 * 기준 누적 보유수량"만 재구성한다(거래가 없던 달은 직전 수량을 이어감). 투자금 = 그 수량 × **오늘 기준 평단가**
 * (오늘 매입금액 ÷ 오늘 수량 — 매매내역에서 원가를 재구성하면 다 안 모인 계좌 때문에 상단 "총 매입금액"과 어긋나서),
 * 평가금액 = 그 수량 × 그 달 실제 종가(없으면 오늘 현재가). `now`는 마지막 달(테스트용).
 */
export function monthlyAmountRows(
  holdings: FlatHolding[],
  trades: StoredTrade[],
  monthlyCloses: MonthlyCloses,
  toKrw: ToKrw,
  now: Date = new Date()
): MonthlyInvestmentRow[] {
  const lastPriceBySymbol = new Map<string, { lastPrice: number; currency: string | null }>();
  const avgCostKrwBySymbol = new Map<string, number>();
  for (const h of holdings) {
    if (h.lastPrice > 0 && !lastPriceBySymbol.has(h.symbol)) lastPriceBySymbol.set(h.symbol, { lastPrice: h.lastPrice, currency: h.currency });
    if (h.quantity <= 0 || avgCostKrwBySymbol.has(h.symbol)) continue;
    const investedKrw = toKrw(h.purchaseAmount, h.currency);
    if (investedKrw !== null) avgCostKrwBySymbol.set(h.symbol, investedKrw / h.quantity);
  }
  const closeBySymbolMonth = new Map<string, Map<string, { closePrice: number; currency: string }>>();
  for (const [symbol, rows] of Object.entries(monthlyCloses)) {
    closeBySymbolMonth.set(symbol, new Map(rows.map((r) => [r.month, { closePrice: r.closePrice, currency: r.currency }])));
  }

  const bySymbol = new Map<string, StoredTrade[]>();
  for (const t of trades) {
    if (!lastPriceBySymbol.has(t.symbol) || !avgCostKrwBySymbol.has(t.symbol)) continue; // 전량 매도했거나 평단가를 못 구하는 종목은 제외
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }

  // 같은 달에 거래가 여러 건이면 그 달의 마지막 수량으로 덮어써진다.
  const perSymbolMonthly = new Map<string, Map<string, number>>();
  let earliestMonth: string | null = null;
  for (const [symbol, symTrades] of bySymbol) {
    const sorted = [...symTrades].sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1));
    let qty = 0;
    const checkpoints = new Map<string, number>();
    for (const t of sorted) {
      qty += t.side === 'BUY' ? t.quantity : -Math.min(t.quantity, qty);
      const month = t.executedAt.slice(0, 7);
      checkpoints.set(month, qty);
      if (!earliestMonth || month < earliestMonth) earliestMonth = month;
    }
    perSymbolMonthly.set(symbol, checkpoints);
  }
  if (!earliestMonth) return [];

  const months: string[] = [];
  const cursor = new Date(`${earliestMonth}-01T00:00:00`);
  const end = new Date(now);
  end.setDate(1);
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const lastQty = new Map<string, number>();
  const rows: MonthlyInvestmentRow[] = [];
  for (const month of months) {
    let totalInvested = 0;
    let totalCurrent = 0;
    for (const [symbol, checkpoints] of perSymbolMonthly) {
      const cp = checkpoints.get(month);
      if (cp !== undefined) lastQty.set(symbol, cp);
      const qty = lastQty.get(symbol);
      if (!qty || qty <= 0) continue;
      const priceInfo = lastPriceBySymbol.get(symbol)!;
      totalInvested += qty * avgCostKrwBySymbol.get(symbol)!;
      // 그 달의 실제 종가(토스 일봉)가 있으면 그걸, 없으면 오늘 현재가로 대체 — 최근 달일수록 둘이 같아져 자연스럽게 이어진다.
      const price = closeBySymbolMonth.get(symbol)?.get(month) ?? { closePrice: priceInfo.lastPrice, currency: priceInfo.currency };
      totalCurrent += toKrw(qty * price.closePrice, price.currency) ?? 0;
    }
    if (totalInvested > 0) rows.push({ month, investedKrw: totalInvested, currentKrw: totalCurrent });
  }
  return rows.slice(-12);
}

export type IndexCloses = Record<string, Array<{ month: string; close: number }>>;

/**
 * 지수와 비교(월간 수익률) — 내 보유종목은 "(그 달 평가 변화 − 투자금 변화) ÷ 전월 평가"(단순 Dietz 근사, 신규 매수만으로
 * 수익률이 부풀지 않게), 지수는 월말 종가 대비. 첫 행은 전월이 없어 mine이 null.
 */
export function indexComparisonRows(rows: MonthlyInvestmentRow[], indexCloses: IndexCloses) {
  const idxReturn = (symbol: string, month: string): number | null => {
    const list = indexCloses[symbol] ?? [];
    const i = list.findIndex((x) => x.month === month);
    return i > 0 ? list[i].close / list[i - 1].close - 1 : null;
  };
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1] : null;
    const mine = prev && prev.currentKrw > 0 ? (r.currentKrw - prev.currentKrw - (r.investedKrw - prev.investedKrw)) / prev.currentKrw : null;
    return { month: r.month, mine, kospi: idxReturn('KOSPI', r.month), kosdaq: idxReturn('KOSDAQ', r.month) };
  });
}
