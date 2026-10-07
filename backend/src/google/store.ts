import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/**
 * 사용자별 Google 연결 상태(토큰 + 연결된 계정 이메일 + 연동된 스프레드시트) —
 * Client ID/Secret은 여기 없다(앱 빌드에 미리 박아 넣은 값, `clientConfig.ts`
 * 참고 — 일반 사용자가 입력하거나 알 필요가 없다). credentials.ts와 별도인
 * 이유는 그 파일의 CredentialsFile이 BrokerId로만 키가 잡혀 있어서 Google을
 * 억지로 브로커 취급하면 안 되기 때문. 전체를 하나의 blob으로 암호화해
 * 저장한다(credentials.ts의 {data, encrypted} 봉투와 같은 패턴 — safeStorage
 * lazy-require도 동일하게 복제, credentials.ts에서 export되어 있지 않아서).
 */
export interface GoogleAccountState {
  refreshToken: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
  email: string | null;
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
}

const EMPTY_STATE: GoogleAccountState = {
  refreshToken: null,
  accessToken: null,
  accessTokenExpiresAt: null,
  email: null,
  spreadsheetId: null,
  spreadsheetUrl: null,
};

interface StoredBlob {
  data: string;
  encrypted: boolean;
}

function getSafeStorage(): typeof import('electron').safeStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    if (electron?.safeStorage?.isEncryptionAvailable?.()) {
      return electron.safeStorage;
    }
  } catch {
    // Not running inside Electron's main process — expected for standalone
    // backend dev/test runs.
  }
  return null;
}

function blobStore() {
  return new JsonStore<StoredBlob | null>('google-account.json', getDataDir(), null);
}

// 복호화 결과 캐시 — credentials.ts의 getCredentialFields와 같은 이유. Sheets
// API 호출 하나하나가(sheetsApi.ts의 각 함수) 그 전에 항상 oauth.ts의
// getValidAccessToken()을 거치고, 그게 매번 이 readState()를 불러 accessToken을
// 확인한다 — safeStorage.decryptString은 OS 키체인을 거치는 동기 호출이라, 캐싱
// 없이는 내보내기/가져오기 한 번에 여러 번(스프레드시트 존재 확인, 탭 생성,
// 읽기/쓰기 등) 반복해서 Electron 메인 프로세스를 그만큼 붙잡는다. 저장된
// 암호문(`data`)이 그대로면 결과도 같으므로 그 문자열을 키로 재사용한다 —
// writeState가 호출되면 암호문 자체가 바뀌어 자연히 다시 복호화된다.
let cachedState: { data: string; state: GoogleAccountState } | null = null;

function readState(): GoogleAccountState {
  const stored = blobStore().read();
  if (!stored) {
    cachedState = null;
    return { ...EMPTY_STATE };
  }

  if (cachedState && cachedState.data === stored.data) {
    return { ...cachedState.state };
  }

  let json: string;
  if (stored.encrypted) {
    const safeStorage = getSafeStorage();
    if (!safeStorage) {
      throw new Error(
        '[google] 저장된 Google 연동 정보가 암호화되어 있지만 Electron safeStorage를 사용할 수 없습니다. ' +
          'Electron 안에서 앱을 실행해주세요.'
      );
    }
    json = safeStorage.decryptString(Buffer.from(stored.data, 'base64'));
  } else {
    json = Buffer.from(stored.data, 'base64').toString('utf-8');
  }

  const state = { ...EMPTY_STATE, ...JSON.parse(json) };
  cachedState = { data: stored.data, state };
  return { ...state };
}

function writeState(state: GoogleAccountState): void {
  const json = JSON.stringify(state);
  const safeStorage = getSafeStorage();
  const blob: StoredBlob = safeStorage
    ? { data: safeStorage.encryptString(json).toString('base64'), encrypted: true }
    : { data: Buffer.from(json, 'utf-8').toString('base64'), encrypted: false };
  blobStore().write(blob);
}

export function getState(): GoogleAccountState {
  return readState();
}

export function setTokens(tokens: { refreshToken?: string; accessToken: string; expiresAt: number }): void {
  const current = readState();
  writeState({
    ...current,
    refreshToken: tokens.refreshToken ?? current.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
  });
}

export function setEmail(email: string | null): void {
  writeState({ ...readState(), email });
}

/** oauth.ts의 `invalidateAccessToken()`이 위임하는 실제 저장소 갱신 — accessToken만
 *  지우고 refreshToken/email/spreadsheet 정보는 그대로 둔다. */
export function invalidateAccessToken(): void {
  writeState({ ...readState(), accessToken: null, accessTokenExpiresAt: null });
}

export function setSpreadsheetInfo(spreadsheetId: string, spreadsheetUrl: string): void {
  writeState({ ...readState(), spreadsheetId, spreadsheetUrl });
}

// spreadsheetId/spreadsheetUrl은 지우지 않는다 — 예전엔 이걸 포함해 전체를
// 지웠는데, 그러면 "연결 해제" 후 같은 계정으로 다시 "연결"해도 sheetsSync.ts의
// ensureSpreadsheet()가 예전 스프레드시트를 잊어버린 걸로 착각해 "MyStock"
// 파일을 새로 만들어버렸다(실제로 이렇게 "MyStock" 파일이 중복 생성된 사례
// 있음 — 예전 파일은 Drive에 그대로 남아있지만 앱은 더 이상 참조하지 않음).
// 같은 계정이 재연결하면 ensureSpreadsheet()의 spreadsheetExists() 확인을 통해
// 저장돼 있던 파일을 그대로 재사용한다 — 다른 계정으로 연결하면 그 계정엔 이
// spreadsheetId에 대한 접근 권한이 없어 spreadsheetExists()가 자연히 404를
// 반환하고 그 계정용 새 파일이 만들어지므로, 계정을 바꾸는 정상적인 경우는
// 여전히 잘 처리된다.
export function clearAccount(): void {
  const current = readState();
  writeState({ ...EMPTY_STATE, spreadsheetId: current.spreadsheetId, spreadsheetUrl: current.spreadsheetUrl });
}
