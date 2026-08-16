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

/** `(broker, accountId)` → 사람이 읽을 수 있는 별칭. Settings.tsx에서만 관리하고
 *  Dashboard.tsx/Trades.tsx/Dividends.tsx는 표시할 때 읽기만 한다. */
export interface AccountLabel {
  broker: BrokerId;
  accountId: string;
  label: string;
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
  /** 브로커 안에서 계좌를 구분하기 위한 선택 필드(예: KB증권 한 곳에 여러 계좌가
   *  있는 경우) — 없으면 null. holdings-store/trades-store의 accountId와 같은
   *  문자열을 쓰면 그 화면들과도 같은 계좌로 매칭된다. */
  accountId: string | null;
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
