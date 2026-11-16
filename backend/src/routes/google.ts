import { Router } from 'express';
import { getSecureStorageState, SECURE_STORAGE_UNAVAILABLE_MESSAGE, SecureStorageUnavailableError } from '../secureStorage';
import {
  clearGoogleClientCredentials,
  getGoogleClientCredentials,
  setGoogleClientCredentials,
  validateGoogleClientInput,
} from '../google/clientCredentials';
import * as store from '../google/store';
import * as oauth from '../google/oauth';
import * as sheetsSync from '../google/sheetsSync';
import { SHEET_DATA_TYPES, type SheetDataType } from '../google/sheetSchemas';

export const googleRouter = Router();

googleRouter.get('/status', (_req, res) => {
  const state = store.getState();
  const connectStatus = oauth.getConnectStatus();
  res.json({
    // 사용자가 설정에 OAuth 클라이언트를 넣었는지(google/clientCredentials.ts) — 없으면 프론트가 입력칸을 보여 주고
    // "Google 계정 연결"을 막는다. Client ID는 비밀이 아니라 알아보기용으로 준다(Secret은 절대 안 준다).
    hasClientCredentials: oauth.isClientConfigured(),
    clientId: getGoogleClientCredentials()?.clientId ?? null,
    connected: Boolean(state.refreshToken),
    email: state.email,
    spreadsheetUrl: state.spreadsheetUrl,
    connectStatus: connectStatus.state,
    connectError: connectStatus.state === 'error' ? connectStatus.message : null,
  });
});

googleRouter.post('/connect', (_req, res) => {
  if (!oauth.isClientConfigured()) {
    return res.status(400).json({ error: '먼저 Google OAuth 클라이언트(Client ID/Secret)를 넣어 주세요.' });
  }
  // 로그인을 다 마친 뒤 토큰 저장에서 실패하지 않도록, 브라우저를 열기 전에 먼저
  // 막는다(키링 없는 Linux 등 — secureStorage.ts).
  if (getSecureStorageState().kind === 'unavailable') {
    return res.status(409).json({ error: SECURE_STORAGE_UNAVAILABLE_MESSAGE });
  }
  oauth.startConnectFlow();
  res.json({ started: true });
});

// ---- 사용자 OAuth 클라이언트(Client ID/Secret)
googleRouter.post('/client', (req, res) => {
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.trim() : '';
  const clientSecret = typeof req.body?.clientSecret === 'string' ? req.body.clientSecret.trim() : '';
  const invalid = validateGoogleClientInput(clientId, clientSecret);
  if (invalid) return res.status(400).json({ error: invalid });
  // 클라이언트가 바뀌면 이전 클라이언트로 받은 토큰은 새 클라이언트로 갱신할 수 없다 — 연결을 끊고 다시 로그인하게 한다.
  // 같은 Client ID면(Secret만 다시 넣음) 연결을 그대로 둔다.
  const previous = getGoogleClientCredentials();
  try {
    setGoogleClientCredentials({ clientId, clientSecret });
  } catch (err) {
    if (err instanceof SecureStorageUnavailableError) return res.status(409).json({ error: err.message });
    throw err;
  }
  const disconnected = Boolean(previous && previous.clientId !== clientId && store.getState().refreshToken);
  if (previous && previous.clientId !== clientId) {
    oauth.cancelConnectFlow();
    store.clearAccount();
  }
  res.json({ configured: true, clientId, disconnected });
});

googleRouter.delete('/client', (_req, res) => {
  oauth.cancelConnectFlow();
  store.clearAccount();
  clearGoogleClientCredentials();
  res.json({ configured: false });
});

googleRouter.post('/disconnect', (_req, res) => {
  store.clearAccount();
  oauth.cancelConnectFlow();
  res.status(204).end();
});

function parseDataType(value: string): SheetDataType | null {
  return (SHEET_DATA_TYPES as string[]).includes(value) ? (value as SheetDataType) : null;
}

googleRouter.post('/sync/:dataType/export', async (req, res) => {
  const dataType = parseDataType(req.params.dataType);
  if (!dataType) return res.status(400).json({ error: `dataType은 ${SHEET_DATA_TYPES.join('|')} 중 하나여야 합니다.` });
  try {
    res.json(await sheetsSync.exportDataType(dataType));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.' });
  }
});

googleRouter.post('/sync/:dataType/import', async (req, res) => {
  const dataType = parseDataType(req.params.dataType);
  if (!dataType) return res.status(400).json({ error: `dataType은 ${SHEET_DATA_TYPES.join('|')} 중 하나여야 합니다.` });
  try {
    res.json(await sheetsSync.importDataType(dataType));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.' });
  }
});
