import type { BrokerId } from './types';

// 브로커 표시 이름/순서의 단일 소스 — Dividends.tsx/Settings.tsx/Dashboard.tsx/
// Trades.tsx가 전부 여기서 가져다 쓴다. 백엔드 brokers/knownBrokers.ts와 짝을
// 이룬다(값은 프론트/백엔드 양쪽에 각각 존재 — 공유 패키지가 없는 이 프로젝트의
// 기존 관례를 그대로 따름, frontend/CLAUDE.md의 "백엔드 응답 타입 미러링" 참고).
export const BROKER_LABELS: Record<BrokerId, string> = {
  toss: '토스증권',
  kis: '한국투자증권',
  kb: 'KB증권',
  samsung: '삼성증권',
  mirae: '미래에셋증권',
};

export const BROKER_ORDER: BrokerId[] = ['toss', 'kis', 'kb', 'samsung', 'mirae'];

/** API 연동이 있는 브로커 — 나머지(KB/삼성/미래에셋)는 CSV로만 데이터를 관리한다
 *  (사용자 요청으로 API 연동을 하지 않기로 함). Dashboard.tsx/Trades.tsx가 이걸로
 *  실시간 조회 vs 로컬 저장소 조회를 분기한다. */
export const API_BROKER_IDS: BrokerId[] = ['toss', 'kis'];
