// DB증권 어댑터 — 앱키가 **계좌 하나에 묶이고** API가 계좌번호를 알려주지 않아(dbClient.ts) 계좌는 설정에 적은 번호 하나다.
// 해외 잔고·예수금은 국내와 독립(실패해도 국내는 보인다). ⚠ 실키 미검증 — dbClient.ts 머리 주석.
import type { BrokerAccount, BrokerAdapter, FetchOpts, HoldingPosition, PortfolioOverview, TradeRecord } from '../types';
import { krSymbol, mapLedgerTrades, xNum, xStr, ymdDash } from '../xingFamily';
import {
  fetchDbDeposit,
  fetchDbDomesticBalance,
  fetchDbLedger,
  fetchDbOverseasBalance,
  fetchDbOverseasTrades,
  getDbAccountId,
  isDbConfigured,
} from './dbClient';
import type { DbResponses } from './dbSpec.gen';

type Elem<V> = V extends readonly (infer E)[] ? E : V;
type DomesticRow = Elem<NonNullable<DbResponses['CSPAQ03420']['Out1']>>;
type OverseasRow = Elem<NonNullable<DbResponses['CAZCQ00400']['Out2']>>;
type OverseasTradeRow = Elem<NonNullable<DbResponses['CAZCQ00200']['Out']>>;

/** 수익률은 평가손익 ÷ 매입금액으로 — DB는 API마다 비율/퍼센트 표기가 다르다(국내 잔고 Ernrat는 비율, 해외 EvalPnlRat는 퍼센트). */
const rate = (pnl: number, cost: number) => (cost > 0 ? pnl / cost : 0);

/** 국내(CSPAQ03420 Out1). 수량은 체결기준(`BalQty0`, 없으면 결제기준 `BalQty`). ⚠ 평균단가 필드가 명세에 없어 매입금액 ÷ 수량. */
export function mapDbDomesticPositions(rows: DomesticRow[]): HoldingPosition[] {
  return rows
    .map((r) => ({ r, qty: xNum(r.BalQty0) || xNum(r.BalQty) }))
    .filter(({ qty }) => qty > 0)
    .map(({ r, qty }) => {
      const purchaseAmount = xNum(r.PchsAmt);
      const profitLossAmount = xNum(r.EvalPnlAmt);
      return {
        symbol: krSymbol(r.IsuNo),
        name: xStr(r.IsuNm) || krSymbol(r.IsuNo),
        market: 'KR',
        currency: 'KRW',
        quantity: qty,
        lastPrice: xNum(r.NowPrc),
        averagePurchasePrice: purchaseAmount / qty,
        purchaseAmount,
        marketValue: xNum(r.EvalAmt),
        profitLossAmount,
        profitLossRate: rate(profitLossAmount, purchaseAmount),
        commission: null,
        tax: null,
      };
    });
}

/** 해외(CAZCQ00400 Out2, 외화 기준) — **미국(USD)만**. 종목은 심볼(`SymCode`, "T"; `AstkIsuNo`는 "T.US"). */
export function mapDbUsPositions(rows: OverseasRow[]): HoldingPosition[] {
  return rows
    .filter((r) => xStr(r.CrcyCode).toUpperCase() === 'USD' && xNum(r.AstkExecBaseQty) > 0)
    .map((r) => {
      const purchaseAmount = xNum(r.AstkBuyAmt);
      const profitLossAmount = xNum(r.AstkEvalPnlAmt);
      const symbol = xStr(r.SymCode) || xStr(r.AstkIsuNo).replace(/\.US$/i, '');
      return {
        symbol,
        name: xStr(r.AstkHanglIsuNm) || symbol,
        market: 'US',
        currency: 'USD',
        quantity: xNum(r.AstkExecBaseQty),
        lastPrice: xNum(r.AstkNowPrc),
        averagePurchasePrice: xNum(r.AstkAvrPchsPrc),
        purchaseAmount,
        marketValue: xNum(r.AstkEvalAmt),
        profitLossAmount,
        profitLossRate: rate(profitLossAmount, purchaseAmount),
        commission: null,
        tax: null,
      };
    });
}

/** 해외 매매내역(CAZCQ00200 건별) → 체결. 방향은 `AstkBnsTpCode`(1 매도·2 매수, 공식 예제 주석), 없으면 `BnsTpNm` 낱말. USD만. */
export function mapDbOverseasTrades(rows: OverseasTradeRow[]): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const r of rows) {
    const code = xStr(r.AstkBnsTpCode);
    const name = xStr(r.BnsTpNm);
    const side = code === '2' || name.includes('매수') ? 'BUY' : code === '1' || name.includes('매도') ? 'SELL' : null;
    const quantity = xNum(r.AstkExecQty);
    const date = ymdDash(r.OrdDt);
    if (!side || quantity <= 0 || !date || xStr(r.CrcyCode).toUpperCase() !== 'USD') continue;
    const fee = xNum(r.AstkExecCmsn);
    out.push({
      id: `db-ovrs-${xStr(r.OrdDt)}-${xStr(r.OrdNo)}`,
      symbol: xStr(r.SymCode) || xStr(r.AstkIsuNo).replace(/\.US$/i, ''),
      name: xStr(r.AstkHanglIsuNm) || null,
      side,
      quantity,
      price: xNum(r.AstkExecPrc),
      amount: xNum(r.AstkExecAmt),
      currency: 'USD',
      commission: fee > 0 ? fee : null,
      tax: null,
      executedAt: date,
    });
  }
  return out;
}

export const dbAdapter: BrokerAdapter = {
  id: 'db',
  displayName: 'DB증권',
  isConfigured: () => isDbConfigured(),

  async listAccounts(): Promise<BrokerAccount[]> {
    const id = await getDbAccountId();
    return [{ id, accountNumber: id, accountType: '종합' }];
  },

  async getPortfolio(accountId: string, opts?: FetchOpts): Promise<PortfolioOverview> {
    const soft = <T>(p: Promise<T>, what: string) =>
      p.catch((err) => {
        console.warn(`[db] ${what} 조회 실패 — 그 부분만 비움:`, (err as Error).message);
        return null;
      });
    const [domestic, deposit, overseas] = await Promise.all([
      fetchDbDomesticBalance(opts),
      soft(fetchDbDeposit(opts), '예수금'),
      soft(fetchDbOverseasBalance(opts), '해외 잔고'),
    ]);
    const s = domestic.summary;
    const us = overseas ? mapDbUsPositions(overseas.items) : [];
    const sumUsd = (k: 'purchaseAmount' | 'marketValue' | 'profitLossAmount') => (us.length ? us.reduce((a, p) => a + p[k], 0) : null);
    const usd = overseas?.currencies.find((c) => xStr(c.CrcyCode).toUpperCase() === 'USD');
    const purchase = xNum(s?.TotBuyAmt);
    const pnl = xNum(s?.TotEvalPnlAmt);
    return {
      broker: 'db',
      accountId,
      totalPurchaseAmountKrw: purchase,
      totalPurchaseAmountUsd: sumUsd('purchaseAmount'),
      totalMarketValueKrw: xNum(s?.TotEvalAmt),
      totalMarketValueUsd: sumUsd('marketValue'),
      totalProfitLossKrw: pnl,
      totalProfitLossUsd: sumUsd('profitLossAmount'),
      profitLossRate: purchase > 0 ? pnl / purchase : null,
      cashBalanceKrw: deposit ? xNum(deposit.DpsBalAmt) : null,
      cashBalanceUsd: usd ? xNum(usd.FcurrDps) : null,
      positions: [...mapDbDomesticPositions(domestic.items), ...us],
      // 해외 잔고 조회 실패 = 미국 종목이 빠진 부분 결과 — write-through가 저장된 미국 행을 지우지 않게(types.ts).
      ...(overseas === null ? { failedMarkets: ['US'] } : {}),
    };
  },

  /** 국내는 계좌 거래내역 매매(QryTp 3), 미국은 해외 매매내역(CAZCQ00200) — 해외가 실패해도 국내는 보인다. */
  async getTradeHistory(_accountId: string, range: { from: string; to: string }, opts?: FetchOpts): Promise<TradeRecord[]> {
    const [domestic, overseas] = await Promise.all([
      fetchDbLedger(range.from, range.to, '3', opts),
      fetchDbOverseasTrades(range.from, range.to, opts).catch((err) => {
        console.warn('[db] 해외 매매내역 조회 실패 — 국내만:', (err as Error).message);
        return [];
      }),
    ]);
    return [...mapLedgerTrades(domestic, 'db').filter((t) => t.currency === 'KRW'), ...mapDbOverseasTrades(overseas)];
  },
};
