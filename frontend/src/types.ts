export type BrokerId = 'toss' | 'kis' | 'kb' | 'samsung' | 'mirae';

export interface BrokerSummary {
  id: BrokerId;
  displayName: string;
  configured: boolean;
}

export interface BrokerAccount {
  id: string;
  accountNumber?: string;
  accountType?: string;
}

export interface HoldingPosition {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  profitLossRate: number;
  commission: number | null;
  tax: number | null;
}

export interface PortfolioOverview {
  broker: BrokerId;
  accountId: string;
  totalPurchaseAmountKrw: number;
  totalPurchaseAmountUsd: number | null;
  totalMarketValueKrw: number;
  totalMarketValueUsd: number | null;
  totalProfitLossKrw: number;
  totalProfitLossUsd: number | null;
  profitLossRate: number | null;
  positions: HoldingPosition[];
}

/** 로컬 저장소(backend/src/db/holdingsStore.ts)에 저장된 보유종목 스냅샷 한 줄 —
 *  실시간 조회(`GET /api/holdings/:broker/:accountId`) 성공 시 write-through로
 *  갱신되거나, CSV 가져오기로 채워진다. */
export interface StoredHolding {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  profitLossRate: number;
  commission: number | null;
  tax: number | null;
  updatedAt: string;
}

/** 로컬 저장소(backend/src/db/tradesStore.ts)에 저장된 매매내역 한 줄. */
export interface StoredTrade {
  broker: BrokerId;
  accountId: string;
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  commission: number | null;
  tax: number | null;
  executedAt: string;
}

export type DividendCurrency = 'KRW' | 'USD';

export interface DividendRecord {
  id: string;
  broker: BrokerId;
  symbol: string;
  name: string;
  currency: DividendCurrency;
  /** Amount in `currency` — not converted (frontend converts USD rows to KRW for combined totals). */
  amount: number;
  paidDate: string;
  memo: string | null;
}

export interface MonthlySummaryRow {
  month: string;
  totalKrw: number;
  totalUsd: number;
  count: number;
}

// CSV 전용 브로커(KB/삼성/미래에셋)는 자격증명이 없어 이 응답에 값이 없을 수
// 있다 — Partial. 고정 필드 대신 BrokerId로 인덱싱할 수 있어야 해서 Record로 바꿈.
export type CredentialStatus = Partial<Record<BrokerId, boolean>>;

export interface ExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  midRate: number | null;
  asOf: string | null;
}

export interface CredentialFieldSpec {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  /** Not every broker's execution-history API returns a display name (Toss's doesn't) — falls back to symbol in the UI. */
  name: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  commission: number | null;
  tax: number | null;
  executedAt: string;
}

export interface StockInfo {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
}
