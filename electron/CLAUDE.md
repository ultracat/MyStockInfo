# electron

Electron 메인 프로세스. `@mystock/backend`를 직접 `import`해서 같은 프로세스 안에서
Express 서버를 구동하고(별도 프로세스 아님), 렌더러 창을 띄운다.

## 핵심 파일

- `src/index.cjs` — **dev 전용** 진입점. `tsx/cjs`를 등록한 뒤 `main.ts`를 require해서,
  빌드 없이 TypeScript를 바로 실행할 수 있게 한다. `electron/package.json`의 `"dev"`
  스크립트가 `electron ./src/index.cjs`로 이 파일을 명시적으로 가리킨다 — `package.json`의
  `"main"`(아래 참고)과는 별개다.
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

- `npm run dev` (electron 워크스페이스) → `electron ./src/index.cjs` 실행(tsx로 TS 즉시
  실행, dev 전용). 보통은 루트의 `npm run dev`(frontend+electron 동시 실행)를 쓴다.
- `npm run build` → 이제 `tsc -p tsconfig.json`이 실제로 `dist/main.js`를 emit한다(과거엔
  `--noEmit` 타입 체크만 했음). `package.json`의 `"main"`이 `dist/main.js`를 가리켜서,
  패키징된 앱(아래 "Mac 배포용 빌드" 참고)과 `electron .`(인자 없이)은 이 컴파일된 산출물로
  뜬다 — dev 스크립트가 `src/index.cjs`를 명시적으로 지정하는 이유가 바로 이 `"main"`
  변경과 dev 워크플로를 분리하기 위해서다.
- 백엔드 코드를 고쳤다면 **`npm run build:backend`를 먼저 실행**하지 않으면 이 워크스페이스가
  참조하는 `@mystock/backend`(`dist/index.js`)가 최신이 아니다.

## Mac 배포용 빌드 (`npm run package:mac`, 루트에서)

`electron-builder`로 `.app`/`.dmg`를 만든다. 설정은 루트 `package.json`의 `"build"` 키에
있다 — 이 모노레포 구조 때문에 몇 가지가 일반적인 electron-builder 세팅과 다르다:

- **`directories.app`을 따로 지정하지 않는다** → 루트가 곧 "app" package.json이 된다.
  electron-builder가 어떤 `node_modules`를 포함할지 결정할 때 이 package.json의
  `dependencies`를 기준으로 삼기 때문에, 루트에 `express`/`cors`(백엔드가 실제로 쓰는
  런타임 의존성)를 **의도적으로 중복 선언**해뒀다 — 이게 없으면 npm workspaces가 만드는
  루트 `node_modules`에 실제로 존재하는데도 electron-builder가 "production dependency
  없음"으로 판단해서 `node_modules`를 통째로 빼버린다(실제로 한 번 겪음 → 패키징된 앱이
  `Cannot find module 'express'`로 즉시 죽었을 것).
- **`@mystock/backend`는 `files`의 `{from, to}` 매핑으로 별도 처리한다** — npm workspaces가
  이걸 `node_modules/@mystock/backend`에 심볼릭 링크로 만들어두는데, electron-builder가
  workspace 심볼릭 링크를 안정적으로 못 따라가서 그냥 `backend` 디렉터리를
  `node_modules/@mystock/backend`로 복사해 넣는 매핑을 명시했다(`package.json`의
  `"build".files` 참고). 그래야 `main.ts`의 `import { startServer } from '@mystock/backend'`가
  패키징된 앱 안에서도 평범한 `require` 경로로 풀린다.
- **`asar: false`.** 압축 안 하고 `Contents/Resources/app/`에 평문 파일 트리로 둔다 —
  디버깅하기 쉽고(그냥 `find`/`ls`로 들여다볼 수 있음), 이 모노레포 구조에서 asar를 켜면
  또 다른 경로 문제가 생길 수 있어서 일단 끄고 검증했다. 나중에 켜려면 `asarUnpack`으로
  `node_modules/@mystock/backend` 같은 걸 풀어줘야 할 가능성이 높다.
- **코드 서명/공증 안 함** (`mac.identity: null`). Apple Developer ID 인증서가 없어서
  의도적으로 뺐다 — 만든 사람 본인 Mac에서 실행하는 건 문제없지만(첫 실행 시 우클릭 →
  열기 필요, Gatekeeper 경고), 다른 사람에게 배포하면 "손상되었거나 확인할 수 없는
  개발자입니다" 경고가 뜬다. 실제로 여러 사람에게 배포하려면 유료 Apple Developer
  Program 인증서로 서명 + 공증(`mac.notarize`)이 필요하다.
- **아이콘 미설정** — 기본 Electron 아이콘이 붙는다. `.icns` 파일을 만들어
  `build.mac.icon`에 지정하면 바뀐다.
- 패키징된 앱은 `app.getName()`이 루트 `package.json`의 `"name"`(`mystock-api`)을 따라가서,
  자격증명/배당 데이터가 `~/Library/Application Support/mystock-api/`에 저장된다 — dev에서
  쓰던 `~/Library/Application Support/@mystock/`와는 **다른 디렉터리**라 데이터가 자동으로
  이어지지 않는다(의도된 동작: 배포용 앱은 깨끗한 상태로 시작해야 함).
- 산출물은 `release/`(gitignore됨)에 생긴다. 실제로 빌드해서 `.app`을 직접 실행 →
  백엔드가 4317 포트에 정상 바인딩 → `/api/accounts` 응답 확인 → `.dmg` 마운트까지
  확인해서 검증했다.

## 자격증명 암호화와의 관계

`backend/src/credentials.ts`가 `electron.safeStorage`와 `electron.app.getPath('userData')`를
쓰기 때문에, 백엔드가 이 프로세스 밖(순수 Node)에서 돌면 자격증명이 암호화되지 않는다.
이 폴더의 존재 이유가 바로 그것 — 절대 백엔드를 별도 자식 프로세스로 스폰하는 방식으로
바꾸지 않는다.

## 알려진 제약

- 배포용 빌드는 코드 서명/공증이 안 돼 있다 — 위 "Mac 배포용 빌드" 참고.
- 백엔드 dev 모드 파일 변경 시 자동 재시작 안 됨 — 수동으로 `build:backend` 후 Electron
  재시작 필요.
