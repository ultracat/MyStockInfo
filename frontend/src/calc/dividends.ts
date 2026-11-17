import { BROKER_LABELS, BROKER_ORDER } from '../brokers';
import { krw, usdFmt } from '../format';
import type { BrokerId, DividendRecord, MonthlySummaryRow, StoredTrade, UpcomingDividend } from '../types';

// 배당금 화면의 투자금 계산(순수 함수) — Dividends.tsx에서 옮겼다(2026-11-17, 테스트: frontend/test/dividends.test.ts).

export interface BrokerInvested {
  krw: number;
  usd: number;
}

/** 종목 하나의 오늘 기준 평단가(브로커 안의 여러 계좌에 같은 심볼이 있으면
 *  가중평균) — "연도별 투자금 재구성"이 재구성한 수량에 곱하는 값. quantity는
 *  오늘 기준 실제 보유수량 합계 — 배당내역 팝업의 "총 주식갯수" 표시에 쓴다. */
export interface BrokerSymbolCost {
  avgCost: number;
  currency: string;
  quantity: number;
}

/** 종목별 평단가 — 보유 행(여러 계좌에 같은 심볼이 있으면 가중평균)에서. 수량 0 이하·통화 없는 행은 뺀다. */
export function buildAvgCostMap(
  rows: { symbol: string; currency: string | null; quantity: number; purchaseAmount: number }[]
): Map<string, BrokerSymbolCost> {
  const bySymbol = new Map<string, { amount: number; qty: number; currency: string }>();
  for (const r of rows) {
    if (r.quantity <= 0 || !r.currency) continue;
    const existing = bySymbol.get(r.symbol) ?? { amount: 0, qty: 0, currency: r.currency };
    existing.amount += r.purchaseAmount;
    existing.qty += r.quantity;
    bySymbol.set(r.symbol, existing);
  }
  const result = new Map<string, BrokerSymbolCost>();
  for (const [symbol, v] of bySymbol) {
    if (v.qty > 0) result.set(symbol, { avgCost: v.amount / v.qty, currency: v.currency, quantity: v.qty });
  }
  return result;
}

/**
 * 연도 말(`cutoff`, "YYYY-12-31") 기준 투자금 재구성 — 그 시점까지의 매매내역으로 종목별 보유수량을 다시 세고, **오늘 평단가**를
 * 곱한다(그 시점 평단가 이력이 없어서). 지금 안 갖고 있는 종목은 대상이 아니다.
 * - 매도는 그때 가진 수량까지만 뺀다(매수 기록이 덜 모였을 때 음수가 되지 않게).
 * - **재구성 수량은 오늘 실제 보유수량을 넘지 않게 묶는다** — 매도 기록이 다 모여 있지 않거나 매매내역이 중복 저장되면
 *   재구성 수량이 터무니없이 커진다(실사례: 중복으로 NVDY 448주 → 1,631주, 투자금이 2배로 부풀려짐). 매도를 거의 안 하는
 *   배당 포트폴리오에선 오늘 수량이 사실상 상한이다.
 */
export function investedAsOf(costs: Map<string, BrokerSymbolCost>, trades: StoredTrade[], cutoff: string): BrokerInvested {
  const tradesBySymbol = new Map<string, StoredTrade[]>();
  for (const t of trades) {
    if (!costs.has(t.symbol)) continue; // 지금 안 갖고 있는 종목은 대상 아님
    if (!tradesBySymbol.has(t.symbol)) tradesBySymbol.set(t.symbol, []);
    tradesBySymbol.get(t.symbol)!.push(t);
  }
  let krw = 0;
  let usd = 0;
  for (const [symbol, cost] of costs) {
    const symTrades = (tradesBySymbol.get(symbol) ?? [])
      .filter((t) => t.executedAt <= cutoff)
      .sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1));
    let qty = 0;
    for (const t of symTrades) qty += t.side === 'BUY' ? t.quantity : -Math.min(t.quantity, qty);
    qty = Math.min(qty, cost.quantity);
    if (qty <= 0) continue;
    const amount = qty * cost.avgCost;
    if (cost.currency === 'USD') usd += amount;
    else krw += amount;
  }
  return { krw, usd };
}

// ---------------------------------------------------------------- 배당금 화면 요약(2026-11-17 Dividends.tsx에서 뺐다)

// 그래프의 예상 배당을 배당 기록(세후)과 같은 기준으로 맞추는 원천징수율 가정 — 국내 배당소득세 15.4%, 미국 현지 15%.
export const KR_WITHHOLDING = 0.154;
export const US_WITHHOLDING = 0.15;

export type YearFilter = 'ALL' | number;
export type BrokerFilter = 'ALL' | BrokerId;

/** 월별 배당 합계(통화별 원본 금액) — 막대 그래프 입력. */
export function monthlySummaryRows(records: DividendRecord[]): MonthlySummaryRow[] {
  const byMonth = new Map<string, { totalKrw: number; totalUsd: number; count: number }>();
  for (const r of records) {
    const month = r.paidDate.slice(0, 7);
    const existing = byMonth.get(month) ?? { totalKrw: 0, totalUsd: 0, count: 0 };
    if (r.currency === 'USD') existing.totalUsd += r.amount;
    else existing.totalKrw += r.amount;
    existing.count += 1;
    byMonth.set(month, existing);
  }
  return Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, ...v }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** 받은 기록과 다가오는 배당의 지급일이 이만큼(일) 안이면 같은 배당으로 본다 — 실제 입금일·직접 적은 날짜가 예상 지급일과 하루이틀
 *  어긋나도 맞추되, 미국 주간 분배 ETF(7일 간격)의 다음 주 몫은 남게 7일보다 좁게. */
const RECEIVED_MATCH_DAYS = 3;
const dayNumber = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 864e5;

/**
 * 다가오는 배당에서 **이미 받은 것**을 뺀다 — 다가오는 배당은 지급일 당일까지 남는데(입금이 오후 늦게 되기도 함), **같은 계좌에 같은
 * 종목의 배당이 들어왔으면**(받은 배당 기록 — 토스·NH·키움은 실제 입금, KB 등은 직접 입력, 한국투자증권은 지급일 동기화) 그때 목록·
 * 그래프에서 빠진다(2026-11-17 사용자 요청). 같은 증권사·**계좌**·종목이고 지급일이 앞뒤 3일 안이면 같은 배당 — 한 증권사 여러 계좌에
 * 같은 종목이 있으면 받은 계좌 몫만 빠진다(계좌 칸이 빈 기록은 그 증권사 전체로 본다).
 */
export function excludeReceived(
  items: UpcomingDividend[],
  received: Pick<DividendRecord, 'broker' | 'accountId' | 'symbol' | 'paidDate'>[]
): UpcomingDividend[] {
  const byKey = new Map<string, Array<{ accountId: string | null; day: number }>>();
  for (const r of received) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.paidDate)) continue;
    const k = `${r.broker}|${r.symbol}`;
    byKey.set(k, [...(byKey.get(k) ?? []), { accountId: r.accountId ?? null, day: dayNumber(r.paidDate) }]);
  }
  return items.filter((i) => {
    if (!i.payDate) return true;
    const day = dayNumber(i.payDate);
    const got = byKey.get(`${i.broker}|${i.symbol}`) ?? [];
    return !got.some((r) => Math.abs(r.day - day) <= RECEIVED_MATCH_DAYS && (r.accountId === null || i.accountId === null || r.accountId === i.accountId));
  });
}

/**
 * 그래프의 흐린 "예상" 막대 — 아직 지급 전인 다가오는 배당(확정·예상·추정)을 지급월(없으면 기준월)로 묶는다.
 * 배당 기록은 **세후**라 같은 기준으로 맞춘다: 세금이 있으면(확정, ISA·연금 계좌의 원화 건은 0) 세전 − 세금, 없으면 원천징수를 가정해 국내 15.4%·미국 15%를 뺀다
 * (ETF 분배금의 과세 대상분 차이 등은 무시한 근사). 그래프와 같은 증권사·연도 필터를 탄다.
 * 받은 것은 호출부가 `excludeReceived`로 미리 뺀다.
 */
export function upcomingMonthlyRows(items: UpcomingDividend[], broker: BrokerFilter, year: YearFilter): MonthlySummaryRow[] {
  const byMonth = new Map<string, MonthlySummaryRow>();
  for (const i of items) {
    if (broker !== 'ALL' && i.broker !== broker) continue;
    const month = (i.payDate ?? i.recordDate ?? '').slice(0, 7);
    if (!month || (year !== 'ALL' && !month.startsWith(String(year)))) continue;
    const net = i.tax !== null ? i.grossAmount - i.tax : i.grossAmount * (1 - (i.currency === 'USD' ? US_WITHHOLDING : KR_WITHHOLDING));
    const row = byMonth.get(month) ?? { month, totalKrw: 0, totalUsd: 0, count: 0 };
    if (i.currency === 'USD') row.totalUsd += net;
    else row.totalKrw += Math.round(net);
    row.count += 1;
    byMonth.set(month, row);
  }
  return [...byMonth.values()];
}

/** 종목별 오늘 보유수량 — 특정 증권사면 그 증권사만, 전체면 전 증권사 합(배당 팝업의 "총 주식갯수"). */
export function quantityBySymbol(avgCostByBroker: Partial<Record<BrokerId, Map<string, BrokerSymbolCost>>>, broker: BrokerFilter) {
  const m = new Map<string, number>();
  const brokerIds = broker === 'ALL' ? (Object.keys(avgCostByBroker) as BrokerId[]) : [broker];
  for (const brokerId of brokerIds) {
    const costs = avgCostByBroker[brokerId];
    if (!costs) continue;
    for (const [symbol, v] of costs) m.set(symbol, (m.get(symbol) ?? 0) + v.quantity);
  }
  return m;
}

export interface BrokerDividendSums {
  /** 통화별 원본 합계(원화/달러 행). */
  krw: number;
  usd: number;
  /** 기록마다 지급월 평균 환율로 먼저 환산해 더한 원화 합계(합계(환산) 행·총합계) — 브로커 합계를 낸 뒤 환율 하나로 곱하면
   *  달마다 다른 환율을 반영할 수 없어서. 환율이 없는 달러 배당은 unconvertedUsd로. */
  krwTotal: number;
  unconvertedUsd: number;
}

export function brokerDividendSums(records: DividendRecord[], rateFor: (month: string) => number | null) {
  const byBroker = new Map<BrokerId, BrokerDividendSums>();
  for (const r of records) {
    const e = byBroker.get(r.broker) ?? { krw: 0, usd: 0, krwTotal: 0, unconvertedUsd: 0 };
    if (r.currency === 'USD') {
      e.usd += r.amount;
      const rate = rateFor(r.paidDate.slice(0, 7));
      if (rate) e.krwTotal += r.amount * rate;
      else e.unconvertedUsd += r.amount;
    } else {
      e.krw += r.amount;
      e.krwTotal += r.amount;
    }
    byBroker.set(r.broker, e);
  }
  return byBroker;
}

export interface BrokerLine {
  broker: BrokerId;
  /** 맨 왼쪽 한 칸 — 묶음 첫 줄은 증권사명, 나머지는 들여쓴 구분 라벨. 별도 "구분" 열은 두지 않는다(사용자 피드백). */
  label: string;
  muted: boolean;
  invested: string;
  dividend: string;
  yieldText: string;
}

const pct = (y: number | null) => (y !== null ? `${(y * 100).toFixed(2)}%` : '-');

/**
 * "증권사별 배당금 총계" 표의 줄. 달러 투자금/배당이 있는 증권사는 원화/달러/합계(환산) 3줄 — 통화별 실제 수익률과 환산
 * 합계를 각각 보여주려고. 투자금(매입원가)은 지금 값이라 오늘 환율(fxRate)로, 배당은 지급월 평균 환율로 환산해 둔 krwTotal을 쓴다.
 * `investedPlaceholder`는 투자금이 없을 때(불러오는 중/조회 실패/-) 칸 글자.
 */
export function brokerLines(
  sums: Map<BrokerId, BrokerDividendSums>,
  invested: Partial<Record<BrokerId, BrokerInvested>>,
  fxRate: number | null,
  investedPlaceholder: (broker: BrokerId) => string
): BrokerLine[] {
  // 배당 기록도 없고 투자금도 0인 브로커는 뺀다(CSV 전용 브로커는 보유종목이 없어도 0/0 항목이 있다).
  const ids = new Set<BrokerId>([
    ...sums.keys(),
    ...(Object.entries(invested) as [BrokerId, BrokerInvested][]).filter(([, inv]) => inv.krw > 0 || inv.usd > 0).map(([id]) => id),
  ]);
  const lines: BrokerLine[] = [];
  for (const brokerId of BROKER_ORDER.filter((id) => ids.has(id))) {
    const dividend = sums.get(brokerId) ?? { krw: 0, usd: 0, krwTotal: 0, unconvertedUsd: 0 };
    const inv = invested[brokerId] ?? null;
    const investedKrw = inv?.krw ?? null;
    const investedUsd = inv?.usd ?? null;
    const placeholder = investedPlaceholder(brokerId);
    const hasUsd = (investedUsd !== null && investedUsd > 0) || dividend.usd > 0;
    const krwLine: BrokerLine = {
      broker: brokerId,
      label: BROKER_LABELS[brokerId],
      muted: false,
      invested: investedKrw !== null ? `${krw.format(investedKrw)}원` : placeholder,
      dividend: `${krw.format(dividend.krw)}원`,
      yieldText: pct(investedKrw && investedKrw > 0 ? dividend.krw / investedKrw : null),
    };
    lines.push(krwLine);
    if (!hasUsd) continue;

    const usdYield = investedUsd && investedUsd > 0 ? dividend.usd / investedUsd : null;
    const investedTotalKrw = (investedKrw ?? 0) + (fxRate ? (investedUsd ?? 0) * fxRate : 0);
    const dividendFxMissing = dividend.unconvertedUsd > 0;
    const totalYield = fxRate && !dividendFxMissing && investedTotalKrw > 0 ? dividend.krwTotal / investedTotalKrw : null;
    lines.push({
      broker: brokerId,
      label: '　달러',
      muted: true,
      invested: investedUsd !== null ? usdFmt.format(investedUsd) : placeholder,
      dividend: usdFmt.format(dividend.usd),
      yieldText: pct(usdYield),
    });
    lines.push({
      broker: brokerId,
      label: '　합계(환산)',
      muted: true,
      invested: fxRate ? `${krw.format(Math.round(investedTotalKrw))}원` : '환율 미적용',
      dividend: !dividendFxMissing ? `${krw.format(Math.round(dividend.krwTotal))}원` : '환율 미적용',
      yieldText: pct(totalYield),
    });
  }
  return lines;
}

/**
 * "총합계" 타일 — 환산된 단일 숫자. 브로커 하나라도 투자금 조회가 안 됐으면(로딩/에러) 부분합을 총합처럼 보여주지 않는다.
 * 투자금은 오늘 환율, 배당은 지급월 환율로 이미 환산한 값 — "환율 미적용" 조건이 서로 달라 따로 판단한다.
 */
export function grandTotal(
  sums: Map<BrokerId, BrokerDividendSums>,
  invested: Partial<Record<BrokerId, BrokerInvested>>,
  fxRate: number | null,
  investedLoading: boolean
) {
  const ids = new Set<BrokerId>([...sums.keys(), ...(Object.keys(invested) as BrokerId[])]);
  let dividendKrwTotal = 0;
  let dividendUnconvertedUsd = 0;
  let investedKrw = 0;
  let investedUsd = 0;
  let missingInvested = false;
  for (const id of ids) {
    const div = sums.get(id);
    if (div) {
      dividendKrwTotal += div.krwTotal;
      dividendUnconvertedUsd += div.unconvertedUsd;
    }
    const inv = invested[id];
    if (inv) {
      investedKrw += inv.krw;
      investedUsd += inv.usd;
    } else {
      missingInvested = true;
    }
  }
  const investedTotal = investedKrw + (fxRate ? investedUsd * fxRate : 0);
  const investedFxMissing = !fxRate && investedUsd > 0;
  const dividendFxMissing = dividendUnconvertedUsd > 0;
  return {
    hasAny: ids.size > 0,
    dividendText: dividendFxMissing ? '환율 미적용' : `${krw.format(Math.round(dividendKrwTotal))}원`,
    investedText: investedLoading
      ? '불러오는 중...'
      : missingInvested
        ? '일부 조회 실패'
        : investedFxMissing
          ? '환율 미적용'
          : `${krw.format(Math.round(investedTotal))}원`,
    yieldText:
      !missingInvested && !investedFxMissing && !dividendFxMissing && investedTotal > 0
        ? `${((dividendKrwTotal / investedTotal) * 100).toFixed(2)}%`
        : '-',
  };
}
