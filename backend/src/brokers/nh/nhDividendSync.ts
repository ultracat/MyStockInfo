import { fetchNhAccounts, fetchNhOverseasTransactions, fetchNhTotalTransactions } from './nhClient';
import { classifyNhDomesticDividends, classifyNhOverseasDividends, type NhDividendCandidate } from './nhMappers';
import { replaceSyncedDividends, type NewDividendInput } from '../../db/dividends';
import type { DividendSyncKind, DividendSyncResult } from '../dividendSyncTypes';

// NH투자증권(나무) 배당 동기화 — 토스·한투와 같은 원칙(API 우선으로 그 계좌 배당 기록을 통째로 교체).
// 국내는 종합거래내역 입출금, 미국은 해외 일별거래내역 입금에서 배당·분배 적요를 고른다(nhMappers.ts).
// NH는 해외 배당도 계좌 기준으로 주므로 **원화·달러 모두 동기화 소유**다(KIS와 다름, rowOwnership.ts).
// ⚠ 실데이터 미검증 — 적요 문구와 세전/세후 가정은 nhMappers.ts의 "⚠ 가정" 참고.

/** 조회 시작일. 종합거래내역은 기간 제한이 명세에 없어 넉넉히 잡는다(실키로 2000-01-01~오늘 요청이 정상 응답함). */
const SYNC_FROM = '2000-01-01';

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

let inFlight: Promise<DividendSyncResult> | null = null;

export function syncNhDividends(): Promise<DividendSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => (inFlight = null));
  return inFlight;
}

async function runSync(): Promise<DividendSyncResult> {
  const today = todayKst();
  const accounts = (await fetchNhAccounts({ forceRefresh: true })).map((a) => a.accountNo);
  const inputs: NewDividendInput[] = [];
  const byKind: Record<DividendSyncKind, number> = { dividend: 0, etfDistribution: 0, taxRefund: 0 };

  for (const accountId of accounts) {
    // 해외 조회가 실패하면 그 계좌 동기화 전체를 실패시킨다 — 일부만 받은 채 교체하면 달러 배당이 지워진다.
    const [domesticRows, overseasRows] = await Promise.all([
      fetchNhTotalTransactions(accountId, SYNC_FROM, today, '01', { forceRefresh: true }),
      fetchNhOverseasTransactions(accountId, SYNC_FROM, today, '01', { forceRefresh: true }),
    ]);
    const candidates: NhDividendCandidate[] = [
      ...classifyNhDomesticDividends(domesticRows),
      ...classifyNhOverseasDividends(overseasRows),
    ];
    for (const c of candidates) {
      byKind[c.kind]++;
      inputs.push({
        broker: 'nh',
        accountId,
        symbol: c.symbol,
        name: c.name,
        currency: c.currency,
        amount: c.amount,
        tax: c.tax,
        paidDate: c.paidDate,
        memo: null,
      });
    }
  }

  // 교체 범위: 앱키에 연결된 실전 계좌들 + 계좌 칸이 빈 NH 기록(계좌가 하나뿐일 때만 그 계좌 것으로 본다).
  const owned = new Set(accounts);
  const r = replaceSyncedDividends(
    'nh',
    (rec) => (rec.accountId === null ? accounts.length === 1 : owned.has(rec.accountId)),
    inputs
  );
  return { broker: 'nh', ...r, total: inputs.length, byKind, skipped: 0 };
}
