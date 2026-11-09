export type BrokerId = 'toss' | 'kis' | 'nh' | 'kb' | 'samsung' | 'mirae';

export interface BrokerAccount {
  /** Adapter-specific identifier to pass into getPortfolio(). */
  id: string;
  accountNumber?: string;
  accountType?: string;
  /** 모의투자 계좌(NH 나무의 acct_type 03) — 보유·매매 화면에서 고를 수만 있고, 합계·스냅샷·배당 동기화·로컬
   *  저장소(write-through)에는 넣지 않는다(실제 자산이 아니라서). `listAccounts({ includePaper: true })`일 때만 온다. */
  paper?: boolean;
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
  /** 예수금(현금 보유분) — 브로커 Open API가 이 정보를 안 주면(또는 조회가
   *  실패하면) null. CSV 전용 브로커는 어댑터 자체가 없어 이 필드가 적용되지
   *  않는다(프론트가 "미지원"으로 고정 표시, backend/CLAUDE.md의 "계좌별 예수금"
   *  절 참고). */
  cashBalanceKrw: number | null;
  cashBalanceUsd: number | null;
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
  /** `includePaper`: 모의투자 계좌도 포함(지원하는 브로커만 — 지금은 NH). 기본은 실전 계좌만. */
  listAccounts(opts?: FetchOpts & { includePaper?: boolean }): Promise<BrokerAccount[]>;
  /** 이 계좌가 모의투자인가 — 라우트가 로컬 저장소 write-through를 건너뛰는 데 쓴다. 없으면 실전으로 본다. */
  isPaperAccount?(accountId: string): Promise<boolean>;
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
