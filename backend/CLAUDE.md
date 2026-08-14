# backend

Express 서버. `@mystock/backend`로 `electron/`에서 직접 `import`되어 Electron 메인
프로세스 안에서 구동된다 (별도 프로세스 아님). 단독 실행(`npm run dev` 또는
`node dist/index.js`)도 가능하지만, 이 경우 `Electron safeStorage`를 못 써서 자격증명이
암호화되지 않고 저장된다 — dev/테스트 전용 폴백.

## 진입점 / 핵심 파일

- `src/index.ts` — `startServer(port = 4317)`. `app.listen`의 `'error'` 이벤트를 반드시
  처리한다 (EADDRINUSE 등) — 처리 안 하면 Node가 uncaught exception으로 취급해서
  Electron이 "A JavaScript error occurred in the main process" 팝업을 띄운다.
- `src/server.ts` — `createApp()`. 라우터 등록 + 마지막에 전역 4-인자 에러 핸들링
  미들웨어(안전망). 어떤 라우트 핸들러든 예외를 던지면 Express 기본 HTML 에러 페이지
  대신 JSON 에러 바디를 반환한다.
- `src/credentials.ts` — 자격증명 저장/조회. **`isConfigured()` 류 존재 여부 확인에는
  `hasCredential()`을 쓴다 (안 던짐). `getCredentialFields()`는 실제 복호화를 하므로
  던질 수 있고, API 호출 직전에만 써야 한다.** 이 둘을 혼동하면 목록 조회 라우트가
  복호화 실패 시 500으로 죽는 버그가 생긴다 (과거 실제로 발생).
- `src/paths.ts` — `getDataDir()`. Electron 안에서는 `app.getPath('userData')/data`,
  단독 실행 시 `backend/data/`(gitignore됨)로 폴백.
- `src/jsonStore.ts` — 파일 기반 JSON 저장 헬퍼 (자격증명, 배당 기록, 설정 공용).

## 브로커 어댑터 (`src/brokers/`)

- `types.ts` — `BrokerAdapter` 인터페이스 (`id`, `displayName`, `isConfigured()`,
  `listAccounts(opts?)`, `getPortfolio(accountId, opts?)`, 선택적 `getExchangeRate?(base, quote, opts?)`,
  선택적 `getTradeHistory?(accountId, {from, to}, opts?)` → `TradeRecord[]`)와
  공용 타입. `opts: FetchOpts`(`{ forceRefresh?: boolean }`)는 아래 `responseCache.ts` 참고.
- `responseCache.ts` — `withCache(key, ttlMs, fetcher, opts)`. 브로커 API 응답을 5초
  (`DEFAULT_TTL_MS`) 캐시한다 — toss/kis 클라이언트의 계좌/보유종목/환율 조회 함수가 모두
  이걸로 감싸져 있음. `opts.forceRefresh`를 true로 넘기면 캐시를 건너뛰고 다시 호출한다
  (프론트 새로고침 버튼 → `?refresh=true` 쿼리 → 라우트 → 어댑터 → 클라이언트로 전달됨).
  새 브로커 클라이언트를 추가할 때도 네트워크를 직접 때리는 함수는 이걸로 감싸는 게 기본.
  **같은 key로 동시에 들어온 호출은 in-flight promise를 공유한다** (TTL 캐시와 별개 —
  아직 아무것도 캐시되지 않은 상태에서 거의 동시에 두 번 호출되면 TTL 캐시는 못 막는다).
  React StrictMode가 dev에서 effect를 이중 실행하면서 같은 계좌에 대해 거의 동시에 두 번
  실제 HTTP 요청을 보내는 게 원인이었는데, 브로커에 따라 이게 rate-limit 에러가 아니라
  전혀 무관해 보이는 에러로 나타날 수 있다 — 실제로 토스 `/api/v1/holdings`가 이 경쟁
  상태의 패자 쪽에 `account-not-found`(400)를 반환한 사례가 있었다(다른 쪽 요청은 성공해서
  화면엔 데이터가 정상 표시됨 — 로그에만 에러가 남는 형태). KIS는 원래 `fetchKisBalance`에
  전용 `inFlightBalance` 변수로 이 문제를 개별 해결했었는데, 이제 `withCache`가 이걸 범용으로
  처리하므로 그 중복 코드는 제거했다.
- `registry.ts` — 브로커 ID → 어댑터 매핑 (`getAdapter`, `listAdapters`).
- `credentialFields.ts` — 브로커별 필요 자격증명 필드 명세 (`CREDENTIAL_FIELDS`). 설정
  화면 폼이 이 명세를 그대로 읽어 렌더링하므로, 필드를 추가/변경하면 프론트엔드 수정 없이
  반영된다.
- `errors.ts` — `handleBrokerApiError(err, res)`. 브로커별 API 에러 클래스(구조적으로
  `{message, status, body}` 형태)를 502로, 그 외는 500으로 통일 변환.
- `rateLimiter.ts` — `RateLimiter`(스케줄링 + 헤더 기반 자가 보정 `learnFromHeaders` + 헤더가
  없는 브로커용 `penalizeUntil`), `withRateLimitRetry`(429/Retry-After + 지수 백오프+jitter).
  브로커 공용.
- `toss/` — `tossClient.ts`(OAuth2 client_credentials, form-urlencoded). **토스 API는 금액/수량/비율
  필드를 전부 `{ type: "string", format: "decimal" }`로 반환한다** (JSON number 아님 — 공식
  OpenAPI 스펙, `openapi.tossinvest.com/openapi-docs/latest/openapi.json` 기준. float 정밀도
  손실을 피하려는 의도로 보임). `tossClient.ts`의 `Raw*` 인터페이스가 이 실제 wire shape이고,
  `toNum()`/`parsePrice()`/`parseHoldingsItem()`이 이 파일을 벗어나기 전에 실수(number)로
  변환한다 — 이 경계를 벗어난 코드는 전부 진짜 number를 받는다는 전제로 짜여 있으니, 새 토스
  필드를 추가할 때도 반드시 여기서 변환하고 넘겨야 한다. 이걸 문자열인 채로 흘려보내면 조용히
  깨진다: `Math.round()`/`*`/`Intl.NumberFormat.format()`은 숫자 문자열을 알아서 형변환해서
  "그냥 동작하는 것처럼" 보이지만, `+`는 문자열 접합을 해버린다 — Dashboard.tsx의 비중(weight)
  계산이 정확히 이 이유로 조용히 깨져 있었다. `rateLimitGroups.ts`(문서상 18개 그룹 전체 표,
  `X-RateLimit-*` 헤더로 실시간 보정), `tossAdapter.ts`. 매매내역(`fetchTossOrders`)은
  `GET /api/v1/orders?status=CLOSED`(`ORDER_HISTORY` 그룹, 이미 `rateLimitGroups.ts`에 등록돼
  있었음)를 `cursor` 페이지네이션으로 끝까지 순회한다 — `status=CLOSED`엔 체결완료 외에
  취소/거부 주문도 섞여 있어서, 어댑터가 `execution.filledQuantity > 0`인 것만 걸러
  `TradeRecord`로 매핑한다. Toss `Order` 스키마엔 종목명 필드가 없어 `TradeRecord.name`은
  항상 `null` — 프론트가 심볼로 대체 표시한다.
- `kis/` — `kisClient.ts`(`POST /oauth2/tokenP`, **JSON 바디** — 토스와 다름. 에러는
  HTTP 상태가 아니라 응답 바디의 `rt_cd`/`msg_cd`/`msg1`로 판단). 주식잔고조회(`inquire-balance`,
  `TTTC8434R`)는 KIS 공식 API 스펙 문서(엑셀, 공식 포털에서 다운로드) 기준으로 **rate-limit
  코드가 두 개**다: `EGW00201`(우리 계정 자체의 초당 유량 초과 — 재시도 시
  `kisLimiter.penalizeUntil()`로 이후 호출 페이싱도 함께 늦춘다)과 `EGW00215`(이 TR은 무거워서
  전체 고객 공용 원장 유량이 초당 120 TPS로 별도 제한됨 — 우리 페이싱과 무관하니
  penalizeUntil 없이 재시도만 한다, 문서가 명시적으로 그렇게 안내). 발급 토큰은
  `kis-token.json`(userData)에 영속화 — 메모리 캐시만 쓰면 백엔드 재시작(이 프로젝트 dev
  워크플로의 일상적인 일)마다 토큰을 재발급받다가 `EGW00133`(1일 1회 발급 원칙, 6시간 이내
  재호출은 기존 토큰 반환 — 공식 문서 기준)에 걸린다. 개인 계정 TPS는 공식 문서에 숫자로
  명시되어 있지 않지만 공식 예제(`examples_user/kis_auth.py`의 `smart_sleep`)가 실전투자
  0.05초(20건/초), 모의투자 0.5초(2건/초)로 페이싱한다 — 이 앱은 그보다 보수적인 4건/초로
  시작한다. **계좌 목록 조회 API가 없어** 사용자가 CANO/상품코드를 직접 입력해야 하고,
  실전투자 계좌만 지원(모의투자 미연동). 매매내역(`fetchKisTradeHistory`, 주식일별주문체결조회
  `/uapi/domestic-stock/v1/trading/inquire-daily-ccld`, 공식 예제
  `examples_llm/domestic_stock/inquire_daily_ccld/`, checked 2026-08-14)은 **조회기간이
  "3개월 이내"냐 "이전"이냐에 따라 TR_ID가 완전히 다르다**(`TTTC0081R` vs `CTSC9215R`,
  모의투자는 `V` 접두), 그래서 요청한 `from~to`가 그 3개월 경계를 걸치면 두 TR을 필요한
  구간만큼씩 나눠 호출해서 합친다(`fetchKisTradeHistoryUncached`). 또한 이 TR은 페이지네이션이
  필요해서(실전 최대 100건/페이지) `kisGet`에 `tr_cont` 파라미터를 추가했다 — 응답 헤더의
  `tr_cont`가 `M`/`F`면 다음 페이지가 있다는 뜻이고, 이때 응답 바디의 `ctx_area_fk100`/
  `ctx_area_nk100`을 다음 요청의 같은 필드로 그대로 돌려주면서 요청 헤더 `tr_cont`를 `N`으로
  바꿔 보낸다(기존 `inquire-balance` 호출은 페이지네이션이 필요 없어서 이 파라미터를 그냥
  생략하고 기본값 `''`을 쓴다). 라이브 API로 실측한 결과 이 TR은 `inquire-balance`보다도
  `EGW00201`(초당 거래건수 초과)에 훨씬 잘 걸린다 — 짧은 시간에 반복 호출하면 재시도(기존
  백오프 로직)로도 계속 실패할 수 있으니, 이 기능을 테스트할 땐 호출 사이 간격을 넉넉히
  둔다.

새 브로커 추가 시 이 네 파일(어댑터, registry 등록, credentialFields, 필요하면 전용
rate limiter 설정)만 만들면 라우트/프론트는 그대로 재사용된다.

## 라우트 (`src/routes/`)

각 라우트는 브로커별 예외를 잡아 `handleBrokerApiError`로 위임한다. 목록형 엔드포인트
(`GET /api/accounts`처럼 여러 브로커를 순회하는 것)는 브로커 하나가 실패해도 전체 응답이
깨지지 않도록 **개별 try/catch**로 감싼다 — 전역 에러 미들웨어에만 의존하지 않는다.

`trades.ts` (`GET /api/trades/:broker/:accountId?from=YYYY-MM-DD&to=YYYY-MM-DD`)는
어댑터의 `getTradeHistory`가 optional이라 KB증권처럼 아직 구현 안 된 브로커면 404로
명확히 응답한다(다른 라우트처럼 무조건 호출하지 않고 `adapter.getTradeHistory` 존재
여부를 먼저 확인).

## 배당 기록 (`src/db/dividends.ts`)

`DividendRecord`는 `currency`(`'KRW'|'USD'`)와 그 통화 기준 `amount`를 저장한다 — 이 모듈은
환율을 모르므로 **크로스 통화 환산을 하지 않는다**(달러 배당을 원화로 합산해 보여주는 건
프론트엔드가 Dashboard.tsx와 같은 방식으로 환율을 가져와서 함). 예전엔 `amountKrw` 하나였고
입력 시 수동으로 원화 환산해서 저장하는 방식이었는데, 그 히스토리 데이터(`dividends.json`)는
전부 `currency: "KRW"`로 마이그레이션해뒀다. 월별/연도별 집계는 여기 없다 — `listDividends()`가
전체 레코드를 그대로 돌려주고, 연도 필터링·월별 합산은 프론트(Dividends.tsx)가 다 한다
(원래는 `monthlySummary()`란 백엔드 집계 함수가 있었는데, Trades.tsx가 애초에 그런 백엔드
집계 없이 클라이언트에서 다 하는 걸 보고 통일했다 — 연도 필터 추가하면서 이 함수를 지웠다).

## 종목명 자동조회 (`src/db/stockNames.ts`, `src/routes/stockInfo.ts`)

배당 기록 추가 폼에서 종목코드만 입력하면 종목명을 사용자가 직접 안 쳐도 되게, 토스의
종목 기본 정보 조회(`GET /api/v1/stocks?symbols=`, `tossClient.ts`의 `fetchTossStockInfo`,
`STOCK` rate-limit 그룹, 콤마로 최대 200개 동시 조회)로 자동 조회한다. **이 API는 계좌와
무관한 시세 참조 데이터라**(공식 문서 확인, checked 2026-08-14) 국내(`005930`)/
미국(`AAPL`) 심볼을 한 API로 다 커버하고, 배당 기록의 브로커가 `kis`여도 그대로 쓸 수
있다(토스 연동이 안 돼 있으면 `GET /api/stock-info/:symbol`이 409로 "토스증권 연동
필요"를 응답 — 프론트는 이때 종목명 직접 입력으로 폴백한다).

한 번 조회한 심볼은 **SQLite**(`node:sqlite`의 `DatabaseSync`, `stockNames.sqlite`,
심볼 → 이름 · 브로커 무관하게 심볼 하나로 키잉)에 영구 캐시해서, 같은 심볼을 나중에 또
입력해도(다른 배당 기록이든, 재실행 후든) 두 번째부터는 토스 API를 다시 안 부른다 —
`credentials.json`/`dividends.json`과 같은 `getDataDir()` 아래 파일이라 dev에서
`backend/data/`, 패키징된 앱에서 `userData/data/`에 쌓인다. **이 테이블만 SQLite고
나머지(자격증명/배당 기록/설정)는 전부 `JsonStore`(JSON 파일)다** — 처음엔 이것도
JSON이었는데 "SQLite로 바꿔달라"는 요청을 받고 이 테이블만 바꿨다.
- **왜 `better-sqlite3`가 아니라 `node:sqlite`(Node 내장, Node 22.5+ `@experimental`)인가**:
  이 프로젝트는 네이티브(`.node`) 의존성이 하나도 없다는 전제로 electron-builder를
  `asar: true` + `npmRebuild: false`로 맞춰뒀다(electron/CLAUDE.md 참고) — `better-sqlite3`
  같은 네이티브 addon을 넣으면 그 전제가 깨져서 `@electron/rebuild`를 다시 켜야 하고
  `asarUnpack`도 추가해야 한다. `node:sqlite`는 addon이 아니라 Node/Electron 런타임에
  내장돼 있어 그런 게 전혀 필요 없다. 다만 여전히 `@experimental`이라 플래그 없이 되는지
  이 프로젝트가 실제로 쓰는 버전으로 직접 확인했다: `ELECTRON_RUN_AS_NODE=1
  ./node_modules/.bin/electron -e "require('node:sqlite')"` — Electron 43.4.0(번들 Node
  24.18.1)과 시스템 `node`(v24.17.0, backend 단독 실행 dev 폴백용) 둘 다 플래그 없이 됨.
  `@types/node`(현재 22.20.1)에도 `sqlite.d.ts`가 이미 있어 타입도 별도 설치 없이 잡힌다.
- **일괄 갱신** (`POST /api/dividends/refresh-names`) — 기존 배당 기록의 종목명을
  전부 API로 얻어온 이름으로 다시 채운다(수동 입력 당시 오타나 트레일링 스페이스 같은
  걸 정리할 때 씀 — 실제로 한 번 돌려서 31건 중 트레일링 스페이스 등으로 어긋나 있던
  이름들을 정리했다). `db/dividends.ts`의 `updateDividendNames(symbol→name 맵)`으로
  일괄 반영하고, 조회 결과는 동시에 SQLite 캐시에도 채워 넣는다. 프론트 Dividends.tsx의
  "종목명 일괄 갱신" 버튼이 이걸 호출한다.

## 검증 방식

증권사 API 관련 코드를 작성/수정할 때는 실제 공식 문서(토스: developers.tossinvest.com,
KIS: github.com/koreainvestment/open-trading-api)를 확인하고 필드명/엔드포인트/에러
포맷을 그대로 반영한다. 추측해서 채우지 않는다.
