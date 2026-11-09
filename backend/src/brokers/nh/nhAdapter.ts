import type { BrokerAccount, BrokerAdapter, FetchOpts, PortfolioOverview, TradeRecord } from '../types';
import {
  fetchNhAccounts,
  fetchNhDomesticBalance,
  fetchNhOverseasBalance,
  fetchNhOverseasTransactions,
  fetchNhTotalTransactions,
  isNhConfigured,
} from './nhClient';
import { mapNhDomesticPosition, mapNhDomesticTrades, mapNhOverseasPosition, mapNhOverseasTrades, nhNum } from './nhMappers';

// NH투자증권(나무) — 토스처럼 **계좌 목록 API가 있어** 앱키 하나로 여러 계좌를 보여준다(KIS·KB는 계좌 하나).
// 해외(미국) 조회는 국내와 독립 — 실패해도 국내는 그대로 보여준다(KIS와 같은 원칙).

export const nhAdapter: BrokerAdapter = {
  id: 'nh',
  displayName: 'NH투자증권',

  isConfigured(): boolean {
    return isNhConfigured();
  },

  async listAccounts(opts?: FetchOpts): Promise<BrokerAccount[]> {
    const accounts = await fetchNhAccounts(opts);
    return accounts.map((a) => ({
      id: a.accountNo,
      accountNumber: a.accountNo,
      accountType: a.type === '02' ? '주문대리인' : '일반',
    }));
  },

  async getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview> {
    const [domestic, overseas] = await Promise.all([
      fetchNhDomesticBalance(accountId, opts),
      fetchNhOverseasBalance(accountId, opts).catch((err) => {
        console.warn('[nh] 해외 잔고 조회 실패 — 국내만 표시:', (err as Error).message);
        return null;
      }),
    ]);
    const s = domestic.summary;
    const domesticPositions = domestic.items.map(mapNhDomesticPosition).filter((p) => p.symbol && p.quantity > 0);
    const overseasPositions = (overseas?.items ?? []).map(mapNhOverseasPosition).filter((p) => p.symbol && p.quantity > 0);
    const sumUsd = (k: 'purchaseAmount' | 'marketValue' | 'profitLossAmount') =>
      overseasPositions.length > 0 ? overseasPositions.reduce((acc, p) => acc + p[k], 0) : null;

    const totalPurchaseAmountKrw = nhNum(s.tot_byn_amt);
    const totalProfitLossKrw = nhNum(s.tot_eal_pls);
    return {
      broker: 'nh',
      accountId,
      totalPurchaseAmountKrw,
      totalPurchaseAmountUsd: sumUsd('purchaseAmount'),
      totalMarketValueKrw: nhNum(s.tot_eal_amt),
      totalMarketValueUsd: sumUsd('marketValue'),
      totalProfitLossKrw,
      totalProfitLossUsd: sumUsd('profitLossAmount'),
      profitLossRate: totalPurchaseAmountKrw > 0 ? totalProfitLossKrw / totalPurchaseAmountKrw : null,
      // dca = 예수금(D+0). 달러 예수금은 해외 잔고 요약의 외화예수금.
      cashBalanceKrw: nhNum(s.dca),
      cashBalanceUsd: overseas?.summary ? nhNum(overseas.summary.fc_dca) : null,
      positions: [...domesticPositions, ...overseasPositions],
    };
  },

  async getTradeHistory(accountId: string, range: { from: string; to: string }, opts?: FetchOpts): Promise<TradeRecord[]> {
    const overseas = (kind: '05' | '06', side: 'BUY' | 'SELL') =>
      fetchNhOverseasTransactions(accountId, range.from, range.to, kind, opts).then(
        (rows) => mapNhOverseasTrades(rows, side),
        (err) => {
          console.warn(`[nh] 해외 ${side === 'BUY' ? '매수' : '매도'} 내역 조회 실패 — 국내만 표시:`, (err as Error).message);
          return [] as TradeRecord[];
        }
      );
    const [domestic, buys, sells] = await Promise.all([
      fetchNhTotalTransactions(accountId, range.from, range.to, '03', opts).then(mapNhDomesticTrades),
      overseas('05', 'BUY'),
      overseas('06', 'SELL'),
    ]);
    return [...domestic, ...buys, ...sells];
  },
};
