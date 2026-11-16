import type { StoredTrade } from '../types';

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
