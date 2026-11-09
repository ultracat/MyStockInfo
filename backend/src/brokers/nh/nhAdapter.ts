import type { BrokerAccount, BrokerAdapter, FetchOpts, PortfolioOverview, TradeRecord } from '../types';
import {
  fetchNhAccounts,
  fetchNhDomesticBalance,
  fetchNhOverseasBalance,
  fetchNhOverseasTransactions,
  fetchNhTotalTransactions,
  isNhConfigured,
  isNhPaperAccount,
  isPaperType,
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

  // 모의투자(03) 계좌는 `includePaper`일 때만 — 보유·매매 화면의 계좌 선택에는 보이고, 대시보드 합계·종목별 수익·
  // 배당은 실전 계좌만 모은다(types.ts의 `BrokerAccount.paper`).
  async listAccounts(opts?: FetchOpts & { includePaper?: boolean }): Promise<BrokerAccount[]> {
    const accounts = await fetchNhAccounts(opts, opts?.includePaper ?? false);
    // 실전 계좌를 앞에 — 화면은 첫 계좌를 기본으로 고른다(API는 구분을 섞어서 준다).
    const ordered = [...accounts].sort((a, b) => Number(isPaperType(a.type)) - Number(isPaperType(b.type)));
    return ordered.map((a) => ({
      id: a.accountNo,
      accountNumber: a.accountNo,
      accountType: isPaperType(a.type) ? '모의투자' : a.type === '02' ? '주문대리인' : '일반',
      ...(isPaperType(a.type) ? { paper: true } : {}),
    }));
  },

  isPaperAccount(accountId: string): Promise<boolean> {
    return isNhPaperAccount(accountId);
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
