import { fetchKiwoomAccountNo, fetchKiwoomTransactions } from './kiwoomClient';
import { classifyKiwoomDividends } from './kiwoomMappers';
import { replaceSyncedDividends, type NewDividendInput } from '../../db/dividends';
import type { DividendSyncKind, DividendSyncResult } from '../dividendSyncTypes';

// 키움증권 배당 동기화 — 토스·한투·NH와 같은 원칙(API 우선, 그 계좌 배당 기록을 통째로 교체). 위탁종합거래내역 입금(tp 6)
// 중 배당·분배 적요를 원화(국내)·달러(미국) 모두 가져온다 → 원화·달러 모두 동기화 소유(rowOwnership.ts).
// ⚠ 실키 미검증 — 적요 문구·세후 금액 필드는 kiwoomMappers.ts의 classifyKiwoomDividends "⚠ 가정".

/** 시작일 — 조회는 1년 단위로 나눠 부른다(kiwoomClient의 yearWindows). 키움 REST API가 2024년 말 공개라 그 전 기록이
 *  필요하면 앞당긴다(빈 해는 빠르게 끝난다). */
const SYNC_FROM = '2015-01-01';

let inFlight: Promise<DividendSyncResult> | null = null;

export function syncKiwoomDividends(): Promise<DividendSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => (inFlight = null));
  return inFlight;
}

async function runSync(): Promise<DividendSyncResult> {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const accountId = await fetchKiwoomAccountNo({ forceRefresh: true });
  const rows = await fetchKiwoomTransactions(SYNC_FROM, today, '6', '0', { forceRefresh: true });
  const candidates = classifyKiwoomDividends(rows);
  const byKind: Record<DividendSyncKind, number> = { dividend: 0, etfDistribution: 0, taxRefund: 0 };
  const inputs: NewDividendInput[] = candidates.map((c) => {
    byKind[c.kind]++;
    return { broker: 'kiwoom', accountId, symbol: c.symbol, name: c.name, currency: c.currency, amount: c.amount, tax: c.tax, paidDate: c.paidDate, memo: null };
  });
  // 앱키가 계좌 하나라 계좌 칸이 빈 키움 기록도 그 계좌 것으로 본다(KIS와 같음).
  const r = replaceSyncedDividends('kiwoom', (rec) => rec.accountId === null || rec.accountId === accountId, inputs);
  return { broker: 'kiwoom', ...r, total: inputs.length, byKind, skipped: 0 };
}
