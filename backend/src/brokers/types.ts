export type BrokerId = 'toss' | 'kis' | 'kb' | 'samsung' | 'mirae';

export interface BrokerAccount {
  /** Adapter-specific identifier to pass into getPortfolio(). */
  id: string;
  accountNumber?: string;
  accountType?: string;
}

export interface HoldingPosition {
  symbol: string;
  name: string;
  /** Raw string from the broker (e.g. "KR" / "US") — not enumerated, since brokers differ. */
  market: string | null;
  /** Raw currency code from the broker (e.g. "KRW" / "USD"). */
  currency: string | null;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  /** In position currency, after tax/fee deduction where the broker provides it. */
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  /** Decimal ratio, e.g. 0.1077 = 10.77%. */
  profitLossRate: number;
  commission: number | null;
  tax: number | null;
  /** CSV 가져오기에서만 쓰인다(예: IRP 계좌의 "개인납입액"/"회사납입액") — 같은
   *  심볼이 한 계좌에 여러 행으로 존재할 때 구분하기 위한 자유 텍스트. 라이브
   *  브로커 어댑터는 채우지 않는다. */
  memo?: string | null;
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

export interface ExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  /** 1 baseCurrency = ? quoteCurrency. */
  rate: number;
  /** Interbank mid rate, when the broker distinguishes it from the buy rate. */
  midRate: number | null;
  asOf: string | null;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  /** Not every broker's execution-history API returns a display name (Toss's doesn't) — falls back to symbol in the UI. */
  name: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  /** Average fill price, in `currency`. */
  price: number;
  /** Total filled amount, in `currency` (broker-reported, not recomputed from quantity*price). */
  amount: number;
  /** Raw currency code from the broker (e.g. "KRW" / "USD"). */
  currency: string;
  commission: number | null;
  tax: number | null;
  /** Execution date, YYYY-MM-DD (day granularity — good enough for monthly aggregation). */
  executedAt: string;
}

/** Bypasses the response cache (see brokers/responseCache.ts) and re-fetches from the broker. */
export interface FetchOpts {
  forceRefresh?: boolean;
}

export interface BrokerAdapter {
  id: BrokerId;
  displayName: string;
  isConfigured(): boolean;
  listAccounts(opts?: FetchOpts): Promise<BrokerAccount[]>;
  getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview>;
  /** Not every broker's Open API publishes this — omit when it doesn't. */
  getExchangeRate?(baseCurrency: string, quoteCurrency: string, opts?: FetchOpts): Promise<ExchangeRate>;
  /** Not every broker's Open API publishes this — omit when it doesn't. `from`/`to` are inclusive YYYY-MM-DD. */
  getTradeHistory?(
    accountId: string,
    range: { from: string; to: string },
    opts?: FetchOpts
  ): Promise<TradeRecord[]>;
}
