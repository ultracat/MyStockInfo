import { Router } from 'express';
import { APP_NAME, APP_VERSION, OSS_PACKAGES } from '../generated/appInfo';

export const aboutRouter = Router();

// 이름/버전/OSS 패키지 목록은 빌드 시점에 generated/appInfo.ts로 구워둔 값을
// 그대로 내려준다(scripts/generate-app-info.cjs 참고). Electron/Chromium/Node
// 버전만 예외적으로 요청 시점에 `process.versions`에서 읽는다 — 이건 "빌드에
// 어떤 패키지가 들어갔는지"가 아니라 "지금 이 실행 환경이 어떤 런타임인지"라
// 빌드 시점 값이 아니라 실제 실행 중인 값이 맞다. Electron 메인 프로세스 밖
// (standalone 백엔드 dev 실행)이면 `electron`/`chrome`이 없어 null로 내려간다.
aboutRouter.get('/', (_req, res) => {
  res.json({
    name: APP_NAME,
    version: APP_VERSION,
    nodeVersion: process.versions.node,
    electronVersion: process.versions.electron ?? null,
    chromeVersion: process.versions.chrome ?? null,
    packages: OSS_PACKAGES,
  });
});
