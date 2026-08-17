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
  ],
  // 삼성증권/미래에셋증권은 API 연동이 없다(CSV로만 데이터 관리, 사용자가
  // 명시적으로 요청) — 자격증명 필드가 없다.
  samsung: [],
  mirae: [],
};
