// 목표 비중·리밸런싱(리밸런싱 화면) — 순수 함수, 테스트 frontend/test/rebalance.test.ts.
//
// 규칙:
// - 같은 종목은 모든 증권사·계좌를 합친다(원화 환산 평가금액). 달러 종목은 환율이 있을 때만(없으면 계산에서 빼고 알린다).
// - **목표를 정한 종목끼리만** 맞춘다 — 목표가 없는 보유 종목은 "유지"(손대지 않음)로 따로 보여 준다. 목표 합이 100%가 아니면 100%로
//   비례 환산해 쓰고 화면이 알린다.
// - 추가 투자금(원)을 넣으면 그만큼 기준 금액이 늘어난다. "매수만" 보기는 팔지 않고 부족한 종목에 부족분 비율대로 나눈다.
import type { TargetWeight } from '../types';

export interface RebalanceHolding {
  symbol: string;
  name: string;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  marketValue: number;
}

export interface RebalanceRow {
  symbol: string;
  name: string;
  /** 원화 환산 평가금액(달러는 환율 적용). */
  valueKrw: number;
  /** 목표 대상 기준 금액 대비 현재 비중(%). 목표 없는 종목은 전체 대비. */
  currentPct: number;
  /** 정규화한 목표 비중(%) — 목표 없는 종목은 null. */
  targetPct: number | null;
  /** 목표 금액 − 현재(양수 = 사야 함, 음수 = 팔아야 함). 목표 없으면 0. */
  diffKrw: number;
  /** 그만큼의 대략적 수량(현재가 기준, 원화 환산) — 현재가가 없으면 null. */
  diffShares: number | null;
  /** "매수만" 보기에서 이 종목에 넣을 금액. */
  buyOnlyKrw: number;
  priceKrw: number | null;
}

export interface RebalanceResult {
  rows: RebalanceRow[];
  /** 목표 대상 종목의 평가금액 합 + 추가 투자금. */
  baseKrw: number;
  totalKrw: number;
  targetSum: number;
  /** 환율이 없어 뺀 달러 종목. */
  unconverted: string[];
}

export function rebalance(holdings: RebalanceHolding[], targets: TargetWeight[], fxRate: number | null, extraCashKrw = 0): RebalanceResult {
  const bySymbol = new Map<string, { name: string; valueKrw: number; priceKrw: number | null }>();
  const unconverted = new Set<string>();
  for (const h of holdings) {
    const rate = h.currency === 'USD' ? fxRate : 1;
    if (!rate) {
      unconverted.add(h.symbol);
      continue;
    }
    const cur = bySymbol.get(h.symbol) ?? { name: h.name, valueKrw: 0, priceKrw: h.lastPrice > 0 ? h.lastPrice * rate : null };
    cur.valueKrw += h.marketValue * rate;
    bySymbol.set(h.symbol, cur);
  }
  const targetSum = targets.reduce((s, t) => s + t.weight, 0);
  const targetBySymbol = new Map(targets.map((t) => [t.symbol, t]));
  const totalKrw = [...bySymbol.values()].reduce((s, v) => s + v.valueKrw, 0);
  const targetedValue = targets.reduce((s, t) => s + (bySymbol.get(t.symbol)?.valueKrw ?? 0), 0);
  const baseKrw = targetedValue + Math.max(0, extraCashKrw);

  const symbols = [...new Set([...targets.map((t) => t.symbol), ...bySymbol.keys()])];
  const shortfall = new Map<string, number>();
  const rows: RebalanceRow[] = symbols.map((symbol) => {
    const held = bySymbol.get(symbol);
    const t = targetBySymbol.get(symbol);
    const valueKrw = held?.valueKrw ?? 0;
    const targetPct = t && targetSum > 0 ? (t.weight / targetSum) * 100 : t ? 0 : null;
    const diffKrw = targetPct === null ? 0 : (baseKrw * targetPct) / 100 - valueKrw;
    if (targetPct !== null && diffKrw > 0) shortfall.set(symbol, diffKrw);
    const priceKrw = held?.priceKrw ?? null;
    return {
      symbol,
      name: held?.name ?? t?.name ?? symbol,
      valueKrw: Math.round(valueKrw),
      currentPct: targetPct === null ? (totalKrw > 0 ? (valueKrw / totalKrw) * 100 : 0) : baseKrw > 0 ? (valueKrw / baseKrw) * 100 : 0,
      targetPct,
      diffKrw: Math.round(diffKrw),
      diffShares: priceKrw ? diffKrw / priceKrw : null,
      buyOnlyKrw: 0,
      priceKrw,
    };
  });

  // 매수만 — 추가 투자금을 부족분 비율로 나눈다(부족분보다 많이 넣지 않는다).
  const need = [...shortfall.values()].reduce((s, v) => s + v, 0);
  const cash = Math.max(0, extraCashKrw);
  if (need > 0 && cash > 0) {
    const ratio = Math.min(1, cash / need);
    for (const r of rows) r.buyOnlyKrw = Math.round((shortfall.get(r.symbol) ?? 0) * ratio);
  }
  rows.sort((a, b) => (a.targetPct === null ? 1 : 0) - (b.targetPct === null ? 1 : 0) || b.valueKrw - a.valueKrw);
  return { rows, baseKrw: Math.round(baseKrw), totalKrw: Math.round(totalKrw), targetSum, unconverted: [...unconverted] };
}
