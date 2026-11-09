import type { BrokerId } from './types';

export interface KnownBrokerInfo {
  id: BrokerId;
  displayName: string;
  /** false면 `registry.ts`에 `BrokerAdapter`가 없다 — CSV로만 데이터를 관리한다
   *  (`db/holdingsStore.ts`/`db/tradesStore.ts` + CSV import/export). */
  hasApiIntegration: boolean;
}

// 브로커 목록/표시 이름의 단일 소스 — routes/dividends.ts, routes/holdingsStore.ts,
// routes/tradesStore.ts, routes/settings.ts, routes/accounts.ts가 전부 여기서
// BROKER_IDS를 가져다 쓴다. 새 브로커를 추가할 때(API 연동이든 CSV 전용이든) 여기
// 한 줄만 추가하면 위 라우트들의 검증/목록에 자동으로 반영된다.
export const KNOWN_BROKERS: KnownBrokerInfo[] = [
  { id: 'toss', displayName: '토스증권', hasApiIntegration: true },
  { id: 'kis', displayName: '한국투자증권', hasApiIntegration: true },
  { id: 'nh', displayName: 'NH투자증권', hasApiIntegration: true },
  { id: 'kiwoom', displayName: '키움증권', hasApiIntegration: true },
  { id: 'kb', displayName: 'KB증권', hasApiIntegration: false },
  { id: 'samsung', displayName: '삼성증권', hasApiIntegration: false },
  { id: 'mirae', displayName: '미래에셋증권', hasApiIntegration: false },
];

export const BROKER_IDS: BrokerId[] = KNOWN_BROKERS.map((b) => b.id);
