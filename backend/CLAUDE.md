# backend

Express 서버. `@mystock/backend`로 `electron/`에서 직접 `import`되어 Electron 메인
프로세스 안에서 구동된다(별도 프로세스 아님). 단독 실행(`npm run dev`)도 되지만 그때는
`Electron safeStorage`를 못 써서 자격증명이 암호화 없이 저장된다 — dev/테스트 전용 폴백.

## 진입점

- 비밀 값 저장소 지도(전부 OS 키체인 봉투 = `secureStorage.ts`, 전부 **async**): 증권사 키 `credentials.ts`(브로커별 봉투 맵),
  Google 토큰 `google/store.ts`, 접속 토큰 `secretJsonStore.ts`(못 쓰면 지움), 사용자 입력 키 `sealedValueStore.ts`
  (`fx/eximbankKey.ts`·`google/clientCredentials.ts`). 백업은 `backup.ts`의 `KEYCHAIN_FILES`·`secrets.enc.json`.
- `src/index.ts` — `startServer(port = 4317, apiToken?)`. `app.listen`의 `'error'` 이벤트를 반드시
  처리한다(안 하면 Electron이 "A JavaScript error occurred" 팝업을 띄운다). `apiToken`을
  안 주면(단독 실행) 새로 만들어 콘솔에 찍는다.
- `src/server.ts` — `createApp({ apiToken })`: 라우터 등록 + 전역 4-인자 에러 미들웨어(안전망 — JSON
  에러 바디 보장). **`/api/*`는 전부 `Authorization: Bearer <apiToken>`을 요구한다**(없거나
  틀리면 401) — 127.0.0.1 리슨은 다른 머신만 막고, 같은 머신 브라우저의 아무 웹페이지가
  이 서버로 fetch하는 건 못 막기 때문. 토큰은 Electron이 실행할 때마다 새로 만들어
  렌더러 URL 해시(`#token=…&port=…`)로만 넘긴다(`electron/src/main.ts` → `frontend/src/api.ts`).
  CORS는 `http://localhost:5173`(dev 기본)·`null`(패키징 `file://`)에 Electron이 넘긴 `extraOrigins`
  (dev Vite가 다른 포트로 떴을 때 그 origin 하나)만 더해 허용하는 보조 수단이고,
  실제로 막는 건 토큰이다. **새 `fetch` 경로를 프론트에 만들면 `AUTH_HEADER`를 꼭 실을 것**
  (`request<T>` 헬퍼 밖의 `downloadBackup`처럼).
- `src/credentials.ts` — 존재 확인은 `hasCredential()`(안 던짐), 실제 사용은
  `getCredentialFields()`(복호화, 던질 수 있음 — API 호출 직전에만).
- `src/secureStorage.ts` — 자격증명과 Google 토큰(`google/store.ts`)의 암호화 봉투
  (`sealJson`)와 "지금 안전하게 암호화할 수 있나" 판단(`getSecureStorageState`)의 단일
  소스. **Electron 안인데 안전한 암호화가 없으면 저장을 거부한다**
  (`SecureStorageUnavailableError` → `POST /settings/credentials/:broker`와
  `POST /google/connect`가 409, 설정 화면은 `GET /settings/secure-storage`로 미리 경고하고
  저장/연결 버튼을 막는다). 예전엔 경고 로그만 찍고 평문으로 저장했다. ⚠ 키링 없는
  Linux에서 Chromium은 `basic_text`(소스에 박힌 고정 키) 백엔드로 떨어져 사실상 평문이라
  암호화 가능 여부(`isAsyncEncryptionAvailable()`)만으로는 못 거른다 — `getSelectedStorageBackend()`가
  `basic_text`/`unknown`이면 거부한다. 평문 저장은 Electron 밖(단독 dev 실행)에서만
  허용된다. 이미 평문으로 저장된 항목은 그대로 읽히고(사용자가 해제할 수 있게),
  나중에 키링이 생기면 다음 읽기 때 암호화해 다시 쓴다(`openJson`의 `reseal`). 토큰이 없는
  Google 상태(연결 해제 후)는 비밀이 아니라 평문으로 쓸 수 있다 — 그래야 키링 없이도
  "연결 해제"가 동작한다.
  - **safeStorage는 비동기 API만 쓴다**(2026-11-16, Electron 45 — 동기 `encryptString`/`decryptString`/`isEncryptionAvailable`은
    45에서 사용 중단 예고, 46에서 제거). 그래서 **키체인을 거치는 함수는 전부 `async`**다: `getSecureStorageState`·`canEncrypt`·
    `sealJson`·`openJson`, 그 위의 `getCredentialFields`/`setCredentialFields`/`listInsecureBrokers`, google `store.*`,
    `SecretJsonStore.read/write`, `SealedValueStore.read/write`(sealedValueStore.ts — 환율 키·Google 클라이언트 공용), 브로커의
    `requireCredentials`·`getKisAccountId`·`getKbLinkedAccountId`, `loadSyncOwnership`(rowOwnership.ts — 판정은 동기 함수를 돌려줌).
    동기 API로 암호화해 둔 기존 파일도 `decryptStringAsync`로 그대로 풀린다(실데이터로 확인, 파일 재기록 없음).
    `openJson`의 `reseal`은 ① 평문인데 지금 암호화 가능 ② `shouldReEncrypt`(키체인이 다시 암호화하라고 함) 둘 다다.
  - ⚠ **`await` 빠뜨림은 타입 검사로 안 잡힌다** — `getEximbankAuthKey() !== null`(Promise는 항상 null 아님),
    `res.json({ configured: hasEximbankAuthKey() })`(Promise가 `{}`로 직렬화), `try { setX() } catch`(거부가 catch를 지나쳐
    처리 안 된 예외)처럼 조용히 틀린다. 전환 때 실제로 `routes/kisReports.ts`의 `accountId: getKisAccountId()`가 이렇게 빠져
    있었다. 이 함수들을 새로 부를 땐 `await`를 확인하고, 라우트는 express 4가 async 예외를 못 잡으니 `next(err)`로 넘긴다.
- `src/secretJsonStore.ts` — `SecretJsonStore<T>`: **증권사 접속 토큰**(`kis/kb/nh/kiwoom-token.json`)을 위
  봉투(`sealJson`)로 암호화해 쓰는 저장소(2026-11-16 — 그 전엔 평문이라 같은 사용자 권한의 아무 프로그램이 파일만
  읽어도 하루짜리 계좌 토큰을 가져갈 수 있었다). 자격증명과 달리 토큰은 **캐시**라서: 풀 수 없으면(키체인 거부·손상)
  던지지 않고 `null`(→ 새로 발급), 키링 없는 Linux면 평문으로 쓰지 않고 **파일을 지운다**(그 실행 동안 메모리에만 —
  KIS는 재실행 때 한 번 더 발급), 예전 평문 파일은 읽으면서 봉투로 다시 쓴다. ⚠ 토큰 파일을 직접 `JSON.parse`하지
  말 것 — 테스트는 `test/setup.ts`의 `readSecretJson`, 실서버 점검 스크립트(`check:kis`/`check:nh`)도 이 클래스로 읽는다.
  새 브로커 토큰도 **`<브로커>-token.json` 이름 + 이 클래스**로 — 백업이 이름 규칙으로 뺀다("백업/복원" 절).
- `src/logRedact.ts` — **증권사 응답을 로그에 남길 땐 이걸 거친다**(2026-11-16). "응답 형식이 예상과 다름" 로그는
  `shapeForLog(raw)`(값을 버리고 키·타입·길이만), 오류 본문은 `redactText()`(6자리 이상 숫자열 가림 + 500자). 예전엔 원본 응답
  전체(계좌번호·수량·금액)를 찍었다 — 터미널·Linux·Windows에선 남을 수 있다. 새 로그에 `JSON.stringify(raw)`를 쓰지 말 것.
- `src/paths.ts` — `getDataDir()`: Electron 안에서 `app.getPath('userData')/data`,
  단독 실행 시 `backend/data/`(gitignore). 단독 실행에서 `MYSTOCK_DATA_DIR` 환경변수가
  있으면 그 폴더를 쓴다 — 테스트가 실제 dev 데이터를 건드리지 않게 하는 용도(Electron
  안에서는 무시된다).
- **데이터 폴더는 0700, `JsonStore`가 쓰는 파일은 0600**(2026-11-16) — `paths.ts`가 폴더를 만들 때와 이미 있을 때
  모두 0700으로 맞추고(Linux는 `~/.config`가 755인 배포판이 있다), `JsonStore.write`의 임시 파일을 0600으로 만들어
  rename 뒤에도 그 권한이 남는다. Windows는 POSIX 권한이 없어 무시된다.
- `src/jsonStore.ts` — `JsonStore<T>`: atomic write(tmp+rename) JSON 파일 저장 헬퍼.
  자격증명/배당/보유종목/매매내역/설정이 전부 이걸 쓴다. **파싱 결과를 파일 경로별로
  메모리에 캐시한다**(mtime/size가 같으면 재파싱 안 함) — 이 백엔드는 Electron 메인
  프로세스 안에서 돌아서 요청마다 sync 읽기+`JSON.parse`를 반복하면 창 이벤트까지
  같이 멈춘다. 그래서 **`read()` 결과는 캐시와 공유되는 객체다 — 제자리 수정
  (push/필드 대입 등) 금지**, 항상 새 배열/객체를 만들어 `write`/`update`로 넘긴다.
  `getCredentialFields()`도 같은 이유로 복호화 결과를 암호문 문자열 기준으로 캐시한다.
  **`google/store.ts`의 `readState()`도 같은 패턴**으로 Google OAuth 상태(암호화된
  refresh/access token)를 캐시한다 — Sheets API 호출 하나하나가 그 전에 거치는
  `getValidAccessToken()`이 매번 이걸 부르므로, 캐시 없인 내보내기/가져오기 한 번에
  키체인 복호화가 여러 번(스프레드시트 확인, 탭 생성, 읽기/쓰기 등 호출 수만큼) 반복됐다(당시엔 동기
  `decryptString`이라 메인 프로세스를 붙잡았고, 지금은 `decryptStringAsync`라도 키체인 왕복이라 캐시를 유지한다).
  `SealedValueStore`(환율 키·Google 클라이언트)도 같은 캐시를 쓴다.
- **브로커 토큰 발급(`toss/tossClient.ts`/`kis/kisClient.ts`/`kb/kbClient.ts`의
  `getToken`/`fetchToken`) 전부 in-flight 프로미스를 공유한다** — 캐시된 토큰이
  만료/부재일 때 두 요청이 동시에 들어오면(예: 화면 두 개가 거의 동시에 API를
  부르는 경우) 각자 독립적으로 토큰을 재발급받던 걸 하나로 합쳤다. KIS는 공식
  문서에 "1일 1회 발급 제한"(`EGW00133`)이 있다고 이미 적혀 있어서(`kis-token.json`
  영속화 이유), 이 레이스가 실제로 발생하면 중복 발급이 그 제한에 걸려 그날 하루
  API 전체가 막힐 수 있는 실질적인 버그였다(토스/KB도 같은 레이스가 있어서 동일하게
  고쳤다 — 토스는 "재발급 시 이전 토큰이 즉시 무효화된다"는 특성 때문에 레이스가
  나면 더 나쁘다: 동시 요청 중 하나가 막 발급받아 쓰고 있는 토큰을 다른 하나가
  재발급하면서 무효화시켜버릴 수 있음).

## 브로커 어댑터 (`src/brokers/`)

- `types.ts` — `BrokerAdapter`(`isConfigured`, `listAccounts`, `getPortfolio`, 선택적
  `getExchangeRate`/`getTradeHistory`), `FetchOpts.forceRefresh`.
- `responseCache.ts` — `withCache(key, ttlMs, fetcher, opts)`: 5초(`DEFAULT_TTL_MS`) TTL
  (보유종목/예수금/계좌목록/현재 환율은 30초 `PORTFOLIO_TTL_MS` — 화면 전환마다
  재조회되는 걸 막는 용도, 새로고침 버튼은 `forceRefresh`로 우회) +
  **in-flight promise 공유**(같은 key로 거의 동시에 온 호출은 하나만 실제 요청). React
  StrictMode의 effect 이중실행이 이 없이는 rate-limit과 무관해 보이는 에러(토스
  `account-not-found` 등)로 샐 수 있어서 생긴 장치 — 새 브로커 클라이언트도 이걸로 감싼다.
- `registry.ts` — `getAdapter`. **삼성증권/미래에셋증권은 등록 안
  돼 있음**(어댑터를 만들 계획 자체가 없음 — CSV 전용, 아래 `knownBrokers.ts` 참고).
  **KB증권도 여기 없다** — Open API는 연동했지만(`kb/kbClient.ts`)
  `BrokerAdapter` 인터페이스(여러 계좌를 넘겨받는 `listAccounts`/`getPortfolio(accountId)`
  구조)에 안 맞아서(아래 "KB증권 Open API" 절 참고) `routes/kb.ts`가 `kbClient.ts`를
  직접 가져다 쓴다 — `knownBrokers.ts`의 `hasApiIntegration`도 `false`로 유지했다
  (이 필드는 "`registry.ts`의 전형적인 `BrokerAdapter`로 등록돼 있는가"를 뜻하는데
  KB는 아니라서).
- `knownBrokers.ts` — `KNOWN_BROKERS`(`{id, displayName, hasApiIntegration}[]`),
  `BROKER_IDS`. 브로커 id/표시 이름의 단일 소스 — `routes/dividends.ts`/
  `holdingsStore.ts`/`tradesStore.ts`/`settings.ts`/`accounts.ts`가 전부 여기서
  가져다 쓴다(예전엔 각 라우트가 `['toss','kis','kb']`를 따로 하드코딩했었음). 새
  브로커(API 연동이든 CSV 전용이든)를 추가할 땐 여기 한 줄만 추가하면 위 라우트들의
  검증/목록에 자동 반영된다. `hasApiIntegration: false`인 브로커는 `registry.ts`에
  없어도 되고, `GET /api/accounts`가 항상 `configured: true`로 돌려준다(자격증명
  개념이 없어서 — 프론트가 바로 선택할 수 있게).
- `credentialFields.ts` — 브로커별 자격증명 필드 명세. 설정 화면 폼이 이걸 그대로 읽어
  렌더링하므로 필드 추가 시 프론트 수정 불필요. 필드마다 `secret`(password input
  여부, 암호화 저장은 어차피 전부 됨 — 이건 순전히 UI/노출 여부용) 외에 선택적
  `kind: 'account'`를 붙일 수 있다 — 계좌번호처럼 "비밀은 아니지만 계좌를 식별하는
  값"이라는 표시다. `routes/settings.ts`의 `GET /settings/credential-info`가 이
  플래그로 골라서(appKey/Client ID 같은 나머지 비밀 아닌 필드는 제외) Settings.tsx의
  "증권사 연동 상태" 표 "계좌 정보" 컬럼에 보여준다.
- `rateLimiter.ts` — `RateLimiter`(직렬 스케줄링 + `learnFromHeaders` 자가보정 +
  `penalizeUntil`), `withRateLimitRetry`.
- **`toss/tossClient.ts`·`kis/kisClient.ts`는 2026-11-17부터 다시 내보내기만 하는 진입 파일이다**(둘 다 1,000줄 안팎이라 나눴다).
  다른 코드는 계속 이 이름으로 import하고, 실제 코드는 같은 폴더의 `tossCore`(응답 타입·숫자 변환·토큰·요청)·`tossAccount`·
  `tossMarketInfo`·`tossOrders`·`tossQuotes`·`tossMonthlyClose`·`tossNames`, `kisCore`(기본 URL·속도 제한·토큰 파일 캐시·`kisGet`)·
  `kisDomestic`·`kisStockDetail`·`kisOverseas`에 있다. 토큰 캐시 같은 모듈 상태는 각 `*Core.ts` 한 곳이다. 아래 "`kisClient.ts`의 …"는 그 함수가
  든 파일로 읽는다. 새 함수는 맞는 파일에 두고 진입 파일엔 손대지 않는다(`export *`라 자동으로 나간다).
- `toss/tossClient.ts` — OAuth2 client_credentials. **금액/수량/비율 필드는 전부 문자열**
  (`{type:"string",format:"decimal"}`, 공식 OpenAPI 스펙) — `toNum()`/`parsePrice()`가
  이 파일 경계에서 number로 변환하므로, 그 밖 코드는 항상 진짜 number를 받는다는 전제.
  문자열인 채로 새는 필드가 있으면 `+` 연산이 문자열 접합을 해버려 조용히 깨진다(과거
  실제 발생). `rateLimitGroups.ts`(TR/엔드포인트별 tps, `X-RateLimit-*` 헤더로 보정 —
  ASSET 5tps=보유종목, ORDER_HISTORY 5tps=매매내역, ACCOUNT 1tps). 매매내역은
  `status=CLOSED` 커서 페이지네이션 후 `filledQuantity > 0`만 필터링, `TradeRecord.name`은
  항상 `null`(Order 스키마에 없음 — 프론트가 심볼로 대체 표시).
- `kis/kisClient.ts` — 토큰 발급은 JSON 바디(토스와 다름), 에러는 HTTP 상태가 아니라
  바디의 `rt_cd`/`msg_cd`로 판단. **`msg_cd` 체크가 `res.ok` 체크보다 먼저 와야 한다** —
  KIS는 EGW00201/EGW00215(레이트리밋)를 문서상 HTTP 200 바디로 보낸다고 하지만 부하 시
  **HTTP 500으로도** 보내서(실측 확인), `res.ok`를 먼저 보면 재시도 로직에 닿기도 전에
  throw돼 리미터가 무력화된다. `kisLimiter`(4tps, 토큰/잔고조회 공용) /
  `kisDailyCcldLimiter`(1tps, 매매내역 전용 — 잔고조회보다 레이트리밋에 훨씬 잘 걸려서
  분리) 두 인스턴스. 토큰은 `kis-token.json`에 영속화(재시작마다 재발급받으면
  `EGW00133` 1일 1회 발급 제한에 걸림). 계좌 목록 조회 API가 없어 CANO/상품코드 직접
  입력, 실전투자만 지원. 매매내역(`inquire-daily-ccld`)은 조회기간이 3개월 이내/이전이냐에
  따라 TR_ID가 다르고(`TTTC0081R`/`CTSC9215R`) 페이지네이션(`tr_cont`+`ctx_area_*`)이
  필요해서, `kisGet`이 `limiter`/`maxRetries`를 파라미터로 받아 호출부가 TR별로 다른
  페이싱/재시도 예산(기본 3회, 이 TR은 5회+1/2/4/8/16초 백오프)을 쓸 수 있다.

**진짜 API 연동이 필요한** 새 브로커는 어댑터+registry 등록+credentialFields(+필요하면
전용 리미터)만 만들면 라우트/프론트는 그대로 재사용된다. **삼성증권/미래에셋증권은
이 넷 다 없고, 앞으로도 안 만든다**(사용자 요청 — API 연동 없이 CSV로만 데이터 관리) —
`knownBrokers.ts`에 `hasApiIntegration: false`로 등록만 돼 있고, 로컬 저장소/CSV
import(아래)가 이 broker id를 받아들인다. 계좌 목록 개념도 라이브 API가 아니라 로컬
저장소에 실제로 CSV로 넣어둔 `accountId`들을 모아 대신한다(프론트
`API_BROKER_IDS.includes(broker)`로 분기, `frontend/CLAUDE.md` 참고). **KB증권은 CSV
전용 브로커와 같은 취급을 받으면서(로컬 저장소·계좌 여러 개·CSV import 전부 그대로)
Open API로 그 로컬 저장소를 채우는 자동 동기화가 추가로 있다** — 아래 "KB증권 Open
API" 절 참고.

### KB증권 Open API (`kb/kbClient.ts`, `routes/kb.ts`)

kbsecurities/kb-openapi(공식 레포, `example/python/README.md`·
`frontend/src/app/openapi-test/samples.generated.json`의 TR 스펙 93종, 2026-08-17
실제 appKey로 호출해 인증/요청 포맷까지 확인)를 기준으로 구현했다. **다른 두 브로커와
근본적으로 다른 제약이 있다: `appKey`/`appSecret` 자체가 발급 시점에 계좌 하나에 이미
고정 바인딩된다** — 토스처럼 계좌 목록을 조회하는 TR도, KIS처럼 계좌번호를 매 요청에
실어 보내는 방식도 없다(93종 TR spec 어디에도 계좌번호 입력 필드가 없음, 실측으로도
확인 — 계좌 관련 TR을 계좌번호 없이 호출해도 정상적으로 그 연결된 계좌의 데이터가
나온다). 그래서 한 사람이 가질 수 있는 KB 계좌 여러 개(종합위탁/연금저축/IRP 등,
`frontend/CLAUDE.md`의 계좌 별칭 참고) 중 **API로 접근 가능한 건 그 중 하나뿐**이고,
`BrokerAdapter`의 `listAccounts()`(여러 계좌를 돌려줌)로는 이 모델을 표현할 수 없다.

**설계: `BrokerAdapter`를 구현하지 않고, CSV 전용 브로커의 로컬 저장소를 채우는
"동기화" 액션으로만 노출한다.** `knownBrokers.ts`의 `hasApiIntegration`은 `false`로
유지(=`registry.ts`에 등록 안 함, 기존 CSV 전용 브로커 라우팅 그대로 재사용) —
`credentialFields.ts`에 `kb: [appKey, appSecret, accountId]`를 추가해서 Settings.tsx가
자격증명 입력 폼을 보여주게 하고, `routes/kb.ts`의 `POST /api/kb/sync-holdings`/
`POST /api/kb/sync-trades`가 `kbClient.ts`의 조회 함수를 호출해 그 결과를
`holdingsStore.replaceSnapshot`/`tradesStore.upsertTrades`(Toss/KIS의 write-through와
정확히 같은 함수)로 로컬 저장소에 써 넣는다. **세 번째 자격증명 필드 `accountId`는
KB에 실제로 보내는 값이 아니다** — 어느 계좌에 연결돼 있는지 API가 알려주지 않으므로
(계좌번호를 돌려주는 필드가 없음), "동기화 결과를 어느 로컬 accountId에 쓸지"를
로컬에서만 쓰는 값이다. `kbClient.ts`의 `getKbLinkedAccountId()`가 이 값을 읽고,
`routes/kb.ts`의 두 동기화 라우트는 요청 본문에 `accountId`가 없으면 이 값으로
자동 폴백한다(있으면 그쪽을 우선 — 다른 계좌로 한 번만 동기화하고 싶을 때의
탈출구) — 그래서 프론트가 동기화를 호출할 때 accountId를 다시 안 물어봐도 된다.
이미 "계좌 별칭"에 등록해둔 accountId와 같은 문자열을 쓰면 라벨이 자동으로
연결된다. **이 두 라우트는 Settings.tsx가 아니라 Dashboard.tsx/Trades.tsx가
호출한다** — 그 계좌가 화면에 보이는 시점에 자동으로(+수동 새로고침 버튼) 백그라운드
동기화가 일어나는 방식으로 바뀌었다(`frontend/CLAUDE.md`의 `kbSync.ts` 절 참고,
예전엔 Settings.tsx에 "KB증권 실시간 동기화" 카드가 따로 있었지만 없앴다). 동기화
후에는 보유종목/매매내역 화면에서 다른 CSV 전용 계좌와 완전히 동일하게 보인다
(별도 프론트 분기 불필요).

**인증**: `POST /oauth2/token`, OAuth2 client_credentials, 요청/응답 전부
`{dataHeader:{ipAddr,macAddr}, dataBody:{...}}` 포맷으로 감싼다(공식 example
`auth_example.py`). `access_token`은 `dataBody.access_token`. TR 호출 헤더는
`appKey`와 `Authorization: bearer <token>`(소문자 `bearer` 고정, KIS의 `Bearer`와
다름). **`ipAddr`/`macAddr`를 빈 문자열로 보내면 계좌 관련 TR이 거부된다**(실측,
"입력 전문 [dataHeader.ipAddr]를 확인해 주세요") — example README는 "서버에서
호출하면 비워도 된다"고 했지만 이건 투자정보(시세) 카테고리 얘기였고, 계좌 데이터는
형식만 맞춘 placeholder(`127.0.0.1`/`00:00:00:00:00:00`)가 필요하다(실제 값 검증은
안 하는 것으로 보임). `expires_in`이 응답에 명시적으로 안 잡혀서 55분을 보수적
기본값으로 쓰고, `kis-token.json`과 같은 이유로 `kb-token.json`에 영속화한다. Rate
limit 수치가 공식 문서에 없어 KIS(4tps)보다 보수적인 2tps로 시작(`kbLimiter`) —
근거가 생기면 조정.

**사용하는 TR**(93종 중 계좌번호 없이 호출 가능한 것으로 실측 확인된 것만):
- `SSQM2952`(계좌자산평가, `/api/v1/ssqm2952`) — 보유종목+평가정보. `is_cd`/`is_nm`/
  `hld_q`/`byng_amt`/`now_prc`/`byng_avr_prc`/`val_amt`/`val_pl`/`val_yld`/`crncy_cd`/
  `mkt_clsf`를 `HoldingPosition`에 매핑(`val_yld`는 KIS의 `evlu_pfls_rt`와 같은 관례로
  가정해 100으로 나눔). 입력은 `excg_mktpr_ccd`(거래소시세구분코드, 필수)만 필요.
- `SWQA2301`(계좌원장 거래내역 조회, `/api/v1/swqa2301`) — 매매내역. `strt_dt`/
  `end_dt`로 기간 조회가 되는 유일한 후보였다(같은 목적의 `SSQM2341`은 실측 결과
  `ordr_dt`(단일 날짜) 없이는 거부돼서 기간 조회에 안 맞음). `inq_clsf5`/`inq_clsf6`을
  `'1'`로 켜서 매수/매도만 서버 단에서 필터링하고, side는 `smry_nm`(적요명)의 "매수"/
  "매도" 한글 텍스트로 판정한다(숫자 코드 `dl_typ_cd`의 정확한 의미를 실측으로 확인
  못 해서 — KB가 이미 사람이 읽을 수 있는 라벨을 내려주는 쪽을 신뢰).

**⚠ 공개 명세에서 계좌 TR이 빠졌다(2026-09-14, 공식 저장소 커밋 "불필요 sample 삭제" — 97 → 31종, 남은 건 "투자정보"뿐).** 그래서 감시·타입은
그 직전 공개본 `159480c`(2026-07-29)을 고정 기준으로 쓴다(`spec/watch.json` kb, `spec/snapshots/kb.json`, `kb/kbSpec.gen.ts` — `kbPost<TR>`이
요청·응답을 타입으로). 명세는 한 줄 목록이고 `grid_cnt1` 뒤가 반복 줄(`dataBody.Record1`)이다. 2026-11-17 `check:kb -- --record`: API는 그대로
응답하고 요약 필드가 고정 기준과 **정확히 같다**(봉투 `o_lngth·o_clsf·o_msg`만 더 있음). 생성 타입이 짚은 것: 보유의 시장을 명세에 없는 `mkt_clsf`로
읽어 **늘 null**이었다 → 통화로 정한다(`marketFromCurrency`, KRW→KR·USD→US). 거래내역 `SWQA2301`엔 연속조회 키 `nxt_key`(입출력)가 있는데
첫 페이지만 받는다 — 0건이라 확인 못 해 그대로 두고 `check:kb`가 `nxt_key`가 오면 WARN으로 알린다. 실서버 점검: `npm run check:kb`.

**검증 상태(중요)**: 위 매핑은 공식 TR 스펙과 실제 appKey로의 인증/요청 포맷 검증까지는
마쳤지만(2026-08-17), **연결된 계좌가 그 시점에 보유종목·매매내역이 전부 0건이라 0이
아닌 실제 값으로 필드 단위 검증은 못 했다** — 특히 `is_cd`/`stnd_is_cd`(종목코드)가
다른 브로커처럼 6자리 단축코드인지 12자리 표준(ISIN)코드인지조차 확인 불가라 변환 없이
있는 그대로 저장한다. 실제 보유종목/거래가 동기화되면 반드시 화면에서 숫자가 맞는지
재확인할 것.

**시도했지만 권한이 없어 실패하는 TR**: `SWQM2302`(예수금조회, `/api/v1/swqm2302`,
`tfnd_amt` 필드) — 93종 스펙엔 있고 계좌번호 없이 호출하는 패턴도 위 두 TR과
동일하지만, **실제로 호출하면 `I446 "API 사용 권한이 없습니다"`(HTTP 500)로
거부된다**(실측 확인, 2026-08-19). 즉 스펙에 있다고 다 되는 게 아니라 계좌 등록
시 권한이 열린 TR만 호출 가능하다는 뜻 — 그래서 KB의 예수금은 이 앱에서 연동하지
않는다(아래 "계좌별 예수금" 절 참고). SSQM0005와 같은 전례.

### 계좌별 예수금

보유종목 화면 상단에 "예수금" 타일이 있다 — **토스/KIS(API 연동 브로커)만
지원**하고, KB/삼성/미래에셋(CSV·Google Sheets로 관리하는 브로커)은 값을 알
방법이 없어(KB는 위 TR 권한 문제, 삼성/미래에셋은 API 자체가 없음) "미지원"으로
고정 표시한다 — 계좌별로 별도 저장소나 CSV/Sheets 가져오기/내보내기를 두면
UI만 복잡해지고 실제로 채울 방법이 없는 브로커가 더 많아 배제했다(사용자 결정,
2026-08-19).

- **토스**: `GET /api/v1/buying-power?currency=KRW|USD`(`ORDER_INFO` 그룹, 공식
  스펙 확인) — "매수 가능 금액(미수 미발생 기준)"이라 T+2 미정산분이 있으면 실제
  예수금과 약간 다를 수 있는 근사치다. `tossAdapter.getPortfolio`가 KRW/USD 두
  통화를 `Promise.allSettled`로 독립 조회하므로 한쪽이 실패해도 나머지와 보유종목
  조회 자체는 안 막힌다.
- **KIS**: 이미 호출 중인 `inquire-balance`의 `output2.dnca_tot_amt`(예수금총금액)를
  그대로 씀 — 추가 API 호출 없음. 달러 예수금은 해외 체결기준현재잔고(`CTRP6504R`) output2의 USD 줄
  `frcr_dncl_amt_2`(아래 "KIS 해외주식(미국)" 절).

`PortfolioOverview.cashBalanceKrw`/`cashBalanceUsd`(브로커 API가 못 주거나 조회
실패 시 null)에 실려서 프론트로 그대로 전달된다 — 별도 저장소 없이 매 조회마다
라이브로 채워지는 값이라 write-through나 CSV/Sheets 대상이 아니다.

## 라우트 (`src/routes/`)

각 라우트는 브로커 예외를 `handleBrokerApiError`로 위임. 여러 브로커를 순회하는 목록형
엔드포인트(`GET /api/accounts`)는 브로커 하나 실패가 전체를 깨지 않도록 개별 try/catch.
`trades.ts`는 `adapter.getTradeHistory` 존재 여부를 먼저 확인해 미구현 브로커면 404.

## 로컬 저장소 + write-through 동기화

보유종목(`src/db/holdingsStore.ts`, `holdings.json`)과 매매내역(`src/db/tradesStore.ts`,
`trades.json`)은 삼성증권/미래에셋증권처럼 API 연동이 없는 브로커의 데이터를 다루기
위해 만든 로컬 저장소다 — `dividends.ts`/`JsonStore` 패턴 그대로. `routes/holdings.ts`/`routes/trades.ts`는
실시간 조회가 성공할 때마다(브로커 무관) 이 저장소도 같이 갱신한다(write-through, 저장
실패는 try/catch로 삼켜서 라이브 응답을 막지 않음) — 그래서 API 연동 브로커도 로컬에
최신 상태가 항상 반영돼 있다. 보유종목은 `replaceSnapshot`(해당 broker+accountId의 기존
행을 통째로 교체 — "현재 상태" 스냅샷이라 히스토리가 아님)을, 매매내역은
`upsertTrades`(브로커 `id` 기준 upsert — 누적 히스토리라 반복 조회에도 중복 안 쌓임)를
쓴다. CSV 가져오기(아래)는 보유종목이 `replaceHoldingsFromImport`, 매매내역이
`upsertFromImport`로 별도 경로를 쓴다 — 보유종목은 실시간 동기화와 마찬가지로 CSV에
등장한 (broker,accountId)를 통째로 덮어쓰고(같은 CSV를 다시 가져와도 안 쌓임), 매매내역은
누적 히스토리라 `id` 기준 upsert로 남긴다.
**KB증권**은 이 write-through를 `routes/kb.ts`의 동기화 라우트가 호출될 때 한다는
점만 다르고(프론트가 보유종목/매매내역 화면 진입 시 자동으로 이 라우트를 호출한다
— "KB증권 Open API" 절 참고), 쓰는 함수(`replaceSnapshot`/`upsertTrades`)는 동일하다.

**`replaceSnapshot`은 내용이 전과 같으면 디스크 쓰기 자체를 건너뛴다.** 보유종목
화면은 `PORTFOLIO_TTL_MS`(30초) 캐시 때문에 짧은 시간 안에 화면을 오가면 같은
포지션 데이터로 이 함수가 반복 호출되는데, `getPortfolio`가 돌려주는 `positions`를
매번 `.map()`으로 새 배열/객체로 바꾸므로 참조 비교로는 "같은 데이터"를 못 거른다
— `sameHoldingsIgnoringUpdatedAt`이 `updatedAt`을 뺀 내용을 직접 비교해서, 같으면
`store().write()` 자체를 안 부른다(Electron 메인 프로세스에서 매번 전체 파일을
다시 stringify+쓰기 하는 비용을 줄임). 키 순서가 항상 같은 같은 코드에서 만든
객체끼리의 비교라 `JSON.stringify` 비교로 충분하다 — 혹시 순서가 달라지는 입력이
들어와도 "달라졌다"고 오판해 다시 쓰는 쪽으로만 안전하게 어긋난다.

**모의투자 계좌(NH 계좌구분 03)는 write-through하지 않는다**(`adapter.isPaperAccount?.(accountId)`) — 로컬 저장소는
다가오는 배당 예상·실현손익·세금 계산·CSV 내보내기가 "실제 보유·체결"로 읽는다. 아래 "NH투자증권(나무)" 절.

`GET /api/holdings-store`, `GET /api/trades-store`(둘 다 `?broker=&accountId=` 필터)로
저장된 걸 조회한다 — CSV 전체 내보내기와 CSV 전용 브로커(실시간 조회가 안 되는)의 데이터
확인용.

## CSV 가져오기 (배당금/보유종목/매매내역 공통 패턴)

세 `POST .../import` 라우트(`routes/dividends.ts`, `routes/holdingsStore.ts`,
`routes/tradesStore.ts`) 모두 `{ records: [...] }`를 받아 행별로 검증하고, 실패해도
나머지는 계속 저장한 뒤 `{ added, failed: [{row, error}], skipped }`로 응답한다
(`routes/importResult.ts` — 수동 작성 CSV라 오타가 흔해서, 몇백 건 중 실패한 몇 건만
골라 고칠 수 있게).

**행 소유권(`brokers/rowOwnership.ts`의 `loadSyncOwnership()` — KB 연동 계좌 id를 한 번 비동기로 읽고 행마다 쓰는 동기 판정 함수를 돌려준다)**: 토스/KIS의 모든 계좌와 KB 연동
계좌 하나는 **실시간 조회·동기화만 쓴다** — 보유종목/매매내역 가져오기(CSV·Sheets
둘 다)는 그 행을 이름/시세 조회 전에 걸러 `skipped`로 세고 쓰지 않는다(실패 아님 —
내보낸 파일을 그대로 다시 가져오면 늘 생긴다). 수동 입력 브로커(삼성/미래에셋)와 KB의
나머지 계좌만 가져오기가 쓴다. 이 구분이 없던 때 같은 체결이 import UUID와 브로커 id로
두 번 저장되거나(2026-10-19), Sheets 가져오기가 API 계좌 행까지 지웠다. **내보내기는
이 구분 없이 모든 계좌를 쓴다.** 배당금은 기준이 다르다 — 토스·한국투자증권(키가 있을 때)의 배당이 동기화
소유(`isDividendSyncOwned`, 계좌가 아니라 증권사 단위 — KIS는 원화 기록만)라 그 행을 건너뛰고, Sheets 전체 교체에서도 그 기록은
남긴다(아래 "배당 동기화(토스·한국투자증권)"). 단점: API 계좌의 과거 매매내역을 다른 머신에서 복구하려면
가져오기가 아니라 zip 백업/복원을 써야 한다. CSV 파싱/직렬화 자체는
프론트(`frontend/src/csv.ts`)가 하고 백엔드는 파싱된 배열만 받는다. 세 라우트 다
`name`(종목명)을 심볼로 자동조회한다(`src/stockNameResolver.ts`의 `resolveStockNames` —
아래 "종목명 자동조회" 절의 토스→KIS→KB 3단계 우선순위 참고). **배당금/보유종목은 이름
조회 실패를 행 실패로 처리**하지만(이름이 화면 표시에 필수), **매매내역은 CSV에 `name`
컬럼이 있으면 그 값을 그대로 쓰고(override), 없거나 조회에 실패해도 행을 막지 않는다**
(`routes/tradesStore.ts`) — 화면이 이미 심볼로 폴백 표시하므로, API 연동이 하나도 없는
사용자도 이름을 직접 CSV에 적어 넣으면 되게 하려는 것. 매매내역 `id`는 선택 컬럼이다
(CSV/Sheets 내보내기 맨 뒤에 들어감). **예전엔 내보내기에 `id`가 없어서 내보냈다
다시 가져올 때마다 같은 체결이 새 `randomUUID()`로 한 벌씩 쌓였고**, 그 뒤 실시간
조회가 브로커 id로 또 저장해 토스/KIS 체결이 최대 4벌까지 중복된 실사례가 있다
(배당금 화면 연도별 투자금이 2배로 부풀려져 발견, 2026-10-19 — 350행 정리).
지금은 `db/tradesStore.ts`가 내용(broker/accountId/symbol/side/quantity/price/
executedAt)으로도 같은 거래를 식별한다: `id` 없는 가져오기 행은 같은 내용의 기존
행 id를 1:1로 물려받고(`createIdReuser`, Sheets 전체 교체도 동일), 실시간 조회
(`upsertTrades`)는 같은 내용의 UUID 사본을 지운다. 이미 쌓였던 중복은 일회성 정리
엔드포인트(`POST /api/trades-store/dedupe`, `removeImportedDuplicates`)로 정리했고, 그 도구는 2026-11-16에 지웠다 —
화면에서 부르지 않고(API 토큰이 실행마다 바뀌어 손으로도 못 부름) 원인은 그 전에 고쳐져 공개 릴리스엔 해당 중복이 없다.
다시 필요하면 git 이력에서 되살린다.

**보유종목 CSV는 현재가/평가금액/손익도 자동으로 채운다** — 필수 컬럼(`broker,accountId,
symbol,quantity,averagePurchasePrice,currency`, `market`은 KR 심볼 0-패딩용으로 사실상
필수)만 채운 최소 CSV를 지원하려는 목적. `routes/holdingsStore.ts`가 `resolveStockNames`와
함께 `resolveStockPrices`(`stockNameResolver.ts`)를 호출해 `lastPrice`/`marketValue`/
`profitLossAmount`/`profitLossRate`를 계산한다(`marketValue = quantity * lastPrice`,
`profitLossAmount = marketValue - purchaseAmount`). **넷 다 사용자가 CSV/Google
Sheets에 뭘 적어놨든 서버가 항상 다시 계산해서 덮어쓴다** — "평가금액/손익금액/
손익률은 항상 접근 가능한 API로 자동 계산돼야 한다"는 요청(2026-09-18)에 따른
것. `lastPrice`/`marketValue`는 **API(토스→KIS) 시세 조회가 성공하면 그 값을
항상 우선**하고, CSV/시트의 값은 API로 그 종목을 못 찾을 때만(해외 종목이라 KIS
대체가 안 되는 경우, 토스 미연동 등) 쓰이는 폴백이다 — 처음엔 반대(CSV 값 우선,
API는 값이 없을 때만 보충)로 짜여 있었는데, 그러면 사용자가 예전에 적어 넣었거나
잘못 입력한 값이 실제 API로 조회 가능한 시세보다 항상 이겨버려서 뒤집었다.
**`profitLossAmount`/`profitLossRate`는 폴백조차 없다** — `marketValue -
purchaseAmount`의 순수 산술 결과라 값을 몇 번 다시 계산해도 항상 같은 답이 나와야
하므로, CSV/시트에 값이 들어 있어도 무조건 무시하고 매번 새로 계산한다. 처음엔 이
둘도 override였는데, 사용자가 Google Sheets에 새 보유종목 행을 직접 추가하면서
이 두 컬럼에 placeholder로 `0`을 적어 넣은 경우, 그 행의 실제 `marketValue`/
`purchaseAmount`가 정상적으로 채워진 뒤에도 손익만 영원히 `0`으로 고정되는
버그가 있었다(실사용자 리포트로 발견, 2026-09-18) — override를 완전히 없애서 고쳤다.
**현재가 조회는 토스 우선,
토스 미연동이면 한국투자증권으로 대체한다**(`kisClient.ts`의 `fetchKisDomesticPrice`,
`inquire-price` TR `FHKST01010100` — 계좌 무관 공개 시세라 CANO 불필요, 공식 예제
`examples_llm/domestic_stock/inquire_price/inquire_price.py` 확인, checked 2026-08-17).
**KIS 대체는 국내(KR) 심볼만 지원** — 해외주식 현재가는 거래소코드(EXCD, NAS/NYS 등)가
필수인데 이 앱은 그 정보를 안 받으므로(CSV엔 통화만 있고 거래소는 없음) 임의로 추측해
넣지 않는다. 이름 조회 실패는 행을 실패 처리하지만 현재가 조회 실패는 그냥 0으로 남긴다
(이름은 화면 표시에 필수, 현재가는 부가 정보). **KR 심볼은 6자리로 0-패딩한다**
(`normalizeSymbol`, `market === 'KR'`이고 숫자 1~6자리면 `padStart(6,'0')`) — CSV에
"5930"처럼 앞자리 0이 빠진 채로 들어와도 이름/현재가 자동조회가 정상 동작하게.

**보유종목 CSV 가져오기는 "덮어쓰기"다** — `replaceHoldingsFromImport`(`db/holdingsStore.ts`)가
이번에 가져온 CSV에 등장한 (broker,accountId) 조합마다 그 계좌의 기존 저장 행을 전부
지우고 CSV로 받은 행으로 통째로 교체한다(실시간 동기화 `replaceSnapshot`과 같은 방식).
같은 CSV를 여러 번 가져와도 행이 계속 누적되지 않고, CSV에서 뺀 종목은 자연히
사라진다 — 처음엔 심볼 기준 upsert였다가, "다시 가져오면 쌓이지 말고 덮어써야 한다"는
피드백으로 이 방식으로 바꿨다. CSV에 없는 다른 (broker,accountId)는 안 건드린다.

**선택 컬럼 `memo`로 같은 심볼의 중복 행을 화면에서 구분한다** — IRP 계좌처럼 한 계좌
안에 같은 종목을 "개인납입액"/"회사납입액"처럼 나눠서 관리하는 경우를 위한 것. 위
덮어쓰기 방식 덕분에 memo는 더 이상 행 식별에 쓰이지 않는다 — CSV에 같은 심볼이 여러
번 나오면(memo가 있든 없든) 그대로 각각 별도 행이 된다. 실시간 동기화(`replaceSnapshot`)는
이 필드를 채우지 않는다(라이브 브로커 API가 이런 구분을 안 줌) — CSV 가져오기 전용.

## 배당 기록 (`src/db/dividends.ts`)

`currency`(`KRW`|`USD`) 기준 `amount`를 그대로 저장 — 크로스 통화 환산은 안 함(프론트가
환율 가져와서 함). 월별/연도별 집계도 여기 없음 — `listDividends()`가 전체를 돌려주고
집계는 전부 프론트(Dividends.tsx) 책임. `accountId: string | null`(선택) — 한 증권사
(주로 KB증권처럼 CSV 전용 브로커) 안에 계좌가 여러 개일 때 구분하는 자유 문자열이다.
계좌 개념이 필요 없으면 `null`. 필드 도입 전 저장된 기존 기록은 JSON에 이 키 자체가
없는데, `listDividends()`가 읽을 때 `normalize()`로 항상 `null`로 채워서(마이그레이션
불필요) 이 밖의 코드는 `undefined` 케이스를 신경 안 써도 된다.

### 배당 동기화(토스·한국투자증권·NH) (`POST /api/dividends/sync`)

(NH투자증권·키움증권도 같은 원칙 — 국내·달러 배당 모두 API 소유, 상세는 각 증권사 절.)
**토스·한국투자증권 계좌의 배당은 API가 유일한 원천이다**(2026-11-09 사용자 결정: "항상 API 우선으로 로컬을
덮어쓴다"). 동기화할 때마다 그 계좌의 배당 기록을 API 결과로 **통째로 교체**한다(`db/dividends.ts`의
`replaceSyncedDividends` — 같은 내용의 기존 기록은 id를 이어받는다). 그래서 이 두 증권사(키가 있을 때)의 배당
행은(**KIS의 달러 기록 제외** — 아래 한국투자증권 항목) 직접 추가·수정·삭제(409)와 CSV·Sheets 가져오기(건너뜀, `skipped`)의 대상이 아니다
(`brokers/rowOwnership.ts`의 `isDividendSyncOwned`). 라우트는 키가 있는 증권사마다 따로 돌려(`Promise.allSettled`)
`{results, errors}`를 준다. 프론트 배당금 화면이 진입 시 자동으로 부른다.

**배당 기록의 `amount`는 세후 실수령액, `tax`는 원천징수 세금**(null=모름, 세전 = amount + tax). 모든 화면의
배당 합계는 세후 기준이다(사용자 결정). 동기화 전엔 사용자가 토스는 세후·KIS는 세전으로 적어 와서 섞여 있었다.

**규칙은 2026-11-09 사용자 기록과 API를 한 건씩 대조해 확인한 것이다**(토스 전부, KIS 68건 중 66건 일치·2건은
입력 실수). 실데이터 사본으로 두 번 돌려 두 번째는 변화 0건임을 확인했다.

토스(`brokers/toss/tossDividendSync.ts`, 거래내역 `GET /api/v1/transactions`, `TRANSACTION` 5tps, 전체 기간):
- 2026-08엔 "토스에 입금 배당 API 없음"으로 판단했었다 — 이후 추가된 것으로 보이며 정확한 시점은 모른다.
- `DIVIDEND` → 세후 `netAmount`, 세금 `tax`, 날짜 `settlementDate`. 미국 배당은 현지 원천징수 후 금액이라 tax=0.
- **국내 ETF 분배금은 `DIVIDEND`가 아니라 `DEPOSIT`(symbol 있음, KRW)로 온다.**
- **종목 붙은 USD `DEPOSIT`은 외화세금환급**(토스 앱 라벨로 확인) — 메모 `외화세금환급`. 종목 없는 입금은 건너뜀.
- **우선주 배당은 보통주 코드·ISIN으로 온다**(123455 → 123450) — 저장 코드는 보유·매매한 같은 회사(국내 코드
  앞 5자리) 코드가 하나면 그것(`toHeldShareClass`). 실데이터에 같은 회사가 두 코드로 섞여 있었다.
- 계좌: 토스 accountSeq·API 계좌번호·별칭의 표시용 번호 중 무엇으로 적힌 기록이든 같은 계좌로 보고 교체한다.
  새 기록은 표시용 번호 > API 계좌번호 > accountSeq. 계좌 칸이 빈 기록은 토스 계좌가 하나일 때만 그 계좌 것.
- 토큰은 계정당 1개라, 앱 밖에서 같은 키로 토큰을 받으면 실행 중인 앱의 토큰이 무효화된다(앱은 401에서 다시 받음).

한국투자증권(`brokers/kis/kisDividendSync.ts`, 기간별계좌권리현황조회 `CTRGA011R`, `kisClient.ts`의
`fetchKisPeriodRights`, 2000-01-01부터 한 번에 — 긴 기간도 받아짐(실측), 25건씩 연속조회, 매매내역과 같은 1tps 리미터):
- `last_alct_amt`(세전) − `tax_amt` = 세후, 날짜는 `cash_dfrm_dt`(현금지급일). ⚠ **ISA·연금저축·IRP 계좌**(계좌 세금 유형,
  `db/accountTaxTypes.ts`의 `isTaxDeferredAccount`)는 원천징수가 없어 **세후 = 세전, 세금 0** — API는 그런 계좌에도 계산상 `tax_amt`를 준다
  (2026-11-17 사용자 ISA 계좌로 확인: 세전 분배금이 그대로 입금, API는 15.4% 세금을 줌 — 고치기 전엔 세금 있는 기록이 15.4%씩 적게 잡혔다).
  다가오는 배당 확정 건과 LS·DB(`classifyLedgerDividends`)도 같은 규칙. 유형을 바꾸면 다음 동기화(배당 화면 진입)에 반영. **지급일이 오늘 이후면 지급 예정이라 넣지 않는다.**
- `rght_type_cd` 실측: `03` 주식 배당, `32` ETF 분배금(코드표는 문서에 없음). 현금 배정이 없는 권리는 걸러진다.
- **국내만** — 해외 배당을 계좌 기준으로 주는 KIS API는 없다(2026-11-09 조사). 계좌는 자격증명의 `CANO-상품코드`.
  그래서 **KIS의 동기화 소유는 원화 기록만**이다(`isDividendSyncOwned({broker, currency})`) — 미국 주식 배당은 사용자가 달러로
  직접 적고, 동기화(`replaceSyncedDividends`의 `inScope`가 기록 전체를 받아 `currency !== 'USD'`로 거름)·가져오기가 그 기록을
  건드리지 않는다. 테스트: `test/tossDividendSync.test.ts`.
- KB는 `SRQM3051`(계좌권리발생내역)·`SWQA2301` 입금 필터가 호출은 되지만(권한 오류 없음), 연동 계좌에 배당이 없어
  필드를 실측할 수 없었고, 배당이 나오는 IRP·연금저축·예전 종합계좌는 API로 연동할 수 없다 — 그래서 KB 배당은 수동.

테스트: `test/tossDividendSync.test.ts`(토스·KIS 분류, 우선주, 교체·id 이어받기·멱등, 가져오기 건너뜀).

## 다가오는 배당·공식 실현손익 (한국투자증권, `src/upcomingDividends.ts`, `routes/kisReports.ts`)

- `GET /dividends/upcoming?refresh=` — `{items, available, builtAt, refreshing}`(KIS 키 없으면 `available:false` — 화면은 키 등록 안내를 띄운다).
  - **저장 + 하루 한 번 갱신**(2026-11-16 — 예전 메모리 6시간 캐시는 재시작마다 사라져 첫 진입이 ~20초): 결과(금액)가 아니라
    **종목별 원본 일정 줄**(예탁원 줄·`overseasScheduleRows` 결과, 배당 없는 미국 종목은 `[]`) + 확정 건 + 국내휴장일을
    `upcoming-dividends.json`(`UpcomingSnapshot`)에 저장하고, 요청마다 **오늘 날짜·지금 보유 수량**으로 `itemsFromSnapshot`(순수 함수)이
    다시 계산한다 — 금액을 저장하면 그날 바뀐 수량이 다음 갱신까지 틀린다. 저장일(KST)이 오늘이 아니거나 `refresh`면 저장본을 바로 주고
    `startRebuild`가 뒤에서 다시 받는다(`refreshing:true`, 동시에 하나만). 저장본에 없는 보유 종목만 그 자리에서 받아 더한다(`fetchMissing`,
    실패한 종목은 그날 다시 시도 안 함). 저장본이 없거나 `kisAccountId`가 바뀌었으면 기다려서 받는다. 종목·확정 조회 실패는 이전 값을 유지. 확정은 앞으로 120일,
  **예상·추정은 이번 달 지급분까지만**(사용자 결정 2026-11-10 — 120일을 다 보이면 매달 지급 종목 × 계좌 수만큼 줄이 너무 많았다).
  **세 종류 모두 지급일 당일까지 남고 다음 날 빠진다**(2026-11-17 사용자 요청 — 입금이 오후 늦게 되는 날이 있다). 대신 **같은 계좌에 같은 종목의
  배당이 들어오면**(받은 배당 기록, 지급일 앞뒤 3일 안) 화면이 목록·그래프에서 뺀다 — 프론트 `calc/dividends.ts`의 `excludeReceived`(계좌가 다르면
  남김, 계좌 칸이 빈 기록은 증권사 단위). 백엔드 응답은 그대로다.
  **ISA·연금저축·IRP 계좌의 원화 건은 확정·예상·추정 모두 `tax: 0`**(`itemsFromSnapshot`의 `taxDeferred` 인자 ← `isTaxDeferredAccount`, 2026-11-17) —
  화면 그래프는 `tax`가 null일 때만 15.4%를 가정해 빼므로 이 계좌들은 세전 그대로 잡힌다. 요청 때 계산해 세금 유형을 바꾸면 바로 반영된다.
  - **확정**: `fetchKisPeriodRights`(CTRGA011R)에서 현금지급일이 오늘 이후(당일 포함)인 건 — 세전·세금 정확, KIS 계좌만. 수량 = `cblc_qty`(기준일 잔고수량),
    주당 = `last_alct_amt ÷ cblc_qty`(2026-11-16 실측 133건 전부 있음·전부 정수 원 — 예전엔 안 읽어 "수량 × 주당"이 "-"였다). 저장 형식이 바뀌면
    `SNAPSHOT_VERSION`을 올린다 — 다른 버전의 저장본은 보여 주되 뒤에서 다시 받는다.
  - **예상**: 예탁원 배당일정(`fetchKisDividendSchedule`, `HHKDB669102C0`, `GB1=0`)의 `per_sto_divi_amt` × 로컬 보유종목
    저장소의 수량 — **모든 증권사의 KRW 보유 종목**. **보유 종목마다 `SHT_CD`로** 지난 400일~앞으로 120일을 조회한다.
    2026-11-10 실측: 시장 전체(예전 방식)는 120일에 57건뿐(27건 금액 0) — 매달 분배 ETF는 기준일 3일 전에도 없었다.
    - **`F_DT`/`T_DT`는 기준일 범위**다 → 기준일이 지났어도 지급일 ≥ 오늘이면 넣는다.
    - **`divi_pay_dt`는 `YYYY/MM/DD`(빗금)**, `record_date`는 `YYYYMMDD` — 예전엔 8자리만 읽어 예상 지급일이 늘 비었다(`parseKsdDate`).
  - **추정**(`status: 'projected'`, `source: 'history'`, `planSymbolDividends`): 예탁원에 아직 없는 다음 배당 — 기준일 간격 중간값이
    **매주(6~8일)**·매달(25~35일)·분기·반기·연이고(최근 12번 간격의 중간값) 최근까지 이어진 종목만(매주·매달·분기 3회, 반기·연 2회 이상,
    매주는 마지막 기준일이 3주 안). 매주는 마지막 기준일에서 **7일씩**(휴일이면 직전 영업일, 다음 주는 원래 요일로 — 2026-11-20, 그 전엔 주간 분배 ETF가
    이번 달 뒤로 0원이라 12개월 예상이 눈에 띄게 낮았다). 주당 = **최근 3회 중간값**(사용자 결정 2026-11-20 — 예전 12회 중간값은 분배금이 한 단계 오른 ETF를
    몇 달씩 옛 금액으로 잡았다. 3회 중간값도 한 번 튄 달은 거른다; 그 전 결정 —
    한 달만 두 배인 분배가 실제로 있다), 금액 미정(0) 일정도 같은 중간값으로 추정.
    - **휴일 반영**: 기준일 = 그 종목의 "매달 며칠"(지난 기준일 일자 중간값, 전부 말일 3일 안이면 말일)이 휴일이면 직전 영업일
      (실측: 15일이 토요일이면 14일). 지급일 = 기준일 + 지난 일정의 **영업일 간격 중간값**(실측: 매달 분배 ETF 2영업일 — 설 연휴엔
      달력상 7일이라 달력 일수로는 틀린다). 휴장일은 국내휴장일조회(`fetchKisBusinessDays`, `CTCA0903R`, 이번 달 1일~다음 달 10일 무렵,
      한 페이지 24일, 연속조회는 본문 `ctx_area_nk`/`fk` — 100 없는 이름). 공식 예제가 **"1일 1회 호출"**을 요청해 `kis-holidays.json`에
      날짜별로 저장하고 그날은 다시 안 부른다. **KIS 값이 없는 날짜(12개월 예상의 몇 달 뒤·과거)는 휴장일 표 `src/krMarketCalendar.ts`**(2026-11-18 —
      월력요항 2026·2027 + KRX 근로자의 날·연말 휴장, `krMarketClosedDays`를 국내 달력에만 깔고 KIS 값을 덮는다; 표에 없는 해는 주말만). ⚠ 해마다
      6월쯤 다음 해 월력요항이 나오면 한 해를 더한다. ⚠ `isBusinessDay`의 기본값에 국내 표를 넣으면 안 된다 — 미국 달력은 쉬는 날만 담아서 국내 휴일이 섞인다.
  - KIS 계좌에 확정 건이 있는 종목·기준월은 그 계좌엔 예상·추정을 안 만든다. 테스트: `test/upcomingDividends.test.ts`.
  - **해외(미국, `currency: 'USD'`, `source: 'kis-overseas'`)** — 모든 증권사의 USD 보유 종목마다(2026-11-16 실측, 21종목 18초):
    - 날짜 = 해외주식 권리종합(`fetchKisOverseasIceRights`, `HHDFS78330900`, `NCOD=US`) — ICE 일정이라 **발표된 미래 배당이 미리 있다**
      (기준일·배당락일·지급일, 권리유형은 한글 `ca_title`). **주당 금액이 없고 한 번에 50건까지**(주간 분배 ETF는 400일이면 잘림 →
      지난 120일~앞으로 120일). 현금배당이 없는 종목(TSLA 등)은 여기서 끝낸다.
    - 주당 금액 = 해외 기간별권리(`fetchKisOverseasDividendRights`, `CTRGT011R`, `alct_frcr_unpr`, 배당 `03`만). ⚠ **`PDNO`만 주면
      `KIER2520 조회된 자료가 없습니다`(rt_cd 0)** — 상품유형코드 `PRDT_TYPE_CD`를 같이 줘야 한다(512 나스닥·513 뉴욕·529 아멕스, NYSE Arca
      ETF는 529). 앱이 거래소를 모르므로 512→513→529로 찾아 `kis-overseas-product-types.json`에 저장(못 찾으면 7일간 다시 안 찾음).
      2026-11-09엔 이걸 몰라 "종목 지정 조회 불가"로 판단하고 해외를 뺐었다. **배당이 기준일 무렵에야 등록**돼 발표만 된 건은 금액이 없다.
    - `overseasScheduleRows`가 둘을 예탁원 일정 모양으로 합쳐(ICE 기준일에 같은 현지 기준일의 금액, 없으면 0, ICE 밖의 지난 권리는 지급일 없이)
      `planSymbolDividends`에 넣는다 — 금액 있으면 예상, 0이면 최근 3회 중간값 추정, 그 뒤는 주기 추정까지 국내와 같은 규칙.
      **휴일은 NYSE 정기 휴장일 규칙**(`src/usMarketCalendar.ts`의 `nyseHolidays`/`usMarketClosedDays`)으로 반영한다 — 국내휴장일조회는
      국내용, 토스 `market-calendar/US`는 기준일 앞뒤 3영업일만 주고 토스 키가 필요, KIS `CTOS5011R`은 휴장일이 아니라 결제일이라 안 썼다.
      규칙: 고정일(1/1·6/19(2022~)·7/4·12/25) 토요일→금요일, 일요일→월요일, **1/1이 토요일이면 휴장 없음**, 굿프라이데이(부활절 −2일),
      MLK·대통령의 날(셋째 월)·메모리얼(5월 마지막 월)·노동절(9월 첫 월)·추수감사절(11월 넷째 목). NYSE 공식표 2026~2028과 같다
      (`test/usMarketCalendar.test.ts`). ⚠ 임시 휴장(국가 애도일 등)은 모른다. 금액은 세전(미국 원천징수 15% 전), 센트 단위 반올림.
    - 종목 하나의 해외 조회가 실패해도 경고 로그만 — 국내·다른 종목은 그대로.
- `GET /kis/realized?from&to` — 기간별매매손익현황조회(`TTTC8715R`, `fetchKisPeriodTradeProfit`, 국내만, `CTX_AREA_FK100/NK100`
  연속조회, 1tps 리미터) 중 `sll_qty > 0`인 매도 줄. `rlzt_pfls`는 수수료·세금 차감 손익. KIS 키 없으면 409.
  같은 응답의 `overseasRows`는 해외 기간손익(`TTTS3039R`, 원화 기준) — 실패하면 null. 두 TR 다 10분 캐시
  (국내·해외 비교 카드가 같은 기간으로 두 번 부른다).
- `GET /kis/stock-detail/:symbol` — 국내 6자리(`[0-9A-Z]{6}`)만. 주식이면 **현재가 기준 투자지표 `valuation`**(주식현재가 시세 `FHKST01010100`의
  `per`·`pbr`·`eps`·`bps`·`hts_avls`(억원)·`w52_hgpr/lwpr`·`hts_frgn_ehrt`, 0은 null)을 같이 준다 — ⚠ 2026-11-17 실측: 재무 API `/finance/*` 7개가
  **전부 실패**(financial·growth·profit·stability·other-major-ratios는 HTTP 404, balance-sheet·income-statement는 `OPSQ0001`, 대·소문자 파라미터 모두,
  같은 키로 시세는 정상) — 공식 예제는 그대로라 KIS 쪽 변경·장애로 보인다. 재무비율 칸은 null로 두고 되살아나면 그대로 보인다. 먼저 ETF 현재가(`FHPST02400000`)를 불러
  **`etf_cnfg_issu_cnt > 0`이면 ETF**(주식이면 NAV 등이 전부 0으로 온다, 실측). ETF → NAV·괴리율(`dprt`)·추적오차
  (`trc_errt`)·순자산(`etf_ntas_ttam`, 억원)·분배주기(`etf_dvdn_cycl`, 코드표 없음 — KODEX 200이 `3`=분기)·구성종목
  (`FHKST121600C0` output2 — **상위 30개만**, 비중 합 ~83%). 주식 → 연간 재무비율(`FHKST66430300`, 최신 줄은 결산 전
  누적일 수 있음, 예 `202606`; ⚠ 2026-11-17 HTTP 404 — 아래 "KIS API 검증 묶음")·최근 6개월 투자의견(`FHKST663300C0`, 날짜는 `00YYYYMMDD`). 둘 다 뉴스 제목
  (`FHKST01011800`) — **`FID_INPUT_ISCD`를 줘도 다른 종목 뉴스가 섞여 온다**(40건 중 ~25건만 해당 종목) →
  `iscd1~10`에 그 코드가 있는 것만 남긴다. 칸별 실패는 null(나머지는 보여줌). 캐시: 재무 1일·의견/구성 6시간·뉴스 10분·ETF 시세 1분.

## 토스 투자원금 (`brokers/toss/tossCashFlows.ts`, `routes/tossReports.ts`)

`GET /toss/cash-flows`(1시간 캐시, `?refresh=true`) — 계좌별 순입금. 2026-11-09 실데이터 분류:
- **원금**: `DEPOSIT`/`WITHDRAWAL` 중 `assetClass === null`(종목·상품 없음 = 은행 이체)만. 달러는 그 거래 `exchangeRate`로 환산
  (없으면 `netPrincipalKrw: null`).
- **원금 아님**: 종목 붙은 `DEPOSIT`(ETF 분배금·외화세금환급), 종목 붙은 `WITHDRAWAL`(실측 전부 tax>0 — 세금 출금),
  `BOND` 원리금·세금, `INTEREST`/`FEE`, 환전(`EXCHANGE_IN/OUT` — 한 건이 KR/US 두 줄로 옴), 미결제·취소.
- **`SECURITIES_TRANSFER_IN/OUT`은 `amount`가 null**(타사 이관·주식배당) — 원금에 못 넣어 건수만 준다. 실데이터는 입고가 많아
  첫 입금일보다 거래가 훨씬 이르다 — 화면이 "수익이 부풀 수 있음"을 알린다.
- KIS는 입출금 내역 API가 없어 토스만. 테스트: `test/tossCashFlows.test.ts`.

## KIS 해외주식(미국) (`kisClient.ts`의 "해외주식" 절, `kisAdapter.ts`)

**⚠ 실데이터 미검증** — 연동 계좌에 해외 보유·거래가 없어(2026-11-09) 요청 형식(`rt_cd 0`, 빈 결과)까지만 확인했다. 필드는 공식
예제 `examples_llm/overseas_stock/*`의 COLUMN_MAPPING 그대로다. 해외 거래가 생기면 숫자를 증권사 앱과 대조할 것.
- **미국(USD)만** — 앱 통화 모델이 KRW/USD뿐. 거래소 `NASD`(=미국 전체), 다른 통화 줄은 걸러낸다.
- 잔고: 체결기준현재잔고(`CTRP6504R`, `WCRC_FRCR_DVSN_CD=02` 외화, `NATN_CD=840`) — output1 보유(`cblc_qty13`·`avg_unpr3`·
  `ovrs_now_pric1`·`frcr_pchs_amt`·`frcr_evlu_amt2`·`evlu_pfls_amt2`·`evlu_pfls_rt1`), output2의 USD 줄 `frcr_dncl_amt_2`가 달러
  예수금. `TTTS3012R`(잔고)는 예수금이 없어 안 썼다. 30초 캐시(`PORTFOLIO_TTL_MS`).
- 체결: 주문체결내역(`TTTS3035R`, `PDNO=%`, `CCLD_NCCS_DVSN=01` 체결만, `FK200/NK200` 연속조회, 1tps 리미터). 날짜는 현지 주문일.
  id는 `ovrs-{ord_dt}-{odno}` — 국내 주문번호와 겹치지 않게(매매내역 저장소가 id로 upsert).
- `kisAdapter`는 국내 조회와 **독립**으로 부른다 — 해외가 실패해도 국내 보유·매매내역은 그대로(경고 로그만). 해외 보유가 있으면
  `totalXxxUsd`가 채워지고, 없으면 예전처럼 null.
- 해외 배당은 여전히 없다(계좌 기준 API 없음, 위 "배당 동기화" 절).

## 키움증권 REST API (`brokers/kiwoom/`, `routes/kiwoomReports.ts`)

**⚠⚠ 실제 키로 한 번도 호출하지 않았다**(2026-11-09 — 개발자에게 키움 계좌가 없음, 사용자 요청: "명세와 GitHub만 보고 구현하고
실제 API Key로 연동 확인을 해야 한다는 점을 남겨 놓을 것"). **키를 받으면 `npm run check:kiwoom`부터** 돌려 FAIL·WARN을 고친다
(배당 세후 가정·실현손익 계산식·매매 줄 해석까지 자동 판정하게 만들어 뒀다).
정본: 공식 저장소 `github.com/Kiwoom-Securities/Kiwoom-REST-API`의 `kiwoom/_data/kiwoom_api_spec.json`(337개 API 명세 +
요청/응답 예시) + 공식 SDK `kiwoom/core/client.py`·`auth.py`. 포털 가이드 화면엔 토큰 발급 정보뿐이다.
- **규약**: 모든 API가 `POST` + JSON, 헤더 `api-id`(TR, 예 `kt00018`) + `authorization: Bearer`. 국내 계좌 TR은 `/api/dostk/acnt`,
  미국은 `/api/us/acnt`. **업무 오류도 HTTP 200**이라 본문 `return_code`(0=정상)로 판정(SDK와 같음). 연속조회는 응답 **헤더**
  `cont-yn`(Y)/`next-key` → 다음 요청 헤더로(NH와 같은 헤더 방식), 같은 next-key가 다시 오면 멈춘다.
- **토큰**: `POST /oauth2/token` JSON(`grant_type`·`appkey`·`secretkey`) → `token`·`expires_dt`(YYYYMMDDHHmmss, KST로 해석 —
  ⚠ 실키로 시간대 확인). `kiwoom-token.json`(앱키 해시) 재사용. 재발급: 8005(토큰 무효 — SDK: `return_code=3` + 메시지 "[8005:"로도
  온다)·**8010(토큰 발급 IP ≠ 요청 IP)**·401. 한도 초과 1700/1701/1702·429는 백오프 재시도.
- **IP 등록**: 포털에 쓸 PC의 IP를 등록해야 한다(최대 10개, 외부 글 기준). IP가 바뀌면 8010 → 새 토큰으로도 안 되면 포털 등록 문제.
- **앱키 = 계좌 하나**: 계좌번호조회(`ka00001`)가 `acctNo` 하나만 주고, 잔고·거래 TR 요청에 계좌번호 칸이 없다. 계좌가 하나라
  `getPortfolio`/`getTradeHistory`는 accountId를 쓰지 않는다. 키움 계좌 여럿 = 키 여러 벌 → 지금 구조(증권사당 키 한 벌)로는 미지원.
  실전 키만(모의투자는 키가 따로 발급되고 도메인 `mockapi.kiwoom.com` — 미지원).
- **숫자**: "000000017598258"·"-00000000196888"·"+61.28"·"56,900"·"156464.6701" — `kwNum` 하나로 읽는다. 국내 종목코드는
  "A005930"(접두어 A 주식/J ELW/Q ETN) → `kwSymbol`로 6자리. 가격 필드는 전일 대비 부호가 붙을 수 있어 절댓값.
- **보유**: `kt00018`(`qry_tp=1` 합산, `dmst_stex_tp=KRX`) — 요약은 본문 최상위, 종목은 `acnt_evlt_remn_indv_tot`. **공식 예시에도
  같은 종목이 두 줄**(현금·신용 등)이라 종목별로 합치고 평균가·수익률을 다시 구한다. 예수금 `kt00001.entr`, 미국 `ust21070`
  `result_list`(USD만), 달러 예수금 `ust21110`의 USD 줄 `fc_entra`. 예수금·미국은 실패해도 국내와 격리.
- **위탁종합거래내역 `kt00015`가 매매·배당·입출금의 원천**: `tp` 4 매수·5 매도(방향을 요청 코드로 — 적요 해석 불필요)·6 입금·1 입출금·
  2 입출고, `gds_tp=0` 전체. 고유 거래번호 `trde_no` → id `kw-{trde_dt}-{trde_no}`. 원화 줄 = 국내, USD 줄 = 미국. 조회 기간 제한이
  명세에 없어 **1년 단위로 나눠** 부른다(`yearWindows`, ⚠ 실키로 제한 확인). 미국 줄 단가는 `trde_unit`("거래단가/환율")이 애매해
  외화 거래금액 ÷ 수량.
- **배당**(`kiwoomDividendSync.ts`): 입금(6) 중 배당·분배 적요(⚠ 가정) — 원화 `exct_amt`(정산금액)=세후·`incm_resi_tax`=세금,
  달러 `fc_exct_amt`=세후·`frgn_pay_txam`(외국납부세액)=세금. 원화·달러 모두 동기화 소유(`isDividendSyncOwned`). 시작일 2015-01-01.
  `check:kiwoom`이 "거래금액 = 정산금액 + 소득/주민세"로 세후 가정을 판정한다.
- **공식 실현손익**(`GET /api/kiwoom/realized`): 국내 `ka10073`(매도 건별) — 공식 예시로 `tdy_sel_pl` = 매도 − 매입 − 수수료 − 세금
  (158200 − 97602.96 − 500 − 284 = 59813.04, 테스트로 고정). 미국 `ust21530`(`fc_krw_tp=1` 원화) `pl_amt`.
- **입금 기준 원금**(`GET /api/kiwoom/cash-flows`): 입출금(1)의 입금/출금(입출구분명·적요), 배당·이자·환전 등 제외, 원화만. 입고 건수는 입출고(2).
- **타입·연속조회**: 요청 본문과 응답 목록 줄은 공식 명세에서 생성한 `kiwoomSpec.gen.ts`(`KiwoomRequests`·`KiwoomListRow<TR, 필드>`) —
  명세상 전부 문자열·선택. 연속조회는 이미 받은 next-key면 멈추고 200페이지 상한에 닿으면 던진다(NH와 같은 이유).
- 테스트: `test/kiwoomClient.test.ts` — 응답은 **명세의 공식 응답 예시**(`test/fixtures/kiwoom-spec-examples.json`, 예시 JSON의 빠진
  쉼표만 보정)로 돈다. 배당·입출금 줄은 명세에 예시가 없어 지어낸 값.

## NH투자증권(나무) Open API (`brokers/nh/`, `routes/nhReports.ts`)

**⚠ 실데이터 미검증(행 해석)** — 실키로 인증·계좌 목록·모든 조회 엔드포인트(실전·모의투자)가 정상 응답하는 것까지
확인했지만(2026-11-09) 연동 계좌에 보유·거래·입출금이 0건이다. 거래가 생기면 `npm run check:nh`로 다시 확인한다.
명세 정본: 포털 `llms-full.txt` + `www.nhplug.com/openapi-docs/{common,krstock,gbstock}/openapi.json`(2026-11-06), 공식 SDK
`github.com/PLUG-OpenAPI/nhplug-sdk`(`nhplug/client.py`·`auth.py`). 필드명은 전부 거기서.
- **규약**: 전부 `POST` + `{"Input_0": {...}}`, 응답 `Output_0`/`Output_1`(객체일 수도 배열일 수도, 0건이면 블록이 없다 —
  `rowsOf`) + `rsp_cd`/`rsp_msg`. 인증 헤더는 `Bearer` 하나. **HTTP 200이 곧 성공이 아니고 정상 `rsp_cd`가 API마다 달라**
  코드로 판정하지 않는다 — 200 아님(IGW*)만 던지고, 요약 블록이 반드시 와야 하는 잔고는 블록이 없으면 `rsp_msg`를 담아 던진다.
  숫자 필드는 실측상 JSON number(명세 그대로), `nhNum`은 문자열도 받는다.
- **토큰**: `POST /oauth2/token`(쿼리 `appkey`·`appsecretkey`, form 헤더, 운영 도메인만). 24시간, **재발급마다 계좌주에게 보안
  알림** → `nh-token.json`에 저장(앱키 해시 `keyHash`로 키 변경 감지, 원문 미저장), 동시 요청은 발급 하나 공유, 재발급은 401·
  IGW40043("유효하지 않은 token")·IGW40044("기간이 만료된 token", 공식 오류코드표 www.nhplug.com/testbed-howto)·본문
  "유효하지 않은 token"(SDK 판정)만(429엔 안 함). **동시에 401을 받은 요청은 한 번만 재발급한다** — `getToken(staleToken)`이 캐시
  토큰이 이미 바뀌었으면 그걸 쓴다(예전엔 늦게 401을 받은 쪽이 또 발급해 보안 알림이 두 번 갔다). 발급은 네트워크 오류·IGW40054
  (인증 서버 일시 장애)에 두 번 더 해 본다.
- **연속조회**: 응답 **헤더** `cts`/`cts_flag`(본문 아님). 플래그가 없으면 응답코드 `00165`/`00218`/`XA109`면 계속(SDK 실측값).
  **이미 받은 cts가 다시 오면 멈춘다**(본 것 전부와 전체 문자열 비교 — 끝 2~3자만 바뀌는 경우, A→B→A 순환). **200페이지 상한에
  닿으면 던진다** — 예전엔 50에서 조용히 끊어, 2000년부터 받는 배당 동기화(전체 교체)가 잘린 목록으로 기존 기록을 지울 수 있었다
  (2026-11-17 SDK 대조, SDK는 기본 무제한). 잔고는 "끝까지 조회해야 요약이 채워진다"는
  명세라 마지막 페이지 `Output_0`을 요약으로 쓴다. 실측: 마지막 페이지에도 `cts`가 오고 `cts_flag=N`.
- **속도**: 명세 초당 5건 → 리미터 초당 4건(SDK 기본값). IGW42901~3/HTTP 429는 백오프 재시도(`Retry-After`가 있으면 그 값) +
  `penalizeUntil`. 요청마다 **15초 제한**(SDK 10초) — 응답이 없으면 같은 캐시 키를 기다리는 화면이 다 멈춘다.
- **오류 메시지**: 게이트웨이 `error_code`·`error_description` 또는 업무 `rsp_cd`·`rsp_msg`를 담는다(SDK와 같은 순서, `redactText`).
- **타입**: 요청 `Input_0`과 응답 줄은 공식 명세에서 생성한 `nhSpec.gen.ts`(`NhInput<경로>`·`NhRow<경로, 'Output_0'|'Output_1'>`) —
  매퍼(`nhMappers.ts`·`nhCashFlows.ts`)가 명세에 없는 필드를 읽으면 컴파일 오류다. 아래 "공식 명세 감시".
- **계좌**: `/n2/acctinfo`가 앱키에 연결된 계좌를 섞어 준다 — `01` 일반·`02` 주문대리인(운영), `03` 모의투자. 실측: 실전 1 +
  모의투자 3. 모르는 구분은 버린다. 화면은 실전을 앞에(첫 계좌가 기본 선택).
- **모의투자(03)**: `moapi.nhplug.com:8443`으로만 조회된다(운영 도메인에 03 계좌를 쓰면 실패). 토큰은 운영에서 받은 것 그대로
  통한다(실측). `nhClient`의 계좌별 함수가 `baseFor(accountNo)`로 도메인을 고른다. 노출 범위:
  - `listAccounts({ includePaper: true })`(`GET /api/accounts/nh?paper=true`)일 때만 오고 `BrokerAccount.paper=true` — 보유 종목·
    매매내역 화면과 설정만 붙인다. 대시보드·종목별 수익·배당 화면은 실전만 받아 합계·순자산 스냅샷에 안 섞인다.
  - write-through 안 함(위), 배당 동기화·원금·공식 실현손익은 실전 계좌만(`fetchNhAccounts()` 기본값).
- **보유**: 국내 `krstock/inquiry/v1/balance`(`qut_dit_cd=UNT` 시장 + `aly_qut_cd=1` 정규장 — 2026-09 명세부터 **둘 다 필수**,
  다른 축). 매입금액 필드가 없어 `eal_amt − eal_pls_amt`. 미국 `gbstock/inquiry/v1/balance`(`200`·USD만), 달러 예수금 `fc_dca`.
  해외 실패는 국내와 격리.
- **매매**: 국내는 종합거래내역(`common/inquiry/v1/totalTransaction`, `act_trd_dtl_cd=03`) — `dailyOrderExecution`은 **주문일 하루씩만**
  조회돼 기간 조회가 비싸서 안 썼다. 매수/매도는 **적요(`sps_cd_krl_anm`)에 "매수"/"매도" 낱말**로 가른다(⚠ 가정, 명세에 값 목록
  없음). 체결 번호가 없어 id = `nh-{날짜}-{종목}-{방향}-{그날 순번}`. 미국은 해외 일별거래내역(`dailyTransaction`, `05` 매수/`06` 매도
  — 방향을 요청 코드로 정해 적요 해석 불필요), id `nh-ovrs-{trd_dt}-{trd_sno}`. 통화 필터는 `isUsdName`(USD 또는 "미국" —
  "달러"만 보면 홍콩달러가 걸린다, 테스트가 잡은 버그).
- **배당 동기화**(`nhDividendSync.ts`): 국내 = 종합거래내역 입출금(`01`)의 배당·분배 적요, 미국 = 해외 일별거래내역 입금(`01`)의
  배당 적요. NH는 해외 배당도 계좌 기준으로 줘서 **원화·달러 모두 동기화 소유**(`isDividendSyncOwned`, KIS와 다름). ⚠ 가정:
  `trd_amt`/`fc_trd_amt`가 세후 입금액, `tax_sum`/`fc_tax_sum`이 세금 — `check:nh`가 권리현황(`rightsHeld`의 세전 `rit_aloc_amt`)과
  짝지어 자동 판정한다. 해외 조회 실패 시 그 동기화를 통째로 실패시킨다(일부만 받은 채 교체하면 달러 배당이 지워진다).
- **공식 실현손익**(`GET /api/nh/realized`): 국내 `tradingPnl`(HTS 8229) — **기간 합계가 종목별 한 줄**(KIS는 매도 건별)이라 비교
  카드도 종목별로 합쳐서 그대로 맞는다. 해외 `periodPnl` 응답엔 종목코드가 없어(주문일·국가 단위) 종목별 비교 불가 → `overseasRows: null`.
- **입금 기준 원금**(`nhCashFlows.ts`, `GET /api/nh/cash-flows`): 입출금내역(`depositWithdrawal`, HTS 8207)의 입금·출금 —
  유형명(`act_trd_tp_nm`)·적요에 배당·분배·이자·환급·세금·수수료·이용료·취소·정정이 들어가면 제외(⚠ 가정), 통화 필드가 없어
  원화로 본다. 타사 입고 건수는 종합거래내역 입출고(`02`)의 "입고" 적요. 토스와 같은 `CashFlowSummary` 모양이라 카드 공용.
- 쓰지 않은 것: 다가오는 배당 확정분(`rightsScheduled`엔 금액이 없고 비율만), 주문 API 전부.

## LS증권·DB증권 (`brokers/ls/`, `brokers/db/`, 공용 `brokers/xingFamily.ts`, 2026-11-17)

**⚠⚠ 둘 다 실제 키로 한 번도 호출하지 않았다**(개발자에게 계좌가 없음) — 키를 받으면 **`npm run check:ls|check:db -- --record`부터**(가정을
PASS/WARN으로 판정하고 응답 모양을 `<증권사>-live.json`에 남긴다) → `spec:types` → `build`. 두 회사는 같은 계열 시스템이라(TR 코드
`CDPCQ04700` 등이 겹치고 토큰·응답 봉투가 같다) 공용 부분을 `xingFamily.ts`에 뒀다: 토큰 파일 캐시(`createXingTokenCache` — form
`appkey`·`appsecretkey`·`scope=oob`, 응답 `access_token|token`·`expires_in|expire_in`), 숫자(`xNum` — 정수는 JSON 숫자, 소수는 소수 문자열),
종목코드(`krSymbol` — `A005930`·ISIN `KR7005930003`), 계좌 거래내역 해석(`mapLedgerTrades`·`classifyLedgerDividends` — 적요 "매수/매도/배당",
⚠ 가정: 배당 세후 = 정산금액 `AdjstAmt`). **수익률은 평가손익 ÷ 매입금액으로 직접 낸다**(DB는 API마다 비율/퍼센트가 다르다).
- **둘 다 앱키 = 계좌 하나**(계좌 목록 TR 없음). LS는 C계열 응답 `OutBlock1.AcntNo`가 계좌번호를 되돌려 줘서 거기서 읽는다(키움처럼).
  DB는 계좌번호를 알려주는 응답이 없어 **설정의 `accountNumber`**(KB의 accountId와 같은 로컬 표시용)를 계좌 id로 쓴다.
- **LS**(`openapi.ls-sec.co.kr:8080`, 전부 POST, 헤더 `tr_cd`·`tr_cont`·`tr_cont_key`, 요청 `<TR>InBlock(1)`, 응답 `<TR>OutBlockN`):
  보유 `t0424`(본문 `cts_expcode` 연속조회), 예수금·계좌 `CSPAQ12200`, 해외 `COSOQ00201`(OutBlock4 종목·OutBlock3 통화별 외화예수금 — 명세는
  객체라는데 공식 예시는 배열), 매매·입출금 `CDPCQ04700`(헤더 연속조회, 1년씩). 해외 매매 줄 종목번호가 ISIN이면 해외 잔고의 ISIN→단축코드로.
  ⚠ 오류코드표가 없어 **`rsp_cd`가 0으로 시작하면 정상**(00000·00001·00136·00133 계속·00200 조회내역 없음)으로 가정. 해외 배당은 이 표에서 확인
  못 해 **원화 배당만 동기화 소유**(KIS와 같음, 달러는 수동). 포털 "시작하기" 예제(tr_id·GET·CANO)는 명세와 다르다 — 명세·TR 가이드만 따른다.
- **DB**(`openapi.dbsec.co.kr:8443`, POST, 헤더 `cont_yn`·`cont_key`, 요청 `{"In":{…}}`, 응답 `Out`·`Out1`…): 국내 잔고 `CSPAQ03420`(⚠ 평균단가
  필드가 없어 매입금액 ÷ 수량), 예수금 `CDPCQ00100`, 해외 `CAZCQ00400`(Out2 종목·Out1 통화별), 국내 매매·입출금 `CDPCQ04700`(최대 12개월 → 1년씩),
  해외 매매 `CAZCQ00200`(방향 2 매수·1 매도), 해외 배당 `CAZCQ01600`(**"배당금입금(외화)" 세전 + "배당세출금(외화)" 원천세 두 줄**을 같은 날·종목끼리
  짝지어 세후). 성공 = `rsp_cd 00000`, 2679(조회내역 없음)는 0건, IGW00121/00123 토큰 무효 → 재발급 1회, IGW00201 호출 초과 → 재시도. 토큰 발급은
  **1분 1건**·유효기간 안 재발급은 같은 토큰(공식). 원화·달러 배당 모두 동기화 소유. ⚠ **포털 응답 예시(resExample)엔 실제 고객 데이터로 보이는 값**이
  있어 저장소에 두지 않는다 — 명세 감시는 구조만(`db.json`), 테스트는 지어낸 값.
- 명세 감시: LS `tr-guides.json`(공식 다운로드), DB 포털 TR 필드 명세 JSON(`guide/tr/property/{trId}` — 공개 API로 문서화된 것은 아님) →
  `snapshots/ls.json`·`db.json` → `ls/lsSpec.gen.ts`·`db/dbSpec.gen.ts`(공용 생성기 `genBlockTypes`). 테스트 `test/lsDbClient.test.ts`(LS는 공식
  TR 가이드 응답 예시 `fixtures/ls-spec-examples.json` — 계좌번호·계좌명은 가짜로 바꿈).
- 부가 기능(공식 실현손익 비교·입금 기준 원금 카드)은 아직 없다 — 두 회사 모두 API는 있다(LS `FOCCQ33600`, DB `CSPAQ07800`·`CAZCQ00300`·`FOCCQ10800`).

## 토스 시장 정보 보조 기능 (`src/marketInsights.ts`, `routes/marketInfo.ts`)

계좌와 무관한 토스 시장 정보로 만드는 기능 넷 — 토스 키만 있으면 **어느 증권사 보유 종목에든** 적용된다(종목
코드 기준). 토스 미연동·실패면 예외 대신 빈 결과를 줘서 화면은 이 정보 없이 예전처럼 동작한다. 원시 호출은
`tossClient.ts`의 `fetchTossMarketCalendar`/`fetchTossStockWarnings`/`fetchTossIndicatorDailyCandles`/
`fetchTossSectors`/`fetchTossSectorStocks`(공식 스펙 v1.2.28, 2026-11-09 실측).
- `GET /market-info/market-status` — 장 운영 캘린더(`MARKET_INFO`, 10분 캐시)로 국내·미국의 **지금 세션**
  (`day`/`pre`/`regular`/`after`/`closed`)과 오늘 휴장 여부. **미국 세션은 KST로 자정을 넘긴다**(정규장 23:30~06:00,
  애프터 06:00~09:50) — 전일·당일·익일 세 날의 세션을 모두 보고 판단한다(`marketStatusFrom`). 보유 종목 화면이
  두 시장 모두 `closed`면 1분 자동 새로고침을 쉰다.
- `GET /market-info/warnings?symbols=` — 매수 유의사항(`STOCK`, 종목당 1회·30분 캐시) 중 **오늘 활성**
  (`startDate ≤ 오늘 ≤ endDate`, endDate null=진행 중)만. 문서대로 모르는 유형도 코드 그대로 라벨로 둔다.
- `GET /market-info/index-monthly?months=` — 시장 지표 일봉(`MARKET_INDICATOR_CHART`, 4시간 캐시)에서 코스피·
  코스닥 월말 종가. **지원 심볼은 국내 지수 2개 + 국채 6개뿐 — 미국 지수 없음.**
- `GET /market-info/sectors?symbols=` — 종목마다 **섹터 배분 `weights`**(합 1, `sector: null` = 분류 못 한 몫)와 출처
  `sources`를 준다(`bySymbol`은 보통주만, 예전 호환). 표 두 개를 **하루 한 번** 만든다:
  - **종목 표** `toss-sector-cache.json`: 대분류(depth 0, 39개) × 국내·미국 구성 주식(하위 섹터 포함, **보통주만**) — 약 80회,
    실측 18초. 요청 때 기다린다(새로 못 만들면 어제 표).
  - **ETF 표** `toss-sector-etf-cache.json`: **모든 섹터**(대 39·중 158·소 103) × 국내·미국 관련 ETF(`/sectors/{id}/etfs` —
    **하위 섹터 미포함**이라 전부 돌아야 함)를 `parentSectorId`로 대분류에 올린다 — 약 600회, 실측 2분. **백그라운드**로 만들고
    응답에 `etfPending: true`(화면이 30초마다 다시 부름). **종목 표를 다 받은 뒤에 시작한다** — 같은 SECTOR 리미터라 먼저
    시작하면 종목 80건이 ETF 600건 뒤에 줄 서서 첫 화면이 2분 넘게 걸렸다(실측).
  - 두 빌드 모두 호출을 `Promise.all`로 한꺼번에 던지고 페이싱은 리미터에 맡긴다 — 하나씩 await하면 지연 때문에 5tps의
    절반도 못 써서 ETF 표가 5분 걸렸다(실측).
  - 배분 순서: ① 종목 표(여러 섹터면 균등) ② 우선주 → 보통주(앞 5자리+`0`) ③ 국내 ETF → 한투 구성종목(`fetchKisEtfComponents`,
    상위 30, `lookThroughEtf` — 표에 없는 구성종목·상위 30 밖은 null, 100% 넘으면 정규화, 하나도 분류 못 하면 다음 단계)
    ④ 토스 ETF 표(균등).
- 테스트: `test/marketInsights.test.ts`(세션 판정·자정 넘김, 활성 경고, 월말 종가, ETF 구성종목 쪼개기).

## 일별 자산 스냅샷 (`src/db/portfolioSnapshots.ts`, `src/routes/portfolioSnapshots.ts`)

`Overview.tsx`가 전체 브로커/계좌를 합산해 이미 계산해둔 KRW 환산 총액
(`totalMarketValueKrw`/`totalPurchaseAmountKrw`/`totalProfitLossKrw`)을 하루 한 번
그대로 받아 기록하는 시계열(`portfolio-snapshots.json`) — **서버는 이 합산을 다시
계산하지 않는다**(Overview.tsx의 "순수 클라이언트 집계" 원칙을 그대로 따름, 새
집계 로직을 중복 구현하지 않으려는 의도). `POST /api/portfolio-snapshots`가 같은
`date`면 덮어쓰기(upsert) — 하루에 앱을 몇 번을 열어도 그 날짜 행 하나로 수렴하고,
지난 날짜는 다시 안 바뀐다. `GET /api/portfolio-snapshots`는 날짜순 정렬 전체 목록.

기존 "누적 수익률(매월 말, 투자금 대비 — 예전 제목 “매월 보유종목 투자금 대비 수익률”)"/"월별 총 투자금 · 총 수입금" 두 카드
(`MonthlyReturnChart`/`MonthlyInvestmentChart`, `frontend/CLAUDE.md`의
`MonthlyInvestmentChart.tsx` 절 참고)는 매매내역에서 수량만 재구성하고 오늘
평단가/종가를 곱하는 **근사치**라 과거까지 소급해서 보여줄 수 있지만, 이 스냅샷은
**이 기능을 쓰기 시작한 날부터만** 쌓이는 대신 매일 실제로 계산된 값 그대로라 더
정확하다 — 두 방식을 경쟁시키지 않고 "순자산 추이(기록 시작 이후)" 카드로
별도로 둔다(`NetWorthChart.tsx`).

## 계좌 별칭 (`src/db/accountLabels.ts`, `src/routes/accountLabels.ts`)

`(broker, accountId) → label` 매핑을 저장하는 작은 `JsonStore`(`account-labels.json`).
CSV 전용 브로커(KB증권/삼성증권/미래에셋증권)는 한 증권사 안에 계좌가 여러 개일 수
있는데(예: KB증권의 종합위탁계좌/연금저축/IRP), 그 계좌를 구분하는 `accountId`는
holdings-store/trades-store/dividends 세 로컬 저장소에 실제로 CSV/수동 입력으로 들어온
문자열 그대로일 뿐 사람이 읽을 수 있는 이름이 아니다 — 이 저장소가 그 위에 별칭을
얹는다. `GET /api/account-labels?broker=`, `PUT /api/account-labels/:broker/:accountId`
(body `{label?, accountNumber?}` — 둘 중 하나는 필수, upsert), `DELETE /api/account-labels/:broker/:accountId`.
**`accountNumber`(표시용 계좌번호)**: 토스증권은 accountId가 Open API용 `accountSeq`
("1")라 화면 곳곳에 "1"이 그대로 보였다 — accountId는 API 호출 키라 못 바꾸므로,
사용자가 Settings.tsx에서 실제 계좌번호를 입력하면 프론트(`accountLabels.ts`의
`displayAccountNumber`: 입력값 > API `accountNumber` > accountId)와 Google Sheets
내보내기(`sheetsSync.ts`, API accountNo보다 우선 — 가져오기 역방향 맵은 둘 다 받음)가
표시할 때만 대신 쓴다. 별도 저장소를 만들지 않고 이 저장소를 확장한 건, 라벨과 같은
"표시용 메타데이터"이고 소비하는 화면도 똑같아서다(입력칸은 토스 행에만 보임).
**관리 UI는 `Settings.tsx` 한 곳에만 있다** — Dashboard.tsx/Trades.tsx/Dividends.tsx는
마운트 시 한 번 불러와 표시할 때 읽기만 한다(`frontend/CLAUDE.md` 참고).

## 계좌별 세금 유형 (`src/db/accountTaxTypes.ts`, `src/routes/accountTaxTypes.ts`)

ISA/연금저축/IRP 계좌를 표시해두는 작은 `JsonStore`(`account-tax-types.json`,
`{broker, accountId, taxType}[]`) — `frontend/src/pages/RealizedGains.tsx`(실현손익
리포트)가 유일한 소비처다. 저장 안 돼 있으면 `'GENERAL'`(일반계좌)로 취급하고,
`'GENERAL'`로 되돌리는 건 그냥 엔트리를 지우는 것과 같다(`DELETE`가 엔트리
없어도 404를 안 던진다 — `routes/accountTaxTypes.ts`의 주석 참고, "일반계좌 선택"이
"애초에 분류 안 된 상태"와 결과적으로 같아서). **왜 기존 "계좌 별칭"
(`accountLabels.ts`)을 확장하지 않고 새로 만들었나** — 계좌 별칭은 CSV 전용
브로커(KB/삼성/미래에셋)만 다룬다(API 브로커는 계좌번호 자체가 이미 사람이 읽을
수 있는 값이라 라벨이 필요 없다는 전제, `frontend/CLAUDE.md`의 "Settings.tsx"
절 참고). 반면 세금 유형 분류는 **토스/KIS 계좌에도 똑같이 필요하다**(API 증권사에도
ISA 계좌가 있다) — 그래서 CSV 전용 브로커 전제를 깨지 않고
별도 저장소로 뺐다. ISA는 손익통산 후 비과세 한도 초과분만 9.9% 분리과세,
연금저축/IRP는 매도 시점엔 과세되지 않고 나중에 연금·퇴직소득으로 인출할 때
과세된다 — 셋 다 일반 해외주식 양도소득세(22%)와 무관한 별도 규정이라,
`RealizedGains.tsx`는 이 분류가 `GENERAL`이 아닌 계좌의 매도 내역을 실현손익
합계·추정 세액 계산에서 제외하고 별도 표로 보여준다.

## 종목 외부 링크 (`src/db/stockLinks.ts`, `src/routes/stockLinks.ts`)

종목별 외부 링크 중 **사용자가 직접 입력한 값만** 저장하는 `JsonStore`
(`stock-links.json`, `{symbol, url, updatedAt}[]`, 심볼 하나로 식별 — 브로커/계좌
무관). 국내 종목처럼 규칙으로 만들 수 있는 자동 링크는 저장하지 않고 프론트
(`frontend/src/stockLinks.ts`)가 계산한다. `url`이 빈 문자열이면 "링크 없음"을
명시적으로 고른 것. `GET /api/stock-links`, `PUT /api/stock-links/:symbol`(body
`{url}`), `DELETE /api/stock-links/:symbol`(자동 링크로 되돌림). **`PUT`은 http/https
주소만 받는다** — 이 값이 그대로 `<a href>`로 렌더링되고 Electron이
`shell.openExternal`로 여는 대상이라 `javascript:`/`file:` 같은 스킴을 막는다.

## 관심종목 (`src/db/watchlist.ts`, `src/routes/watchlist.ts`)

보유하지 않은 종목의 현재가만 추적하는 목록 — `watchlist.json`,
`JsonStore<WatchlistEntry[]>`, 브로커/계좌 개념이 없고 심볼 하나로만 식별한다.
`POST /api/watchlist`(body `{symbol}`)가 `resolveStockNames`(토스→KIS→KB 폴백,
`stockNameResolver.ts`)로 이름/시장/통화를 한 번 자동조회해 저장하고, 실패하면
보유종목 CSV 가져오기와 같은 에러 메시지로 400/404를 응답한다 — 자동조회 결과를
영구 저장하는 이유는 이름/시장/통화가 거의 안 바뀌는 값이라서(종목명 캐시와 같은
전제). **현재가(`lastPrice`)는 저장하지 않는다** — `GET /api/watchlist`가 매번
`resolveStockPrices`로 등록된 심볼 전체를 한 번에 라이브 조회해 합쳐서 응답한다
(보유종목 CSV의 `lastPrice` 자동조회와 같은 원칙 — 시시각각 바뀌는 값을 저장해두면
바로 stale해짐). `DELETE /api/watchlist/:symbol`.
**등락률 `changeRate`**(2026-11-18, 토스 키가 있을 때만 — 없으면 null): 토스 현재가 API엔 전일 종가가 없어서 일봉(`/api/v1/candles`, 4시간 캐시)의
**가격 시각보다 20시간 넘게 앞선 가장 최근 봉**을 직전 거래일로 본다(`tossMonthlyClose.ts`의 `previousCloseFrom`, 테스트 `krMarketCalendar.test.ts` —
오늘 봉은 장 시작부터 가격 시각까지 길어야 16~17시간, 어제 봉은 24시간 이상 앞선다; 주말엔 마지막 거래일의 등락). 가격 시각은 `/prices`의 선택 필드
`timestamp`(없으면 지금). **2026-11-18 실데이터 대조**: 일봉 `timestamp`는 국내 그날 00:00 KST, 미국 그날 00:00 ET(=14:00 KST)이다.
(`adjusted`는 그날 대조한 종목에선 차이가 없었지만, 분배금 많은 국내 ETF는 다르다 — 아래 "상세 화면" 참고.) ⚠ **국내 일봉 종가는 NXT 시간외까지 포함한 그날 마지막 가격**이라 KRX 기준가와 다르다(예: 기준가보다 수백 원 차이) → 국내 6자리는
**KIS 키가 있으면 `inquire-price`의 기준가 `stck_sdpr`**(`fetchKisDomesticBasePrice`, 10분 캐시)를 쓰고, 없을 때만 토스 일봉. 미국은 토스 일봉이
마지막 정규장 종가와 맞았다 — KIS 해외 `rate`는 "마지막 정규장의 등락"이라 주간거래·프리마켓 시간엔 우리 값(지금 가격 ÷ 마지막 정규장 종가)과 다른 게 정상.

**상세 화면 API**(2026-11-19 — 화면은 `frontend/src/pages/watchlist/`):
- `GET /api/watchlist/candles/:symbol?days=`(30~900, 기본 400) — `fetchTossDailyCandles`(`tossMonthlyClose.ts`): 일봉 시가·고가·저가·종가·거래량,
  한 페이지 200봉씩 최대 3페이지, 페이지마다 4시간 캐시. 거래일은 `candleTradingDate`(봉 시각 + 12시간의 UTC 날짜 — 국내 00:00 KST·미국 00:00 ET 둘 다
  그날, 테스트 있음). 관심종목이 아닌 종목(비교 기준 KODEX 200 `069500`·`SPY`)도 받는다. 토스 키가 없으면 409.
  ⚠ **`adjusted=false`(실제 가격)로 받는다** — 토스 기본은 **수정주가**다(2026-11-19 실측: 매달 분배하는 국내 ETF는 과거 종가가 그동안의 분배금만큼
  낮게 오고(10개월 전 봉이 약 8% 차이), `SPY`·삼성전자는 같았다). 수정주가로 그리면 내 매수가(▲)가 과거로 갈수록 선 위로 떠서 어긋났다.
  **월별 종가(`fetchTossMonthlyClosePrices`)·직전 종가(`fetchTossPreviousClose`)도 같은 날 실제 가격으로 바꿨다** — 그 전엔 대시보드 월별 평가금액에서
  분배금 많은 ETF의 지난 달이 낮게 잡혔다. 디스크 캐시는 `monthly-close-cache-v2.json`으로 새로 받고 옛 `monthly-close-cache.json`(수정주가)은 처음 열 때 지운다.
  **토스 일봉을 새로 부를 땐 `adjusted=false`를 꼭 준다.**
- `GET /api/watchlist/:symbol/dividends?currency=KRW|USD` — `getSymbolDividends`(`upcomingDividends.ts`): 다가오는 배당과 **같은 원본**(국내 예탁원 일정 /
  미국 ICE + 기간별권리)을 종목 하나로 받아 지난 1년여(`history`, 기준일 오늘 이전)와 `planSymbolDividends`로 앞으로 12개월(`upcoming`). 6시간 캐시, KIS 키 없으면 409.
  주 단위 분배 ETF도 `planSymbolDividends`가 7일씩 추정한다(2026-11-20 전엔 월 단위만 알아 두어 건만 나왔다).
- `GET /api/watchlist/:symbol/overseas-detail` — KIS **해외주식 현재가상세 `HHDFS76200200`**(`fetchKisOverseasPriceDetail`, `kisOverseas.ts`, 거래소 NAS→NYS→AMS
  순서로 현재가가 있는 것, 10분 캐시). PER·PBR·EPS·BPS·시가총액(`tomv` — **달러 단위**, 실측)·상장주수·52주 고저(날짜 포함)·업종(`e_icod`)·ETP 분류(`etyp_nm`).
  **ETF는 PER·PBR·EPS·BPS가 0으로 와서**(실측 SPY) null로 바꾼다. KIS 52주 고저는 일봉 실제 가격으로 계산한 화면 요약과 다를 수 있다(실측: 분배금 많은 미국
  ETF에서 KIS 최고가가 일봉 최고가보다 20%가량 낮았다 — 분배금 조정 추정).
- `GET /api/watchlist?prices=0` — 저장된 목록만(시세·등락률 조회 없이). 종목코드 형식 `SYMBOL_PATTERN`은 **1~20자**(종목별 메모리 캐시 키가 끝없이 늘지 않게,
  `routes/stockInfo.ts`도 같게), 메모·삭제 경로도 검사한다. 502·마지막 오류 처리기(`server.ts`)의 응답 문장은 `redactText`로 긴 숫자열(계좌번호 등)을 가린다
  (2026-11-19 보안 리뷰 — 날짜 같은 7자리 이상 숫자도 가려진다).
- `PUT /api/watchlist/:symbol/memo` `{memo}`(2000자, 빈 값이면 지움 — 화면의 `BACKGROUND_WRITES`). 저장소 항목에 `memo`·`addedPrice`(추가할 때 현재가,
  "넣은 뒤 수익률" 기준 — 그 전에 넣은 종목은 없어서 화면이 추가한 날 이후 첫 종가로 대신)가 생겼다. 같은 종목을 다시 추가해도 추가일·그때 가격·메모는 그대로.

## 종목명 자동조회 (`src/db/stockNames.ts`, `src/stockNameResolver.ts`, `src/routes/stockInfo.ts`)

**두 개의 서로 다른 조회 경로가 있다.** `GET /api/stock-info/:symbol`(`routes/stockInfo.ts`,
Dividends.tsx의 "직접 입력" 단건 조회용)은 토스 전용이다(토스 종목 기본 정보 조회
`GET /api/v1/stocks?symbols=`, 최대 200개 콤마 동시조회 — 계좌와 무관한 시세 참조
데이터라 브로커가 `kis`/CSV 전용인 기록에도 그대로 쓴다, 토스 미연동이면 409, 프론트는
직접 입력으로 폴백). 반면 CSV 가져오기 세 라우트(배당금/보유종목/매매내역)가 공유하는
`resolveStockNames`는 **토스 → 한국투자증권 → KB증권 순으로 시도한다**(`stockNameResolver.ts`) —
1) 토스 종목 기본 정보(위와 같은 API, 국내/해외 다 지원, 배치 최대 200개), 2) 한국투자증권
주식기본조회(`kisClient.ts`의 `fetchKisStockName`, TR `CTPF1002R`, 국내 6자리만, 건별),
3) KB증권 종목기본정보(`kbClient.ts`의 `fetchKbStockName`, TR `SIQM4900`, 국내 6자리만,
건별, 앱에 이 TR 권한이 없으면 그냥 null). 두 경로 다 같은 SQLite 캐시를 공유한다.
**`name`이 심볼과 같은 경우가 있다** — 한글명이 없는 종목(주로 미국 ETF)은 토스 응답의
`name`이 티커 그대로 내려와서, `displayNameOf(info)`가 `name === symbol`(대소문자 무시)일
때만 `englishName`으로 대체한다(KIS/KB 대체 조회는 국내 종목만 다뤄서 이 문제가 없다).
조회 결과는 **SQLite**(`node:sqlite`, `stockNames.sqlite`, 심볼 하나로 키잉 — 브로커
무관)에 영구 캐시 — 이 테이블만 SQLite고 나머지는 전부 `JsonStore`다. `node:sqlite`를
쓰는 이유: 네이티브 addon이 없어야 electron-builder의 `asar: true` + `npmRebuild: false`
전제가 유지된다(`better-sqlite3`는 네이티브라 이 전제를 깬다) — 이 프로젝트가 실제 쓰는
Electron/Node 버전에서 플래그 없이 동작함을 직접 확인함.

일괄 갱신(`POST /api/dividends/refresh-names`)은 이미 저장된 기록의 이름을 전부
다시 채운다(오타 정리용) — `updateDividendNames`로 일괄 반영, 동시에 SQLite 캐시도 채운다.

### 매매내역 종목명

`StoredTrade.name`(선택, `string | null`)은 세 경로로 채워진다. **1) 실시간 조회**
(`routes/trades.ts`) — KIS는 체결 내역 TR(`inquire-daily-ccld`)이 `prdt_name`을 같이
내려줘서 그대로 쓰고, 토스는 Order 스키마 자체에 이름 필드가 없어서(`tossAdapter.ts`의
`mapOrder`, 항상 `name: null`) 응답 직전에 `resolveStockNames`로 채운 뒤 write-through
한다. **2) KB증권 동기화**(`routes/kb.ts`의 `sync-trades`) — `fetchKbTradeHistory`가
이미 `is_nm`(종목명)을 내려주므로 보통 그대로 쓰고, 혹시 비어 있으면 같은
`resolveStockNames`로 보충한다. **3) CSV 가져오기/수동 입력**(`routes/tradesStore.ts`) —
CSV의 `name` 컬럼이 선택 컬럼이라, 값이 있으면 그대로 쓰고(override) 없으면
`resolveStockNames`로 채운다 — 위 "CSV 가져오기" 절 참고. 세 경로 다 실패해도(API 연동이
전혀 없고 CSV에도 이름이 없으면) `name: null`로 저장되고, 화면은 심볼로 폴백 표시한다
(기존부터 있던 동작 — 이름이 필수는 아님).

**기존에 저장된 행 백필**(`POST /api/trades-store/refresh-names`, `db/tradesStore.ts`의
`updateTradeNames`) — `name` 필드가 생기기 전에 저장됐던 행(그땐 write-through가 이름을
무조건 버렸음)이나, 그때는 API 연동이 없어서 못 채웠던 행을 나중에 채워 넣는 일괄
백필용. `listTrades()`로 전체를 읽어 `name`이 빈 행의 심볼만 모아 `resolveStockNames`
(토스→KIS→KB)로 조회하고, `updateTradeNames`가 그 결과로 **비어 있는 행만** 채운다 —
이미 이름이 있는 행(CSV로 직접 입력한 이름 포함)은 덮어쓰지 않는다. `refresh-names`
(`routes/dividends.ts`)와 이름은 비슷하지만 동작이 다르다: dividends 쪽은 토스 전용이고
이미 있는 이름도 전부 덮어쓴다(오타 정리 목적), 이쪽은 다중 브로커 폴백 + 빈 행만
채우기다. 아무 브로커도 연동 안 돼 있으면 그냥 0건 갱신으로 끝난다(에러 아님).

## 환율 조회 (`src/exchangeRateResolver.ts`, `src/fx/eximbankClient.ts`)

USD/KRW 환율은 **토스 → 한국수출입은행 순으로 시도한다**(`resolveUsdKrwRate`) —
종목명 조회의 토스→KIS→KB 3단계 폴백과 같은 방향(위 절 참고), 토스 환율 API
(`GET /api/v1/exchange-rate`)가 가끔씩 실패하는 문제를 완화하려고 만들었다.
`GET /api/market-info/exchange-rate/usd-krw`(브로커 무관, `routes/marketInfo.ts`)가
이 리졸버를 호출한다 — 예전의 브로커 지정 `GET /api/market-info/:broker/exchange-rate`(2026-11-16 삭제 — 화면이
더 이상 부르지 않았다)와 달리, 이 라우트는
둘 다 실패해도 예외를 던지지 않고 `{rate: null}`을 응답한다 — 프론트는 그걸 보고
설정에 저장된 수동 환율로 마지막 폴백한다(`manualFxRate ?? liveFxRate` 패턴,
`Dashboard.tsx`/`Trades.tsx`/`Dividends.tsx`/`Overview.tsx` 전부 동일).

⚠ 정정(2026-11-16): 한국수출입은행 공식 명세 페이지는 **`oapi.koreaexim.go.kr`이 신규 도메인**이고 기존 도메인이 2026-04-30에
종료된다고 안내한다 — 아래 "구 도메인"이라는 표현은 당시 공지를 거꾸로 읽은 것이다. 어쨌든 지금 쓰는 `oapi`가 맞는 도메인이다.
또 발급 키는 **개인정보 보유기간 2년이 지나면 파기**돼 `result: 3`(인증키 오류)이 나온다 — 사용자에게 재발급을 안내한다(매뉴얼 부록).

**한국수출입은행 Open API**(`eximbankClient.ts`, `exchangeJSON`, `data=AP01`) —
매 영업일 11시경 갱신되는 일별 매매기준율(`deal_bas_r`)을 준다. **도메인은
`oapi.koreaexim.go.kr`(구 도메인)을 쓴다** — 공공데이터포털 공지는 "2025-06-25에
`www.koreaexim.go.kr`로 이전, 구 도메인은 2026-04-30 폐쇄 예정"이라고 해서 처음엔
신 도메인으로 구현했는데, **실측 결과가 공지와 반대였다**: 신 도메인은 쿼리
파라미터가 붙은 요청에 응답을 아예 안 주고 계속 걸렸고(WAF/봇 차단 추정 —
`authkey`만 붙여도 재현, TLS 핸드셰이크는 성공하지만 응답 바이트가 0),
"폐쇄 예정"이라던 구 도메인은 사용자가 실제 발급받은 인증키로 즉시(0.1초) 정상
응답했다(200 OK, checked 2026-08-17). 그래서 문서상 공지를 무시하고 실측 결과를
따라 구 도메인을 쓴다 — **구 도메인이 나중에 진짜 폐쇄되면 `BASE_URL`을
`www.koreaexim.go.kr`로 다시 바꿔야 한다**(그땐 아래 타임아웃/재시도가 안전망
역할을 그대로 한다). 응답 필드(`result`/`cur_unit`/`ttb`/`tts`/`deal_bas_r`/
`cur_nm` 등, `cur_unit`이 "USD"로 오는 것 포함)는 이 실제 응답과 공식 사용 예제
(Java/Spring Boot, Python)를 교차 확인해 반영했다.

`searchdate`를 오늘부터 최대 5일 전까지 하루씩 거슬러 올라가며 USD 항목이 있는
첫 응답을 쓴다(주말/공휴일엔 그날 데이터가 없어서). 각 시도는 `AbortController`로
5초 타임아웃을 건다 — 신 도메인에서 겪은 응답-없음(hang) 현상 때문에 방어적으로
남겨뒀다(구 도메인은 정상 응답이 0.1초 남짓이라 5초면 충분히 넉넉함) — 타임아웃이
없으면 "토스 실패 시 몇 초 안에 대체"라는 이 기능의 목적 자체가 무한 대기로
무너질 수 있다(최악의 경우도 총 대기 30초 안쪽으로 묶임).

**인증키는 사용자가 설정에서 직접 입력한다**(2026-11-16 사용자 결정 — "내 키를 삽입해서 사용하는 것은 아닌 것 같다").
- ⚠ **왜 이게 맞았나 — 빌드 내장 방식은 배포본에서 한 번도 동작하지 않았다.** ②(아래 이력) 시절 키는 gitignore된
  `fx/eximbankConfig.ts`에 있었고 CI가 Secret `EXIMBANK_AUTH_KEY`로 그 파일을 만들게 돼 있었는데, **그 Secret을 등록한 적이
  없어** v1.0.0~v1.2.2 여섯 번의 릴리스 빌드가 전부 `.example` 템플릿(`'YOUR_EXIMBANK_AUTH_KEY'`)으로 빌드됐다(각 run 로그의
  `::warning::EXIMBANK_AUTH_KEY가 없어 템플릿으로…` 3건씩, 2026-11-16 확인). 개발자 PC의 로컬 빌드·dev 실행만 진짜 키를 써서
  "잘 된다"고 보였을 뿐, 사용자에게는 수출입은행 환율(지급월 평균 환율·예비 환율)이 **처음부터 없었다**. 로컬 동작만 보고
  배포본을 믿지 말 것 — **배포에 필요한 비밀값은 CI 로그의 경고까지 확인**해야 한다.
- 덕분에 키가 GitHub(코드·이력·릴리스 파일·Secrets)에 올라간 적도 없다 — 2026-11-16 전 브랜치·태그·PR ref·reflog·dangling 객체,
  릴리스 run 로그까지 확인. 개발자 PC의 `fx/eximbankConfig.ts`는 키를 설정(봉투)으로 옮긴 뒤 2026-11-16에 지웠다 —
  tsconfig `exclude`는 같은 이름 파일이 다시 생겨도 배포에 안 실리게 남겨 둔다.
- 저장: `fx/eximbankKey.ts` — `eximbank-key.json`에 증권사 키와 같은 키체인 봉투(`sealJson`)로. 키링 없는 Linux면 저장 거부(409).
  복호화 결과는 암호문을 키로 메모리 캐시. **값을 화면으로 돌려주지 않는다**(`GET /api/settings/eximbank-key`는 `{configured}`만).
- 저장 전 확인: `POST /api/settings/eximbank-key` → `checkEximbankAuthKey()`가 최근 평일을 한 번 조회 — 응답 `result`
  1 성공·3 인증키 오류(→ 400, 저장 안 함)·4 일일 한도 마감(저장 + 경고)·연결 실패(저장 + 경고). `DELETE`로 지운다.
- 백업: 키체인 파일 목록(`KEYCHAIN_FILES`)에 들어가 zip엔 원본이 안 들어가고, 비밀번호 백업이면 `secrets.enc.json`의
  `eximbankKey`로 들어간다. 이 필드가 없는 예전 백업을 복원하면 지금 키를 그대로 둔다(`undefined`), `null`이면 지운다.
- ⚠ **"없음" 캐시 오염 주의**: 키를 사용자가 넣다 보니 틀린 키로 조회하는 일이 생긴다. `fetchEximbankRateForDate`는 응답에
  `result !== 1` 항목이 있으면(2·3·4 — 키·요청 문제) 날짜 캐시에 null을 **쓰지 않는다**(쓰면 키를 고친 뒤에도 그 날짜가 영영 빈다).
  월평균의 메모리 캐시(`withCache`, 최대 30일)는 키에 `eximbankKeyFingerprint`(sha256 앞 12자)를 넣어 키가 바뀌면 다시 받는다.
  키가 없을 땐 아예 캐시하지 않고 null — 키를 넣는 즉시 다음 요청부터 받아진다.
- 화면: 설정의 "한국수출입은행 환율 인증키" 카드(입력 필요/저장됨), 배당금 화면은 키가 없고 달러 배당이 있으면 안내.
- ①의 평문 `settings.json`의 `eximbankAuthKey`가 남아 있으면(실제로 개발자 PC에 남아 있었다 — 백업 zip에도 들어감) 처음 읽을 때
  `migrateLegacyKey()`가 봉투로 옮기고 평문 필드를 지운다(이미 새 키가 있으면 지우기만, 키링이 없으면 잃지 않게 그대로).
- 이력: 예전엔 ① Settings 입력 + 평문 `settings.json` → ② 개발자 키를 빌드에 내장(`fx/eximbankConfig.ts`, gitignore) → ③ 지금.
  ②의 파일이 개발자 PC에 남아 있어도 `backend/tsconfig.json`의 `exclude`로 컴파일·배포에서 빠진다. 키는 git 이력에 들어간
  적이 없다(2026-11-16 전 브랜치·태그·PR ref 검색).

**응답을 날짜별로 영구 캐시한다**(`fx/eximbankCache.ts`, `eximbank-cache.json`) —
처음엔 앱에 박힌 공유 키의 요청량을 줄이려고 만들었고, 지금은 사용자 키의 일일 호출 한도(알려진 값 하루 1,000회)를
아끼는 역할이다. 날짜별 환율은 키와 무관해서 키를 바꿔도 캐시를 그대로 쓴다. `fetchEximbankRateForDate`가
실제 네트워크 호출 경계에서 캐시를 확인/기록한다 — **지난 날짜**는 환율이든
"그날 데이터 없음"(주말/공휴일)이든 한 번 확인하면 영구 캐시(디스크, 앱 재시작
후에도 유지)하고 다시는 API를 안 부른다. **오늘 날짜**는 값이 아직 없으면(매매기준율
고시 전, 보통 11시 이전) 캐시하지 않고 다음 호출 때 다시 확인하며, 값이 생기면
그때부터 캐시한다. 네트워크/타임아웃/응답 형식 오류는 일시적 문제일 수 있어 아예
캐시하지 않는다(다음 호출에 재시도) — 이 구분이 없으면 일시적 네트워크 오류를
"그날 데이터 없음"으로 영구 캐시해버려 실제로 있는 데이터를 계속 숨기게 된다.
이 캐시 하나로 "오늘 환율" 조회(`fetchEximbankUsdKrwRate`, 예전엔 캐시가 전혀
없어서 호출마다 최대 6번 API를 쳤음)와 "월평균 환율" 조회(아래, 기존 메모리
캐시는 앱 재시작하면 초기화됐음) 둘 다 자동으로 혜택을 받는다.

## 월별 종가 조회 (`brokers/toss/tossClient.ts`의 `fetchTossMonthlyClosePrices`)

프론트 `Overview.tsx`의 "월별 총 투자금 · 총 수입금"/"매월 보유종목 투자금 대비
수익률" 두 카드가 각 달의 평가금액을 계산할 때, 예전엔 그 달 보유수량에 **오늘
현재가**를 곱했다 — 그래서 그래프가 사실상 "수량 증감만 반영된, 오늘 가격
기준" 곡선이었다. 실제 그 달 시세로 계산해달라는 요청으로 토스 일봉 API를 새로
연동했다.

- **`GET /api/v1/candles`**(`MARKET_DATA_CHART` group, 공식 스펙 확인, checked
  2026-08-17) — 계좌 무관, KR/US 심볼 공통. `interval=1d`(일봉, `1m`도 있지만
  안 씀)만 지원하고 **월봉 자체가 없어서**, 일봉을 모아 이 코드가 직접 달마다
  "그 달 마지막 거래일 종가"를 뽑는다(달력상 말일이 아니라 마지막 *거래일* —
  휴장일과 무관하게 항상 값이 나옴). 한 번에 최대 200봉이라(하루 평균 거래일
  기준 약 9~10개월치), 그 이상 필요하면 응답의 `nextBefore`로 과거로
  페이지네이션한다(최대 5페이지 상한).
- **KIS에도 월봉 API(`FHKST03010100`, `inquire-daily-itemchartprice`)가
  있지만 국내 종목(KRX) 전용이라 안 썼다** — 이 포트폴리오엔 미국 ETF
  (YieldMax NVDA 등)도 있어서, 국내/해외를 한 API로 같이 커버하는 토스가 이
  용도엔 더 맞다.
- **종목 하나가 실패해도 다른 종목을 막지 않는다** — `fetchTossMonthlyClosePrices`
  자체가 실패(토스 미연동, 상장폐지/오타로 종목을 못 찾음, 네트워크 오류 등)
  시 예외 대신 빈 배열을 준다. 라우트(`GET /api/market-info/monthly-close-prices?symbols=A,B&months=12`)도
  종목별로 독립 호출해서 모으므로 한 종목의 실패가 나머지 응답에 영향을 안 준다.
- **프론트 쪽 fallback**: `Overview.tsx`가 그 종목·그 달의 종가를 못 받았으면
  (토스 미연동 포함) 그 달만 오늘 현재가로 대체한다 — 예전 동작으로 자연스럽게
  내려가는 안전망이라 이 기능이 없어도 카드 자체는 계속 동작한다.
- 대시보드가 새로고침마다 "지금 보유 중이면서 매매내역도 있는" 종목만 조회
  대상으로 삼는다(전량 매도해 더는 안 갖고 있는 과거 거래 종목은 제외) — 그래도
  종목 수만큼 API 호출이 늘어나므로(종목당 1~2페이지), 이미 다른 화면보다 호출량이
  많다고 문서화된 `Overview.tsx`의 특성이 여기서 한 번 더 커진다.
- **확정된 달(지난달보다 이전)의 종가는 디스크에 영구 캐시한다**
  (`db/monthlyCloseCache.ts`, `monthly-close-cache-v2.json` — 실제 가격, 2026-11-19 전 파일은 수정주가라 버림) — 캐시가 요청 범위를
  덮으면(`coveredFrom`) 최신 일봉 한 페이지만 받아 합친다, 앱 재시작 후에도 종목당
  1페이지. 지난달은 한국 시간 1일 새벽 미국장 마감 전엔 미확정일 수 있어 일부러
  캐시하지 않는다(최신 페이지에 항상 포함돼 추가 비용 없음). **디스크 기록은
  `fx/eximbankCache.ts`와 같은 이유로 메모리에 모았다가 500ms 뒤 한 번에 쓴다** —
  `/monthly-close-prices` 라우트가 보유 종목 전체(수십 개)를 `Promise.all`로
  한꺼번에 조회하는데, 콜드 캐시라 종목마다 `setCachedCloses`가 불리면 그때마다
  파일 전체(종목 수에 비례해 계속 커짐)를 다시 썼다.
- **캐시 TTL을 다른 브로커 응답(`DEFAULT_TTL_MS`, 5초)보다 훨씬 길게(`CANDLE_CACHE_TTL_MS`,
  4시간) 잡는다** — 이미 지나간 달의 종가는 다시 안 바뀌고, 오늘이 속한 달의
  봉만 장중에 계속 움직인다.
- **`months=all`(최대 600개월)**: 관심종목 상세의 "전체 기간"/연도별 보기용 — 페이지
  상한이 요청 기간에 비례해 늘어나(`ceil(months/9)+2`, 최소 5·최대 80) 상장 초기까지
  내려간다. 토스 일봉은 미국 종목이 1990년부터, 국내는 그 이전(삼성전자 1976-08~)까지
  있다. 첫 조회 실측 0.8~6.7초(NVDY 42개월 ~ AAPL 442개월), 끝까지 받으면
  `coveredFrom='0000-00'`으로 디스크 캐시돼 이후엔 최신 1페이지만 받는다. 캐시 경로는
  `months`와 무관하게 캐시된 달 전체를 돌려주므로 호출부가 필요한 달만 고른다. 이 기능을 처음 붙였을 때 대시보드 진입 시
  "몇 초간 빈 화면"이 되는 문제가 있었는데(41개 종목 기준 콜드 캐시 실측 약
  4.2초), 짧은 TTL로는 새로고침을 누를 때마다 이 비용을 매번 다시 치렀다 —
  긴 TTL로 같은 세션 안의 재조회는 캐시로 즉시 끝난다. 첫 진입(콜드 캐시)의
  지연 자체는 프론트 쪽 비동기 분리(아래 `frontend/CLAUDE.md`의
  "MonthlyInvestmentChart.tsx" 절 참고)로 별도 해결했다.

## 배당금 월평균 환율 (`fx/eximbankClient.ts`의 `fetchEximbankMonthlyAvgUsdKrwRate`)

`Dividends.tsx`/`Overview.tsx`가 달러 배당금을 원화로 환산할 때, 예전엔 다른
모든 USD 환산과 마찬가지로 "오늘(또는 설정에 직접 입력한) 환율" 하나를 모든
기록에 똑같이 적용했다 — 그런데 배당금은 각 기록에 실제 지급일(`paidDate`)이
있어서, 몇 달 전에 받은 배당금까지 오늘 환율로 계산하면 그때 실제로 얼마를
받았는지와 어긋난다는 지적을 받아 "그 배당금이 지급된 달의 평균 환율"로
바꿨다.

- **토스는 과거 환율을 지원하지 않는다**(`fetchTossExchangeRate`는 현재가만
  줌, 날짜 파라미터 자체가 없음) — 그래서 이 기능은 한국수출입은행이
  유일한 소스다. 종목 시세처럼(위 "월별 종가 조회" 절) 국내/해외 커버리지를
  놓고 고민할 필요가 없다 — 환율은 애초에 국가별 종목 구분이 없다.
- **하루짜리 조회(`fetchEximbankUsdKrwRate`, "환율 조회" 절)를 그 달 전체
  평일에 반복 호출해 평균낸다** — 별도 "월평균" API가 없어서 직접 구한다.
  주말은 애초에 그 API가 데이터를 안 주므로 호출 자체를 건너뛰고(평일만
  대상), 공휴일은 그 날짜만 자연히 실패로 빠지므로 별도 휴일 목록이 필요
  없다. 이번 달처럼 아직 안 끝난 달은 오늘까지만 평균낸다. 달 하나당 최대
  20여 회 호출이 필요하지만 전부 병렬로(`Promise.all`) 쏘고, 개별 호출이
  평균 0.1~0.2초라 실측 3개월치 배치 조회가 0.24초 걸렸다(캐시 없는 상태).
  단 실제 네트워크 요청은 동시 6개로 제한하고(`MAX_CONCURRENT_REQUESTS` — 여러
  달이 겹치면 수백 건이 한꺼번에 나가던 문제), 디스크 캐시 기록은 메모리에
  모았다가 500ms 뒤 한 번에 쓴다(`eximbankCache.ts` — 날짜마다 파일 전체를 다시
  쓰던 문제).
- **캐시 TTL도 위 종가 캐시와 같은 논리**: 이미 끝난 달의 평균은 다시 안
  바뀌니 30일(`PAST_MONTH_TTL_MS`, 이 프로세스가 사는 동안은 사실상 영구)로
  길게, 아직 진행 중인 이번 달만 4시간(`CURRENT_MONTH_TTL_MS`)으로 짧게
  캐싱한다.
- `GET /api/market-info/exchange-rate/monthly-avg?months=2025-09,2025-10` —
  여러 달을 한 번에 조회한다(달마다 독립 실패, `monthly-close-prices`와 같은
  패턴). 그 달을 못 구했으면(수출입은행 미연동, 그 달 데이터를 하나도 못 찾음)
  그 키는 `null`이고, 프론트가 기존 `effectiveFxRate`(오늘/수동 환율)로
  대체한다 — 이 기능이 없어도(수출입은행 키를 아예 안 넣었어도) 예전 동작
  그대로 계속 작동한다.
- **투자금(매입원가)은 이 대상이 아니다** — "지금 이 순간 보유 중인 자산의
  가치"라 특정 달에 귀속시킬 자연스러운 기준이 없다(배당금은 지급일이라는
  명확한 날짜가 있지만, 매입원가는 매수 시점이 여러 번일 수 있고 지금 이
  순간의 스냅샷이 의미 있는 값이다). `Dividends.tsx`의 "투자금"/`총 매입금액`
  계열은 그대로 `effectiveFxRate`를 쓴다.

## Google Sheets 연동 (`src/google/`, `src/routes/google.ts`)

CSV export/import를 향후 대체할 목적으로 만들었다 — Drive 루트에 "MyStock"
스프레드시트를 하나 두고, Holdings/Trades/Dividends 세 탭에 보유종목/매매내역/
배당금을 내보내거나 가져온다. googleapis 같은 SDK 없이 순수 `fetch`로 REST를
직접 호출한다(Toss/KIS 클라이언트와 같은 이 프로젝트 관례).

- **`clientCredentials.ts`** — **사용자가 자기 Google Cloud 프로젝트에서 만든 OAuth 클라이언트**(데스크톱 앱 유형의 Client ID/Secret)를
  설정에서 넣는다(2026-11-16 사용자 결정 — 수출입은행 키와 같은 이유, 루트 CLAUDE.md "API 자격증명" 줄). `google-client.json`에
  키체인 봉투로 저장, 키링 없는 Linux면 거부(409). **Secret은 응답하지 않는다** — `GET /status`의 `clientId`만 알아보기용으로 준다.
  `validateGoogleClientInput`은 형식만 본다(`<숫자>-<영숫자>.apps.googleusercontent.com`, Secret 영숫자·`_-`) — Google에 미리 맞는지
  물어볼 API가 없어 실제 확인은 로그인 때 된다. 백업은 비밀번호 백업의 `secrets.enc.json`(`googleClient`)에만, 예전 백업엔 이 필드가
  없어 복원해도 지금 값을 둔다.
  - **클라이언트를 바꾸면 연결을 끊는다**(`POST /client`에서 이전 Client ID와 다르면 `clearAccount()`) — 이전 클라이언트로 받은
    refresh_token은 새 클라이언트로 갱신되지 않는다. 같은 Client ID로 Secret만 다시 넣으면 연결을 둔다. `DELETE /client`는 연결까지 지운다.
  - 사용자 클라이언트가 **테스트 게시 상태면 refresh_token이 7일 뒤 만료**된다(Google 정책) — 그때 `invalid_grant` → 아래
    `reconnectAndGetAccessToken()`이 다시 로그인 창을 연다. 매뉴얼은 "프로덕션으로 게시하면 안 만료되고 '확인하지 않은 앱' 경고만"이라고 안내.
  - 이력: 예전엔 gitignore된 `google/clientConfig.ts`에 개발자 클라이언트를 박아 빌드했다 — 그런데 CI Secret(`GOOGLE_CLIENT_ID`/`SECRET`)을
    등록한 적이 없어 **v1.0.0~v1.2.2 배포본엔 들어간 적이 없고**(run 로그 템플릿 경고 3건씩, 2026-11-16 확인) 배포본 설정 화면은 "지금은
    사용할 수 없습니다"였다. 개발자 PC의 로컬 빌드만 동작했다. 그 Client ID/Secret도 git 이력·reflog에 없다(2026-11-16 확인). 파일이 남아
    있어도 `backend/tsconfig.json`의 `exclude`로 컴파일·배포에서 빠진다.
- **`oauth.ts`** — 루프백 리디렉션 + PKCE(`crypto`로 code_verifier/code_challenge
  생성, SDK 불필요) + **`state`**(로그인 시도마다 무작위 — 콜백의 `state`가 다르면 400으로 무시하고 서버는 닫지 않은 채
  진짜 콜백을 기다린다. 다른 페이지가 루프백 콜백에 남의 code를 밀어 넣는 로그인 CSRF 대비, 2026-11-16). `startConnectFlow()`가 임시 로컬 서버를 임의 포트(`listen(0)`)에
  띄우고 `shell.openExternal`로 시스템 브라우저를 연다(Electron 밖 dev 실행이면
  콘솔에 URL만 출력). 진행 상태(`idle`/`waiting`/`connected`/`error`)는 모듈
  전역 변수로 관리 — 프론트가 `GET /status`를 폴링해서 확인한다(별도 push
  메커니즘 불필요, 이 앱 전체가 폴링 기반). `getValidAccessToken()`이 만료
  임박이면 refresh_token으로 자동 갱신 — Sheets API 호출 전에 항상 이걸 거친다.
  **범위는 `spreadsheets` + `drive.file` + `userinfo.email` 세 개다** —
  `drive.file`은 오직 `sheetsApi.findSpreadsheetByName()`(아래)에서 이름으로
  기존 "MyStock" 파일을 찾는 용도로만 쓴다, 업로드/삭제/공유 등 그 외 Drive
  조작은 안 함. `drive.file`은 **이 앱이 만들었거나 이 앱으로 연 파일만** 보인다 —
  찾는 파일이 이 앱이 만든 "MyStock"이라 충분하다(사용자가 Drive에서 직접 만든
  같은 이름 파일은 안 찾아진다). 예전엔 `drive.readonly`였는데 Google 공식 분류상
  `drive.readonly`는 **restricted**, `drive.file`은 **non-sensitive(권장)**,
  `spreadsheets`는 sensitive라 2026-10-30에 바꿨다. 이미 `drive.readonly`로
  연결해 둔 사용자는 재연결 전까지 옛 토큰(옛 범위)을 그대로 쓰며 문제없이 동작한다.
  **Drive 범위는 중간에 추가돼서 그 전에 이미
  연결한 사용자의 refresh_token엔 없다** — "연결 해제" 후 재연결(재동의)해야
  Drive 검색이 실제로 동작한다, 안 그러면 `findSpreadsheetByName`이 403을 조용히
  삼키고 `null`을 반환해 기존 동작(새 파일 생성)으로 자연스럽게 넘어간다.
  **refresh_token 자체가 만료/취소됐을 때(Google이 `invalid_grant`로 응답 —
  가장 흔한 원인은 사용자가 Google 계정 설정에서 이 앱 접근 권한을 직접
  취소한 경우) `getValidAccessToken()`이 에러를 던지는 대신 자동으로 재로그인한다** —
  내부적으로 `reconnectAndGetAccessToken()`이 `store.clearAccount()`로 죽은
  토큰을 지우고 `startConnectFlow()`를 다시 실행해(시스템 브라우저가 자동으로
  뜬다) `currentStatus`가 `connected`/`error`가 될 때까지 1초 간격으로 폴링한
  뒤(최대 `CONNECT_TIMEOUT_MS`=5분, 정상 로그인 플로우와 같은 타임아웃) 새
  액세스 토큰을 돌려준다. Sheets/Trades/Dividends 화면의 "Google Sheets로
  내보내기/가져오기" 버튼이 그대로 이 함수 위에 얹혀 있어서(`sheetsApi.ts`가
  전부 `getValidAccessToken()`을 거침) 사용자 입장에선 버튼을 눌렀을 때
  시스템 브라우저가 저절로 뜨고, 그 브라우저에서 로그인을 마치면 원래 누른
  내보내기/가져오기가 그대로 이어서 완료된다 — 설정 화면에서 수동으로
  "연결 해제 → 재연결"을 할 필요가 없다. **캐시된 accessToken이 로컬 만료
  시각상으로는 아직 안 지났는데 실제로는 이미 죽은 경우**(같은 원인 —
  refresh 시도 자체를 안 타는 시점에 권한이 취소된 경우)를 위해
  `invalidateAccessToken()`(로컬 accessToken만 지움, refreshToken은 유지)도
  같이 뒀다 — `sheetsApi.ts`의 각 호출이 401을 받으면 이걸로 캐시를 지우고
  `getValidAccessToken()`을 한 번 더 불러 재시도한다(정상 만료면 조용히
  refresh_token 갱신으로 끝나고, refresh_token도 죽었으면 위 자동 재로그인으로
  이어진다). **403 "insufficient authentication scopes"도 같은 자동 재로그인으로
  이어진다** — `sheetsApi.ts`가 이 정확한 Google 오류 메시지를 401과 구분해서
  잡는다(`sheetsFetch`의 `isInsufficientScopeError`). 원인은 위 `SCOPES`가 코드에
  추가/변경되기 *전에* 이미 연결해둔 오래된 refresh_token을 그대로 쓰고 있는
  경우다 — access token을 새로 받는 401 경로(`invalidateAccessToken`)로는
  refresh_token 자체에 없는 스코프가 생기지 않으므로(access token은 발급 시
  refresh_token이 가진 스코프의 부분집합만 받을 수 있음), 이 경우엔 처음부터
  `reconnectAndGetAccessToken()`으로 바로 건너뛰어 전체 재동의 화면을 다시
  띄운다. `findSpreadsheetByName()`의 Drive 검색 요청 하나만 이 처리에서 제외돼
  있다 — 그쪽은 원래부터(위 "이 범위는 중간에 추가돼서" 문단) 403을 "검색 실패
  → 새로 생성"으로 조용히 넘기는 게 의도된 동작이라, 이걸 재로그인으로 승격시키면
  이름 검색 실패만으로도 매번 브라우저가 뜨게 돼 오히려 불편해진다.
- **`sheetsApi.ts`** — `createSpreadsheet`/`spreadsheetExists`/`ensureTab`/
  `writeValues`/`readValues`/`findSpreadsheetByName`. 스프레드시트 생성·읽기·쓰기는
  전부 Sheets API만으로 되고(`spreadsheets.create`가 파일을 Drive 루트에 직접
  만들어줌), **`findSpreadsheetByName`만 예외적으로 Drive API v3
  (`files.list`, `name = '...' and mimeType = '...spreadsheet' and trashed = false`)를
  직접 호출한다** — Sheets API엔 "이름으로 검색" 기능이 없어서 불가피함, 이 앱이
  만든 파일을 찾는 것이라 `drive.file` 범위로 충분하다. `writeValues`는 범위를 탭 이름만으로
  줘서(Sheets API가 이걸 "그 탭 전체"로 해석) 쓰기 전에 항상 전체를 지운다(clear)
  — 이전 내보내기보다 행이 줄었을 때 마지막 행들이 stale하게 안 남게.
- **`sheetsSync.ts`** — `ensureSpreadsheet()`가 먼저 로컬에 캐시해둔
  `spreadsheetId`를 재사용하고(`spreadsheetExists()`로 확인), 없거나 404면
  `sheetsApi.findSpreadsheetByName('MyStock')`으로 Drive에서 같은 이름의 기존
  파일을 찾아 재사용을 시도한 뒤, 그마저 없으면(진짜 최초 연결, 또는
  Drive 범위 동의가 없는 옛 토큰) 새로 만든다. 이 순서(캐시 → 이름 검색 →
  생성)를 둔 이유는 **`store.ts`의 `clearAccount()`(연결 해제 버튼)가 옛날엔
  `spreadsheetId`/`spreadsheetUrl`까지 지워서** 재연결할 때마다 "MyStock" 파일이
  중복 생성된 실제 사례가 있었기 때문 — 지금은 `clearAccount()`가 그 두 필드를
  보존해 1차로 캐시 재사용이 되지만, 캐시가 어떤 이유로든 유실되는 경우(수동으로
  데이터 폴더를 지웠다거나)에도 이름 검색이 2차 안전망으로 중복 생성을 막는다.
  여러 개 찾으면 가장 최근에 수정된 파일을 쓴다(사용자가 최근 편집 중이던 파일일
  가능성이 가장 높음). 다른 계정으로 연결하면 그 계정엔 저장된 spreadsheetId
  접근 권한이 없어 `spreadsheetExists()`가 자연히 404를 반환하고, 그 계정
  소유의 "MyStock" 파일이 따로 있다면 이름 검색으로 찾아 재사용하며 없으면 그
  계정용으로 새로 만든다. `exportDataType`은 로컬 저장소 전체를 헤더+행으로
  바꿔 그 탭에 덮어쓴다(`HOLDINGS_SHEET_HEADER` 등 `sheetSchemas.ts` — 프론트
  `HOLDINGS_CSV_HEADER`와 컬럼 이름/순서를 동일하게 맞춰야 한다, 워크스페이스가
  갈려 있어 상수 공유는 못 함). **`importDataType`은 CSV 가져오기와 다르게
  "전체 교체"다** — 시트에서 읽은 데이터로 수동 행 전체를 대체하고, 시트에
  없는 기존 수동 행(다른 계좌/기록 포함)은 지운다. API·동기화 계좌 행은 시트에서
  건너뛰고 로컬 것을 그대로 둔다(위 "CSV 가져오기"의 행 소유권 — `replaceAllHoldings`/
  `replaceAllTrades`의 `preserve` 인자). `routes/holdingsStore.ts`/
  `tradesStore.ts`/`dividends.ts`의 `importXxxRecords(records, {fullReplace})`가
  이 옵션을 받아 `db/*.ts`의 `replaceAllHoldings`/`replaceAllTrades`/
  `replaceAllDividends`(전체 교체, CSV의 부분 병합/업서트/추가와는 다른 함수)로
  분기한다 — CSV 가져오기 쪽(`fullReplace` 생략, 기본 `false`)은 기존 동작 그대로다.
  **안전장치**: 시트에 실패한 행이 **하나라도** 있으면 아무것도 바꾸지 않고
  `aborted: true`로 응답한다(예전엔 "전부 실패"만 막아서, 100행 중 5행이 일시적인
  이름 조회 실패로 떨어지면 그 5행이 경고 없이 로컬에서 지워졌다). 옮길 수동 행이
  하나도 없을 때(시트 행이 전부 API·동기화 계좌 것)도 건드리지 않는다
  (`toUpsert.length===0 && records.length>0` 가드). 시트가 완전히
  비어 있으면(`records.length===0`, 아직 한 번도 내보낸 적 없는 새 스프레드시트 등)
  아예 가져오기 자체를 건너뛴다. **토스 accountId 표시 변환**: 토스만
  내부 accountId가 Toss Open API가 요구하는 `accountSeq`(예: `"1"`)라 사람이
  못 알아본다(KIS/KB/삼성은 accountId 자체가 이미 실제 계좌번호). Local DB는
  건드리지 않고(바꾸면 다음 라이브 동기화가 깨짐 — `accountSeq`가 Toss API
  호출에 그대로 필요), 시트로 내보낼 때만 `buildTossAccountNumberMap()`으로
  `accountNo`(실제 계좌번호)로 바꿔 보여주고, 가져올 때 역맵으로 다시
  `accountSeq`로 되돌린다.
- **`routes/google.ts`** — `GET /status`(`hasClientCredentials`, `clientId`, 연결 상태), `POST /client`·`DELETE /client`(사용자 OAuth
  클라이언트, 위 `clientCredentials.ts`), `POST /connect`(클라이언트 없으면 400), `POST /disconnect`,
  `POST /sync/:dataType/export`, `POST /sync/:dataType/import` (`dataType`은 `holdings`|`trades`|`dividends`).

## 백업/복원 (`src/backup.ts`, `src/backupCrypto.ts`, `src/routes/backup.ts`)

데이터 폴더(`getDataDir()`)를 zip으로 묶어 내려받고, 다시 그 zip으로 되돌리는 기능 —
Google Sheets 연동은 "동기화"(부분 교체/append)라 백업이 아니므로, 진짜 전체 백업
수단이 따로 필요해서 추가했다.

- **비밀 파일 넷은 zip에 원본 그대로 넣지 않는다**(2026-10-30, EGM 리뷰 S2):
  - 접속 토큰(`<브로커>-token.json` — KIS·KB·NH·키움): **항상 뺀다.** 하루 안팎이면
    만료되고 없으면 앱이 다시 받는다. 복원할 때도 예전 백업에 들어 있으면 건너뛰고, 비밀번호 복원 뒤엔 남은 토큰을 지운다.
    ⚠ 예전엔 파일 이름 목록(KIS·KB)으로 골라서 **NH·키움 토큰이 평문으로 백업에 들어갔다** — 지금은 이름 규칙
    `/^[a-z0-9]+-token\.json$/`(`isAccessTokenFile`)으로 고른다(2026-11-16). 토큰 자체도 이제 `SecretJsonStore`로 암호화돼 있다.
- **복원 입력 검증**(2026-11-16): 항목 500개·항목당 100MB·합계 300MB(풀기 전 `header.size`로 먼저 — 압축 폭탄), JSON은 파싱되는지,
  `.sqlite`는 `SQLite format 3\0` 헤더인지 본다. 형식이 틀린 항목은 `skipped`. **모두 검사한 뒤에 쓴다**(일부만 덮어쓰지 않게).
  예전 형식 백업의 `credentials.json`·`google-account.json`은 **`encrypted: true` 봉투만** 받는다 — 평문 봉투를 받으면 조작된 백업이
  남의 API 키를 심을 수 있다(그래서 테스트도 평문 봉투가 되는 standalone 저장 대신 `encrypted:true` 모양을 직접 만든다).
  - `credentials.json`/`google-account.json`(OS 키체인으로 암호화): 그 열쇠는 PC 밖으로
    못 나가서 그대로 넣으면 다른 PC에선 못 연다. **사용자가 백업 비밀번호를 주면** 풀어서
    그 비밀번호로 다시 잠근 `secrets.enc.json` 하나로 넣는다(`backupCrypto.ts` —
    scrypt N=2^16,r=8,p=1 + AES-256-GCM, KDF 파라미터를 파일에 같이 적음, Node 내장
    `crypto`만 씀). 비밀번호를 안 주면 넣지 않는다. 비밀번호는 8자 이상.
- **`createBackupZip(password?)`** — 위 넷을 뺀 `SAFE_FILENAME_RE`(`/^[\w.-]+\.(json|sqlite)$/`)
  파일을 화이트리스트 없이 전부 담는다 — "백업 = 데이터 폴더 전체"가 가장 단순하고,
  저장소가 하나 늘어도 이 함수를 안 고쳐도 된다. `manifest.json`(생성 시각, 앱 버전,
  `includesSecrets`)도 같이 넣지만 복원 대상은 아니다. 의존성은 `adm-zip`(순수 JS,
  네이티브 바인딩 없음 — `electron/CLAUDE.md`의 `asar:true`+`npmRebuild:false` 전제를
  깨지 않음) — **루트 `package.json`에도 같은 버전을 중복 선언해뒀다**(`cors`/`express`와
  같은 이유, electron-builder가 패키징 대상 결정에 루트 `package.json`의
  `dependencies`를 본다).
- **`restoreBackupZip(buf, password?)`** — **비밀번호 확인을 파일을 쓰기 전에 끝낸다**
  (`secrets.enc.json`이 있는데 비밀번호가 없거나 틀리면 `BackupPasswordError`, 아무것도
  안 바뀜). 그다음 엔트리 이름을 `SAFE_FILENAME_RE`로 재검증해(zip-slip 방어)
  `fs.writeFileSync`로 직접 덮어쓴다. 비밀 정보가 있으면 **백업이 기준이다** — 백업에
  없는 브로커 키는 지우고, 백업의 키·Google 상태를 이 PC의 키체인으로 다시 잠가
  저장하고(`setCredentialFields`, `google/store.ts`의 `replaceState`), 남아 있던 접속
  토큰 파일은 지운다(복원 전 키로 받은 것일 수 있음). 결과의 `secrets`:
  `restored` / `not-in-backup`(비밀번호 없이 만든 백업 — 지금 키를 그대로 둠) /
  `keyring-unavailable`(키링 없는 Linux라 저장 거부, `secureStorage.ts` — 지금 키도
  그대로 둠, 나머지 데이터는 복원). 예전 형식 백업(`secrets.enc.json` 없음)의
  `credentials.json`/`google-account.json`은 그대로 받는다 — 같은 PC면 열린다.
- **복원 뒤에는 앱을 다시 시작한다** — `JsonStore` 캐시는 mtime으로 저절로 무효화되지만,
  열린 `stockNames.sqlite` 핸들과 KIS/KB 토큰 메모리 캐시는 그대로라서. 패키징된 앱은
  `electron/src/main.ts`가 `startServer(..., { requestRestart })`로 넘긴
  `app.relaunch()`+`app.exit(0)`을 응답 1.5초 뒤 부른다(응답의 `restarting: true`).
  dev 실행은 넘기지 않는다 — `concurrently -k`가 Electron 종료를 보고 Vite까지 내린다.
- **`routes/backup.ts`**(`createBackupRouter`) — `POST /`(body `{password?}`, zip
  바이너리를 `Content-Disposition: attachment`로 응답 — 비밀번호를 URL에 안 남기려고
  GET이 아니다), `POST /restore`(body `{zipBase64, password?}`, 비밀번호 오류는 400 +
  `code: 'BACKUP_PASSWORD'`). **raw/multipart body 파서를 새로 안 쓰고 base64로
  감싼 평범한 JSON body로 받는다** — 이 프로젝트가 지금까지 모든 API에서 JSON
  body만 썼다는 관례를 유지하기 위해서다. 대신 `server.ts`의 `express.json()` 기본
  바디 크기 제한(100kb)을 20mb로 올렸다(안 그러면 복원 업로드가 데이터가 조금만
  쌓여도 막힘).

## 자동 로컬 백업 (`src/autoBackup.ts`, `routes/backup.ts`의 `/auto`)

2026-11-16 추가 — 예전엔 사용자가 직접 받을 때만 백업이 생겨 가져오기를 잘못하면 되돌릴 방법이 없었다.
- `startServer()`가 listen 직후 `startAutoBackupSchedule()` — 1분 뒤 + 6시간마다 "마지막 하루 백업이 20시간 넘었나" 확인 후
  `createBackupZip()`(**비밀번호 없음 → 비밀 정보 제외**)를 `auto-YYYYMMDD-HHMMSS.zip`으로. 최근 7개만(복원 직전 백업 포함).
- 위치는 데이터 폴더 **옆** `backups/`(`getBackupDir()`, 0700/파일 0600) — 데이터 폴더 안이면 다음 백업이 이전 백업을 또 담는다.
- **복원(수동 `/restore`·자동 `/auto/:name/restore`) 직전에 `-before-restore` 백업을 남긴다** — 되돌린 것을 되돌릴 수 있게.
  자동 백업 복원은 비밀 정보가 없어 `secrets: 'not-in-backup'`(지금 키 유지).
- 복원 라우트는 이름을 `AUTO_BACKUP_NAME_RE`로만 받는다(경로 조작 방지, 테스트 있음).
- ⚠ 테스트: `test/setup.ts`가 데이터 폴더를 **전용 임시 폴더 아래 `data/`**로 둔다 — 예전처럼 `os.tmpdir()` 바로 아래면
  "데이터 폴더 옆 backups/"가 시스템 임시 폴더에 생기고 테스트가 그걸 지운다(실제로 그럴 뻔했다).

## 계획·목표 값, 알림, 보고서 PDF (2026-11-17)

화면 여러 곳이 쓰는 사용자 설정을 **`db/planner.ts`(`planner.json`) 하나**에 모았다 — `GET/PUT /api/planner`(보낸 필드만 검증해 바꾼다, 틀리면 400).
월 배당 목표, 세제 혜택 계좌(ISA 유형·가입일·연도별 납입액)와 **한도 수치**, 목표 비중(리밸런싱), 알림 켜기/끄기, 관심종목 목표가. 계산은 전부 화면 `calc/*`.
- ⚠ **한도 기본값은 2025년까지 확정된 수치**(ISA 비과세 200만/400만, 납입 연 2,000만, 연금저축 600만·합산 900만). 2026 ISA 개편(500만/1,000만, 납입 4,000만)은
  국회 통과·시행을 확인할 수 없어(2026-11-17 검색 — 보도마다 다름) 기본값으로 쓰지 않고 화면에서 바꾸게 했다.
- **알림**(`alerts.ts`, `startServer`가 `startAlertSchedule()`): Electron 메인의 `Notification`(렌더러는 권한을 전부 거절하므로 화면에서 못 띄운다).
  목표가 5분(조건마다 하루 한 번, `resolveStockPrices`), 매수 유의사항 2시간(처음 실행은 기록만, `getActiveWarnings` — 토스 키 필요), 배당 입금은
  **새 배당 기록이 생길 때마다**(`dividendSyncAll.ts`의 `onDividendsAdded` — 화면의 동기화든 백그라운드든, 최근 7일 지급분만, 4건 이상이면 묶음) +
  한국 시간 9~21시에 4시간마다 백그라운드 동기화(KIS 권리현황·토스 거래내역 전체라 무겁다 — 자주 하지 않는다). 중복 방지 상태는 `alert-state.json`.
  테스트는 `setNotifier`로 가로챈다(`test/plannerAlerts.test.ts`).
- **배당 동기화 한 곳**: `dividendSyncAll.ts`의 `syncAllDividends()` — 라우트(`POST /dividends/sync`)와 알림이 같이 쓰고, 동시에 두 번 돌지 않게 진행 중인 것을 공유한다.
  동기화 전후 id를 비교해 새 기록을 낸다(같은 내용은 id를 이어받으므로).
- **보고서 PDF**(`routes/report.ts`, `POST /api/report/pdf`): 앱 창을 그대로 `webContents.printToPDF`(A4) → `dialog.showSaveDialog` → 파일. 화면의 인쇄 CSS
  (`frontend/src/styles.css` `@media print`)가 사이드바·버튼·줌을 걷어 내고 다크 모드도 밝게 바꾼다. 동시에 두 번이면 409(macOS에서 printToPDF 동시 실행이 죽은 전례).
  ⚠ CDP `Page.printToPDF`는 Electron 창에서 응답하지 않는다 — 인쇄 모양 확인은 `Emulation.setEmulatedMedia({media:'print'})` + 캡처로.
- **planner 필드 추가(같은 날 두 번째 묶음)**: `simulation`(은퇴·목표 시뮬레이션 입력 — 범위 검증), `savingsPlans`(적립식 계획 — 종목·월 금액·시작 달),
  `alerts.weeklySummary`. **주간 요약 알림**(`alerts.ts` `maybeWeeklySummary`, 30분마다 확인): 금요일 KST 18시 이후 그날 한 번(`lastWeeklySummary`) —
  문구는 순수 함수 `weeklySummaryText`(순자산 기록의 7일 전 대비, 최근 7일 배당, 다음 7일 다가오는 배당(세전), 이번 달 적립이 95% 미만인 계획 — 달러 매수는 지금 환율).
- **2026-11-17 코드·보안 점검 반영**(알림): 목표가는 `marketMaybeOpen`(국내 평일 8:50~15:40, 미국 평일 21시~다음 날 7시 KST)일 때만·한 번에 40종목,
  `alerts.hideDetails`면 종류만, OS 알림이 없을 때 콘솔엔 **종류만**(콘솔 → main.log, 로그 가리기가 종목명·작은 금액은 못 가림), 배당 알림 중복은
  `dividendNotified`(증권사|계좌|종목|지급일, 30일)로, 새 배당 판정은 id가 아니라 내용 키 + 동기화한 증권사만(`dividendSyncAll.ts`), 매수 유의사항은 토스 키가
  없으면 상태를 쓰지 않고 조회 실패 종목은 이전 기록 유지(`getActiveWarningsDetailed`), 주간 요약은 `horizonMonths: 1`(월말에 다음 달 초 예정이 빠지지 않게).
  `replaceSyncedDividends`는 **0건 응답이면 기존 기록을 지우지 않는다**(무인 백그라운드 동기화 안전장치). planner의 `taxLimits` 부분 갱신은 지금 값 기준,
  객체 필드는 평범한 객체만, 납입 연도 1990~2100·계좌당 120개.
- **12개월 예상 배당**: `GET /dividends/upcoming?months=12` — `itemsFromSnapshot`의 `until`을 1년 뒤로(확정은 원래대로 120일). 저장 일정·추정 로직은 그대로.
- **ETF 구성 펼치기**: `GET /kis/etf-lookthrough?symbols=` — 종목마다 `fetchKisEtfComponents`(상위 30, 6시간 캐시), 구성이 비면(주식) 빠진다. 60종목까지.
- **입금 기준 연환산 수익률**: 토스·NH·키움 원금 요약(`CashFlowSummary`)에 `byMonth`(월별 순입금, 원화 환산)를 더했다 — 화면 `calc/xirr.ts`.

## 새 버전 알림 (`src/updateCheck.ts`, `routes/about.ts`의 `/update`)

자동 설치는 코드 서명이 있어야 안전해서 없고, **알림만** 한다(2026-11-16). GitHub 공개 API
`repos/ultracat/MyStockInfo/releases/latest`(키 없음, 익명 시간당 60회)를 6시간 메모리 캐시로 부른다. 초안·프리릴리스·형식이 다른
태그는 무시, 링크는 이 저장소 릴리스 페이지만 받는다. 실패하면 "모름"(지난 성공 결과 유지). `settings.json`의 `updateCheck: false`로
끈다(정보 화면 체크박스, `POST /api/about/update-check`). User-Agent는 `MyStock/<버전>`뿐 — 개인정보를 보내지 않는다.
버전 비교 `isNewerVersion`은 `x.y.z` 숫자만(테스트 있음).

## 앱 정보(About) 화면 (`src/routes/about.ts`, `src/generated/appInfo.ts`, `scripts/generate-app-info.cjs`)

- 같은 라우터에 2026-11-16 추가: `GET /update`·`POST /update-check`(위 절), `POST /client-error`(화면 오류 경계가 보낸 오류를
  잘라서 `console.error` → 메인 로그 파일, electron/CLAUDE.md "로그 파일"), `POST /open-logs`(`shell.openPath(app.getPath('logs'))`).

프론트 "정보" 페이지(`frontend/src/pages/About.tsx`, 사이드바에서 "설정" 바로
아래)가 `GET /api/about`로 SW 이름/버전과 사용 중인 오픈소스 패키지 목록(이름/
버전/라이선스)을 받아 보여준다.

- **버전의 단일 소스는 루트 `version.json`**(예: `{"version": "1.2.0"}`)이다 —
  앱 버전을 올릴 땐 이 파일 하나만 고치면 된다. `npm run build`/`npm run dev`가
  둘 다 `backend` 빌드 전에 `scripts/generate-app-info.cjs`를 먼저 돌리는데
  (루트 `package.json`의 `build:backend`), 이 스크립트가 (1) `version.json`을
  읽어 루트 `package.json`의 `"version"` 필드에 동기화하고(값이 이미 같으면
  다시 안 씀 — 불필요한 git diff 방지) (2) 각 워크스페이스 `package.json`의
  `dependencies`(devDependencies 제외 — 빌드 도구는 최종 앱에 안 들어감)를
  모아 `node_modules`에 실제 설치된 버전/라이선스를 읽어 `backend/src/generated/
  appInfo.ts`(gitignored, 매 빌드마다 새로 생성)로 굽는다. **`package:mac`/
  `package:linux`/`package:win` 전부 `npm run build`를 먼저 거치므로**, 세
  플랫폼 산출물이 전부 `version.json` 값 하나로 자동 일치한다 — electron-builder
  자체는 `version.json`을 모르고 항상 루트 `package.json`의 `version`만 읽지만,
  그 필드가 이 스크립트로 이미 동기화돼 있다.
- **작성자/저작권의 단일 소스는 루트 `package.json`**이다 — `author`("이름 <이메일>"
  npm 문자열 형식)와 `build.copyright`(electron-builder가 mac 앱 정보/Windows 파일
  속성에도 쓰는 값)를 같은 스크립트가 `APP_AUTHOR`/`APP_COPYRIGHT`로 굽고,
  `GET /api/about`의 `author`/`copyright`로 내려가 정보 화면에 표시된다.
- `electron`은 devDependencies에 있지만 패키징된 앱의 실제 런타임이라 스크립트가
  별도로 목록에 끼워 넣는다. `@mystock/*`(워크스페이스 내부 참조)는 제외한다.
- **Electron/Chromium/Node 버전은 빌드 시점이 아니라 요청 시점에 `process.versions`
  에서 읽는다**(`about.ts`) — "이 실행 환경이 실제로 어떤 런타임인지"는 빌드
  시점 값이 아니라 지금 실행 중인 값이 맞기 때문. Electron 메인 프로세스 밖
  (standalone 백엔드 dev 실행)이면 `electron`/`chrome`이 없어 `null`로 내려간다.

## 검증 방식

증권사 API 관련 코드는 실제 공식 문서(토스: developers.tossinvest.com, KIS:
github.com/koreainvestment/open-trading-api)를 확인하고 필드명/엔드포인트/에러 포맷을
그대로 반영한다. 추측해서 채우지 않는다.

### 공식 명세 감시 (`backend/spec/`, `scripts/spec-watch.cjs`, 2026-11-17)

증권사 공식 저장소의 라이브러리를 그대로 쓰지 않는 이유(2026-11-17 조사): 공식 코드는 전부 **Python**(KIS 예제 모음·키움 SDK·NH SDK,
KB는 테스트 화면)이라 Electron 메인 프로세스(Node) 안에 넣으려면 Python 런타임을 같이 배포해야 하고, **키움은 라이선스가 복제·수정·배포를
금지**, KIS·KB는 라이선스 표기가 없다(MIT는 NH뿐). 토스는 공식 SDK가 없다. JS로 여러 증권사를 묶은 오픈소스 라이브러리도 없다(비공식
0.x·관리 중단뿐). 그래서 **TS로 직접 구현하고, 공식 명세를 정본으로 고정해 바뀌면 알게** 한다:
- `spec/watch.json` — 우리가 실제로 쓰는 것 목록(토스·NH operationId, 키움 TR, KIS TR → 공식 예제 파일). **새 API를 쓰기 시작하면
  여기 한 줄 + `npm run spec:update`.**
- `spec/snapshots/*.json` — 그 부분의 **구조만**(필드 이름·형식·필수, 설명문·예시 없음 — 명세 전체를 공개 저장소에 복사하지 않으려고).
  KIS는 기계가 읽을 명세가 없어 아래 "KIS API 검증 묶음"의 카탈로그에서 쓰는 TR만 뽑는다(주소·TR ID·요청 파라미터·응답 필드 이름).
- `npm run spec:check` — 최신 공식 명세와 비교, 구조가 바뀌면 종료 코드 1. `.github/workflows/spec-watch.yml`이 **매주 월요일** 돌린다
  (실패 = 소유자에게 메일, 바뀐 경로는 잡 요약). 대응: 클라이언트 확인·수정 → `npm run spec:update` → `npm run build`(타입 오류가 고칠 곳)
  → `npm test`.
- `npm run spec:types` — 스냅샷에서 `toss/tossSpec.gen.ts`·`nh/nhSpec.gen.ts`(openapi-typescript, devDependency)·
  `kiwoom/kiwoomSpec.gen.ts`(스크립트 자체 생성)를 만든다. **생성물은 직접 고치지 않는다** — CI가 다시 만들어 `git diff`로 확인한다.
  - 토스: `tossCore.ts`의 원형 타입(`RawToss*`)·`TossTransaction`·종목 정보·시세·일봉이 생성 타입 별칭이다. 생성 타입이 드러낸 것:
    `Price.usd`·`Order.price`·`Cost.tax`는 **생략될 수 있다**(`?`) — 예전 코드는 `=== null`만 봐서 필드가 빠져 오면 `toNum(undefined)`로
    던졌을 것이다(공식 예시·실측에선 아직 빠진 적 없음) → `== null`.
  - NH·키움: 위 각 절의 "타입".
- 생성 타입 `kis/kisSpec.gen.ts`는 KIS 검증 묶음이 만든다(`spec:types`·`spec:update`가 같이 부름).
- `test/fixtures/toss-spec-examples.json` — `spec:update`가 토스 명세의 **공식 응답 예시**(쓰는 operation 17개, 예시 40여 개)를 뽑아 둔다.
  `test/tossSpecExamples.test.ts`가 예시 전부를 가짜 서버로 돌려 예외 없이 숫자로 바뀌는지 본다 — 이 테스트가 **같은 커서 반복 시 거래내역
  200페이지를 다 돌던 문제**를 잡았다(지금은 같은 커서면 멈추고, 상한에 닿으면 던진다). NH·KIS 명세엔 응답 예시가 없다.

### 증권사 공통 — 실제 응답 기록·응답 변화 감지·자동 업데이트 PR (2026-11-17, 아래 KIS 묶음을 전 증권사로)

- **실제 응답 기록**: 모든 실서버 점검에 `-- --record`(`npm run check:toss|nh|kb|kiwoom -- --record`, KIS는 `kis:record`) — 성공 응답의
  **블록별 필드 이름과 값 형태만**(값·계좌번호·금액 없음, `test/responseShape.test.ts`) `spec/snapshots/<증권사>-live.json`에 남긴다
  (`scripts/lib/live-check.cjs`의 `shapeRecorder`, 줄 없던 블록은 예전 기록 유지). 블록 이름은 본문 경로: `$`(최상위 글자 값)·`output1`·
  `result.items`·`Output_1`·`dataBody.Record1`. 토스는 토큰이 하나라 **앱을 닫고**, NH는 **저장 토큰이 유효할 때**(재발급 = 계좌주 보안 알림).
  2026-11-17 기록: KIS 18·토스 16·NH 8·KB 3 API(NH·KB는 연동 계좌 0건이라 요약 블록만). 키움·LS·DB는 키가 없어 없음 — **키를 받으면 `check:<증권사> -- --record`**.
- **응답 변화 감지**(`brokers/responseShape.ts`): 각 요청 함수(`kisGet`·`tossFetch`·`nhPost`·`kiwoomPost`·`kbPost`)가 성공 응답마다
  `noteResponse(증권사, API, 본문)` → 기록(`liveFields.gen.ts`, `spec:types`가 생성)에 있던 필드가 **빠지면** 로그 파일에 한 번 경고. 키는 KIS TR·
  토스 경로 템플릿(`tossPathTemplate`)·NH 경로·키움 api-id·KB TR.
- **코드 ↔ 감시 목록**: `test/specCoverage.test.ts`가 코드가 부르는 토스 경로·NH 경로·키움 API·KIS TR·KB TR이 전부 감시 목록에 있는지 본다.
- **자동 업데이트 PR**(`.github/workflows/spec-watch.yml` + `scripts/spec-watch.cjs auto`, 매주 월 09:17 KST): 다섯 증권사 명세와 KIS 카탈로그를
  비교해 바뀌었으면 스냅샷·카탈로그·생성 타입·토스 예시를 갱신하고 빌드·테스트·`kis:verify --offline` 결과를 붙여 **`bot/spec-update` PR 하나**를
  열거나 갱신한다(같으면 조용히, 못 받으면 잡 실패 → 메일). **앱 코드는 고치지 않는다** — 읽는 필드가 사라지면 PR의 빌드가 실패한 채로 열리고 그게
  고칠 곳이다. 실행 중 앱이 필드를 추측해 바꿔 읽는 방식은 금액을 조용히 틀리게 할 수 있어 안 한다. `*-live.json`은 키가 필요해 CI가 못 만든다.
  저장소 설정 "Allow GitHub Actions to create and approve pull requests"를 2026-11-17에 켰다(기본 토큰은 읽기 그대로) — 꺼지면 브랜치만 올리고
  이슈 "증권사 명세 업데이트 대기"에 링크를 남긴다. GITHUB_TOKEN이 만든 PR엔 ci.yml이 돌지 않아 이 잡이 빌드·테스트를 직접 돌린다. 봇 커밋 작성자는
  `github-actions[bot]`(소유자 규칙과 맞추려면 squash 머지).

### KIS API 검증 묶음 (`scripts/kis-verify.cjs`, `kis/kisResponseShape.ts`, 2026-11-17)

KIS는 OpenAPI 같은 명세가 없다. 포털(apiportal) 화면의 필드 표·엑셀은 브라우저 세션이 있어야 받아져(직접 부르면 `/intro`로 되돌림)
자동화하지 않았고, 공식 저장소 MCP 폴더의 `data.csv`(MIT)는 **갱신이 몇 달씩 밀린다**(2026-07-09 이후 그대로 — 11-16 예제 수정이 안 들어감).
그래서 세 가지를 맞대어 본다:
1. **공식 예제 카탈로그** `spec/kis-catalog.json` — `npm run kis:catalog`가 공식 저장소 `examples_llm/` 전체(API 334개)를 git으로 얕게 받아
   주소·TR(실전·모의)·요청 파라미터(필수)·블록 이름·응답 필드+한글명(`chk_*.py`의 `COLUMN_MAPPING`)을 뽑는다(`scripts/lib/kis-catalog.cjs`).
   KIS가 실제로 고치는 곳이 이 예제 파일이다. 응답 필드는 output1/output2가 한 목록으로 섞여 있고 타입이 없다.
2. **실제 응답 기록** `spec/snapshots/kis-live.json` — `npm run kis:record`(= `check:kis --record`, Electron·저장된 키·조회 TR만)가 앱이 쓰는
   TR을 실제로 불러 **블록별 필드 이름과 값의 형태(number/text/empty)만** 남긴다(값·계좌번호·금액 없음, 테스트가 확인). 줄이 없던 블록
   (해외 보유 0건 등)은 예전 기록을 둔다. 점검에 없는 TR(휴장일·종목명·종목 상세·ETF·해외 권리)은 공개 종목(삼성전자·KODEX 200·AAPL)으로 부른다.
3. **생성 타입** `kis/kisSpec.gen.ts`(`npm run kis:types`) — 실측한 블록은 그 필드(필수), 실측 전 블록은 예제 목록(선택). `kisGet<T>`가 TR별로
   요청 파라미터(`KisParams<T>`, 예제 이름을 대문자로 — KIS 쿼리는 대소문자를 안 가림)와 응답 블록을 타입으로 받고, 줄 타입은 `KisRow<TR, 블록>`.
   예전 손 인터페이스(`[key: string]: unknown` — 오타가 안 잡혔다)는 전부 이 별칭이다.
- `npm run kis:verify`(`-- --offline`은 CI 매 푸시): 앱 코드가 부르는 TR(주석 뺀 코드의 따옴표 문자열) = `watch.json`의 `kis.trIds` ⊂ 카탈로그,
  최신 공식 예제와 비교(쓰는 TR의 주소·파라미터·필드), 실측↔예제 대조, 기록 나이(90일 넘으면 WARN), 생성 타입 최신 여부.
- **자동 업데이트**: 아래 "증권사 공통 — 자동 업데이트 PR"(spec-watch.yml)이 KIS 카탈로그도 같이 갱신한다.
- **앱 안 감지**: `kisGet`이 성공 응답마다 `noteKisResponse` → 기록(`KIS_LIVE_FIELDS`)에 있던 필드가 **빠졌으면** 로그 파일에 한 번 경고
  (`[kis] 응답 모양이 기록(kis-live.json)과 다릅니다 …`, 필드 이름만). 새 필드만 생긴 건 앱을 깨지 않아 경고하지 않는다.
- **처음 돌려서 찾은 것(2026-11-17)**:
  - 감시 목록에 **배당 원천 `CTRGA011R`·해외 권리 `CTRGT011R`이 빠져 있었다** → 코드와 목록이 같은지 검사로 고정.
  - 공식 예제가 틀린 필드: 국내 체결 `cnc_cfrm_qty`·`excg_id_dvsn_Cd` → 실제는 `cncl_cfrm_qty`·`excg_id_dvsn_cd`. 앱이 쓰는 `isin_name`(배당
    일정)·`mbcr_name`(투자의견)·`iscd6~10`(뉴스)은 **예제엔 없고 응답에만 있다** — 예제만으로 타입을 만들면 틀린다(실측이 정본).
  - 해외 잔고(`CTRP6504R`)·해외 기간손익(`TTTS3039R`) 줄엔 예제상 **종목명 필드가 없다** — 코드가 읽던 `prdt_name`·`ovrs_item_name`은
    없으면 종목코드로 대신 쓴다(해외 거래가 생기면 `kis:record`로 확인).
  - **재무비율 `FHKST66430300`이 HTTP 404**(같은 계열 `balance-sheet`는 응답, 예제 주소 그대로) — KIS 쪽 변경·장애로 보임. 종목 상세는 칸별
    실패를 null로 두므로 재무 칸만 빈다. `kis-live.json`에 기록이 없어 `kis:verify`가 WARN.
- KIS 연속조회도 다른 증권사와 같이: 이미 받은 `ctx_area_nk*`로 되돌아오면 멈추고, `MAX_PAGES`(200)에 닿으면 **던진다**(권리현황·실현손익·
  체결·해외 FK200) — 권리현황은 배당 기록 전체 교체의 원천이라 잘리면 안 된다.

### 자동 테스트 (`backend/test/`)

`npm test`(루트) 또는 `npm run test -w backend` — Node 내장 `node:test`를 `tsx --test`로
돌린다(별도 테스트 프레임워크 없음). 데이터를 잃거나 중복이 생기는 규칙만 골라 덮는다:
행 소유권(`loadSyncOwnership`, 배당은 `isDividendSyncOwned`), Sheets 전체 교체의 전부 취소·API 행 보존, 배당 동기화
(토스·KIS 분류, 우선주 코드, API 우선 교체·id 이어받기·멱등), 매매내역 중복
제거(가져오기 id 이어받기, 실시간 조회의 UUID 사본 제거),
`normalizeSymbol`, `SAFE_FILENAME_RE`, 백업 비밀번호 암호화·복원(비밀번호가 틀리면 아무것도
안 바뀜, 모든 브로커 접속 토큰은 zip에 안 들어감, 형식이 틀린 항목·평문 키 봉투는 건너뜀, 압축 폭탄 거절, 환율 인증키 왕복),
KIS 달러 배당은 동기화 소유가 아님, 토스 투자원금 분류(`tossCashFlows.test.ts`),
장 상태·활성 경고·월말 종가·ETF 구성종목 섹터 쪼개기(`marketInsights.test.ts`), 보안 보조: 접속 토큰 봉투 저장·평문 마이그레이션
(`secretJsonStore.test.ts`), 로그 가리기(`logRedact.test.ts`), 예전 평문 `settings.json` 환율 키 이전(`eximbankKey.test.ts`).
- ⚠ 테스트는 Electron 밖이라 `sealJson`이 **평문 봉투**(`encrypted:false`)를 만든다 — 복원 검증은 키체인 파일에 `encrypted:true`만
  받으므로, 예전 형식 백업을 흉내 낼 땐 `{ data, encrypted: true }` 모양을 직접 만든다(`backup.test.ts`).
- **CI**: `.github/workflows/ci.yml`이 푸시·PR마다 `npm run build`(타입 검사) → `npm run lint` → `npm test`(백엔드 + 프론트엔드
  `frontend/test/*.test.ts` — 화면 쪽 순수 모듈 `fx.ts`·`csv.ts`·`format.ts`·`calc/*`). 린트(`eslint.config.mjs`)는 `no-floating-promises`·
  `no-misused-promises`(조건)·`await-thenable`·React 훅 규칙만 — 결과를 일부러 안 기다릴 땐 `void`를 붙인다.
- **`test/setup.ts`를 각 테스트 파일에서 가장 먼저 import한다** — 전용 임시 폴더 아래 `data/`를 만들어
  `MYSTOCK_DATA_DIR`로 넘긴다. `getDataDir()`는 처음 불린 값을 고정하므로 다른 모듈이
  먼저 데이터 폴더를 건드리면 `backend/data/`의 실제 데이터에 쓴다.
- 브로커를 하나도 연동하지 않은 상태로 돈다 — 네트워크를 타지 않게, 종목명은
  `cacheStockName()`으로 SQLite 캐시에 미리 넣어 성공 행을 만들고 캐시에 없는 심볼로
  실패 행을 만든다.
- `tsconfig.json`의 `include`가 `src`뿐이라 테스트는 `dist`로 빌드되지 않는다(타입
  검사도 안 한다 — `tsx`는 타입을 지우기만 한다).
- **증권사 클라이언트 HTTP 흐름**(`tossClient.test.ts`·`kisClient.test.ts`·`nhClient.test.ts`): `globalThis.fetch`를
  가짜 서버로 바꿔 실키 없이 돈다 — 요청 모양(경로·헤더·쿼리/Input_0), 토큰 재사용(KIS 하루 1회·NH 보안 알림 때문에
  파일 캐시, 동시 호출은 발급 1회), 401 재발급, 429/EGW00201/IGW429 재시도, 연속조회(토스 커서·KIS tr_cont+ctx_area·
  NH 헤더 cts와 같은 cts 종료), 해외 조회 실패 격리, 응답→화면 모양 매핑, NH 모의투자 moapi 라우팅.
  - 모듈 전역 상태가 테스트 사이에 남는다(메모리 토큰, `responseCache`) — 테스트마다 앱키를 바꾸고(NH·KIS는 키 해시/
    파일로 갈림) `forceRefresh: true`로 부른다. 리미터 간격(초당 1~5건) 때문에 이 세 파일이 전체 시간의 대부분이다.
- **공식 명세 예시**: 키움(`kiwoomClient.test.ts`)·토스(`tossSpecExamples.test.ts`)는 명세의 응답 예시를 그대로 입력으로 쓴다(위 "공식 명세 감시").
  KIS 검증 묶음의 순수 부분(응답 모양에 값이 안 남는지, 기록과의 차이 경고, 예제 파일 해석)은 `kisVerification.test.ts`, 증권사 공통 응답 모양은
  `responseShape.test.ts`, 코드가 부르는 API ⊂ 감시 목록은 `specCoverage.test.ts`.
- **실서버 점검(자동 테스트 아님)** — `npm run check:nh` / `check:kis` / `check:toss` / `check:kb` / `check:kiwoom` / `check:ls` / `check:db`(`scripts/*-live-check.cjs`,
  공용 `scripts/lib/live-check.cjs`). 설정에 저장한 키로 **조회 API만** 불러 기대 필드·숫자 변환·요약 합계와 종목 합
  대조·적요 해석·배당 세전/세후를 PASS/WARN/FAIL/SKIP으로 찍는다. 계좌번호·금액·종목은 출력하지 않는다(건수·필드명·적요만).
  - Electron으로 돈다(자격증명이 safeStorage 암호화) — `app.setName('@mystock/electron')`으로 앱과 같은 userData·키체인.
  - 토큰: NH·KIS는 앱과 같은 파일 토큰을 재사용(새 발급 없음). **토스는 메모리 토큰이라 매번 새로 받아 켜진 앱의 토큰을
    끊는다** → 앱이 떠 있으면 `check:toss`는 시작하지 않는다(`-- --force`로 무시).
  - 자료가 없는 계좌는 SKIP이 정상이다(NH는 2026-11-09 기준 보유·거래 0건 — 거래가 생기면 다시 돌려 행 해석을 확인).
