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
Open API로 그 로컬 저장소를 채우는 동기화 버튼만 추가로 있다** — 아래 "KB증권 Open
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
탈출구) — 그래서 프론트(Settings.tsx)는 동기화 버튼을 누를 때 accountId를 다시
안 물어봐도 된다. 이미 "계좌 별칭"에 등록해둔 accountId와 같은 문자열을 쓰면 라벨이
자동으로 연결된다. 동기화 후에는 보유종목/매매내역 화면에서 다른 CSV 전용 계좌와
완전히 동일하게 보인다(별도 프론트 분기 불필요).

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
**KB증권**은 이 write-through를 화면 조회 시점이 아니라 `routes/kb.ts`의 동기화
버튼 클릭 시점에 한다는 점만 다르고(계좌 하나짜리 API라 화면마다 자동 조회할 대상이
불명확 — "KB증권 Open API" 절 참고), 쓰는 함수(`replaceSnapshot`/`upsertTrades`)는
동일하다.

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
