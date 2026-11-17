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
  - **포트는 고정이 아니다**(2026-11-09) — 다른 프로젝트의 Vite가 5173을 잡고 있어 앱이
    아예 못 뜬 일이 있어서 둘 다 빈 포트로 옮겨 뜬다.
    - 백엔드: `findFreeBackendPort()`가 127.0.0.1에서 4317부터 20개를 확인해 고르고, 실제
      포트를 렌더러 URL 해시(`#token=…&port=…`, `rendererHash()`)로 넘긴다 —
      `frontend/src/api.ts`가 해시의 `port`로 `BASE_URL`을 만든다(없으면 4317).
    - dev Vite: **`scripts/dev.cjs`**(`npm run dev`의 진입점)가 5173부터 빈 포트를 골라
      `MYSTOCK_VITE_PORT`로 Vite(`vite.config.ts`, `strictPort` 유지)와 Electron 둘 다에
      넘긴다. ⚠ Vite에 `strictPort: false`만 주면 안 된다 — Vite만 옮겨 뜨고 Electron은
      여전히 5173(남의 앱)을 연다. ⚠ 빈 포트 판단은 127.0.0.1과 **::1 둘 다** 본다
      (`localhost`가 ::1로 풀려 남의 Vite가 `[::1]:5173`에 떠 있었다).
    - dev origin이 바뀌므로 Electron이 그 origin을 `startServer(…, { extraOrigins })`로
      백엔드 CORS에 추가한다(패키징은 `file://` → `null`이라 불필요).
    - `start.sh`/`start-windows.bat`의 포트 사전 검사는 없앴다 — 중복 실행은 아래 단일
      인스턴스 락이 막는다.
  - **앱은 한 번에 하나만 뜬다** — `app.requestSingleInstanceLock()`을 못 잡은 두 번째
    인스턴스는 `whenReady()`에서 백엔드·창을 띄우지 않고 바로 종료하고, 먼저 떠 있던
    쪽이 `'second-instance'`에서 창을 앞으로 가져온다(mac에서 창을 닫아 둔 상태면 새로
    연다 — `mainWindow`가 파괴된 창을 가리키므로 `isDestroyed()`로 확인). 이게 없으면
    두 번째 실행이 아래 EADDRINUSE 오류 창으로 끝났다.
  - `app.whenReady()` 안에서 `findFreeBackendPort()` → `startServer(backendPort, API_TOKEN, …)` → `createWindow()` 순서.
  - **`startServer()`가 반환한 서버의 `'error'` 이벤트를 반드시 처리한다** (예:
    EADDRINUSE — 이전 실행이 남아 포트를 점유한 경우). 처리하지 않으면 창은 뜨지만
    모든 API 호출이 이유 없이 실패하거나, backend 쪽에서 처리 안 하면 uncaught
    exception으로 "A JavaScript error occurred in the main process" 팝업이 뜬다.
  - `createWindow()` — dev 모드는 `http://localhost:${MYSTOCK_VITE_PORT}`(Vite, 기본 5173) 로드 + DevTools 자동
    오픈, 패키징된 빌드는 `frontend/dist/index.html`을 파일로 로드. **`show: false`로
    만들고 `ready-to-show` 이벤트에서만 `show()`한다** — 기본값(즉시 표시)이면 로드가
    끝나기 전 빈 창(흰 화면)이 그대로 보였다가 콘텐츠가 뒤늦게 나타난다. Vite
    HMR 서버가 아직 안 뜬 상태로 dev 모드를 너무 일찍 띄우는 등 로드 자체가 실패하는
    경우엔 `ready-to-show`가 영영 안 와서 창이 계속 안 보일 수 있다 — 그런 경우는
    로드 실패 자체(백엔드 EADDRINUSE 같은 것과는 별개)라 별도 타임아웃 안전장치는
    아직 안 뒀다.
  - `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`,
    `sandbox: true` — 렌더러 보안 기본값 유지. 완화하지 않는다.
  - `mainWindow.webContents.setWindowOpenHandler(...)` — 렌더러가 `target="_blank"`로
    여는 링크(Settings.tsx의 Google Sheets 연동 스프레드시트 바로가기 등)를 앱 안
    새 창이 아니라 `shell.openExternal`로 시스템 브라우저에서 연다(`{action: 'deny'}`로
    앱 내부 새 창 자체는 항상 막음). `backend/src/google/oauth.ts`가 OAuth 로그인
    페이지를 여는 것과 같은 `shell` — 그쪽은 백엔드 코드에서 직접 `require('electron')`로
    가져온다(safeStorage와 같은 lazy-require 패턴).
  - **`will-navigate`로 창이 앱 화면 밖으로 이동하지 못하게 막고**(http(s)는 시스템 브라우저로 넘김),
    **`denyAllPermissions()`가 브라우저 권한 요청(카메라·알림 등)을 전부 거절한다** — 아래 "보안 하드닝" 절.
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
- 이 워크스페이스는 `@mystock/backend`(`dist/index.js`)를 require한다 — **루트 `npm run dev`는 `scripts/dev-electron.cjs`가
  백엔드 `tsc -w`를 돌리며 오류 0건으로 다시 빌드될 때마다, 그리고 `electron/src/**`가 바뀔 때마다 Electron을 다시 띄운다**(2026-11-17).
  이전 프로세스가 완전히 끝난 뒤 띄운다(단일 인스턴스 락·백엔드 포트). 사용자가 앱을 끝내면 스크립트도 끝나 `concurrently -k`가 Vite까지 내린다.
  ⚠ 다시 뜰 때마다 토스 토큰을 새로 받는다(메모리 토큰) — 토스 쪽을 연달아 고칠 땐 감안. dev 밖(`electron` 워크스페이스 `npm run dev`
  단독, 실서버 점검)은 여전히 `npm run build:backend`를 먼저 돌려야 dist가 최신이다.

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
- **`electronLanguages: ["ko", "en-US"]`.** Electron은 기본적으로 Chromium의 55개
  로케일 `.pak` 파일(`locales/`)을 전부 포함하는데, 이 앱은 한국어 UI 전용이라 대부분
  안 쓰인다. Windows 기준 unpacked 산출물에서 `locales/`가 47MB(전체 350MB의 13%)를
  차지하고 있어서 실제로 확인 후 뺐다 — 한국어(`ko`)와 폴백용 영어(`en-US`)만 남기니
  `locales/`가 1.3MB로 줄고 unpacked 총용량은 305MB, NSIS 인스톨러는 94MB가 됐다(둘 다
  win-unpacked 실행 + `/api/accounts` 응답으로 정상 동작 재검증함). 다국어 지원을
  추가하게 되면 그때 필요한 로케일 코드를 이 배열에 추가하면 된다.
- **Mac은 위 `electronLanguages`만으로는 안 줄어든다 + `identity: null`만으로는
  다른 맥에서 "손상된 앱" 오류가 난다 — 이 둘을 `afterPack:
  "scripts/afterPack.cjs"` 훅 하나에서 순서대로 처리한다(반드시 fuse 적용 → 로케일
  삭제 → 재서명 순서, 거꾸로 하면 재서명한 뒤에 파일을 바꿔서 서명이 다시 깨진다).
  같은 훅이 모든 OS에서 먼저 Electron fuses를 적용한다 — 아래 "보안 하드닝" 절.**
  1. **로케일 정리**(⚠ electron-builder 26부터는 빌드 도구가 직접 정리해서 이 단계가 지우는 로케일이 0개다 — 26.18.1로 올린
     2026-11-16 확인. 남겨 둬도 해가 없고, 26 미만으로 내려가면 다시 필요하다): electron-builder(25.1.8, `app-builder-lib/out/electron/
     ElectronFramework.js`의 `getLocalesConfig`)가 Mac에서 로케일을 정리할 때 보는
     디렉터리는 `packager.getResourcesDir()`(= 앱 최상위 `Contents/Resources` — 여긴
     원래 거의 빈 스텁 `.lproj`뿐)인데, 실제 무거운 Chromium 로케일 데이터는
     `Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/*.lproj`
     (개당 최대 ~1.6MB, 총합 ~47MB — Windows의 `locales/` 47MB와 같은 데이터)에 있다.
     즉 이 버전의 electron-builder는 Mac에서 이 경로를 아예 안 건드리는 버그/제약이
     있다(실측 확인, 2026-08-19) — `electronLanguages`를 설정해도 `.app`이 ~290MB
     그대로였다. 그래서 훅이 저 프레임워크 안의 `.lproj`를 직접 훑어서 `ko`/`en` 계열
     (성별 굴절형 `en_FEMININE.lproj` 등 포함)만 남기고 지운다.
  2. **번들 전체 ad-hoc 재서명**: `identity: null`이면 Electron이 미리 심어둔
     "linker-signed" ad-hoc 서명만 남는데, 이건 번들 전체를 감싸는 리소스 시일
     (`_CodeSignature/CodeResources`) 없이 Mach-O 실행 파일 하나만 가리키는 불완전한
     상태다(`codesign --verify --deep --strict`가 "code has no resources but
     signature indicates they must be present"로 실패 — **로케일 정리와 무관하게
     원래부터 이랬다**, 0.1.0 dmg에서도 재현 확인, 2026-08-19). 빌드한 맥에서는
     quarantine 속성이 없어 Gatekeeper가 서명 검증 자체를 건너뛰어 멀쩡히 실행되지만,
     다른 맥으로 옮기면(다운로드/AirDrop 등으로 quarantine이 붙으면) Gatekeeper가 이
     불일치를 "손상된 앱"으로 판정해 실행 자체를 막는다("휴지통으로 이동해야
     합니다" 다이얼로그 — README.md가 이미 안내한 "확인되지 않은 개발자" 경고와는
     다른, 훨씬 심한 증상). `codesign --deep --force --sign -`(하이픈 = ad-hoc, 유료
     Apple Developer 인증서 불필요)로 번들 전체를 재서명하면 리소스 시일이 새로
     생겨 해결된다 — 여전히 공증은 안 된 상태라 "확인되지 않은 개발자" 경고는
     그대로 뜨지만, 우클릭 "열기"로 우회 가능한 정상 흐름으로 돌아온다.

  결과: `.app` 288MB→232MB, DMG 120MB→108MB로 줄었고, 다른 맥에 옮겨서 실행 +
  `/api/accounts` 응답까지 재검증했다. electron-builder를 올려서 로케일 정리 버그가
  고쳐지면 1번 단계는 지워도 되지만, 2번(재서명)은 `identity: null`을 유지하는
  한(=Apple Developer 인증서로 진짜 서명하기 전까지는) 계속 필요하다.
공통 설정(위 `files`/`asar`/`npmRebuild`) 위에, 플랫폼별로 아래 서브키가 따로 있다.

### Mac (`build.mac`, `npm run package:mac`)

- **macOS 13(Ventura) 이상**이 필요하다 — Electron 44부터 macOS 12 지원이 빠졌다(지금 Electron 45, 2026-11-16).
  README·매뉴얼 설치 표에 같은 내용이 있다. Electron 메이저를 올릴 땐 공식 breaking-changes에서 최소 OS를 다시 본다.

- **코드 서명/공증 안 함** (`mac.identity: null`). Apple Developer ID 인증서가 없어서
  의도적으로 뺐다 — 만든 사람 본인 Mac에서 실행하는 건 문제없지만(첫 실행 시 우클릭 →
  열기 필요, Gatekeeper 경고), 다른 사람에게 배포하면 "손상되었거나 확인할 수 없는
  개발자입니다" 경고가 뜬다. 실제로 여러 사람에게 배포하려면 유료 Apple Developer
  Program 인증서로 서명 + 공증(`mac.notarize`)이 필요하다.
- **아이콘**: `build/icon.icns`(`build.mac.icon`). 패키징 후
  `Contents/Info.plist`의 `CFBundleIconFile`이 `icon.icns`이고
  `Contents/Resources/icon.icns`가 원본과 바이트 동일한지까지 확인했다 —
  아래 "앱 아이콘" 절 참고.
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
- **아이콘**: `build/icons/`(`build.linux.icon`) — **단일 PNG가 아니라 디렉터리**를
  준다. 단일 PNG를 주면 electron-builder가 그 크기 하나만 hicolor에 설치해서(실측:
  `1024x1024/apps/` 하나뿐) 데스크톱 메뉴/작업표시줄이 매번 축소해 쓴다. 디렉터리를
  주면 `16~1024` 8개가 전부 설치된다(`usr/share/icons/hicolor/<N>x<N>/apps/`에서 확인).
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
- **아이콘**: `build/icon.ico`(`build.win.icon`). **이 단계는 Apple Silicon 맥에서
  실행되지 않는다** — electron-builder가 exe에 아이콘을 박을 때 쓰는 `rcedit`는
  Windows 바이너리라 Wine(x86_64)을 타는데, Rosetta가 없으면
  `bad CPU type in executable`로 죽는다(아이콘과 무관하게 `package:win` 자체가
  원래부터 Windows 머신에서만 돌았다). 맥에서 확인할 수 있는 건 electron-builder가
  `rcedit ... --set-icon <repo>/build/icon.ico`를 올바른 경로로 호출한다는 것까지다 —
  실제 exe 아이콘은 Windows에서 빌드해 확인해야 한다(미검증).
- 실제로 Windows 11 머신에서 `npm run package:win` 전체 빌드 →
  `release/win-unpacked/MyStock.exe` 직접 실행(NSIS 인스톨러를 거치지 않고 unpacked
  산출물로 검증) → 창이 정상적으로 뜨고 백엔드가 4317 포트에 바인딩 → `/api/accounts`가
  정상 JSON을 반환 → 프론트엔드도 흰 화면 없이 실제 데이터(보유 종목)까지 렌더링되는 것을
  확인했다. NSIS 인스톨러(`MyStock Setup 0.1.0.exe`) 자체도 산출물로 정상 생성된다.
  다만 인스톨러를 실제로 실행해 설치 마법사 플로우까지 검증하지는 않았다(시스템에 설치되는
  동작이라 보류) — unpacked 실행 파일 검증으로 앱 코드 자체의 동작은 확인된 상태다.

## GitHub Actions 릴리스 (`.github/workflows/release.yml`)

**로컬 크로스 빌드는 Apple Silicon 맥에서 불가능하다** — Windows는 `rcedit`가
Wine(x86_64)을 타고, Linux AppImage는 `mksquashfs`가 x86_64 바이너리라 둘 다
`bad CPU type in executable`로 죽는다(실측). Rosetta를 까는 것보다 **그 OS의
러너에서 빌드**하는 쪽이 재현성이 좋아서 CI로 옮겼다.

```
plan (ubuntu)   고른 플랫폼만 담은 matrix JSON 출력
  └ package     각 OS 러너에서 npm ci → 패키징 → upload-artifact
      └ release 태그 ref로 수동 실행했을 때만(npm run release:build). 산출물을 모아 **초안** 릴리스 생성
```

- **릴리스 주체는 release 잡 하나뿐**이다. electron-builder가 `GH_TOKEN`을 보면
  스스로 릴리스를 만들어 세 잡이 경쟁하므로 `-- --publish never`로 막는다.
  `--` 뒤 인자는 스크립트 문자열 맨 끝에 붙어서(`npm run build && electron-builder
  --mac --publish never`) electron-builder가 받는다.
- **`plan` 잡이 따로 있는 이유**: 잡 단위 `if`는 matrix가 펼쳐지기 전에 평가돼서
  `matrix`를 읽을 수 없다. "어떤 OS를 돌릴지"를 앞 잡에서 JSON으로 만들어 넘긴다.
- `inputs.platforms`가 비면 `all` — `release:build`는 `-f platforms=all`을 명시한다
  — 같은 워크플로를 빌드만(브랜치 ref)과 릴리스(태그 ref) 양쪽에 쓴다.
- 기본 권한은 `contents: read`, 릴리스 잡만 `write`. `if-no-files-found: error`로
  산출물 없이 "성공"하는 것을 막고, `fail-fast: false`로 한 OS가 실패해도 나머지는 받는다.
- 릴리스는 **초안(draft)**이다 — 되돌리기 어려운 공개 배포만 사람이 눌러서 확정한다.

### 빌드에 넣는 자격증명은 없다
예전엔 gitignore된 `backend/src/google/clientConfig.ts`(Google OAuth 클라이언트)와 `backend/src/fx/eximbankConfig.ts`(수출입은행
환율 키)를 워크플로가 Secrets(`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`EXIMBANK_AUTH_KEY`)로 만들어 빌드에 넣었다(없으면
`.example.ts` 템플릿 + `::warning::`). **2026-11-16부터 둘 다 사용자가 설정에서 입력**하고(`google/clientCredentials.ts`,
`fx/eximbankKey.ts`) 이 단계와 템플릿 파일을 지웠다 — 이제 러너에 만들 파일이 없다.
⚠ 바꾼 계기: **그 Secrets를 등록한 적이 없어서 v1.0.0~v1.2.2 여섯 번의 릴리스가 전부 템플릿으로 빌드됐다**(각 run에 경고 3건씩) —
배포본에서는 Google Sheets 연동도, 수출입은행 환율도 처음부터 동작하지 않았고, 개발자 PC의 로컬 빌드만 진짜 값으로 동작해서
몰랐다. "경고만 남기고 통과"하는 단계는 놓치기 쉽다 — 다시 빌드에 비밀값을 넣게 되면 릴리스 뒤 run 로그의 `::warning::`까지 확인할 것.

### 릴리스 절차
1. 루트 `version.json`의 `version`을 올린다(**단일 원천** — `generate-app-info.cjs`가
   루트 `package.json`을 자동으로 맞춘다. `package-lock.json`은 안 맞춰주므로 같이 고친다).
   같은 커밋에서 **`CHANGELOG.md` 맨 위에 새 버전 절**을 쓰고, 매뉴얼 머리말의 "vX.Y.Z 기준"과
   정보 화면 스크린샷(`doc/images/10-about.png` — 버전이 찍혀 있다)도 맞춘다.
   스크린샷은 **빈 `--user-data-dir`** 인스턴스로 찍으면 자격증명·보유 데이터가 없어 토스 토큰 충돌도 없다
   (메인 앱을 안 닫아도 됨). 작성자·저작권 줄만 가리고, 시스템이 다크 모드면 CDP
   `Emulation.setEmulatedMedia`로 `prefers-color-scheme: light`를 강제해 다른 스크린샷과 맞춘다.
2. 커밋 → main push → **`npm run release:tag`**(`scripts/release.cjs tag`) — main·변경 없음·HEAD=origin/main·
   CHANGELOG에 그 버전 절·package.json 버전 일치·태그 중복 없음을 확인하고 `vX.Y.Z` 태그를 만들어 push한다.
   **태그 push로는 빌드가 돌지 않는다**(2026-11-09 사용자 요청 — 태그와 릴리스 빌드를 따로 하려고 `on: push: tags`를 뺐다).
3. **`npm run release:build [-- vX.Y.Z]`** — `gh workflow run release.yml --ref vX.Y.Z`. 태그 ref로 돌면
   `github.ref`가 `refs/tags/v…`라 release 잡까지 가서 **초안** 릴리스를 만든다. 노트는 워크플로가 `CHANGELOG.md`의
   `## vX.Y.Z` 절을 awk로 잘라 넣는다(없으면 `--generate-notes`로 폴백 + 경고 — 그건 PR 기준이라 Full Changelog 한 줄뿐). 맨 아래 Full Changelog는 CHANGELOG에서 바로 다음 `## v` 제목을 이전 버전으로 보고 `compare/<이전>...<태그>` 링크를 단다(첫 버전이거나 그 태그가 원격에 없으면 `commits/<태그>`).
   - 수동 실행은 **그 ref의 워크플로 파일**로 돈다 — 이 변경 전에 단 태그(v1.0.x)를 다시 빌드하면 옛 워크플로가 쓰인다.
   - 같은 태그의 릴리스(초안 포함)가 이미 있으면 스크립트가 멈춘다 — 지우고 다시.
4. 초안을 확인하고 공개: `gh release edit vX.Y.Z --draft=false --latest`.

필요한 OS만 돌리려면 Actions 탭에서 **main(브랜치)으로** 수동 실행(`workflow_dispatch`)하고 플랫폼을
고른다 — 브랜치 ref라 빌드만 하고 릴리스는 만들지 않는다.

## 앱 아이콘

**원본은 `build/icon.svg` 하나다.** 나머지는 전부 거기서 생성되는 산출물이라 직접
고치지 않는다 — 로고를 바꾸려면 SVG를 고치고 루트에서 `npm run generate:icons`
(`scripts/generate-icons.cjs`)를 돌린다.

| 산출물 | 쓰이는 곳 |
|---|---|
| `build/icon.png` (1024) | 마스터 PNG — 아래 전부의 원본 |
| `build/icon.icns` | mac 실행 파일/DMG 아이콘 (`build.mac.icon`) |
| `build/icon.ico` | Windows 실행 파일/NSIS 아이콘 (`build.win.icon`) |
| `build/icons/<N>x<N>.png` | Linux hicolor 아이콘 세트 (`build.linux.icon`) |
| `electron/assets/icon.png` (512) | **런타임** 아이콘 — 아래 참고 |
| `frontend/public/icon.svg` | 브라우저 탭 파비콘(Vite dev) |
| `build/wordmark.svg` / `.png` | README/문서용 가로 워드마크 |

**아이콘을 정하는 곳이 두 군데다.** 실행 파일·설치 파일 아이콘(Finder/탐색기에서
보이는 것)은 빌드 때 electron-builder가 박고, **Linux 창/작업표시줄 아이콘과 mac dev
실행의 Dock 아이콘은 런타임에 지정해야 한다** — `main.ts`의 `APP_ICON_PATH`
(`BrowserWindow({icon})` + `app.dock.setIcon()`). 둘 중 하나만 하면 나머지 자리에
Electron 기본 아이콘이 그대로 보인다. 이 런타임 PNG는 루트 `package.json`의
`build.files`에 `electron/assets/**/*`가 있어야 asar에 들어간다.

생성 방식(이 머신엔 ImageMagick/rsvg/inkscape가 없어서 고른 경로):
- **SVG → PNG**: 이미 의존성으로 있는 Electron의 Chromium으로 렌더한다. SVG 마크업을
  HTML에 **인라인**해야 한다 — `<img src="...svg">`로 참조하면 Chromium이 `file://`
  페이지의 `file://` 하위 리소스를 막아서 깨진 이미지가 캡처된다(조용히 성공한 것처럼
  보이고, 파일 크기로만 티가 난다).
- **창은 하나를 재사용한다** — 투명·프레임 없는 `BrowserWindow`를 `destroy()`한 뒤
  같은 프로세스에서 또 만들면 그 창의 첫 로드가 `ERR_FAILED`로 거부됐다.
- 크기별 리샘플링은 `sips`, icns 패키징은 `iconutil`(둘 다 macOS 기본). ICO는 PNG를
  그대로 품을 수 있는 포맷이라 헤더만 직접 쓴다(`writeIco`, 256은 폭·높이 칸에 0).

**`.gitignore`에 `build/`를 넣지 말 것** — electron-builder의 `buildResources` 폴더와
이름이 같아서, 그 줄이 있으면 아이콘이 커밋에서 조용히 빠진다(실제로 이 저장소에
그 줄이 있어서 `git check-ignore`로 확인하고 지웠다). 빌드 산출물은 전부 `dist/`·
`release/`로 나가므로 `build/`는 소스로만 쓰인다.

## OS 알림·PDF 저장 (2026-11-17)

둘 다 **백엔드(같은 메인 프로세스)가 `require('electron')`으로** 한다 — 별도 IPC를 만들지 않았다(`backend/CLAUDE.md` "계획·목표 값, 알림, 보고서 PDF").
- 알림: `Notification`(메인 프로세스). 렌더러의 알림 권한은 `denyAllPermissions()`가 계속 거절한다 — 화면 쪽에서 `new Notification`을 쓰지 말 것.
  dev 실행은 알림 이름이 "Electron"으로 보인다. 맥은 처음 알림 때 허용을 묻는다.
- PDF: `BrowserWindow.webContents.printToPDF` + `dialog.showSaveDialog`. 원격 디버깅으로 띄운 개발용 인스턴스에서 CDP `Page.printToPDF`는 응답하지 않는다.

## 로그 파일과 처리 안 된 오류 (`src/logging.ts`, 2026-11-16)

예전엔 콘솔에만 찍혀 설치본 사용자의 문제를 추적할 방법이 없었다. `main.ts`가 `app.setName()` 직후(로그 폴더가 이름을 따름),
실행 차단 판단보다 먼저 `setupFileLogging()`을 부른다.
- 메인 프로세스(백엔드 포함)의 `console.log/info/warn/error`를 그대로 두고 `app.getPath('logs')/main.log`에도 쓴다(0600, 시작 때
  2MB 넘으면 `main.1.log`로 돌림 — 최대 약 4MB). 정보 화면 "로그 폴더 열기"가 연다(backend `routes/about.ts`).
- **`redactLogLine`으로 가려서 쓴다**: 홈 폴더 → `~`(계정 이름), 6자리 이상 숫자열(계좌번호·금액·날짜), 이메일, `Bearer …`,
  영문+숫자가 섞인 24자 이상 덩어리(토큰·키). 사용자가 문의에 첨부하는 파일이라 백엔드 `logRedact.ts` 위에 한 번 더 거른다.
- `unhandledRejection`·`uncaughtException`을 받아 기록한다(앱은 계속 돈다 — Electron 기본 오류 창 대신). 비동기 함수가 많아져
  놓친 거부를 추적하려고. 렌더러 오류는 화면 오류 경계가 백엔드 `/api/about/client-error`로 보내 같은 파일에 남는다.
- dev 실행에선 `app.getVersion()`이 Electron 버전이라 첫 줄에 `(dev)`로 찍는다.

## 화면 줌 — 메인 프로세스가 맡는 세 가지

**확대/축소 자체는 렌더러가 CSS `transform: scale`로 한다**(`frontend/CLAUDE.md`의
"화면 줌" 절 — 사이드바를 제외해야 해서 페이지 줌으로는 불가능하다). 메인
프로세스는 **Chromium이 같은 제스처에 자기 줌을 겹쳐 걸지 않게 막는 역할**만
한다. 셋 다 없으면 한 번의 ⌘+ 또는 핀치에 두 줌이 **곱해진다**.

1. **Mac 메뉴에서 줌 항목 제거.** Electron 기본 메뉴의 View에는
   `zoomIn`/`zoomOut`/`resetZoom`(= **페이지 줌**)이 ⌘+ · ⌘- · ⌘0으로 들어 있다
   (실측 확인: `View > Actual Size [resetzoom]`, `Zoom In [zoomin]`,
   `Zoom Out [zoomout]`). **메뉴 accelerator는 네이티브 쪽에서 먼저 잡아가므로
   렌더러의 `preventDefault()`로는 막을 수 없다** — 항목 자체를 빼야 그 조합이
   렌더러까지 내려간다. 기본 메뉴를 통째로 없애지는 않는다(⌘Q·복사/붙여넣기가
   전부 거기 얹혀 있다): `appMenu`/`editMenu`/`windowMenu`는 그대로 두고 View만
   직접 만든다. Windows/Linux는 원래 `setApplicationMenu(null)`이라 해당 없음.
2. **`setVisualZoomLevelLimits(1, 1)`** — 터치스크린/트랙패드 핀치로 페이지를
   통째로 확대하는 Chromium 자체 기능을 1배로 고정한다.
3. **`did-finish-load`에서 `setZoomFactor(1)`** — ⚠ 페이지 줌은 **origin별로 디스크에
   기억된다.** 과거에 ⌘+를 눌러 페이지 줌이 남아 있으면 CSS 배율과 이중으로 곱해져
   "똑같은 100%인데 화면이 크다"가 된다. 매 로드마다 되돌린다.

## 보안 하드닝 (2026-11-16)

목표는 **"이 앱의 권한(키체인으로 증권사 자격증명을 푸는 프로세스 + 토큰을 든 렌더러)을 남의 코드가 빌려 쓰지 못하게"**다.
네 겹이고 각각 막는 길이 다르다.

| 겹 | 위치 | 막는 것 |
|---|---|---|
| 렌더러 격리 | `main.ts` `webPreferences` | 렌더러에서 Node/Electron API 접근 |
| CSP | `frontend/vite.config.ts`(빌드 때 `<meta>`로 주입) | 외부 스크립트·인라인 스크립트·`eval`·외부 연결·iframe |
| 탐색·권한 | `main.ts` `will-navigate`, `denyAllPermissions()` | 창이 다른 페이지로 바뀌어 토큰 든 창에서 남의 코드가 도는 것, 브라우저 권한 |
| Electron fuses | `scripts/afterPack.cjs`(패키징 때 바이너리 수정) | 실행 파일을 Node로 쓰기(`ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS`, `--inspect`, asar 바꿔치기 |
| 원격 디버깅·개발자 도구 | `main.ts` 맨 위 `blockedLaunchReason()`, `webPreferences.devTools`, 보기 메뉴 | 다른 프로그램이 `--remote-debugging-port`로 앱을 띄워 화면을 조종하는 것, 개발자 도구 |
| 위험한 Node 환경 변수 | `main.ts` `UNSAFE_NODE_ENV` | `NODE_TLS_REJECT_UNAUTHORIZED=0`·`NODE_EXTRA_CA_CERTS`·`NODE_USE_ENV_PROXY`(통신 가로채기), `NODE_DEBUG` |
| 맥 hardened runtime | `scripts/afterPack.cjs` `resignAdHoc` + `build/entitlements.mac.plist` | `DYLD_INSERT_LIBRARIES` dylib 주입 |

- **CSP는 패키징 빌드에만 들어간다** — dev는 Vite HMR이 인라인 스크립트·ws를 써서 뺐다. 그래서 CSP 위반은 dev에선
  안 보이고 패키징해야 드러난다. 렌더러에 외부 자원(폰트·이미지·스크립트)을 들이면 `vite.config.ts`의 `CSP`를 같이 고치고
  **패키징해서** 확인한다. 화면은 `file://`라 응답 헤더가 없어 `<meta>`밖에 방법이 없다(`frame-ancestors`는 meta에서 무시됨 — 상관없다).
- **fuses 확인**: `npx @electron/fuses read --app release/mac-arm64/MyStock.app`. (electron-builder 26엔 `electronFuses` 설정이 생겼지만 맥 재서명 순서를 한 훅에서 챙기려고 afterPack을 그대로 쓴다.) 처음 넣을 땐 electron-builder 25에 fuse 설정이 없어
  `@electron/fuses`(MIT, 루트 devDependency)로 afterPack에서 직접 바꾼다. 26 이상으로 올리면 `electronFuses` 설정으로 옮길 수 있다.
- ⚠ **`EnableCookieEncryption`은 켜지 않는다** — 켰더니 시작 시 네트워크 서비스가 키체인 키를 먼저 요구해서, 서명이 매 빌드
  바뀌는 ad-hoc 앱은 키체인 허용 창에 답할 때까지 렌더러의 모든 fetch가 멈췄다("불러오는 중…"에서 정지, 실측). 쿠키를 안 쓴다.
- ⚠ **`GrantFileProtocolExtraPrivileges`는 켜 둔다(기본값)** — 화면을 `file://`로 열기 때문. 끄려면 화면을 커스텀 프로토콜로 옮겨야 한다.
- **asar 무결성 검사**(`EnableEmbeddedAsarIntegrityValidation`)는 Mac·Windows만 동작한다 — 해시는 electron-builder가
  `Info.plist`의 `ElectronAsarIntegrity`·exe 리소스에 넣는다. 패키징 뒤에 `app.asar`를 손으로 고치면 앱이 안 뜬다(의도).
- 검증(2026-11-16, Mac 패키징 + 빈 `--user-data-dir` + `--remote-debugging-port`): 화면·API 정상, CSP 위반 로그 0건.
  외부 fetch·외부/인라인 script·iframe·`eval` 차단, `file://` 탐색 차단, 알림 권한 `denied`.
  ⚠ CDP `Runtime.evaluate`로 `eval`을 시험하면 기본값 `allowUnsafeEvalBlockedByCSP: true` 때문에 CSP를 무시하고 실행된다 —
  `false`로 줘야 페이지와 같은 조건이 된다.
- **원격 디버깅 옵션은 fuses로 못 막는다** — Chromium 스위치라서. 패키징본(`app.isPackaged`)은 `remote-debugging-port`·
  `-pipe`·`-address`가 붙어 있으면 **모듈을 읽자마자 `app.exit(1)`**(창·백엔드를 만들기 전). 이걸 열어 두면 같은 PC의 프로그램이
  앱을 그 옵션으로 띄워 렌더러를 조종하고, 자기 비밀번호로 "데이터 백업"을 눌러 키체인 확인 없이 API 키를 전부 꺼내 갈 수 있었다.
  dev 실행·매뉴얼 스크린샷용 인스턴스(개발용 Electron)는 그대로 쓸 수 있다. **그래서 패키징본은 CDP로 검증할 수 없다** —
  CSP 등 렌더러 검증은 이 차단을 잠시 빼고 패키징하거나(커밋하지 말 것) dev에서 `vite build` 결과를 `loadFile`로 띄워 한다.
  패키징본 검증(2026-11-16): 두 옵션 모두 exit 1, 옵션 없이 실행하면 정상(창 뜸, 화면→백엔드 저장 요청 들어옴).
- 패키징본은 `webPreferences.devTools: false` + 보기 메뉴의 "개발자 도구" 항목 없음.
- **위험한 Node 환경 변수도 fuses로 못 막는다**(`NODE_OPTIONS`만 fuse 대상). 실측(2026-11-16): `NODE_TLS_REJECT_UNAUTHORIZED=0`이면
  메인 프로세스 `fetch`가 자체 서명 인증서 사이트에 그대로 붙었다 → 프록시와 묶으면 증권사 통신(앱 키·토큰) 가로채기. 패키징본은
  `UNSAFE_NODE_ENV`에 걸리면 **안내 창(`dialog.showErrorBox`, ready 전에도 됨) 후 종료**. 조용히 지우지 않는 이유: `NODE_EXTRA_CA_CERTS`·
  `NODE_USE_ENV_PROXY`는 시작할 때 이미 읽혀서 JS에서 지워도 늦다. Finder·시작 메뉴 실행엔 이런 변수가 없다(사내 CA를 넣어 둔 사용자만 걸림).
- **맥 hardened runtime**: 그 전 서명은 `flags=0x2(adhoc)`뿐이라 `DYLD_INSERT_LIBRARIES=x.dylib`로 띄우면 메인·헬퍼 프로세스 모두에
  dylib이 들어갔다(실측) — MyStock으로 취급돼 키체인 확인 없이 키를 푼다. 지금은 `codesign --options runtime --entitlements
  build/entitlements.mac.plist`(`flags=0x10002(adhoc,runtime)`). 권한은 셋뿐: `allow-jit`·`allow-unsigned-executable-memory`(V8),
  `disable-library-validation`(⚠ 빼면 ad-hoc엔 Team ID가 없어 **"different Team IDs"로 Electron Framework 로드 실패**, 앱이 아예 안 뜬다 —
  실측). `allow-dyld-environment-variables`를 넣지 않는 것이 주입 차단이다. 인증서로 진짜 서명하면 library validation을 다시 켠다.
  확인: `codesign -dv … | grep flags`, 시험용 dylib(`__attribute__((constructor))`로 파일에 한 줄 쓰기)을 넣어 띄워 보기.
  키체인(safeStorage)은 hardened runtime의 제한 대상이 아니다(샌드박스가 아니므로) — 다른 맥에서의 Gatekeeper 흐름은 미검증.
- **Windows·Linux엔 같은 장치가 없다** — DLL 주입·`LD_PRELOAD`는 막지 못한다. 같은 사용자 권한의 악성 프로그램을 완전히 막을 수는
  없고, 위 조치는 키체인으로 지킨 키를 꺼내기까지의 벽을 높이는 것이다.
- **릴리스 산출물 무결성**: 릴리스 잡이 `SHA256SUMS.txt`를 만들어 같이 올린다(공백 든 파일명은 GitHub처럼 `.`으로 바꾼 뒤 —
  `MyStock.Setup.X.exe`). 워크플로의 외부 액션은 **커밋 해시로 고정**(`@<sha> # vX.Y.Z`)하고 `.github/dependabot.yml`이
  매달 갱신 PR을 올린다. 액션을 새로 쓰면 해시로 적는다(`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`).
- **광고·외부 위젯을 넣는다면 이 창의 CSP를 넓히지 말고** 별도 `WebContentsView`(다른 출처, preload 없음)에 띄운다.

## 자격증명 암호화와의 관계

`backend/src/credentials.ts`가 `electron.safeStorage`와 `electron.app.getPath('userData')`를
쓰기 때문에, 백엔드가 이 프로세스 밖(순수 Node)에서 돌면 자격증명이 암호화되지 않는다.
safeStorage는 **비동기 API만** 쓴다(Electron 45에서 동기 API 사용 중단 예고, 46에서 제거 — `backend/CLAUDE.md`의
`secureStorage.ts` 항목). Electron을 46 이상으로 올릴 때 동기 API를 다시 들이지 않았는지 확인한다.
이 폴더의 존재 이유가 바로 그것 — 절대 백엔드를 별도 자식 프로세스로 스폰하는 방식으로
바꾸지 않는다.

## 알려진 제약

- 배포용 빌드는 세 플랫폼 모두 코드 서명/공증이 안 돼 있다 — 위 "플랫폼별 배포용 빌드"
  참고.
- Windows NSIS 인스톨러(`MyStock Setup *.exe`)는 실제 설치 마법사 플로우까지는 검증하지
  않았다 — 위 "Windows" 참고.
- dev 자동 재시작은 루트 `npm run dev`에서만 — 위 "개발/빌드".
