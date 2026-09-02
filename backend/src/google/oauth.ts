import http from 'node:http';
import crypto from 'node:crypto';
import * as store from './store';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './clientConfig';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// spreadsheets 범위만으로 스프레드시트 생성/읽기/쓰기는 다 된다. drive.readonly는
// 오직 하나의 목적으로만 쓴다 — sheetsSync.ts의 ensureSpreadsheet()가 로컬에
// 저장된 spreadsheetId를 못 찾을 때(최초 연결, 또는 예전에 "연결 해제"가
// spreadsheetId까지 지워버리던 버그로 이미 중복 생성된 경우 등) 이름이
// "MyStock"인 기존 스프레드시트가 있는지 찾아 재사용하기 위해서다(그렇게 안
// 하면 매번 새 파일을 만들어 같은 이름의 파일이 계속 늘어남). 그 외의 Drive
// 조작(업로드/삭제/공유 등)은 하지 않는다 — Google이 "restricted"로 분류하는
// 더 넓은 drive/drive.file 범위 대신 조회 전용인 readonly만 쓴다. 이메일은
// Settings 화면에 연결된 계정을 표시하기 위한 것.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const CONNECT_TIMEOUT_MS = 5 * 60 * 1000;

export type ConnectStatus =
  | { state: 'idle' }
  | { state: 'waiting' }
  | { state: 'connected' }
  | { state: 'error'; message: string };

let currentStatus: ConnectStatus = { state: 'idle' };
let activeServer: http.Server | null = null;

export function getConnectStatus(): ConnectStatus {
  return currentStatus;
}

/** 이 빌드에 Google Client ID/Secret이 실제로 박혀 있는지 — 이 값을 채우지 않은
 *  채로 빌드하면(clientConfig.example.ts를 clientConfig.ts로 복사만 하고 값을
 *  안 채운 경우 등) 연결 시도 자체를 막아 알아보기 쉬운 에러를 준다. 정상
 *  배포된 앱에서는 항상 true여야 한다 — 일반 사용자는 이 값의 존재 자체를
 *  모른다(입력 UI가 없음). */
export function isClientConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function resetStatus(): void {
  currentStatus = { state: 'idle' };
}

/** 연결 해제(routes/google.ts의 disconnect)를 로그인 대기 중에 눌렀을 때, 열려
 *  있던 루프백 서버를 즉시 닫는다 — 없으면 최대 5분(CONNECT_TIMEOUT_MS) 동안
 *  불필요하게 포트를 붙잡고 있는다. */
export function cancelConnectFlow(): void {
  if (activeServer) closeServer(activeServer);
  resetStatus();
}

function getElectronShell(): typeof import('electron').shell | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    return electron?.shell ?? null;
  } catch {
    // Standalone (non-Electron) dev run — fall back to logging the URL.
    return null;
  }
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildAuthUrl(clientId: string, redirectUri: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // 매번 refresh_token을 받기 위해 강제로 동의 화면을 다시 띄운다 — 이게
    // 없으면 두 번째 연결부터는 Google이 refresh_token을 아예 안 내려줄 수 있다.
    prompt: 'consent',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string };
    return body.email ?? null;
  } catch {
    return null;
  }
}

function closeServer(server: http.Server): void {
  if (activeServer === server) activeServer = null;
  server.close();
}

async function exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<void> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  const body = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !body.access_token) {
    throw new Error(body.error_description ?? body.error ?? `토큰 교환 실패: ${tokenRes.status}`);
  }

  store.setTokens({
    refreshToken: body.refresh_token,
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  });
  store.setEmail(await fetchUserEmail(body.access_token));
}

const CALLBACK_SUCCESS_HTML =
  '<html><body style="font-family:sans-serif;padding:40px;">' +
  '<p>Google 계정 연결이 완료되었습니다. 이 창은 닫고 MyStock 앱으로 돌아가주세요.</p></body></html>';
const CALLBACK_FAILURE_HTML =
  '<html><body style="font-family:sans-serif;padding:40px;">' +
  '<p>Google 계정 연결에 실패했습니다. 이 창은 닫고 MyStock 앱에서 다시 시도해주세요.</p></body></html>';

/** 루프백 리디렉션 + PKCE로 OAuth 로그인을 시작한다 — 임시 로컬 서버를 임의
 *  포트에 띄우고 시스템 브라우저로 Google 로그인 페이지를 연다. 완료/실패 여부는
 *  `getConnectStatus()`를 폴링해서 확인한다(라우트가 이걸 그대로 응답). Client
 *  ID/Secret이 없으면(개발 빌드에 clientConfig.ts를 안 채운 경우) 호출부
 *  (routes/google.ts)가 먼저 걸러낸다는 전제. */
export function startConnectFlow(): void {
  if (activeServer) return; // 이미 진행 중인 로그인 플로우가 있으면 중복 시작하지 않는다.

  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const code = url.searchParams.get('code');
      const errorParam = url.searchParams.get('error');
      const address = server.address();
      const redirectUri = address && typeof address !== 'string' ? `http://127.0.0.1:${address.port}/callback` : '';

      if (errorParam || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CALLBACK_FAILURE_HTML);
        currentStatus = { state: 'error', message: errorParam ?? '인증 코드를 받지 못했습니다.' };
        closeServer(server);
        return;
      }

      try {
        await exchangeCode(code, codeVerifier, redirectUri);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CALLBACK_SUCCESS_HTML);
        currentStatus = { state: 'connected' };
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(CALLBACK_FAILURE_HTML);
        currentStatus = { state: 'error', message: err instanceof Error ? err.message : '알 수 없는 오류' };
      } finally {
        closeServer(server);
      }
    })();
  });

  currentStatus = { state: 'waiting' };
  activeServer = server;

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      currentStatus = { state: 'error', message: '로컬 서버 포트를 확인하지 못했습니다.' };
      closeServer(server);
      return;
    }
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    const authUrl = buildAuthUrl(GOOGLE_CLIENT_ID, redirectUri, codeChallenge);
    const shell = getElectronShell();
    if (shell) {
      void shell.openExternal(authUrl);
    } else {
      console.log(`[google] 브라우저에서 다음 주소를 열어 Google 로그인을 완료해주세요:\n${authUrl}`);
    }
  });

  // 사용자가 브라우저 로그인 자체를 끝내지 않는 경우를 대비한 안전장치 — 로컬
  // 서버가 무한정 열려 있지 않게 한다.
  setTimeout(() => {
    if (activeServer === server) {
      currentStatus = { state: 'error', message: '로그인 대기 시간이 초과되었습니다. 다시 시도해주세요.' };
      closeServer(server);
    }
  }, CONNECT_TIMEOUT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** refresh_token 자체가 죽었을 때(Google이 `invalid_grant`로 응답 — 만료되었거나,
 *  사용자가 Google 계정 설정에서 이 앱의 접근 권한을 직접 취소한 경우) 더 이상
 *  조용히 갱신할 방법이 없다. Sheets 내보내기/가져오기 도중 이 상태를 만나면
 *  에러로 실패시키는 대신 로그인 플로우(`startConnectFlow`)를 자동으로 다시
 *  띄우고(시스템 브라우저가 열림) 완료될 때까지 기다린 뒤 새 액세스 토큰을
 *  돌려준다 — 사용자는 뜬 브라우저에서 로그인만 다시 하면 되고, 설정 화면에서
 *  수동으로 "연결 해제 → 재연결"을 할 필요가 없다. */
async function reconnectAndGetAccessToken(): Promise<string> {
  store.clearAccount();
  startConnectFlow();

  const POLL_INTERVAL_MS = 1000;
  const start = Date.now();
  while (Date.now() - start < CONNECT_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const status = currentStatus;
    if (status.state === 'connected') {
      const token = store.getState().accessToken;
      if (!token) throw new Error('Google 재연결 후 액세스 토큰을 확인하지 못했습니다.');
      return token;
    }
    if (status.state === 'error') {
      throw new Error(`Google 계정 재연결에 실패했습니다: ${status.message}`);
    }
  }
  throw new Error('Google 계정 재연결 대기 시간이 초과되었습니다. 설정에서 다시 연결해주세요.');
}

/** Sheets API 호출 전에 항상 이걸 거친다 — 만료 임박이면 refresh_token으로
 *  자동 갱신 후 돌려준다. refresh_token 자체가 만료/취소돼 갱신이 안 되면
 *  (`invalid_grant`) 위 `reconnectAndGetAccessToken()`으로 자동 재로그인까지
 *  시도한다. */
export async function getValidAccessToken(): Promise<string> {
  const state = store.getState();
  if (!state.refreshToken) {
    throw new Error('Google 계정이 연결되어 있지 않습니다. 설정에서 먼저 연결해주세요.');
  }

  const SKEW_MS = 60_000;
  if (state.accessToken && state.accessTokenExpiresAt && state.accessTokenExpiresAt - SKEW_MS > Date.now()) {
    return state.accessToken;
  }
  if (!isClientConfigured()) {
    throw new Error('앱에 Google Client ID/Secret이 설정되지 않았습니다.');
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: state.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    if (body.error === 'invalid_grant') {
      return reconnectAndGetAccessToken();
    }
    throw new Error(
      body.error_description ?? body.error ?? `Google 액세스 토큰 갱신 실패: ${res.status}. 다시 연결해주세요.`
    );
  }

  store.setTokens({ accessToken: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 });
  return body.access_token;
}

/** 로컬에 캐시된 accessToken을 만료 시각과 무관하게 지운다 — Sheets/Drive API가
 *  401을 돌려줬을 때(로컬 만료 시각은 아직 안 지났지만 실제로는 무효화된 경우,
 *  주로 사용자가 Google 계정 설정에서 이 앱 접근 권한을 방금 취소한 직후) 다음
 *  `getValidAccessToken()` 호출이 죽은 캐시를 다시 쓰지 않고 강제로 갱신을
 *  시도하게 만든다. */
export function invalidateAccessToken(): void {
  store.invalidateAccessToken();
}
