import type { BrokerAccount, BrokerAdapter, FetchOpts, PortfolioOverview, TradeRecord } from '../types';
import {
  fetchKiwoomAccountNo,
  fetchKiwoomDeposit,
  fetchKiwoomDomesticBalance,
  fetchKiwoomTransactions,
  fetchKiwoomUsBalance,
  fetchKiwoomUsDeposit,
  isKiwoomConfigured,
  listOf,
} from './kiwoomClient';
import { kwNum, mapKiwoomDomesticPositions, mapKiwoomTrades, mapKiwoomUsPositions } from './kiwoomMappers';

// 키움증권 — 앱키가 **계좌 하나에 묶여** 계좌 목록은 계좌번호조회(ka00001)가 주는 한 계좌뿐이다(KB와 같은 제약이지만
// 계좌번호를 API가 알려줘서 토스·한투·NH처럼 실시간 어댑터로 만든다). 미국 조회·예수금은 국내와 독립(실패해도 국내는 보인다).
// ⚠ 실키 미검증 — kiwoomClient.ts 머리 주석.

export const kiwoomAdapter: BrokerAdapter = {
  id: 'kiwoom',
  displayName: '키움증권',

  isConfigured(): boolean {
    return isKiwoomConfigured();
  },

  async listAccounts(opts?: FetchOpts): Promise<BrokerAccount[]> {
    const acct = await fetchKiwoomAccountNo(opts);
    return [{ id: acct, accountNumber: acct, accountType: '위탁종합' }];
  },

  async getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview> {
    const soft = <T>(p: Promise<T>, what: string) =>
      p.catch((err) => {
        console.warn(`[kiwoom] ${what} 조회 실패 — 그 부분만 비움:`, (err as Error).message);
        return null;
      });
    const [domestic, deposit, us, usDeposit] = await Promise.all([
      fetchKiwoomDomesticBalance(opts),
      soft(fetchKiwoomDeposit(opts), '예수금'),
      soft(fetchKiwoomUsBalance(opts), '미국 잔고'),
      soft(fetchKiwoomUsDeposit(opts), '달러 예수금'),
    ]);
    const s = domestic.summary;
    const usPositions = us ? mapKiwoomUsPositions(us.items) : [];
    const sumUsd = (k: 'purchaseAmount' | 'marketValue' | 'profitLossAmount') =>
      usPositions.length > 0 ? usPositions.reduce((acc, p) => acc + p[k], 0) : null;
    const usdRow = usDeposit ? listOf(usDeposit, 'result_list').find((r) => String(r.crnc_code ?? '').trim() === 'USD') : undefined;
    const totalPurchaseAmountKrw = kwNum(s.tot_pur_amt);
    const totalProfitLossKrw = kwNum(s.tot_evlt_pl);
    return {
      broker: 'kiwoom',
      accountId,
      totalPurchaseAmountKrw,
      totalPurchaseAmountUsd: sumUsd('purchaseAmount'),
      totalMarketValueKrw: kwNum(s.tot_evlt_amt),
      totalMarketValueUsd: sumUsd('marketValue'),
      totalProfitLossKrw,
      totalProfitLossUsd: sumUsd('profitLossAmount'),
      profitLossRate: totalPurchaseAmountKrw > 0 ? totalProfitLossKrw / totalPurchaseAmountKrw : null,
      cashBalanceKrw: deposit ? kwNum(deposit.entr) : null,
      cashBalanceUsd: usdRow ? kwNum(usdRow.fc_entra) : null,
      positions: [...mapKiwoomDomesticPositions(domestic.items), ...usPositions],
    };
  },

  // 위탁종합거래내역 매수(4)·매도(5), 상품 전체(0) — 원화 줄은 국내, USD 줄은 미국으로 나뉜다(mapKiwoomTrades).
  async getTradeHistory(_accountId: string, range: { from: string; to: string }, opts?: FetchOpts): Promise<TradeRecord[]> {
    const [buys, sells] = await Promise.all([
      fetchKiwoomTransactions(range.from, range.to, '4', '0', opts),
      fetchKiwoomTransactions(range.from, range.to, '5', '0', opts),
    ]);
    return [...mapKiwoomTrades(buys, 'BUY'), ...mapKiwoomTrades(sells, 'SELL')];
  },
};
