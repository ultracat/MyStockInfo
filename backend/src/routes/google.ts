import { Router } from 'express';
import * as store from '../google/store';
import * as oauth from '../google/oauth';
import * as sheetsSync from '../google/sheetsSync';
import { SHEET_DATA_TYPES, type SheetDataType } from '../google/sheetSchemas';

export const googleRouter = Router();

googleRouter.get('/status', (_req, res) => {
  const state = store.getState();
  const connectStatus = oauth.getConnectStatus();
  res.json({
    // 앱 빌드에 Client ID/Secret이 박혀 있는지 — 정상 배포된 앱에서는 항상
    // true. false면 개발 빌드에 clientConfig.ts를 안 채운 경우뿐이라, 프론트는
    // 이 경우 "Google 계정 연결" 버튼을 비활성화한다(일반 사용자는 Client ID
    // 자체를 입력하는 UI가 없다 — google/clientConfig.ts 참고).
    hasClientCredentials: oauth.isClientConfigured(),
    connected: Boolean(state.refreshToken),
    email: state.email,
    spreadsheetUrl: state.spreadsheetUrl,
    connectStatus: connectStatus.state,
    connectError: connectStatus.state === 'error' ? connectStatus.message : null,
  });
});

googleRouter.post('/connect', (_req, res) => {
  if (!oauth.isClientConfigured()) {
    return res.status(500).json({ error: '이 빌드에 Google Client ID가 설정되지 않았습니다 (개발자 설정 누락).' });
  }
  oauth.startConnectFlow();
  res.json({ started: true });
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
