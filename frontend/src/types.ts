export type BrokerId = 'toss' | 'kis' | 'kb';

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

export interface CredentialStatus {
  toss: boolean;
  kis: boolean;
  kb: boolean;
}

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
