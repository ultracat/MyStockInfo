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

/** API_BROKER_IDS의 여집합 — CSV(또는 수동 입력)로만 데이터를 관리하는 브로커.
 *  Settings.tsx(계좌 별칭 등록 대상)/Trades.tsx(매매내역 수동 입력 대상)가 이걸
 *  쓴다. 토스/KIS는 실시간 API로 실제 계좌/체결 내역이 들어오므로 수동 입력 대상이
 *  아니다 — 라이브 데이터와 수동 입력이 섞이면 어느 쪽이 진짜인지 알 수 없어진다. */
export const CSV_ONLY_BROKER_IDS: BrokerId[] = BROKER_ORDER.filter((id) => !API_BROKER_IDS.includes(id));
