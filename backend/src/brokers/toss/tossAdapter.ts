import type {
  BrokerAccount,
  BrokerAdapter,
  ExchangeRate,
  FetchOpts,
  HoldingPosition,
  PortfolioOverview,
} from '../types';
import { fetchTossAccounts, fetchTossExchangeRate, fetchTossHoldings, isTossConfigured } from './tossClient';

function mapPosition(item: Awaited<ReturnType<typeof fetchTossHoldings>>['items'][number]): HoldingPosition {
  return {
    symbol: item.symbol,
    name: item.name,
    market: item.marketCountry ?? null,
    currency: item.currency ?? null,
    quantity: item.quantity,
    lastPrice: item.lastPrice,
    averagePurchasePrice: item.averagePurchasePrice,
    purchaseAmount: item.marketValue.purchaseAmount,
    marketValue: item.marketValue.amountAfterCost,
    profitLossAmount: item.profitLoss.amountAfterCost,
    profitLossRate: item.profitLoss.rateAfterCost,
    commission: item.cost.commission,
    tax: item.cost.tax,
  };
}

export const tossAdapter: BrokerAdapter = {
  id: 'toss',
  displayName: '토스증권',

  isConfigured(): boolean {
    return isTossConfigured();
  },

  async listAccounts(opts?: FetchOpts): Promise<BrokerAccount[]> {
    const accounts = await fetchTossAccounts(opts);
    return accounts.map((a) => ({
      id: String(a.accountSeq),
      accountNumber: a.accountNo,
      accountType: a.accountType,
    }));
  },

  async getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview> {
    const accountSeq = Number(accountId);
    const overview = await fetchTossHoldings(accountSeq, opts);

    try {
      return {
        broker: 'toss',
        accountId,
        totalPurchaseAmountKrw: overview.totalPurchaseAmount.krw,
        totalPurchaseAmountUsd: overview.totalPurchaseAmount.usd,
        totalMarketValueKrw: overview.marketValue.amountAfterCost.krw,
        totalMarketValueUsd: overview.marketValue.amountAfterCost.usd,
        totalProfitLossKrw: overview.profitLoss.amountAfterCost.krw,
        totalProfitLossUsd: overview.profitLoss.amountAfterCost.usd,
        profitLossRate: overview.profitLoss.rateAfterCost,
        positions: overview.items.map(mapPosition),
      };
    } catch (err) {
      // A field we expect (per developers.tossinvest.com/docs) is missing
      // or shaped differently on the live API — log the real payload so the
      // mapping above can be corrected against actual data, not assumptions.
      console.error('[toss] Failed to map /api/v1/holdings response:', JSON.stringify(overview, null, 2));
      throw new Error(
        `토스증권 보유 종목 응답을 처리하는 중 오류가 발생했습니다 (${(err as Error).message}). ` +
          '백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
      );
    }
  },

  async getExchangeRate(baseCurrency: string, quoteCurrency: string, opts?: FetchOpts): Promise<ExchangeRate> {
    const data = await fetchTossExchangeRate(baseCurrency, quoteCurrency, opts);
    return {
      baseCurrency: data.baseCurrency,
      quoteCurrency: data.quoteCurrency,
      rate: data.rate,
      midRate: data.midRate ?? null,
      asOf: data.validFrom ?? null,
    };
  },
};
