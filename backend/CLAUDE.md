# backend

Express 서버. `@mystock/backend`로 `electron/`에서 직접 `import`되어 Electron 메인
프로세스 안에서 구동된다(별도 프로세스 아님). 단독 실행(`npm run dev`)도 되지만 그때는
`Electron safeStorage`를 못 써서 자격증명이 암호화 없이 저장된다 — dev/테스트 전용 폴백.

## 진입점

- `src/index.ts` — `startServer(port = 4317)`. `app.listen`의 `'error'` 이벤트를 반드시
  처리한다(안 하면 Electron이 "A JavaScript error occurred" 팝업을 띄운다).
- `src/server.ts` — `createApp()`: 라우터 등록 + 전역 4-인자 에러 미들웨어(안전망 — JSON
  에러 바디 보장).
- `src/credentials.ts` — 존재 확인은 `hasCredential()`(안 던짐), 실제 사용은
  `getCredentialFields()`(복호화, 던질 수 있음 — API 호출 직전에만).
- `src/paths.ts` — `getDataDir()`: Electron 안에서 `app.getPath('userData')/data`,
  단독 실행 시 `backend/data/`(gitignore).
- `src/jsonStore.ts` — `JsonStore<T>`: atomic write(tmp+rename) JSON 파일 저장 헬퍼.
  자격증명/배당/보유종목/매매내역/설정이 전부 이걸 쓴다.

## 브로커 어댑터 (`src/brokers/`)

- `types.ts` — `BrokerAdapter`(`isConfigured`, `listAccounts`, `getPortfolio`, 선택적
  `getExchangeRate`/`getTradeHistory`), `FetchOpts.forceRefresh`.
- `responseCache.ts` — `withCache(key, ttlMs, fetcher, opts)`: 5초(`DEFAULT_TTL_MS`) TTL +
  **in-flight promise 공유**(같은 key로 거의 동시에 온 호출은 하나만 실제 요청). React
  StrictMode의 effect 이중실행이 이 없이는 rate-limit과 무관해 보이는 에러(토스
  `account-not-found` 등)로 샐 수 있어서 생긴 장치 — 새 브로커 클라이언트도 이걸로 감싼다.
- `registry.ts` — `getAdapter`/`listAdapters`. **KB증권/삼성증권/미래에셋증권은
  등록 안 돼 있음**(어댑터를 만들 계획 자체가 없음 — CSV 전용, 아래 `knownBrokers.ts`
  참고).
- `knownBrokers.ts` — `KNOWN_BROKERS`(`{id, displayName, hasApiIntegration}[]`),
  `BROKER_IDS`. 브로커 id/표시 이름의 단일 소스 — `routes/dividends.ts`/
  `holdingsStore.ts`/`tradesStore.ts`/`settings.ts`/`accounts.ts`가 전부 여기서
  가져다 쓴다(예전엔 각 라우트가 `['toss','kis','kb']`를 따로 하드코딩했었음). 새
  브로커(API 연동이든 CSV 전용이든)를 추가할 땐 여기 한 줄만 추가하면 위 라우트들의
  검증/목록에 자동 반영된다. `hasApiIntegration: false`인 브로커는 `registry.ts`에
  없어도 되고, `GET /api/accounts`가 항상 `configured: true`로 돌려준다(자격증명
  개념이 없어서 — 프론트가 바로 선택할 수 있게).
- `credentialFields.ts` — 브로커별 자격증명 필드 명세. 설정 화면 폼이 이걸 그대로 읽어
  렌더링하므로 필드 추가 시 프론트 수정 불필요.
- `rateLimiter.ts` — `RateLimiter`(직렬 스케줄링 + `learnFromHeaders` 자가보정 +
  `penalizeUntil`), `withRateLimitRetry`.
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
전용 리미터)만 만들면 라우트/프론트는 그대로 재사용된다. **KB증권/삼성증권/
미래에셋증권은 이 넷 다 없고, 앞으로도 안 만든다**(사용자 요청 — API 연동 없이 CSV로만
데이터 관리) — `knownBrokers.ts`에 `hasApiIntegration: false`로 등록만 돼 있고, 로컬
저장소/CSV import(아래)가 이 broker id를 받아들인다. 계좌 목록 개념도 라이브 API가
아니라 로컬 저장소에 실제로 CSV로 넣어둔 `accountId`들을 모아 대신한다(프론트
`API_BROKER_IDS.includes(broker)`로 분기, `frontend/CLAUDE.md` 참고).

## 라우트 (`src/routes/`)

각 라우트는 브로커 예외를 `handleBrokerApiError`로 위임. 여러 브로커를 순회하는 목록형
엔드포인트(`GET /api/accounts`)는 브로커 하나 실패가 전체를 깨지 않도록 개별 try/catch.
`trades.ts`는 `adapter.getTradeHistory` 존재 여부를 먼저 확인해 미구현 브로커면 404.

## 로컬 저장소 + write-through 동기화

보유종목(`src/db/holdingsStore.ts`, `holdings.json`)과 매매내역(`src/db/tradesStore.ts`,
`trades.json`)은 KB증권/삼성증권/미래에셋증권처럼 API 연동이 없는 브로커의 데이터를
다루기 위해 만든 로컬 저장소다 — `dividends.ts`/`JsonStore` 패턴 그대로. `routes/holdings.ts`/`routes/trades.ts`는
실시간 조회가 성공할 때마다(브로커 무관) 이 저장소도 같이 갱신한다(write-through, 저장
실패는 try/catch로 삼켜서 라이브 응답을 막지 않음) — 그래서 API 연동 브로커도 로컬에
최신 상태가 항상 반영돼 있다. 보유종목은 `replaceSnapshot`(해당 broker+accountId의 기존
행을 통째로 교체 — "현재 상태" 스냅샷이라 히스토리가 아님)을, 매매내역은
`upsertTrades`(브로커 `id` 기준 upsert — 누적 히스토리라 반복 조회에도 중복 안 쌓임)를
쓴다. CSV 가져오기(아래)는 각각 `upsertHoldings`/`upsertFromImport`로 별도 경로를 쓴다 —
실시간 동기화(전체 교체)와 달리 사용자가 일부 종목만 넣어도 나머지가 안 사라지게.

`GET /api/holdings-store`, `GET /api/trades-store`(둘 다 `?broker=&accountId=` 필터)로
저장된 걸 조회한다 — CSV 전체 내보내기와 CSV 전용 브로커(실시간 조회가 안 되는)의 데이터
확인용.

## CSV 가져오기 (배당금/보유종목/매매내역 공통 패턴)

세 `POST .../import` 라우트(`routes/dividends.ts`, `routes/holdingsStore.ts`,
`routes/tradesStore.ts`) 모두 `{ records: [...] }`를 받아 행별로 검증하고, 실패해도
나머지는 계속 저장한 뒤 `{ added, failed: [{row, error}] }`로 응답한다(수동 작성 CSV라
오타가 흔해서, 몇백 건 중 실패한 몇 건만 골라 고칠 수 있게). CSV 파싱/직렬화 자체는
프론트(`frontend/src/csv.ts`)가 하고 백엔드는 파싱된 배열만 받는다. **세 라우트 다
`name`(종목명)을 CSV 컬럼으로 안 받는다** — 배당금/보유종목은 심볼로 자동조회하고
(`src/stockNameResolver.ts`의 `resolveStockNames`, 캐시 우선 + 토스 종목 정보 API 최대
200개 청크 — `refresh-names`가 쓰던 것과 같은 조합을 공용 함수로 뺐다), 매매내역은
`TradeRecord.name`이 원래도 선택적이고 화면이 이미 심볼로 폴백 표시해서 자동조회 자체가
불필요하다. 매매내역은 `id`도 안 받는다(브로커 고유 체결번호라 CSV 행엔 없음 — 없으면
서버가 `randomUUID()`로 발급).

**보유종목 CSV는 현재가/평가금액/손익도 자동으로 채운다** — 필수 컬럼(`broker,accountId,
symbol,quantity,averagePurchasePrice,currency`, `market`은 KR 심볼 0-패딩용으로 사실상
필수)만 채운 최소 CSV를 지원하려는 목적. `routes/holdingsStore.ts`가 `resolveStockNames`와
함께 `resolveStockPrices`(`stockNameResolver.ts`)를 호출해 `lastPrice`/`marketValue`/
`profitLossAmount`/`profitLossRate`를 계산한다(`marketValue = quantity * lastPrice`,
`profitLossAmount = marketValue - purchaseAmount`) — CSV에 이 필드들을 명시적으로 넣으면
그 값을 그대로 쓰고(override), 안 넣은 경우에만 계산한다. **현재가 조회는 토스 우선,
토스 미연동이면 한국투자증권으로 대체한다**(`kisClient.ts`의 `fetchKisDomesticPrice`,
`inquire-price` TR `FHKST01010100` — 계좌 무관 공개 시세라 CANO 불필요, 공식 예제
`examples_llm/domestic_stock/inquire_price/inquire_price.py` 확인, checked 2026-08-17).
**KIS 대체는 국내(KR) 심볼만 지원** — 해외주식 현재가는 거래소코드(EXCD, NAS/NYS 등)가
필수인데 이 앱은 그 정보를 안 받으므로(CSV엔 통화만 있고 거래소는 없음) 임의로 추측해
넣지 않는다. 이름 조회 실패는 행을 실패 처리하지만 현재가 조회 실패는 그냥 0으로 남긴다
(이름은 화면 표시에 필수, 현재가는 부가 정보). **KR 심볼은 6자리로 0-패딩한다**
(`normalizeSymbol`, `market === 'KR'`이고 숫자 1~6자리면 `padStart(6,'0')`) — CSV에
"5930"처럼 앞자리 0이 빠진 채로 들어와도 이름/현재가 자동조회가 정상 동작하게.

## 배당 기록 (`src/db/dividends.ts`)

`currency`(`KRW`|`USD`) 기준 `amount`를 그대로 저장 — 크로스 통화 환산은 안 함(프론트가
환율 가져와서 함). 월별/연도별 집계도 여기 없음 — `listDividends()`가 전체를 돌려주고
집계는 전부 프론트(Dividends.tsx) 책임.

## 종목명 자동조회 (`src/db/stockNames.ts`, `src/stockNameResolver.ts`, `src/routes/stockInfo.ts`)

토스 종목 기본 정보 조회(`GET /api/v1/stocks?symbols=`, 최대 200개 콤마 동시조회)로 자동
조회 — 계좌와 무관한 시세 참조 데이터라 브로커가 `kis`/CSV 전용인 기록에도 그대로 쓴다(토스
미연동이면 409, 프론트는 직접 입력으로 폴백). **`name`이 심볼과 같은 경우가 있다** —
한글명이 없는 종목(주로 미국 ETF)은 `name`이 티커 그대로 내려와서, `displayNameOf(info)`가
`name === symbol`(대소문자 무시)일 때만 `englishName`으로 대체한다. 조회 결과는
**SQLite**(`node:sqlite`, `stockNames.sqlite`, 심볼 하나로 키잉 — 브로커 무관)에
영구 캐시 — 이 테이블만 SQLite고 나머지는 전부 `JsonStore`다. `node:sqlite`를 쓰는 이유:
네이티브 addon이 없어야 electron-builder의 `asar: true` + `npmRebuild: false` 전제가
유지된다(`better-sqlite3`는 네이티브라 이 전제를 깬다) — 이 프로젝트가 실제 쓰는
Electron/Node 버전에서 플래그 없이 동작함을 직접 확인함.

일괄 갱신(`POST /api/dividends/refresh-names`)은 이미 저장된 기록의 이름을 전부
다시 채운다(오타 정리용) — `updateDividendNames`로 일괄 반영, 동시에 SQLite 캐시도 채운다.

## 검증 방식

증권사 API 관련 코드는 실제 공식 문서(토스: developers.tossinvest.com, KIS:
github.com/koreainvestment/open-trading-api)를 확인하고 필드명/엔드포인트/에러 포맷을
그대로 반영한다. 추측해서 채우지 않는다.
