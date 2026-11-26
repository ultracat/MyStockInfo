import type { BrokerId } from './types';

// 배당 기록의 동기화 소유 규칙(화면 쪽) — 백엔드 `brokers/rowOwnership.ts`의 `isDividendSyncOwned`와 **같은 규칙을 한 곳에** 둔다
// (2026-11-26 — 예전엔 useDividendSync·DividendAddCard가 한국투자증권만 예외로 하드코딩해서, 백엔드가 직접 입력을 받는 LS 달러 배당을
// 화면이 막았다). API 키가 있는 증권사의 배당은 동기화가 그 계좌 기록을 통째로 바꾸므로 직접 추가·수정·삭제를 막는다. 단 아래
// "달러는 직접 입력" 증권사는 원화 배당만 API로 오고 달러 배당은 사용자가 적는다.

/** 배당 동기화를 하는 증권사(API 키가 있으면 그 증권사 배당은 동기화 소유). */
export const DIVIDEND_SYNC_BROKERS: readonly BrokerId[] = ['toss', 'kis', 'nh', 'kiwoom', 'ls', 'db'];

/** 원화 배당만 API로 오고 **달러 배당은 직접 입력**하는 증권사 — 한국투자증권(CTRGA011R 국내만), LS증권(계좌 거래내역 원화만). */
export const USD_MANUAL_DIVIDEND_BROKERS: readonly BrokerId[] = ['kis', 'ls'];

/** 이 (증권사, 통화) 배당 행이 API 동기화 소유인가 — 맞으면 직접 추가·수정·삭제 불가. */
export function isDividendRowSyncOwned(syncOwned: ReadonlySet<BrokerId>, broker: BrokerId, currency: string | null | undefined): boolean {
  if (!syncOwned.has(broker)) return false;
  return !(USD_MANUAL_DIVIDEND_BROKERS.includes(broker) && currency === 'USD');
}

/** 직접 입력 폼에서 이 증권사를 고를 수 있나 — 동기화 안 하는 증권사, 또는 동기화하지만 달러는 직접 입력하는 증권사. */
export function canAddDividendManually(syncOwned: ReadonlySet<BrokerId>, broker: BrokerId): boolean {
  return !syncOwned.has(broker) || USD_MANUAL_DIVIDEND_BROKERS.includes(broker);
}

/** 직접 입력 폼에서 이 증권사는 달러만 고를 수 있나(원화는 동기화 소유). */
export function manualDividendUsdOnly(syncOwned: ReadonlySet<BrokerId>, broker: BrokerId): boolean {
  return syncOwned.has(broker) && USD_MANUAL_DIVIDEND_BROKERS.includes(broker);
}
