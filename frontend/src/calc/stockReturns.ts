// 종목별 수익 표 정렬(순수 함수, 테스트: frontend/test/sort.test.ts) — 2026-11-20 StockReturns.tsx에서 뺐다.
import { sortByText, sortByValue } from './sort';

/** 표 한 줄 — 전부 KRW 환산 후의 값. */
export interface SymbolRow {
  symbol: string;
  name: string;
  /** 보유종목이 있으면 그 통화, 배당 기록만 있으면 그 기록의 통화. */
  currency: string | null;
  quantity: number;
  purchaseKrw: number;
  marketKrw: number;
  dividendKrw: number;
  /** 지금 보유 중인가(수량 > 0) — 전량 매도했지만 배당 기록만 남은 종목 구분용. */
  held: boolean;
  /** 환율을 못 구해 이 종목의 달러 금액 일부/전부가 빠졌는가. */
  unconverted: boolean;
}

export type StockReturnSortKey =
  | 'name'
  | 'purchase'
  | 'market'
  | 'valuation'
  | 'valuationRate'
  | 'dividend'
  | 'dividendRate'
  | 'totalReturn'
  | 'totalReturnRate';

/** 투자금 대비 비율 — 투자금이 0이면(배당 기록만 남은 종목) 없음. */
function rateOf(amount: number, purchaseKrw: number): number | null {
  return purchaseKrw > 0 ? amount / purchaseKrw : null;
}

/**
 * 종목별 수익 표 정렬. **"환율 미적용" 종목은 금액·비율 기준이면 방향과 상관없이 맨 뒤** — 환산 못 한 달러 금액이
 * 빠진 채 합쳐져 있어(StockReturns.tsx) 그 값으로 줄 세우면 실제 크기와 무관한 자리에 끼었다. 비율은 투자금이 0이면 맨 뒤.
 */
export function sortStockReturnRows(rows: SymbolRow[], key: StockReturnSortKey, asc: boolean): SymbolRow[] {
  if (key === 'name') return sortByText(rows, (r) => r.name || r.symbol, asc);
  const valueOf = (r: SymbolRow): number | null => {
    if (r.unconverted) return null;
    const valuation = r.marketKrw - r.purchaseKrw;
    switch (key) {
      case 'purchase':
        return r.purchaseKrw;
      case 'valuation':
        return valuation;
      case 'valuationRate':
        return rateOf(valuation, r.purchaseKrw);
      case 'dividend':
        return r.dividendKrw;
      case 'dividendRate':
        return rateOf(r.dividendKrw, r.purchaseKrw);
      case 'totalReturn':
        return valuation + r.dividendKrw;
      case 'totalReturnRate':
        return rateOf(valuation + r.dividendKrw, r.purchaseKrw);
      case 'market':
      default:
        return r.marketKrw;
    }
  };
  return sortByValue(rows, valueOf, asc);
}
