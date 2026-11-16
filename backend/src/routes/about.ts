import { Router } from 'express';
import { APP_AUTHOR, APP_COPYRIGHT, APP_NAME, APP_VERSION, OSS_PACKAGES } from '../generated/appInfo';
import { getUpdateStatus } from '../updateCheck';
import { setUpdateCheck } from '../db/settings';

export const aboutRouter = Router();

// 이름/버전/작성자/저작권/OSS 패키지 목록은 빌드 시점에 generated/appInfo.ts로 구워둔 값을
// 그대로 내려준다(scripts/generate-app-info.cjs 참고). Electron/Chromium/Node
// 버전만 예외적으로 요청 시점에 `process.versions`에서 읽는다 — 이건 "빌드에
// 어떤 패키지가 들어갔는지"가 아니라 "지금 이 실행 환경이 어떤 런타임인지"라
// 빌드 시점 값이 아니라 실제 실행 중인 값이 맞다. Electron 메인 프로세스 밖
// (standalone 백엔드 dev 실행)이면 `electron`/`chrome`이 없어 null로 내려간다.
aboutRouter.get('/', (_req, res) => {
  res.json({
    name: APP_NAME,
    version: APP_VERSION,
    author: APP_AUTHOR,
    copyright: APP_COPYRIGHT,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    chromeVersion: process.versions.chrome ?? null,
    packages: OSS_PACKAGES,
  });
});

// ---- 새 버전 알림(updateCheck.ts) — 실패해도 예외 대신 "모름"을 준다.
aboutRouter.get('/update', async (req, res, next) => {
  try {
    res.json(await getUpdateStatus({ force: req.query.refresh === 'true' }));
  } catch (err) {
    next(err);
  }
});

aboutRouter.post('/update-check', async (req, res, next) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled(true/false)가 필요합니다.' });
  try {
    setUpdateCheck(enabled);
    res.json(await getUpdateStatus());
  } catch (err) {
    next(err);
  }
});

// ---- 로그(electron/src/logging.ts가 메인 프로세스 console.*를 가려서 파일로 남긴다)
// 화면(렌더러)에서 난 오류를 같은 로그 파일에 남긴다 — PageErrorBoundary.tsx. 크기를 잘라 받는다.
aboutRouter.post('/client-error', (req, res) => {
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '');
  console.error(`[renderer] ${clip(req.body?.page, 40)} 화면 오류: ${clip(req.body?.message, 500)}\n${clip(req.body?.stack, 4000)}`);
  res.status(204).end();
});

// 로그 폴더를 파일 탐색기로 연다(Electron 밖 단독 실행이면 404).
aboutRouter.post('/open-logs', async (_req, res, next) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    if (!electron?.app || !electron.shell) return res.status(404).json({ error: '앱 안에서만 열 수 있습니다.' });
    const failure = await electron.shell.openPath(electron.app.getPath('logs'));
    if (failure) return res.status(500).json({ error: failure });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
