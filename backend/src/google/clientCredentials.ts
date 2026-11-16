import { SealedValueStore } from '../sealedValueStore';

// Google Sheets 연동의 OAuth 클라이언트(Client ID/Secret) — **사용자가 자기 Google Cloud 프로젝트에서 만들어 설정에 넣는다**
// (2026-11-16 사용자 결정, 수출입은행 환율 키와 같은 이유 — 개발자 키를 배포본에 넣지 않는다).
// 예전엔 gitignore된 google/clientConfig.ts에 개발자 클라이언트를 박아 빌드했지만, CI Secret을 등록한 적이 없어
// v1.0.0~v1.2.2 배포본엔 들어간 적이 없다(배포본의 Google Sheets 연동은 원래 꺼져 있었다).
//
// 저장은 다른 키들과 같은 OS 키체인 봉투. 키링 없는 Linux면 저장을 거부한다. Client ID는 비밀이 아니라서 화면에
// 보여 준다(어느 클라이언트인지 알아보게) — Secret은 절대 돌려주지 않는다.

export const GOOGLE_CLIENT_FILE = 'google-client.json';

export interface GoogleClientCredentials {
  clientId: string;
  clientSecret: string;
}

const store = new SealedValueStore<GoogleClientCredentials>(GOOGLE_CLIENT_FILE, (raw) => {
  const v = (raw ?? {}) as Partial<GoogleClientCredentials>;
  if (typeof v.clientId !== 'string' || !v.clientId || typeof v.clientSecret !== 'string' || !v.clientSecret) return null;
  return { clientId: v.clientId, clientSecret: v.clientSecret };
});

export function hasGoogleClientCredentials(): boolean {
  return store.exists();
}

export async function getGoogleClientCredentials(): Promise<GoogleClientCredentials | null> {
  const v = await store.read();
  return v ? { ...v } : null;
}

/** 키체인으로 암호화해 저장 — 안전하게 암호화할 수 없으면 SecureStorageUnavailableError를 던진다. */
export async function setGoogleClientCredentials(value: GoogleClientCredentials): Promise<void> {
  await store.write({ clientId: value.clientId, clientSecret: value.clientSecret });
}

export function clearGoogleClientCredentials(): void {
  store.clear();
}

/** 형식 검사 — Desktop 앱 유형 OAuth 클라이언트의 모양. 진짜인지는 로그인해 봐야 안다(Google에 미리 확인할 API가 없다). */
export function validateGoogleClientInput(clientId: string, clientSecret: string): string | null {
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    return 'Client ID 형식이 아닙니다. Google Cloud Console의 "사용자 인증 정보"에서 만든 OAuth 클라이언트 ID(…apps.googleusercontent.com)를 그대로 붙여 넣어 주세요.';
  }
  if (!/^[A-Za-z0-9_-]{10,100}$/.test(clientSecret)) {
    return 'Client Secret 형식이 아닙니다. 같은 화면의 클라이언트 보안 비밀번호(보통 GOCSPX-로 시작)를 그대로 붙여 넣어 주세요.';
  }
  return null;
}
