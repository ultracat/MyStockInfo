import type {
  BrokerAccount,
  BrokerAdapter,
  FetchOpts,
  HoldingPosition,
  PortfolioOverview,
  TradeRecord,
} from '../types';
import { getCredentialFields } from '../../credentials';
import { fetchKisBalance, fetchKisTradeHistory, isKisConfigured, type KisDailyCcldItem } from './kisClient';

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapTrade(item: KisDailyCcldItem): TradeRecord {
  const orderDate = String(item.ord_dt);
  return {
    id: String(item.odno),
    symbol: String(item.pdno),
    name: String(item.prdt_name),
    // sll_buy_dvsn_cd: 01 매도(SELL) / 02 매수(BUY), per the API's SLL_BUY_DVSN_CD param docs.
    side: item.sll_buy_dvsn_cd === '02' ? 'BUY' : 'SELL',
    quantity: num(item.tot_ccld_qty),
    price: num(item.avg_prvs),
    amount: num(item.tot_ccld_amt),
    currency: 'KRW',
    commission: null,
    tax: null,
    executedAt: `${orderDate.slice(0, 4)}-${orderDate.slice(4, 6)}-${orderDate.slice(6, 8)}`,
  };
}

function mapPosition(item: Awaited<ReturnType<typeof fetchKisBalance>>['items'][number]): HoldingPosition {
  return {
    symbol: String(item.pdno),
    name: String(item.prdt_name),
    market: 'KR',
    currency: 'KRW',
    quantity: num(item.hldg_qty),
    lastPrice: num(item.prpr),
    averagePurchasePrice: num(item.pchs_avg_pric),
    purchaseAmount: num(item.pchs_amt),
    marketValue: num(item.evlu_amt),
    profitLossAmount: num(item.evlu_pfls_amt),
    // KIS reports this as a percentage number (e.g. "15.23" meaning
    // 15.23%) — our common shape uses a decimal ratio (0.1523) to match
    // Toss's convention, so we normalize it here rather than in the UI.
    profitLossRate: num(item.evlu_pfls_rt) / 100,
    commission: null,
    tax: null,
  };
}

export const kisAdapter: BrokerAdapter = {
  id: 'kis',
  displayName: '한국투자증권',

  isConfigured(): boolean {
    return isKisConfigured();
  },

  async listAccounts(): Promise<BrokerAccount[]> {
    // KIS's Open API has no "list my accounts" endpoint (confirmed against
    // koreainvestment/open-trading-api) — the account number is entered
    // directly in Settings, so we just echo it back as a single account to
    // keep the shape the rest of the app (and frontend) already expects.
    const creds = getCredentialFields('kis');
    if (!creds) return [];
    return [
      {
        id: `${creds.accountNumber}-${creds.accountProductCode}`,
        accountNumber: creds.accountNumber,
        accountType: `상품코드 ${creds.accountProductCode}`,
      },
    ];
  },

  async getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview> {
    const { items, summary } = await fetchKisBalance(opts);

    try {
      const totalPurchaseAmountKrw = num(summary.pchs_amt_smtl_amt);
      const totalMarketValueKrw = num(summary.evlu_amt_smtl_amt);
      const totalProfitLossKrw = num(summary.evlu_pfls_smtl_amt);

      return {
        broker: 'kis',
        accountId,
        totalPurchaseAmountKrw,
        totalPurchaseAmountUsd: null,
        totalMarketValueKrw,
        totalMarketValueUsd: null,
        totalProfitLossKrw,
        totalProfitLossUsd: null,
        // KIS's output2 doesn't publish an aggregate P/L rate field (only
        // asst_icdc_erng_rt, a broader day-over-day asset-change metric) —
        // derived here instead of guessing a field that isn't there.
        profitLossRate: totalPurchaseAmountKrw > 0 ? totalProfitLossKrw / totalPurchaseAmountKrw : null,
        positions: items.map(mapPosition),
      };
    } catch (err) {
      console.error(
        '[kis] Failed to map inquire-balance response:',
        JSON.stringify({ items, summary }, null, 2)
      );
      throw new Error(
        `한국투자증권 보유 종목 응답을 처리하는 중 오류가 발생했습니다 (${(err as Error).message}). ` +
          '백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
      );
    }
  },

  async getTradeHistory(
    _accountId: string,
    range: { from: string; to: string },
    opts?: FetchOpts
  ): Promise<TradeRecord[]> {
    const items = await fetchKisTradeHistory(range.from, range.to, opts);
    // CCLD_DVSN='01' already asks for filled-only, but a cancelled order can
    // still surface with 0 filled quantity — drop those defensively.
    return items.filter((item) => num(item.tot_ccld_qty) > 0).map(mapTrade);
  },
};
