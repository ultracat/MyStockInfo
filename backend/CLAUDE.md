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
- `registry.ts` — `getAdapter`/`listAdapters`. **삼성증권/미래에셋증권은 등록 안
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
나온다). 그래서 사용자가 실제로 갖고 있는 KB 계좌 여러 개(종합위탁/신연금저축/IRP 등,
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

**검증 상태(중요)**: 위 매핑은 공식 TR 스펙과 실제 appKey로의 인증/요청 포맷 검증까지는
마쳤지만(2026-08-17), **연결된 계좌가 그 시점에 보유종목·매매내역이 전부 0건이라 0이
아닌 실제 값으로 필드 단위 검증은 못 했다** — 특히 `is_cd`/`stnd_is_cd`(종목코드)가
다른 브로커처럼 6자리 단축코드인지 12자리 표준(ISIN)코드인지조차 확인 불가라 변환 없이
있는 그대로 저장한다. 실제 보유종목/거래가 동기화되면 반드시 화면에서 숫자가 맞는지
재확인할 것.

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

`GET /api/holdings-store`, `GET /api/trades-store`(둘 다 `?broker=&accountId=` 필터)로
저장된 걸 조회한다 — CSV 전체 내보내기와 CSV 전용 브로커(실시간 조회가 안 되는)의 데이터
확인용.

## CSV 가져오기 (배당금/보유종목/매매내역 공통 패턴)

세 `POST .../import` 라우트(`routes/dividends.ts`, `routes/holdingsStore.ts`,
`routes/tradesStore.ts`) 모두 `{ records: [...] }`를 받아 행별로 검증하고, 실패해도
나머지는 계속 저장한 뒤 `{ added, failed: [{row, error}] }`로 응답한다(수동 작성 CSV라
오타가 흔해서, 몇백 건 중 실패한 몇 건만 골라 고칠 수 있게). CSV 파싱/직렬화 자체는
프론트(`frontend/src/csv.ts`)가 하고 백엔드는 파싱된 배열만 받는다. 세 라우트 다
`name`(종목명)을 심볼로 자동조회한다(`src/stockNameResolver.ts`의 `resolveStockNames` —
아래 "종목명 자동조회" 절의 토스→KIS→KB 3단계 우선순위 참고). **배당금/보유종목은 이름
조회 실패를 행 실패로 처리**하지만(이름이 화면 표시에 필수), **매매내역은 CSV에 `name`
컬럼이 있으면 그 값을 그대로 쓰고(override), 없거나 조회에 실패해도 행을 막지 않는다**
(`routes/tradesStore.ts`) — 화면이 이미 심볼로 폴백 표시하므로, API 연동이 하나도 없는
사용자도 이름을 직접 CSV에 적어 넣으면 되게 하려는 것. 매매내역은 `id`도 안 받는다
(브로커 고유 체결번호라 CSV 행엔 없음 — 없으면 서버가 `randomUUID()`로 발급).

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

## 계좌 별칭 (`src/db/accountLabels.ts`, `src/routes/accountLabels.ts`)

`(broker, accountId) → label` 매핑을 저장하는 작은 `JsonStore`(`account-labels.json`).
CSV 전용 브로커(KB증권/삼성증권/미래에셋증권)는 한 증권사 안에 계좌가 여러 개일 수
있는데(예: KB증권의 종합위탁계좌/연금저축/IRP), 그 계좌를 구분하는 `accountId`는
holdings-store/trades-store/dividends 세 로컬 저장소에 실제로 CSV/수동 입력으로 들어온
문자열 그대로일 뿐 사람이 읽을 수 있는 이름이 아니다 — 이 저장소가 그 위에 별칭을
얹는다. `GET /api/account-labels?broker=`, `PUT /api/account-labels/:broker/:accountId`
(body `{label}`, upsert), `DELETE /api/account-labels/:broker/:accountId`.
**관리 UI는 `Settings.tsx` 한 곳에만 있다** — Dashboard.tsx/Trades.tsx/Dividends.tsx는
마운트 시 한 번 불러와 표시할 때 읽기만 한다(`frontend/CLAUDE.md` 참고).

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
이 리졸버를 호출한다 — 기존 `GET /api/market-info/:broker/exchange-rate`(브로커
지정 필수, 그 브로커 어댑터가 없거나 실패하면 그대로 에러)와 달리, 이 라우트는
둘 다 실패해도 예외를 던지지 않고 `{rate: null}`을 응답한다 — 프론트는 그걸 보고
설정에 저장된 수동 환율로 마지막 폴백한다(`manualFxRate ?? liveFxRate` 패턴,
`Dashboard.tsx`/`Trades.tsx`/`Dividends.tsx`/`Overview.tsx` 전부 동일).

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

**인증키는 사용자 입력이 아니라 앱 빌드에 미리 박아 넣는다**(`fx/eximbankConfig.ts`,
`EXIMBANK_AUTH_KEY` 상수) — Google Client ID/Secret과 같은 이유·같은 패턴이다
(`google/clientConfig.ts` 절 참고). `.gitignore`에 등록돼 커밋되지 않고,
`eximbankConfig.example.ts`가 템플릿이다. 예전엔 Settings 화면에서 사용자가 직접
입력해 평문 `settings.json`에 저장했지만(`db/settings.ts`의 `eximbankAuthKey`,
`POST /api/settings/eximbank-key` — 둘 다 이제 없음), 일반 사용자가 이 키의 존재
자체를 몰라도 되게 바꿨다.

**응답을 날짜별로 영구 캐시한다**(`fx/eximbankCache.ts`, `eximbank-cache.json`) —
이 인증키가 앱에 공유로 박힌 개인 발급 키라, 테스트 배포 후 여러 사용자가 반복
조회하면 요청량이 예상보다 커질 수 있어서 만들었다. `fetchEximbankRateForDate`가
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
- **캐시 TTL을 다른 브로커 응답(`DEFAULT_TTL_MS`, 5초)보다 훨씬 길게(`CANDLE_CACHE_TTL_MS`,
  4시간) 잡는다** — 이미 지나간 달의 종가는 다시 안 바뀌고, 오늘이 속한 달의
  봉만 장중에 계속 움직인다. 이 기능을 처음 붙였을 때 대시보드 진입 시
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

- **`clientConfig.ts`**(gitignored, `.example.ts`가 템플릿) — `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET`을 앱 빌드에 미리 박아 넣는다. **일반 사용자는 이 값을
  입력하는 UI가 아예 없다** — Settings.tsx엔 "Google 계정 연결" 버튼만 있다
  (`frontend/CLAUDE.md` 참고). Google이 "데스크톱 앱" 유형 OAuth 클라이언트를
  애초에 "완전한 기밀은 아님, PKCE로 실제 보안을 건다"는 전제로 설계해서(그래서
  이 유형은 secret이 코드에 노출돼도 공식적으로 허용됨) 가능한 방식 — 나중에
  자체 서버에서 로그인시키는 방식으로 바꿀 계획이 있어 그 전까지의 과도기 설계다.
- **`oauth.ts`** — 루프백 리디렉션 + PKCE(`crypto`로 code_verifier/code_challenge
  생성, SDK 불필요). `startConnectFlow()`가 임시 로컬 서버를 임의 포트(`listen(0)`)에
  띄우고 `shell.openExternal`로 시스템 브라우저를 연다(Electron 밖 dev 실행이면
  콘솔에 URL만 출력). 진행 상태(`idle`/`waiting`/`connected`/`error`)는 모듈
  전역 변수로 관리 — 프론트가 `GET /status`를 폴링해서 확인한다(별도 push
  메커니즘 불필요, 이 앱 전체가 폴링 기반). `getValidAccessToken()`이 만료
  임박이면 refresh_token으로 자동 갱신 — Sheets API 호출 전에 항상 이걸 거친다.
  **범위는 `spreadsheets` + `drive.readonly` + `userinfo.email` 세 개다** —
  `drive.readonly`는 오직 `sheetsApi.findSpreadsheetByName()`(아래)에서 이름으로
  기존 "MyStock" 파일을 찾는 용도로만 쓴다, 업로드/삭제/공유 등 그 외 Drive
  조작은 안 함(Google이 "restricted"로 분류하는 `drive`/`drive.file`보다 검증
  부담이 가벼운 "sensitive" 등급 유지). **이 범위는 중간에 추가돼서 그 전에 이미
  연결한 사용자의 refresh_token엔 없다** — "연결 해제" 후 재연결(재동의)해야
  Drive 검색이 실제로 동작한다, 안 그러면 `findSpreadsheetByName`이 403을 조용히
  삼키고 `null`을 반환해 기존 동작(새 파일 생성)으로 자연스럽게 넘어간다.
- **`sheetsApi.ts`** — `createSpreadsheet`/`spreadsheetExists`/`ensureTab`/
  `writeValues`/`readValues`/`findSpreadsheetByName`. 스프레드시트 생성·읽기·쓰기는
  전부 Sheets API만으로 되고(`spreadsheets.create`가 파일을 Drive 루트에 직접
  만들어줌), **`findSpreadsheetByName`만 예외적으로 Drive API v3
  (`files.list`, `name = '...' and mimeType = '...spreadsheet' and trashed = false`)를
  직접 호출한다** — Sheets API엔 "이름으로 검색" 기능이 없어서 불가피함, 조회
  전용이라 `drive.readonly` 범위로 충분하다. `writeValues`는 범위를 탭 이름만으로
  줘서(Sheets API가 이걸 "그 탭 전체"로 해석) 쓰기 전에 항상 전체를 지운다(clear)
  — 이전 내보내기보다 행이 줄었을 때 마지막 행들이 stale하게 안 남게.
- **`sheetsSync.ts`** — `ensureSpreadsheet()`가 먼저 로컬에 캐시해둔
  `spreadsheetId`를 재사용하고(`spreadsheetExists()`로 확인), 없거나 404면
  `sheetsApi.findSpreadsheetByName('MyStock')`으로 Drive에서 같은 이름의 기존
  파일을 찾아 재사용을 시도한 뒤, 그마저 없으면(진짜 최초 연결, 또는
  `drive.readonly` 동의가 없는 옛 토큰) 새로 만든다. 이 순서(캐시 → 이름 검색 →
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
  "전체 교체"다** — 시트에서 읽은 데이터로 로컬 저장소 전체를 대체하고, 시트에
  없는 기존 로컬 데이터(다른 계좌/기록 포함)는 지운다. `routes/holdingsStore.ts`/
  `tradesStore.ts`/`dividends.ts`의 `importXxxRecords(records, {fullReplace})`가
  이 옵션을 받아 `db/*.ts`의 `replaceAllHoldings`/`replaceAllTrades`/
  `replaceAllDividends`(전체 교체, CSV의 부분 병합/업서트/추가와는 다른 함수)로
  분기한다 — CSV 가져오기 쪽(`fullReplace` 생략, 기본 `false`)은 기존 동작 그대로다.
  **안전장치**: 시트에 행이 있었는데 검증에서 전부 실패했으면(예: 이름 조회 전부
  실패) 기존 로컬 데이터를 지우지 않는다(`toUpsert.length===0 && records.length>0`
  가드) — 일시적 조회 실패를 "전부 지워라"로 오인하면 안 되므로. 시트가 완전히
  비어 있으면(`records.length===0`, 아직 한 번도 내보낸 적 없는 새 스프레드시트 등)
  아예 가져오기 자체를 건너뛴다. **토스 accountId 표시 변환**: 토스만
  내부 accountId가 Toss Open API가 요구하는 `accountSeq`(예: `"1"`)라 사람이
  못 알아본다(KIS/KB/삼성은 accountId 자체가 이미 실제 계좌번호). Local DB는
  건드리지 않고(바꾸면 다음 라이브 동기화가 깨짐 — `accountSeq`가 Toss API
  호출에 그대로 필요), 시트로 내보낼 때만 `buildTossAccountNumberMap()`으로
  `accountNo`(실제 계좌번호)로 바꿔 보여주고, 가져올 때 역맵으로 다시
  `accountSeq`로 되돌린다.
- **`routes/google.ts`** — `GET /status`, `POST /connect`, `POST /disconnect`,
  `POST /sync/:dataType/export`, `POST /sync/:dataType/import`
  (`dataType`은 `holdings`|`trades`|`dividends`). Client ID/Secret을 받는
  라우트는 없다(위 `clientConfig.ts` 참고).

## 앱 정보(About) 화면 (`src/routes/about.ts`, `src/generated/appInfo.ts`, `scripts/generate-app-info.cjs`)

프론트 "정보" 페이지(`frontend/src/pages/About.tsx`, 사이드바에서 "설정" 바로
아래)가 `GET /api/about`로 SW 이름/버전과 사용 중인 오픈소스 패키지 목록(이름/
버전/라이선스)을 받아 보여준다.

- **버전의 단일 소스는 루트 `version.json`**(`{"version": "0.1.0"}`)이다 —
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
