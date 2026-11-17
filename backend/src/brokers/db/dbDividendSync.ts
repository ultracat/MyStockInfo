// DB증권 배당 동기화 — 토스·한투·NH·키움과 같은 원칙(API 우선, 그 계좌 배당 기록을 통째로 교체). 원화는 국내 계좌 거래내역 입출금
// (CDPCQ04700, xingFamily.classifyLedgerDividends), 달러는 해외 거래내역(CAZCQ01600)의 "배당금입금(외화)"(세전)·"배당세출금(외화)"
// (원천세) 두 줄을 같은 날·같은 종목끼리 짝지어 세후 = 입금 − 세출금(⚠ 가정, 공식 예시 근거). NH처럼 **원화·달러 모두 동기화 소유**.
// 해외 조회가 실패하면 동기화를 통째로 실패시킨다(일부만 받은 채 교체하면 달러 배당이 지워진다).
// ⚠ 실키 미검증 — `npm run check:db`가 판정한다.
import { replaceSyncedDividends, type NewDividendInput } from '../../db/dividends';
import type { DividendSyncKind, DividendSyncResult } from '../dividendSyncTypes';
import { classifyLedgerDividends, kstToday, xNum, xStr, ymdDash, type LedgerDividend } from '../xingFamily';
import type { DbResponses } from './dbSpec.gen';
import { fetchDbLedger, fetchDbOverseasLedger, getDbAccountId } from './dbClient';
import { isTaxDeferredAccount } from '../../db/accountTaxTypes';

type Elem<V> = V extends readonly (infer E)[] ? E : V;
type OverseasLedgerRow = Elem<NonNullable<DbResponses['CAZCQ01600']['Out']>>;

/** 해외 배당 — 입금·세출금 두 줄을 (거래일, 종목)으로 합친다. 금액은 외화 거래금액(`FcurrTrdAmt`, 없으면 `AstkBnsAmt`). USD만. */
export function classifyDbOverseasDividends(rows: OverseasLedgerRow[]): LedgerDividend[] {
  const groups = new Map<string, { symbol: string; name: string; paidDate: string; gross: number; tax: number }>();
  for (const r of rows) {
    const summary = xStr(r.SmryNm);
    if (!summary.includes('배당') || /취소|정정/.test(summary) || xStr(r.CrcyCode).toUpperCase() !== 'USD') continue;
    const symbol = xStr(r.SymCode) || xStr(r.AstkIsuNo).replace(/\.US$/i, '');
    const paidDate = ymdDash(r.TrdDt);
    if (!symbol || !paidDate) continue;
    const key = `${paidDate}|${symbol}`;
    const g = groups.get(key) ?? { symbol, name: xStr(r.AstkHanglIsuNm) || symbol, paidDate, gross: 0, tax: 0 };
    const amt = Math.abs(xNum(r.FcurrTrdAmt)) || Math.abs(xNum(r.AstkBnsAmt));
    if (/세출금|세금|원천/.test(summary)) g.tax += amt;
    else if (summary.includes('입금')) g.gross += amt;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.gross > 0)
    .map((g) => ({ symbol: g.symbol, name: g.name, currency: 'USD' as const, amount: Math.round((g.gross - g.tax) * 100) / 100, tax: g.tax, paidDate: g.paidDate, kind: 'dividend' as const }));
}

const SYNC_FROM = '2015-01-01';
let inFlight: Promise<DividendSyncResult> | null = null;

export function syncDbDividends(): Promise<DividendSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => (inFlight = null));
  return inFlight;
}

async function runSync(): Promise<DividendSyncResult> {
  const accountId = await getDbAccountId();
  const today = kstToday();
  const [domestic, overseas] = await Promise.all([
    fetchDbLedger(SYNC_FROM, today, '1', { forceRefresh: true }),
    fetchDbOverseasLedger(SYNC_FROM, today, { forceRefresh: true }),
  ]);
  const byKind: Record<DividendSyncKind, number> = { dividend: 0, etfDistribution: 0, taxRefund: 0 };
  const inputs: NewDividendInput[] = [...classifyLedgerDividends(domestic, { taxDeferred: isTaxDeferredAccount('db', accountId) }), ...classifyDbOverseasDividends(overseas)].map((c) => {
    byKind[c.kind]++;
    return { broker: 'db', accountId, symbol: c.symbol, name: c.name, currency: c.currency, amount: c.amount, tax: c.tax, paidDate: c.paidDate, memo: null };
  });
  const r = replaceSyncedDividends('db', (rec) => rec.accountId === null || rec.accountId === accountId, inputs);
  return { broker: 'db', ...r, total: inputs.length, byKind, skipped: 0 };
}
