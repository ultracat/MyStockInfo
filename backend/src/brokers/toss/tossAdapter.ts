import type {
  BrokerAccount,
  BrokerAdapter,
  ExchangeRate,
  FetchOpts,
  HoldingPosition,
  PortfolioOverview,
  TradeRecord,
} from '../types';
import {
  fetchTossAccounts,
  fetchTossBuyingPower,
  fetchTossExchangeRate,
  fetchTossHoldings,
  fetchTossOrders,
  isTossConfigured,
  type TossOrder,
} from './tossClient';

function mapOrder(o: TossOrder): TradeRecord {
  return {
    id: o.orderId,
    symbol: o.symbol,
    // Toss's Order schema has no display name field — the UI falls back to symbol.
    name: null,
    side: o.side,
    quantity: o.execution.filledQuantity,
    price: o.execution.averageFilledPrice ?? o.price ?? 0,
    amount: o.execution.filledAmount ?? 0,
    currency: o.currency,
    commission: o.execution.commission,
    tax: o.execution.tax,
    // filledAt is null if execution never happened (0 fills, already filtered
    // out below) — orderedAt is always present, used as a same-day fallback.
    executedAt: (o.execution.filledAt ?? o.orderedAt).slice(0, 10),
  };
}

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
    // 예수금(매수 가능 금액)은 보유종목 조회와 별개 API라 실패해도 전체 조회를
    // 막지 않는다 — allSettled로 KRW/USD 각각 독립적으로 실패를 흡수한다.
    // 보유종목(ASSET 그룹)과 예수금(ORDER_INFO 그룹)은 서로 의존하지 않고 rate
    // limit 그룹도 달라서 세 호출을 동시에 시작한다(예전엔 보유종목이 끝난 뒤에야
    // 예수금 조회를 시작해 계좌마다 왕복 한 번이 더 걸렸다). 같은 그룹인 KRW/USD
    // 두 호출은 그 그룹의 RateLimiter가 알아서 직렬화한다.
    const cashPromise = Promise.allSettled([
      fetchTossBuyingPower(accountSeq, 'KRW', opts),
      fetchTossBuyingPower(accountSeq, 'USD', opts),
    ]);
    const overview = await fetchTossHoldings(accountSeq, opts);
    const [krwCash, usdCash] = await cashPromise;

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
        cashBalanceKrw: krwCash.status === 'fulfilled' ? krwCash.value : null,
        cashBalanceUsd: usdCash.status === 'fulfilled' ? usdCash.value : null,
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

  async getTradeHistory(
    accountId: string,
    range: { from: string; to: string },
    opts?: FetchOpts
  ): Promise<TradeRecord[]> {
    const accountSeq = Number(accountId);
    const orders = await fetchTossOrders(accountSeq, range.from, range.to, opts);
    // status=CLOSED also includes CANCELED/REJECTED orders — only ones with
    // an actual fill are a real buy/sell.
    return orders.filter((o) => o.execution.filledQuantity > 0).map(mapOrder);
  },
};
