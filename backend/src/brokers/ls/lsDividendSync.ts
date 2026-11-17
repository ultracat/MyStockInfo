// LS증권 배당 동기화 — 토스·한투·NH·키움과 같은 원칙(API 우선, 그 계좌 배당 기록을 통째로 교체). 계좌 거래내역 입출금(QryTp 1) 중
// 배당·분배 줄(원화)을 가져온다(xingFamily.classifyLedgerDividends). 해외(달러) 배당은 이 표에서 확인하지 못해 넣지 않는다 →
// LS의 동기화 소유는 **원화 기록만**(KIS와 같음, rowOwnership.ts) — 달러 배당은 사용자가 직접 적는다.
// ⚠ 실키 미검증 — 적요·세후 금액은 classifyLedgerDividends의 "⚠ 가정". `npm run check:ls`가 판정한다.
import { replaceSyncedDividends, type NewDividendInput } from '../../db/dividends';
import type { DividendSyncKind, DividendSyncResult } from '../dividendSyncTypes';
import { classifyLedgerDividends, kstToday } from '../xingFamily';
import { fetchLsAccount, fetchLsLedger } from './lsClient';
import { isTaxDeferredAccount } from '../../db/accountTaxTypes';

const SYNC_FROM = '2015-01-01';
let inFlight: Promise<DividendSyncResult> | null = null;

export function syncLsDividends(): Promise<DividendSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => (inFlight = null));
  return inFlight;
}

async function runSync(): Promise<DividendSyncResult> {
  const { accountNo } = await fetchLsAccount({ forceRefresh: true });
  const rows = await fetchLsLedger(SYNC_FROM, kstToday(), '1', { forceRefresh: true });
  const byKind: Record<DividendSyncKind, number> = { dividend: 0, etfDistribution: 0, taxRefund: 0 };
  const inputs: NewDividendInput[] = classifyLedgerDividends(rows, { taxDeferred: isTaxDeferredAccount('ls', accountNo) }).map((c) => {
    byKind[c.kind]++;
    return { broker: 'ls', accountId: accountNo, symbol: c.symbol, name: c.name, currency: c.currency, amount: c.amount, tax: c.tax, paidDate: c.paidDate, memo: null };
  });
  // 원화 기록만 교체 대상 — 사용자가 직접 적은 달러 배당은 건드리지 않는다.
  const r = replaceSyncedDividends('ls', (rec) => (rec.accountId === null || rec.accountId === accountNo) && rec.currency !== 'USD', inputs);
  return { broker: 'ls', ...r, total: inputs.length, byKind, skipped: 0 };
}
