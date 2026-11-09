import type { BrokerId } from './types';

/** 동기화로 들어온 배당의 종류 — 화면 안내 문구용 집계. */
export type DividendSyncKind = 'dividend' | 'etfDistribution' | 'taxRefund';

/** 배당 동기화 한 번의 결과(브로커 하나). 그 브로커의 API 계좌 배당 기록은 API 내용으로 통째로 교체된다. */
export interface DividendSyncResult {
  broker: BrokerId;
  /** 새로 생긴 기록 수. */
  added: number;
  /** API에 없어 지워진 기존 기록 수(직접 입력했던 것 포함). */
  removed: number;
  /** 내용이 그대로인 기록 수. */
  unchanged: number;
  /** 교체 후 그 브로커 API 계좌의 배당 기록 수. */
  total: number;
  byKind: Record<DividendSyncKind, number>;
  /** 아직 결제·지급 전이거나 취소돼 넣지 않은 건수. */
  skipped: number;
}
