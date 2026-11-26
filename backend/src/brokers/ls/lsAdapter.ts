// LS증권 어댑터 — 앱키가 **계좌 하나에 묶여** 계좌 목록은 CSPAQ12200이 되돌려 주는 그 계좌 하나뿐이다(키움과 같은 모양).
// 해외 잔고·예수금은 국내와 독립(실패해도 국내는 보인다). ⚠ 실키 미검증 — lsClient.ts 머리 주석.
import type { BrokerAccount, BrokerAdapter, FetchOpts, HoldingPosition, PortfolioOverview, TradeRecord } from '../types';
import { krSymbol, mapLedgerTrades, xNum, xStr } from '../xingFamily';
import { fetchLsAccount, fetchLsDomesticBalance, fetchLsLedger, fetchLsOverseasBalance, isLsConfigured } from './lsClient';
import type { LsResponses } from './lsSpec.gen';

type Elem<V> = V extends readonly (infer E)[] ? E : V;
type DomesticRow = Elem<NonNullable<LsResponses['t0424']['t0424OutBlock1']>>;
type OverseasRow = Elem<NonNullable<LsResponses['COSOQ00201']['COSOQ00201OutBlock4']>>;

/** 수익률은 평가손익 ÷ 매입금액으로 직접 낸다 — 증권사·TR마다 비율/퍼센트 표기가 달라(DB 조사) 단위를 추측하지 않는다. */
const rate = (pnl: number, cost: number) => (cost > 0 ? pnl / cost : 0);

export function mapLsDomesticPositions(rows: DomesticRow[]): HoldingPosition[] {
  return rows
    .filter((r) => xNum(r.janqty) > 0)
    .map((r) => {
      const purchaseAmount = xNum(r.mamt);
      const profitLossAmount = xNum(r.dtsunik);
      return {
        symbol: krSymbol(r.expcode),
        name: xStr(r.hname) || krSymbol(r.expcode),
        market: 'KR',
        currency: 'KRW',
        quantity: xNum(r.janqty),
        lastPrice: xNum(r.price),
        averagePurchasePrice: xNum(r.pamt),
        purchaseAmount,
        marketValue: xNum(r.appamt),
        profitLossAmount,
        profitLossRate: rate(profitLossAmount, purchaseAmount),
        commission: xNum(r.fee) || null,
        tax: xNum(r.tax) || null,
      };
    });
}

/** 해외(COSOQ00201 OutBlock4) — **미국(USD)만**(앱 통화 모델). 종목은 단축코드(`ShtnIsuNo`, "TSLA"). */
export function mapLsUsPositions(rows: OverseasRow[]): HoldingPosition[] {
  return rows
    .filter((r) => xStr(r.CrcyCode).toUpperCase() === 'USD' && xNum(r.AstkBalQty) > 0)
    .map((r) => {
      const purchaseAmount = xNum(r.FcurrBuyAmt);
      const profitLossAmount = xNum(r.FcurrEvalPnlAmt);
      return {
        symbol: xStr(r.ShtnIsuNo),
        name: xStr(r.JpnMktHanglIsuNm) || xStr(r.ShtnIsuNo),
        market: 'US',
        currency: 'USD',
        quantity: xNum(r.AstkBalQty),
        lastPrice: xNum(r.OvrsScrtsCurpri),
        averagePurchasePrice: xNum(r.FcstckUprc),
        purchaseAmount,
        marketValue: xNum(r.FcurrEvalAmt),
        profitLossAmount,
        profitLossRate: rate(profitLossAmount, purchaseAmount),
        commission: null,
        tax: null,
      };
    });
}

export const lsAdapter: BrokerAdapter = {
  id: 'ls',
  displayName: 'LS증권',
  isConfigured: () => isLsConfigured(),

  async listAccounts(opts?: FetchOpts): Promise<BrokerAccount[]> {
    const { accountNo } = await fetchLsAccount(opts);
    return [{ id: accountNo, accountNumber: accountNo, accountType: '종합' }];
  },

  async getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview> {
    const soft = <T>(p: Promise<T>, what: string) =>
      p.catch((err) => {
        console.warn(`[ls] ${what} 조회 실패 — 그 부분만 비움:`, (err as Error).message);
        return null;
      });
    const [domestic, account, overseas] = await Promise.all([
      fetchLsDomesticBalance(opts),
      soft(fetchLsAccount(opts), '예수금'),
      soft(fetchLsOverseasBalance(opts), '해외 잔고'),
    ]);
    const s = domestic.summary;
    const us = overseas ? mapLsUsPositions(overseas.items) : [];
    const sumUsd = (k: 'purchaseAmount' | 'marketValue' | 'profitLossAmount') => (us.length ? us.reduce((a, p) => a + p[k], 0) : null);
    const usd = overseas?.currencies.find((c) => xStr(c.CrcyCode).toUpperCase() === 'USD');
    const purchase = xNum(s?.mamt);
    const pnl = xNum(s?.tdtsunik);
    return {
      broker: 'ls',
      accountId,
      totalPurchaseAmountKrw: purchase,
      totalPurchaseAmountUsd: sumUsd('purchaseAmount'),
      totalMarketValueKrw: xNum(s?.tappamt),
      totalMarketValueUsd: sumUsd('marketValue'),
      totalProfitLossKrw: pnl,
      totalProfitLossUsd: sumUsd('profitLossAmount'),
      profitLossRate: purchase > 0 ? pnl / purchase : null,
      cashBalanceKrw: account?.summary ? xNum(account.summary.Dps) : null,
      cashBalanceUsd: usd ? xNum(usd.FcurrDps) : null,
      positions: [...mapLsDomesticPositions(domestic.items), ...us],
      // 해외 잔고 조회 실패 = 미국 종목이 빠진 부분 결과 — write-through가 저장된 미국 행을 지우지 않게(types.ts).
      ...(overseas === null ? { failedMarkets: ['US'] } : {}),
    };
  },

  /** 계좌 거래내역 매매(QryTp 3) — 국내·해외 한 표. 해외 줄 종목번호가 ISIN이면 해외 잔고의 ISIN→단축코드로 바꾼다(없으면 그대로). */
  async getTradeHistory(_accountId: string, range: { from: string; to: string }, opts?: FetchOpts): Promise<TradeRecord[]> {
    const [rows, overseas] = await Promise.all([fetchLsLedger(range.from, range.to, '3', opts), fetchLsOverseasBalance(opts).catch(() => null)]);
    const isinToTicker = new Map((overseas?.items ?? []).map((r) => [xStr(r.IsuNo), xStr(r.ShtnIsuNo)]));
    return mapLedgerTrades(rows, 'ls', (raw) => isinToTicker.get(raw) ?? raw);
  },
};
