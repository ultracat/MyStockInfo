import type { BrokerId } from './types';

export interface CredentialFieldSpec {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
}

/**
 * What Settings needs to ask for, per broker — drives both the dynamic
 * form on the frontend and backend validation. Add a broker here (and to
 * brokers/registry.ts) to wire up a new integration's credential intake
 * without touching the settings route or the Settings page.
 */
export const CREDENTIAL_FIELDS: Record<BrokerId, CredentialFieldSpec[]> = {
  toss: [
    { key: 'clientId', label: 'Client ID', secret: false },
    { key: 'clientSecret', label: 'Client Secret', secret: true },
  ],
  kis: [
    { key: 'appKey', label: '앱키 (App Key)', secret: false },
    { key: 'appSecret', label: '앱시크릿 (App Secret)', secret: true },
    { key: 'accountNumber', label: '계좌번호 (CANO, 8자리)', secret: false, placeholder: '12345678' },
    { key: 'accountProductCode', label: '상품코드 (ACNT_PRDT_CD, 2자리)', secret: false, placeholder: '01' },
  ],
  kb: [
    { key: 'appKey', label: 'appKey', secret: false },
    { key: 'appSecret', label: 'appSecret', secret: true },
    // KB Open API는 appKey/appSecret 자체가 계좌 하나에 이미 고정 바인딩되고
    // (계좌 목록 조회 API가 없음), 그 계좌번호를 API가 알려주지도 않는다 — 그래서
    // 이건 KB에 실제로 보내는 값이 아니라, "이 자격증명이 어느 로컬 accountId로
    // 동기화될지"를 로컬에서만 쓰는 값이다(routes/kb.ts 참고).
    { key: 'accountId', label: '계좌번호 (API 연동된 계좌)', secret: false, placeholder: '123-45-678901' },
  ],
  // 삼성증권/미래에셋증권은 API 연동이 없다(CSV로만 데이터 관리, 사용자가
  // 명시적으로 요청) — 자격증명 필드가 없다.
  samsung: [],
  mirae: [],
};
