import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import { canEncrypt, getSecureStorageState, openJson, sealJson, type StoredEnvelope } from '../secureStorage';

/**
 * 사용자별 Google 연결 상태(토큰 + 연결된 계정 이메일 + 연동된 스프레드시트) —
 * Client ID/Secret은 여기 없다(사용자가 설정에 넣는 OAuth 클라이언트, `clientCredentials.ts`). credentials.ts와 별도인
 * 이유는 그 파일의 CredentialsFile이 BrokerId로만 키가 잡혀 있어서 Google을
 * 억지로 브로커 취급하면 안 되기 때문. 전체를 하나의 blob으로 암호화해
 * 저장한다(credentials.ts와 같은 secureStorage.ts의 봉투 — 키링 없는 Linux에선
 * 토큰이 든 상태는 저장을 거부한다).
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

type StoredBlob = StoredEnvelope;

function blobStore() {
  return new JsonStore<StoredBlob | null>('google-account.json', getDataDir(), null);
}

// 복호화 결과 캐시 — credentials.ts의 getCredentialFields와 같은 이유. Sheets
// API 호출 하나하나가(sheetsApi.ts의 각 함수) 그 전에 항상 oauth.ts의
// getValidAccessToken()을 거치고, 그게 매번 이 readState()를 불러 accessToken을
// 확인한다 — 복호화는 OS 키체인을 거치는 호출이라, 캐싱
// 없이는 내보내기/가져오기 한 번에 여러 번(스프레드시트 존재 확인, 탭 생성,
// 읽기/쓰기 등) 반복해서 Electron 메인 프로세스를 그만큼 붙잡는다. 저장된
// 암호문(`data`)이 그대로면 결과도 같으므로 그 문자열을 키로 재사용한다 —
// writeState가 호출되면 암호문 자체가 바뀌어 자연히 다시 복호화된다.
let cachedState: { data: string; state: GoogleAccountState } | null = null;

async function readState(): Promise<GoogleAccountState> {
  const stored = blobStore().read();
  if (!stored) {
    cachedState = null;
    return { ...EMPTY_STATE };
  }
  if (cachedState && cachedState.data === stored.data) return { ...cachedState.state };

  let opened: { json: string; reseal: boolean };
  try {
    opened = await openJson(stored);
  } catch {
    throw new Error(
      '[google] 저장된 Google 연동 정보가 암호화되어 있지만 Electron safeStorage를 사용할 수 없습니다. ' +
        'Electron 안에서 앱을 실행해주세요.'
    );
  }
  const state = { ...EMPTY_STATE, ...JSON.parse(opened.json) };
  // 평문으로 저장돼 있던 상태를 지금 암호화할 수 있거나 키체인이 다시 암호화하라고 하면 다시 쓴다(credentials.ts와 같음).
  if (opened.reseal) {
    await writeState(state);
    return { ...state };
  }
  cachedState = { data: stored.data, state };
  return { ...state };
}

/** 토큰이 없는 상태(연결 해제 후 spreadsheetId만 남긴 것)는 비밀이 아니라서 암호화를
 *  못 해도 평문으로 쓴다 — 그래야 키링 없는 Linux에서도 "연결 해제"가 동작해 예전에
 *  평문으로 저장된 토큰을 지울 수 있다. 토큰이 있으면 sealJson이 거부한다. */
async function writeState(state: GoogleAccountState): Promise<void> {
  const json = JSON.stringify(state);
  const hasSecret = Boolean(state.refreshToken || state.accessToken);
  const blob: StoredBlob =
    !hasSecret && !(await canEncrypt())
      ? { data: Buffer.from(json, 'utf-8').toString('base64'), encrypted: false }
      : await sealJson(json);
  blobStore().write(blob);
}

/** 안전하지 않게 저장된 Google 토큰이 있는지 — 설정 화면 경고용(credentials.ts의
 *  listInsecureBrokers와 같은 기준). */
export async function hasInsecureTokens(): Promise<boolean> {
  const stored = blobStore().read();
  if (!stored) return false;
  if (stored.encrypted && (await getSecureStorageState()).kind !== 'unavailable') return false;
  const state = await readState();
  return Boolean(state.refreshToken || state.accessToken);
}

export async function getState(): Promise<GoogleAccountState> {
  return readState();
}

/** 백업 복원 전용(backup.ts) — 비밀번호로 풀어낸 상태를 이 PC의 키체인으로 다시 잠가
 *  통째로 저장한다. 키링 없는 Linux에서 토큰이 있으면 sealJson이 거부한다. */
export async function replaceState(state: GoogleAccountState): Promise<void> {
  await writeState({ ...EMPTY_STATE, ...state });
}

export async function setTokens(tokens: { refreshToken?: string; accessToken: string; expiresAt: number }): Promise<void> {
  const current = await readState();
  await writeState({
    ...current,
    refreshToken: tokens.refreshToken ?? current.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
  });
}

export async function setEmail(email: string | null): Promise<void> {
  await writeState({ ...(await readState()), email });
}

/** oauth.ts의 `invalidateAccessToken()`이 위임하는 실제 저장소 갱신 — accessToken만
 *  지우고 refreshToken/email/spreadsheet 정보는 그대로 둔다. */
export async function invalidateAccessToken(): Promise<void> {
  await writeState({ ...(await readState()), accessToken: null, accessTokenExpiresAt: null });
}

export async function setSpreadsheetInfo(spreadsheetId: string, spreadsheetUrl: string): Promise<void> {
  await writeState({ ...(await readState()), spreadsheetId, spreadsheetUrl });
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
export async function clearAccount(): Promise<void> {
  // 풀 수 없는 상태(다른 PC의 키체인 등)라도 연결 해제는 돼야 한다 — 그땐 스프레드시트 정보 없이 비운다.
  const current = await readState().catch(() => ({ ...EMPTY_STATE }));
  await writeState({ ...EMPTY_STATE, spreadsheetId: current.spreadsheetId, spreadsheetUrl: current.spreadsheetUrl });
}
