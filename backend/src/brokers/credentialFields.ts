import type { BrokerId } from './types';

export interface CredentialFieldSpec {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  /** "이 필드가 계좌 정보다" 표시 — appKey/Client ID 같은 비밀 아닌 다른 필드와
   *  구분해서, Settings.tsx의 "증권사 연동 상태" 표가 API 키 문자열까지 노출하지
   *  않고 계좌번호류만 골라 보여주게 한다(routes/settings.ts의 credential-info). */
  kind?: 'account';
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
    { key: 'accountNumber', label: '계좌번호 (CANO, 8자리)', secret: false, placeholder: '12345678', kind: 'account' },
    { key: 'accountProductCode', label: '상품코드 (ACNT_PRDT_CD, 2자리)', secret: false, placeholder: '01', kind: 'account' },
  ],
  // NH투자증권(나무) — 계좌 목록 API(/n2/acctinfo)가 있어 계좌번호는 받지 않는다(토스와 같음).
  nh: [
    { key: 'appKey', label: '앱키 (App Key)', secret: false },
    { key: 'appSecret', label: '앱시크릿 (App Secret)', secret: true },
  ],
  kb: [
    { key: 'appKey', label: 'appKey', secret: false },
    { key: 'appSecret', label: 'appSecret', secret: true },
    // KB Open API는 appKey/appSecret 자체가 계좌 하나에 이미 고정 바인딩되고
    // (계좌 목록 조회 API가 없음), 그 계좌번호를 API가 알려주지도 않는다 — 그래서
    // 이건 KB에 실제로 보내는 값이 아니라, "이 자격증명이 어느 로컬 accountId로
    // 동기화될지"를 로컬에서만 쓰는 값이다(routes/kb.ts 참고).
    { key: 'accountId', label: '계좌번호 (API 연동된 계좌)', secret: false, placeholder: '123-45-678901', kind: 'account' },
  ],
  // 삼성증권/미래에셋증권은 API 연동이 없다(CSV로만 데이터 관리, 사용자가
  // 명시적으로 요청) — 자격증명 필드가 없다.
  samsung: [],
  mirae: [],
};
