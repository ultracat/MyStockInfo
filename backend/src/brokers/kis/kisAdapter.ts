import type {
  BrokerAccount,
  BrokerAdapter,
  FetchOpts,
  HoldingPosition,
  PortfolioOverview,
  TradeRecord,
} from '../types';
import { getCredentialFields } from '../../credentials';
import {
  fetchKisBalance,
  fetchKisOverseasBalance,
  fetchKisOverseasTrades,
  fetchKisTradeHistory,
  isKisConfigured,
  type KisDailyCcldItem,
  type KisOverseasPosition,
} from './kisClient';

// 해외주식(미국)은 국내 조회와 독립이다 — 해외 조회가 실패해도 국내 보유·매매내역은 그대로 보여준다(경고 로그만).
// ⚠ 연동 계좌에 해외 자료가 없어 실데이터 필드 검증은 아직 못 했다(kisClient.ts의 "해외주식" 절).
function mapOverseasPosition(p: KisOverseasPosition): HoldingPosition {
  return {
    symbol: p.symbol,
    name: p.name,
    market: 'US',
    currency: 'USD',
    quantity: p.quantity,
    lastPrice: p.lastPrice,
    averagePurchasePrice: p.averagePurchasePrice,
    purchaseAmount: p.purchaseAmount,
    marketValue: p.marketValue,
    profitLossAmount: p.profitLossAmount,
    profitLossRate: p.profitLossRate,
    commission: null,
    tax: null,
  };
}

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
    const [{ items, summary }, overseasResult] = await Promise.all([
      fetchKisBalance(opts),
      fetchKisOverseasBalance(opts).then(
        (v) => v,
        (err) => {
          console.warn('[kis] 해외 잔고 조회 실패 — 국내만 표시:', (err as Error).message);
          return null;
        }
      ),
    ]);
    const overseas = overseasResult?.positions ?? [];
    const sumUsd = (k: 'purchaseAmount' | 'marketValue' | 'profitLossAmount') =>
      overseas.length > 0 ? overseas.reduce((s, p) => s + p[k], 0) : null;

    try {
      const totalPurchaseAmountKrw = num(summary.pchs_amt_smtl_amt);
      const totalMarketValueKrw = num(summary.evlu_amt_smtl_amt);
      const totalProfitLossKrw = num(summary.evlu_pfls_smtl_amt);

      return {
        broker: 'kis',
        accountId,
        totalPurchaseAmountKrw,
        totalPurchaseAmountUsd: sumUsd('purchaseAmount'),
        totalMarketValueKrw,
        totalMarketValueUsd: sumUsd('marketValue'),
        totalProfitLossKrw,
        totalProfitLossUsd: sumUsd('profitLossAmount'),
        // KIS's output2 doesn't publish an aggregate P/L rate field (only
        // asst_icdc_erng_rt, a broader day-over-day asset-change metric) —
        // derived here instead of guessing a field that isn't there.
        profitLossRate: totalPurchaseAmountKrw > 0 ? totalProfitLossKrw / totalPurchaseAmountKrw : null,
        // dnca_tot_amt(예수금총금액) — KIS 공식 필드명이 곧 "예수금"이라 별도 API
        // 호출 없이 이미 받아온 summary에서 그대로 뽑는다. 달러 예수금은 해외 체결기준현재잔고의 외화예수금액.
        cashBalanceKrw: num(summary.dnca_tot_amt),
        cashBalanceUsd: overseasResult?.cashUsd ?? null,
        positions: [...items.map(mapPosition), ...overseas.map(mapOverseasPosition)],
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
    const [items, overseas] = await Promise.all([
      fetchKisTradeHistory(range.from, range.to, opts),
      fetchKisOverseasTrades(range.from, range.to, opts).catch((err) => {
        console.warn('[kis] 해외 체결내역 조회 실패 — 국내만 표시:', (err as Error).message);
        return [];
      }),
    ]);
    // CCLD_DVSN='01' already asks for filled-only, but a cancelled order can
    // still surface with 0 filled quantity — drop those defensively.
    const domestic = items.filter((item) => num(item.tot_ccld_qty) > 0).map(mapTrade);
    return [
      ...domestic,
      ...overseas.map(
        (t): TradeRecord => ({
          id: t.id,
          symbol: t.symbol,
          name: t.name,
          side: t.side,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          currency: 'USD',
          commission: null,
          tax: null,
          executedAt: t.date,
        })
      ),
    ];
  },
};
