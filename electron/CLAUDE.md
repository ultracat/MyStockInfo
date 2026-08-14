# electron

Electron 메인 프로세스. `@mystock/backend`를 직접 `import`해서 같은 프로세스 안에서
Express 서버를 구동하고(별도 프로세스 아님), 렌더러 창을 띄운다.

## 핵심 파일

- `src/index.cjs` — 진입점 (`package.json`의 `main`). `tsx/cjs`를 등록한 뒤
  `main.ts`를 require해서, 빌드 없이 TypeScript를 바로 실행할 수 있게 한다 (dev 모드).
- `src/main.ts` — 실제 로직.
  - `BACKEND_PORT = 4317` — `frontend/src/api.ts`의 `BASE_URL`과 반드시 일치해야 한다.
  - `app.whenReady()` 안에서 `startServer(BACKEND_PORT)` → `createWindow()` 순서.
  - **`startServer()`가 반환한 서버의 `'error'` 이벤트를 반드시 처리한다** (예:
    EADDRINUSE — 이전 실행이 남아 포트를 점유한 경우). 처리하지 않으면 창은 뜨지만
    모든 API 호출이 이유 없이 실패하거나, backend 쪽에서 처리 안 하면 uncaught
    exception으로 "A JavaScript error occurred in the main process" 팝업이 뜬다.
  - `createWindow()` — dev 모드는 `http://localhost:5173`(Vite) 로드 + DevTools 자동
    오픈, 패키징된 빌드는 `frontend/dist/index.html`을 파일로 로드.
  - `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`,
    `sandbox: true` — 렌더러 보안 기본값 유지. 완화하지 않는다.

## 개발/빌드

- `npm run dev` (electron 워크스페이스) → `electron .` 실행. 보통은 루트의
  `npm run dev`(frontend+electron 동시 실행)를 쓴다.
- `npm run build` → `tsc --noEmit` (타입 체크만, 실제 산출물은 없음 — electron은
  TypeScript를 dev에서는 tsx로, 여기서는 타입 검증만).
- 백엔드 코드를 고쳤다면 **`npm run build:backend`를 먼저 실행**하지 않으면 이 워크스페이스가
  참조하는 `@mystock/backend`(`dist/index.js`)가 최신이 아니다.

## 자격증명 암호화와의 관계

`backend/src/credentials.ts`가 `electron.safeStorage`와 `electron.app.getPath('userData')`를
쓰기 때문에, 백엔드가 이 프로세스 밖(순수 Node)에서 돌면 자격증명이 암호화되지 않는다.
이 폴더의 존재 이유가 바로 그것 — 절대 백엔드를 별도 자식 프로세스로 스폰하는 방식으로
바꾸지 않는다.

## 알려진 제약

- 프로덕션 패키징(electron-builder 등 설치형 빌드) 미구현.
- 백엔드 dev 모드 파일 변경 시 자동 재시작 안 됨 — 수동으로 `build:backend` 후 Electron
  재시작 필요.
