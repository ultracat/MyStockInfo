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

// ⚠ 저장소 접근은 전부 비동기(safeStorage 비동기 API) — express 4는 async 핸들러 예외를 못 잡으니 next(err)로 넘긴다.
googleRouter.get('/status', async (_req, res, next) => {
  try {
    // 풀 수 없는 상태(다른 PC의 키체인 등)면 연결 안 됨으로 보여 준다 — 다시 연결하면 된다.
    const state = await store.getState().catch(() => null);
    const client = await getGoogleClientCredentials();
    const connectStatus = oauth.getConnectStatus();
    res.json({
      // 사용자가 설정에 OAuth 클라이언트를 넣었는지(google/clientCredentials.ts) — 없으면 프론트가 입력칸을 보여 주고
      // "Google 계정 연결"을 막는다. Client ID는 비밀이 아니라 알아보기용으로 준다(Secret은 절대 안 준다).
      hasClientCredentials: client !== null,
      clientId: client?.clientId ?? null,
      connected: Boolean(state?.refreshToken),
      email: state?.email ?? null,
      spreadsheetUrl: state?.spreadsheetUrl ?? null,
      connectStatus: connectStatus.state,
      connectError: connectStatus.state === 'error' ? connectStatus.message : null,
    });
  } catch (err) {
    next(err);
  }
});

googleRouter.post('/connect', async (_req, res, next) => {
  try {
    if (!oauth.isClientConfigured()) {
      return res.status(400).json({ error: '먼저 Google OAuth 클라이언트(Client ID/Secret)를 넣어 주세요.' });
    }
    // 로그인을 다 마친 뒤 토큰 저장에서 실패하지 않도록, 브라우저를 열기 전에 먼저
    // 막는다(키링 없는 Linux 등 — secureStorage.ts).
    if ((await getSecureStorageState()).kind === 'unavailable') {
      return res.status(409).json({ error: SECURE_STORAGE_UNAVAILABLE_MESSAGE });
    }
    await oauth.startConnectFlow();
    res.json({ started: true });
  } catch (err) {
    next(err);
  }
});

// ---- 사용자 OAuth 클라이언트(Client ID/Secret)
googleRouter.post('/client', async (req, res, next) => {
  const clientId = typeof req.body?.clientId === 'string' ? req.body.clientId.trim() : '';
  const clientSecret = typeof req.body?.clientSecret === 'string' ? req.body.clientSecret.trim() : '';
  const invalid = validateGoogleClientInput(clientId, clientSecret);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    // 클라이언트가 바뀌면 이전 클라이언트로 받은 토큰은 새 클라이언트로 갱신할 수 없다 — 연결을 끊고 다시 로그인하게 한다.
    // 같은 Client ID면(Secret만 다시 넣음) 연결을 그대로 둔다.
    const previous = await getGoogleClientCredentials();
    try {
      await setGoogleClientCredentials({ clientId, clientSecret });
    } catch (err) {
      if (err instanceof SecureStorageUnavailableError) return res.status(409).json({ error: err.message });
      throw err;
    }
    const changed = Boolean(previous && previous.clientId !== clientId);
    const wasConnected = changed && Boolean((await store.getState().catch(() => null))?.refreshToken);
    if (changed) {
      oauth.cancelConnectFlow();
      await store.clearAccount();
    }
    res.json({ configured: true, clientId, disconnected: wasConnected });
  } catch (err) {
    next(err);
  }
});

googleRouter.delete('/client', async (_req, res, next) => {
  try {
    oauth.cancelConnectFlow();
    await store.clearAccount();
    clearGoogleClientCredentials();
    res.json({ configured: false });
  } catch (err) {
    next(err);
  }
});

googleRouter.post('/disconnect', async (_req, res, next) => {
  try {
    oauth.cancelConnectFlow();
    await store.clearAccount();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
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
