import type { BrokerId, StoredTrade } from '../types';
import { sortByText, sortByValue } from './sort';

// 실현손익 계산(순수 함수) — RealizedGains.tsx에서 옮겼다(2026-11-17, 테스트: frontend/test/realizedGains.test.ts).
// 계산 방식·과세 범위에 대한 긴 설명은 RealizedGains.tsx 상단 주석을 본다.

// 해외주식 양도소득세의 기본공제/세율 — 매년 바뀔 수 있는 값이라 "참고용
// 추정치"라는 캡션과 함께만 쓴다(공식 세무 자료 대체 아님).
export const TAX_FREE_ALLOWANCE_KRW = 2_500_000;
export const TAX_RATE = 0.22;
// 금융소득종합과세 기준 — 이자+배당소득이 연 이 금액을 넘으면 초과분이 다른
// 종합소득과 합산돼 누진세율로 과세된다(그 이하는 원천징수 15.4%로 끝).
export const FINANCIAL_INCOME_THRESHOLD_KRW = 20_000_000;

export interface RealizedSale {
  date: string;
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string | null;
  quantity: number;
  /** 거래 통화 — 해외주식 양도소득세(22%)는 해외 상장 종목에만 해당해서, 국내
   *  상장(KRW) 매도와 가르는 기준으로 쓴다. */
  currency: string;
  proceedsKrw: number;
  costKrw: number;
  gainKrw: number;
}

/** 해외주식 양도소득세 추정(참고용) — 기본공제 후 22%, 손실이면 0. */
export function estimateOverseasCapitalGainsTax(totalGainKrw: number): number {
  return Math.max(0, totalGainKrw - TAX_FREE_ALLOWANCE_KRW) * TAX_RATE;
}

/**
 * 매도 건별 실현손익 — 이동평균법(종목별로 원가를 누적하다 매도마다 평균단가 × 매도수량만큼 덜어냄).
 * - 매수 부대비용은 취득원가에 더하고, 매도 부대비용은 양도가액에서 뺀다.
 * - 달러 거래는 `rateFor("YYYY-MM")`(그 달 평균, 없으면 대체 환율)로 원화 환산한다. 한 종목의 달러 거래 중 **하나라도**
 *   환율이 없으면 그 종목 전체를 계산에서 빼고 `excludedSymbols`에 넣는다(일부만 반영하면 원가 추적이 깨진다).
 * - 매수 기록보다 많이 판 경우(로컬 매매내역이 덜 모인 경우) 있는 수량만큼만 반영한다.
 * - 결과는 최근 매도부터.
 */
export function computeRealizedSales(
  trades: StoredTrade[],
  rateFor: (month: string) => number | null
): { sales: RealizedSale[]; excludedSymbols: string[] } {
  const bySymbol = new Map<string, StoredTrade[]>();
  for (const t of trades) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol)!.push(t);
  }

  const results: RealizedSale[] = [];
  const excluded: string[] = [];

  for (const [symbol, symTrades] of bySymbol) {
    const sorted = [...symTrades].sort((a, b) =>
      a.executedAt < b.executedAt ? -1 : a.executedAt > b.executedAt ? 1 : 0
    );

    // 이 종목의 모든 달러 거래가 환산 가능한지 먼저 확인한다 — 하나라도
    // 못 구하면(월평균도 없고 effectiveFxRate도 없음) 이 종목 전체를 계산에서
    // 뺀다(일부 거래만 반영하면 원가 추적 자체가 깨져서 숫자가 틀어짐).
    const canCompute = sorted.every(
      (t) => t.currency !== 'USD' || rateFor(t.executedAt.slice(0, 7)) !== null
    );
    if (!canCompute) {
      excluded.push(symbol);
      continue;
    }

    let qty = 0;
    let totalCostKrw = 0;

    for (const t of sorted) {
      const rate = t.currency === 'USD' ? rateFor(t.executedAt.slice(0, 7))! : 1;
      const grossKrw = t.amount * rate;
      const feeKrw = ((t.commission ?? 0) + (t.tax ?? 0)) * rate;

      if (t.side === 'BUY') {
        qty += t.quantity;
        totalCostKrw += grossKrw + feeKrw; // 매수 부대비용은 취득원가에 가산
        continue;
      }

      // SELL — 매수 기록 없이(또는 수량이 모자라게) 매도만 있으면 그만큼은
      // 원가를 알 수 없다. 로컬 매매내역이 다 안 모여있을 수 있다는, 이 앱
      // 여러 화면에 이미 있는 한계와 같은 이유 — 있는 수량만큼만 반영한다.
      if (qty <= 0) continue;
      const soldQty = Math.min(t.quantity, qty);
      const soldFraction = soldQty / t.quantity;
      const avgCost = totalCostKrw / qty;
      const costKrw = avgCost * soldQty;
      const proceedsKrw = grossKrw * soldFraction - feeKrw * soldFraction; // 매도 부대비용은 양도가액에서 차감
      results.push({
        date: t.executedAt,
        broker: t.broker,
        accountId: t.accountId,
        symbol,
        name: t.name,
        quantity: soldQty,
        currency: t.currency,
        proceedsKrw,
        costKrw,
        gainKrw: proceedsKrw - costKrw,
      });
      qty -= soldQty;
      totalCostKrw -= costKrw;
    }
  }

  results.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { sales: results, excludedSymbols: excluded.sort() };
}

export type RealizedSortKey = 'date' | 'name' | 'proceeds' | 'gain' | 'gainRate';

/** 매도 내역 표 정렬(2026-11-20) — 금액은 이미 원화 환산값. 수익률은 취득금액이 0이면 맨 뒤(calc/sort.ts). */
export function sortRealizedSales(rows: RealizedSale[], key: RealizedSortKey, asc: boolean): RealizedSale[] {
  switch (key) {
    case 'name':
      return sortByText(rows, (s) => s.name || s.symbol, asc);
    case 'proceeds':
      return sortByValue(rows, (s) => s.proceedsKrw, asc);
    case 'gain':
      return sortByValue(rows, (s) => s.gainKrw, asc);
    case 'gainRate':
      return sortByValue(rows, (s) => (s.costKrw > 0 ? s.gainKrw / s.costKrw : null), asc);
    case 'date':
    default:
      return sortByText(rows, (s) => s.date, asc);
  }
}

/** 표 합계 줄 — 매도·취득·손익 합과 손익률(취득 0이면 null). */
export function realizedTotals(rows: RealizedSale[]): { proceedsKrw: number; costKrw: number; gainKrw: number; rate: number | null } {
  const t = rows.reduce((a, s) => ({ proceedsKrw: a.proceedsKrw + s.proceedsKrw, costKrw: a.costKrw + s.costKrw, gainKrw: a.gainKrw + s.gainKrw }), {
    proceedsKrw: 0,
    costKrw: 0,
    gainKrw: 0,
  });
  return { ...t, rate: t.costKrw > 0 ? t.gainKrw / t.costKrw : null };
}
