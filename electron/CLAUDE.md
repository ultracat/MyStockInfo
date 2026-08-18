# electron

Electron 메인 프로세스. `@mystock/backend`를 직접 `import`해서 같은 프로세스 안에서
Express 서버를 구동하고(별도 프로세스 아님), 렌더러 창을 띄운다.

## 핵심 파일

- `src/index.cjs` — **dev 전용** 진입점. `tsx/cjs`를 등록한 뒤 `main.ts`를 require해서,
  빌드 없이 TypeScript를 바로 실행할 수 있게 한다. `electron/package.json`의 `"dev"`
  스크립트가 `electron ./src/index.cjs`로 이 파일을 명시적으로 가리킨다 — `package.json`의
  `"main"`(아래 참고)과는 별개다.
- `src/main.ts` — 실제 로직.
  - **파일 맨 위에서 `app.setName('@mystock/electron')`을 제일 먼저 호출한다.** Electron은
    `app.getPath('userData')`(자격증명/배당 기록이 저장되는 곳)를 정할 때 쓰는 기본 앱
    이름을, "디렉터리로 실행됐을 때만" 그 디렉터리의 `package.json`의 `"name"`에서 가져오고
    (예: `electron .` → `electron/package.json`의 `"@mystock/electron"`, 슬래시가 그대로
    경로 구분자가 돼서 `~/Library/Application Support/@mystock/electron/`이라는 중첩
    폴더가 생김), 스크립트 파일 경로로 실행되면(`electron ./src/index.cjs`, 지금 dev
    스크립트가 이렇게 함) 이 조회 자체를 안 해서 Electron 기본값 `"Electron"`으로
    떨어진다 — 즉 dev 스크립트를 `electron .`에서 `electron ./src/index.cjs`로 바꾼
    시점에 기존 사용자 데이터(`@mystock/electron/`)를 통째로 못 찾게 되는 회귀가 실제로
    발생했었다(보유 종목·배당 기록이 전부 안 보이는 버그로 나타남). `setName`으로 이름을
    고정해서 어떻게 실행되든(스크립트 경로든 디렉터리든, dev든 패키징된 빌드든) 항상 같은
    `userData` 경로를 쓰게 만들어 근본적으로 해결했다 — 새 이름을 고르지 않고 기존 폴더명
    그대로 쓴 이유는 이미 있는 사용자 데이터를 마이그레이션 없이 계속 쓰기 위해서다.
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
  - `mainWindow.webContents.setWindowOpenHandler(...)` — 렌더러가 `target="_blank"`로
    여는 링크(Settings.tsx의 Google Sheets 연동 스프레드시트 바로가기 등)를 앱 안
    새 창이 아니라 `shell.openExternal`로 시스템 브라우저에서 연다(`{action: 'deny'}`로
    앱 내부 새 창 자체는 항상 막음). `backend/src/google/oauth.ts`가 OAuth 로그인
    페이지를 여는 것과 같은 `shell` — 그쪽은 백엔드 코드에서 직접 `require('electron')`로
    가져온다(safeStorage와 같은 lazy-require 패턴).
  - `process.platform !== 'darwin'`일 때만 `Menu.setApplicationMenu(null)`로 기본
    메뉴(File/Edit/View/Window)를 없앤다. Mac은 이 메뉴가 창 밖 OS 전역 메뉴바로
    가서 원래도 창 안엔 안 보이고 Cmd+Q 같은 표준 단축키도 거기 얹혀 있어 그대로
    둔다 — Windows/Linux만 창 안에 그대로 그려져서(커스텀 메뉴 항목이 하나도 없는
    이 앱엔 불필요한 줄) 뺐다. Linux AppImage를 처음 화면으로 띄워보고 나서 추가함.

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

## 플랫폼별 배포용 빌드 (`npm run package:mac`/`package:linux`/`package:win`, 루트에서)

`electron-builder`로 플랫폼별 산출물을 만든다. 설정은 루트 `package.json`의 `"build"` 키에
있고, `mac`/`linux`/`win` 서브키로 플랫폼별 타겟을 나눠 지정한다. 네이티브(`.node`) 모듈이
전혀 없는 앱이라(`express`/`cors` 체인 전부 순수 JS) `asar`/`npmRebuild` 등 아래 공통
설정은 세 플랫폼 모두에 그대로 적용되고, 크로스 컴파일 이슈(네이티브 모듈 재빌드 실패 등)
걱정 없이 다른 OS용으로도 빌드를 시도해볼 수 있다. 이 모노레포 구조 때문에 몇 가지가
일반적인 electron-builder 세팅과 다르다:

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
- **`asar: true`.** 처음 이 설정을 만들 땐 디버깅하기 쉽게(그냥 `find`/`ls`로 들여다볼 수
  있게) `false`로 두고 검증했었는데, 구조가 안정된 뒤 다시 켰다 — 네이티브(`.node`) 모듈이
  전혀 없어서(`express`/`cors` 체인 전부 순수 JS, `find node_modules -name binding.gyp`
  결과 0건) `asarUnpack` 없이도 안전하다. 앱 자체 코드(`node_modules`+`frontend`+`electron`)가
  수천 개의 흩어진 작은 파일 대신 `app.asar` 파일 하나(~1.8MB)로 묶여서, 매 실행마다
  Node의 모듈 리졸버가 열어야 하는 파일 수가 크게 줄어든다(시작 속도에 실질적으로
  영향 — Electron 프레임워크 자체 용량(~274MB, 아래 참고)에 비하면 작지만, 이 앱 코드
  안에서는 가장 눈에 띄는 최적화였다).
- **`npmRebuild: false`.** electron-builder는 기본적으로 패키징할 때마다
  `@electron/rebuild`로 네이티브 모듈을 현재 Electron의 ABI에 맞춰 재컴파일하는데, 이
  프로젝트엔 재컴파일할 네이티브 모듈이 하나도 없어서(위와 동일 이유) 매번 그 단계를
  통째로 낭비하고 있었다 — 꺼서 패키징 시간을 줄였다(순수 빌드 성능 최적화, 앱
  런타임과는 무관).
- **`@mystock/backend` 매핑에 `.d.ts`/`.map` 제외 필터 추가.** 최상위 `files`의
  `"!**/*.map"`/`"!**/*.ts"` 패턴은 `{from, to}` 매핑에는 안 먹는다(별도 필터 스코프라서) —
  그래서 `backend/dist`의 타입 선언 파일(`.d.ts`, 23개)이 패키징된 앱에 그대로 딸려가고
  있었다. 런타임엔 전혀 안 쓰이는 순수 빌드타임 산출물이라(`declaration: true`는 electron
  워크스페이스의 `tsc` 타입체크가 `@mystock/backend`의 타입을 찾는 데 필요해서 계속
  켜둬야 하지만, 그 결과물을 배포용 앱에 담을 이유는 없음) 이 매핑에도
  `"!dist/**/*.d.ts"`/`"!dist/**/*.map"`을 추가해서 뺐다.
- **패키징 자체 용량은 이미 거의 다 Electron 프레임워크다.** `.app` 293MB 중
  `Electron Framework.framework`가 274MB — Chromium/V8/Node 런타임 자체 무게라 Electron을
  쓰는 이상 못 줄인다. 우리 코드(`node_modules`+`frontend`+`electron`)는 asar로 묶은
  뒤 1.8MB밖에 안 된다 — 여기서 더 짤 게 별로 없다는 뜻. "용량이 너무 크다"고 느껴지면
  범인은 거의 항상 Electron 자체지 이 앱 코드가 아니다.
공통 설정(위 `files`/`asar`/`npmRebuild`) 위에, 플랫폼별로 아래 서브키가 따로 있다.

### Mac (`build.mac`, `npm run package:mac`)

- **코드 서명/공증 안 함** (`mac.identity: null`). Apple Developer ID 인증서가 없어서
  의도적으로 뺐다 — 만든 사람 본인 Mac에서 실행하는 건 문제없지만(첫 실행 시 우클릭 →
  열기 필요, Gatekeeper 경고), 다른 사람에게 배포하면 "손상되었거나 확인할 수 없는
  개발자입니다" 경고가 뜬다. 실제로 여러 사람에게 배포하려면 유료 Apple Developer
  Program 인증서로 서명 + 공증(`mac.notarize`)이 필요하다.
- **아이콘 미설정** — 기본 Electron 아이콘이 붙는다. `.icns` 파일을 만들어
  `build.mac.icon`에 지정하면 바뀐다.
- `main.ts`가 `app.setName('@mystock/electron')`으로 이름을 고정하므로, 패키징된 앱도
  dev와 똑같이 `~/Library/Application Support/@mystock/electron/`을 쓴다 — 기존에 dev에서
  입력해둔 자격증명/배당 기록을 그대로 이어서 쓸 수 있다(별도 마이그레이션 불필요).
- 타겟은 `dmg` 하나. 산출물은 `release/`(gitignore됨)에 생긴다. 실제로 빌드해서 `.app`을
  직접 실행 → 백엔드가 4317 포트에 정상 바인딩 → `/api/accounts`/`/api/dividends` 응답
  확인 → `.dmg` 마운트까지 확인해서 검증했다(asar 활성화 이후에도 다시 실행해서
  재검증함 — `require('@mystock/backend')`와 `loadFile()` 둘 다 asar 안에서 투명하게
  잘 풀린다).

### Linux (`build.linux`, `npm run package:linux`) — 검증 완료

- **타겟은 `AppImage` 하나.** 설치 없이 실행 파일 하나로 배포 가능해서 골랐다(Mac의
  서명 없는 `.dmg`와 같은 맥락 — 별도 배포 채널/서명 없이 그냥 실행할 수 있는 형태).
  `deb`/`rpm` 등 배포판 패키지는 추가하지 않았다 — `deb`는 electron-builder가
  `author`에 이메일이 있어야 빌드되므로(현재 루트 `package.json`의 `author`는 이름
  문자열만 있음), 개인정보를 커밋된 `package.json`에 넣지 않기 위해 보류했다. 필요해지면
  `build.linux.target`에 `"deb"`를 추가하고 `author`를 `{name, email}` 객체로 바꾸면 된다.
- **아이콘 미설정** — 기본 Electron 아이콘이 붙는다(Mac과 동일한 이유로 아직 안 함).
- `category: "Office"` — `.desktop` 항목의 프리데스크톱 분류. 앱 성격상 "Finance"도
  가능하지만(Mac의 `public.app-category.finance`와 대응) 리눅스 데스크톱 환경에서
  메뉴 노출이 더 안정적인 표준 카테고리인 `Office`를 우선 썼다.
  `build.linux.category`만 바꾸면 된다.
  Mac과 마찬가지로 `main.ts`의 `app.setName()` 고정 덕분에 사용자 데이터 경로는
  `~/.config/@mystock/electron/`로 dev와 동일하게 간다.
- 실제로 이 리눅스 환경(Ubuntu, x64)에서 `npm run package:linux` 전체 빌드 →
  `release/MyStock-0.1.0.AppImage` 생성 → `xvfb-run`으로 헤드리스 실행 → 백엔드가
  4317에 바인딩되고 `/api/accounts`가 정상 JSON을 반환하는 것까지 확인했다. 다른
  배포판(특히 Wayland-only 환경)에서의 실행은 아직 검증되지 않았다.

### Windows (`build.win`, `npm run package:win`) — 검증 완료

- **타겟은 `nsis`**(일반적인 `.exe` 설치 마법사) 하나로 준비해뒀다. `portable` 타겟(설치
  없이 실행)이 필요해지면 `build.win.target`에 추가하면 된다.
- **코드 서명 안 함.** Mac과 동일한 이유(인증서 없음) — 서명 없는 `.exe`를 실행하면
  Windows SmartScreen이 "알 수 없는 게시자" 경고를 띄운다. 여러 사람에게 배포하려면
  코드 서명 인증서(EV 인증서면 SmartScreen 평판이 즉시 쌓임)가 필요하다.
  `build.win.certificateFile`/`certificatePassword` 또는 `signtoolOptions`로 나중에
  추가할 수 있다.
  아이콘도 미설정 — 기본 Electron 아이콘이 붙는다. `.ico` 파일을 만들어
  `build.win.icon`에 지정하면 바뀐다.
- 실제로 Windows 11 머신에서 `npm run package:win` 전체 빌드 →
  `release/win-unpacked/MyStock.exe` 직접 실행(NSIS 인스톨러를 거치지 않고 unpacked
  산출물로 검증) → 창이 정상적으로 뜨고 백엔드가 4317 포트에 바인딩 → `/api/accounts`가
  정상 JSON을 반환 → 프론트엔드도 흰 화면 없이 실제 데이터(보유 종목)까지 렌더링되는 것을
  확인했다. NSIS 인스톨러(`MyStock Setup 0.1.0.exe`) 자체도 산출물로 정상 생성된다.
  다만 인스톨러를 실제로 실행해 설치 마법사 플로우까지 검증하지는 않았다(시스템에 설치되는
  동작이라 보류) — unpacked 실행 파일 검증으로 앱 코드 자체의 동작은 확인된 상태다.

## 자격증명 암호화와의 관계

`backend/src/credentials.ts`가 `electron.safeStorage`와 `electron.app.getPath('userData')`를
쓰기 때문에, 백엔드가 이 프로세스 밖(순수 Node)에서 돌면 자격증명이 암호화되지 않는다.
이 폴더의 존재 이유가 바로 그것 — 절대 백엔드를 별도 자식 프로세스로 스폰하는 방식으로
바꾸지 않는다.

## 알려진 제약

- 배포용 빌드는 세 플랫폼 모두 코드 서명/공증이 안 돼 있다 — 위 "플랫폼별 배포용 빌드"
  참고.
- Windows NSIS 인스톨러(`MyStock Setup *.exe`)는 실제 설치 마법사 플로우까지는 검증하지
  않았다 — 위 "Windows" 참고.
- 백엔드 dev 모드 파일 변경 시 자동 재시작 안 됨 — 수동으로 `build:backend` 후 Electron
  재시작 필요.
