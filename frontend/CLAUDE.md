# frontend

React + Vite 렌더러 UI (TypeScript). 라우터 라이브러리 없이 `App.tsx`가 `useState`로
페이지 상태를 직접 관리한다 — 페이지가 늘어나도 라우터를 도입하지 않는다.

## 구조

- `src/format.ts` — 공용 `Intl.NumberFormat` 인스턴스(`krw`, `usdFmt`, `formatKrw` 등).
  **렌더 바디나 행마다 호출되는 함수 안에서 `new Intl.NumberFormat(...)`을 직접 만들지
  않는다** — 로케일 데이터 조회가 있어 공짜가 아니라서, 행마다 새로 만들면 포지션
  30~50개짜리 렌더 한 번에 수백 번 생성된다(과거 `HoldingsTable.tsx`에서 실제 발생).
- `src/App.tsx` — 좌측 네비 + `page` 상태
  (`'overview'|'dashboard'|'dividends'|'trades'|'settings'`, 기본값 `'overview'`).
  새 페이지 추가 시 `Page` 타입과 `NAV_ITEMS`에 항목(아이콘 컴포넌트 포함) 추가.
  **`'overview'`(대시보드, `pages/Overview.tsx`)와 `'dashboard'`(보유 종목,
  `pages/Dashboard.tsx`) 이름이 헷갈리기 쉽다** — `Dashboard.tsx`는 이 세션
  훨씬 이전부터 있던 "보유 종목" 화면 파일명이라 그대로 두고, 나중에 추가된
  진짜 "대시보드"(전체 브로커/계좌 요약)는 이름 충돌을 피해 `Overview.tsx`로
  만들었다 — 페이지 id도 `'dashboard'`가 이미 선점돼 있어서 새 페이지는
  `'overview'`를 쓴다.
  **사이드바 접기**: `collapsed` 상태(로컬, 새로고침 시 초기화됨 — 영속화 안 함) +
  `.sidebar.collapsed` CSS(너비만 200px→56px로 줄임, `transition`으로 애니메이션).
  접힌 상태에서는 라벨(`<span>`)을 숨기고 아이콘만 남긴다(`nav-item`이 항상
  아이콘+라벨을 같이 렌더하다가, 접혔을 때만 라벨을 조건부로 뺌) — 아이콘은 외부
  라이브러리 없이 최소한의 인라인 SVG로 직접 그렸다(Feather 아이콘 스타일: grid/
  percent/repeat/sliders). 접기/펼치기 토글 버튼(`ChevronIcon`)은 사이드바 상단
  `sidebar-header`에 있고, 접힌 상태에서 `title`(hover 툴팁)로 라벨을 대신 보여준다.
  **레이아웃(`styles.css`)**: `html,body,#root`를 `height:100%`로 고정하고 `body`에
  `overflow:hidden`을 줘야 `.main`의 `overflow-y:auto`가 실제로 동작한다 — 예전엔
  `#root`가 `min-height:100vh`라 컨테이너 높이가 콘텐츠만큼 계속 늘어났고, 그래서
  `.main`이 절대 자기 안에서 스크롤 못 하고 body(문서 전체)가 스크롤돼 사이드바까지
  같이 밀려 올라갔다. `.sidebar`도 `height:100%`+`overflow:hidden`으로 뷰포트에 고정해
  스크롤에 안 따라오게 한다(메뉴가 4개뿐이라 넘칠 일도 없음).
- `src/api.ts` — 백엔드 호출 레이어. `BASE_URL`이 `electron/src/main.ts`의
  `BACKEND_PORT`와 일치해야 한다. 에러 응답은 `{error, detail?}`을 기대.
- `src/types.ts` — 백엔드 응답 타입 미러링(`brokers/types.ts`와 형태 유지). CSV 관련
  로컬 저장소 타입은 `StoredHolding`/`StoredTrade`.
- `src/brokers.ts` — `BROKER_LABELS`/`BROKER_ORDER`/`API_BROKER_IDS`/`CSV_ONLY_BROKER_IDS`.
  브로커 표시 이름/순서의 단일 소스(백엔드 `brokers/knownBrokers.ts`와 짝) —
  Dividends.tsx/Settings.tsx/Dashboard.tsx/Trades.tsx가 전부 여기서 가져다 쓴다.
  `API_BROKER_IDS`(토스/KIS만)에 없는 브로커는 CSV 전용(KB/삼성/미래에셋) — 실시간
  조회 없이 로컬 저장소로만 동작한다, 아래 "CSV 전용 브로커" 참고. `CSV_ONLY_BROKER_IDS`는
  `API_BROKER_IDS`의 여집합(`BROKER_ORDER.filter`) — Settings.tsx의 계좌 별칭 등록
  대상, Trades.tsx의 매매내역 수동 입력 대상 브로커 선택지가 이걸 쓴다(각 파일에서
  따로 필터링하지 않도록 여기 한 곳으로 뺌).
- `src/csv.ts` — RFC4180 최소 파서/직렬화(`parseCsv`/`toCsv`/`downloadCsv`, 라이브러리
  없이 직접 구현). `downloadCsv`는 UTF-8 BOM을 붙인다(없으면 엑셀/한글 스프레드시트가
  UTF-8로 안 열림). 배당금/보유종목/매매내역 세 화면이 공용으로 쓴다.
- `src/components/CollapseToggle.tsx` — 카드 헤더 우측 접기/펼치기 토글(공용, 처음엔
  Dividends.tsx 안에 있다가 Trades.tsx도 필요해져서 공용 컴포넌트로 뺌).
- `src/components/HoldingsTable.tsx`, `DividendsChart.tsx` — 표시 전용 컴포넌트.
  `DividendsChart`의 `fxRate` prop은 고정 숫자(`number|null`)뿐 아니라
  `(month: string) => number|null` 형태의 함수도 받는다 — Dividends.tsx/
  Overview.tsx 둘 다 이제 함수를 넘겨서, 막대 하나(= 한 달)마다 그 달의
  평균 환율로 환산한다(오늘 환율 하나로 전체 막대를 환산하던 예전 방식
  대신 — 아래 "배당금 월평균 환율" 절 참고). 내부에서
  `typeof fxRate === 'function' ? fxRate : () => fxRate`로 감싸서 두 형태를
  같은 코드 경로로 처리한다.
- `src/components/DonutChart.tsx` — 범용 도넛 차트(Overview.tsx의 보유종목/배당금
  비중 카드가 씀). `slices: {label,value,color}[]`만 받는다 — "어떤 데이터를
  카테고리로 접을지"는 전부 호출부 책임이고, 이 컴포넌트는 그리기만 한다. dataviz
  스킬은 파이/도넛을 기본으로는 권장하지 않지만(값이 비슷하면 구분이 어려움)
  사용자가 "원형 그래프"를 명시적으로 요청해서 그대로 쓰되, 품질 기준은 지킨다:
  카테고리 최대 6개(그 이상은 "기타"로 접어서 호출부가 넘김 — `--baseline` 회색),
  색은 검증된 categorical 팔레트(`--series-1`~`6`, `styles.css`), 조각마다 항상
  라벨을 보여주는 범례(호버에만 의존하지 않음 — 3~5번 슬롯이 대비 WARN이라 라벨이
  완화 조건이기도 함), 호버 시 해당 조각 강조 + 범례 항목 딤아웃.
- `src/components/MonthlyReturnChart.tsx` — 월별 diverging 막대(0% 기준선 위/아래로
  자람, Overview.tsx의 "매월 보유종목 투자금 대비 수익률" 카드가 씀). 카테고리 색이 아니라
  `--good`/`--critical`(status 색)을 쓴다 — 이 값 자체가 손익(좋다/나쁘다)을
  뜻해서 color-formula.md의 "series가 곧 good/bad면 status를 입는다" 규칙에 해당.
  **기준선 위/아래 영역 높이가 비대칭이다** — 값이 전부 양수(또는 음수)인 흔한
  경우, 안 쓰는 쪽 절반이 통째로 빈칸이 되던 걸(막대와 아래 월 라벨 사이가
  불필요하게 벌어짐) 고쳐서, 양수/음수 각 쪽 최대값에 비례해 위/아래 높이를
  따로 잡는다(막대 하나당 픽셀 비율은 전체 공통이라 크기 비교는 그대로 정확함).
  **툴팁이 위/아래·좌/우로 자동 뒤집힌다**(`vAlign`/`hAlign`) — 값이 큰 막대는
  꼭대기가 차트 그리기 영역 맨 위에 바싹 붙어서, 기본 배치(막대 위에 툴팁)로
  두면 카드 안내 문구나 제목과 겹쳐 잘린 것처럼 보였다(뷰포트 좌표가 아니라 이
  차트 자기 그리기 영역 안에서의 여유로 판단 — 페이지 어디에 있든 동일 기준).
  좌우도 마찬가지로, 가장자리 막대는 가운데 정렬 툴팁이 차트의
  `overflowX:auto` 스크롤 영역 밖으로 반쯤 튀어나가 잘렸던 걸, 그 경우 막대
  안쪽 모서리에 붙여서 항상 스크롤 영역 안에 들어오게 했다.
- `src/components/MonthlyInvestmentChart.tsx` — 총 투자금(파랑, `--series-1`)과 총
  수입금=평가금액(주황, `--series-2`) 두 선을 겹쳐 그리는 line chart(Overview.tsx의
  "월별 총 투자금 · 총 수입금" 카드가 씀) — 비율이 아니라 절대금액 두 계열을
  비교하는 거라 diverging 막대가 아니라 카테고리컬 색 2개짜리 line이 맞다.
  `Overview.tsx`의 `monthlyAmountRows`와 `MonthlyReturnChart`의 입력이 같은
  월별 보유수량 체크포인트에서 파생되므로 그 계산은 한 번만 하고 두 컴포넌트가
  나눠 쓴다. **투자금은 매매내역에서 재구성하지 않고 오늘 보유종목의 실제
  매입금액을 그대로 쓴다** — 처음엔 매매내역을 시간순으로 훑으며 평균원가법으로
  "그 달까지 누적 투자금"을 재구성했는데, 계좌마다 매매내역이 다 안 모여있을 수
  있어(write-through 캐시 한계) 최신 달 투자금이 상단 "총 매입금액" 통계와
  어긋날 수 있다는 문제가 있었다 — 사용자가 "매입 원가로 계산하지 말고
  보유종목을 가지고 투자금을 계산해달라"고 명시적으로 요청해서, 지금은 오늘
  기준 평단가(`avgCostKrwBySymbol` = 오늘 매입금액 ÷ 오늘 수량, 이미 신뢰할 수
  있는 값)를 고정해두고 매달 보유수량(매매내역에서 재구성하는 건 이 부분뿐)에
  곱하는 방식이다. `MonthlyReturnChart`와 툴팁 자동 뒤집힘 로직(`vAlign`/
  `hAlign`)을 그대로 공유하되, 3줄짜리 텍스트라 위쪽 여유 판단 기준값을 조금
  더 크게(40→60) 잡았다 — headroom 배수(1.1배)의 경계값이라 40 기준으론
  최고점이 카드 안내 문구와 살짝 겹치는 경우가 있었음. **평가금액(총 수입금)은
  오늘 현재가가 아니라 그 달의 실제 종가를 쓴다** — 처음엔 두 카드 다 그 달
  보유수량에 오늘 현재가를 곱했는데(그래서 그래프가 사실상 "수량 증감만
  반영된 오늘 가격 기준" 곡선이었다), 사용자가 "오늘 현재가 말고 해당 달의
  금액으로 계산할 수 있냐"고 물어서 토스 일봉 API(`GET /market-info/monthly-close-prices`,
  `backend/CLAUDE.md`의 "월별 종가 조회" 절 참고)를 새로 연동했다. `loadAll()`이
  지금 보유 중이면서 매매내역도 있는 종목만 대상으로 이 API를 한 번 호출해
  `monthlyClosePrices` state에 담고, `closePriceBySymbolMonth`(useMemo)가
  `symbol → month → {closePrice, currency}` 조회용 맵으로 바꾼다.
  `monthlyAmountRows` 계산에서 그 종목·그 달의 종가가 있으면 그걸, 없으면
  (토스 미연동, 그 달 봉을 못 찾음 등) 오늘 현재가로 그대로 대체한다 — 이
  fallback 덕에 토스 연동이 없어도 카드 자체는 예전처럼 계속 동작한다.
  **이 종가 조회는 `loadAll()`을 안 막는다** — 종목 수만큼 API를 호출해서(종목당
  1~2페이지) 콜드 캐시 기준 수 초가 걸리는데(`backend/CLAUDE.md`의 "월별 종가
  조회" 절 참고), 처음엔 `loadAll()` 안에서 그냥 `await`해서 대시보드 진입 시
  화면 전체가 몇 초간 "불러오는 중..."으로 멈추는 문제가 있었다. 지금은
  `loadMonthlyClosePrices(heldSymbols, allTrades)`를 `loadAll()`의 나머지가
  끝나고 `setLoading(false)` 되기 전에 `void`로(=await 안 하고) 호출만 해두고,
  응답이 오면 그때 `monthlyClosePrices` state만 갱신한다 — 화면은 오늘
  현재가로 즉시 뜨고, 이 두 카드만 몇 초 뒤 조용히 더 정확한 값으로 바뀐다.
  진행 중엔 두 카드 설명문 아래에 안내 문구가 붙는다(`loadingClosePrices`
  state). 새로고침을 연타해도 오래된 응답이 최신 상태를 덮어쓰지 않도록
  `monthlyCloseRequestId`(useRef 카운터)로 마지막 호출만 반영한다.
- `src/accountLabels.ts` — `(broker, accountId) → label`(백엔드 `account-labels`) 조회용
  공용 유틸. `accountLabelKey(broker, accountId)`(맵 키 조합 — accountId만으로는 브로커
  간에 우연히 겹칠 수 있어서 broker도 같이 묶는다), `formatAccountOption(account, label?)`
  (계좌 select 옵션 텍스트 — `accountType`이 있을 때만 괄호를 붙인다: CSV 전용 브로커의
  로컬 저장소 계좌는 `accountType`이 없어서, 예전엔 여기서 무조건 괄호를 붙이다가
  "123-45-678901 (undefined)"가 그대로 찍히는 버그가 있었다). Dashboard.tsx/Trades.tsx/
  Dividends.tsx가 전부 여기서 가져다 쓴다.
- `src/pages/Settings.tsx` — 브로커별 자격증명 폼. **하드코딩이 아니라 백엔드의
  `GET /api/settings/credential-fields`를 읽어 동적 렌더링** — 새 브로커/필드는
  백엔드 `credentialFields.ts`만 고치면 여기는 자동 반영됨. "API 키 등록" 폼의 브로커
  선택지는 `API_BROKER_IDS`가 아니라 **자격증명 필드가 실제로 있는 브로커**
  (`fieldSpecs[id]?.length > 0`)로 고른다 — KB증권처럼 CSV 전용이면서 자격증명은
  받는 브로커(아래 "KB증권 실시간 동기화" 참고)가 생기면서 `API_BROKER_IDS`만으로는
  "이 브로커가 자격증명 폼이 필요한가"를 못 가려서 갈라놨다. "증권사 연동 상태" 표도
  같은 기준(`fieldSpecs`)으로 "CSV 전용" vs 상태 표시를 가르고, `API_BROKER_IDS`에
  없는데 자격증명은 있는 브로커(KB)는 상태 뒤에 "(CSV 전용 + 동기화 가능)"을 덧붙인다.
  "계좌 정보" 컬럼은 `api.getCredentialInfo()`(`GET /settings/credential-info`)로
  받은, 저장된 자격증명 중 `kind === 'account'`인 필드(KIS의 계좌번호/상품코드, KB의
  계좌번호)만 보여준다 — appKey/Client ID 같은 나머지 비밀 아닌 필드는 이 표에서도
  안 보여준다(백엔드가 애초에 응답에서 뺌, `backend/CLAUDE.md`의 `credentialFields.ts`
  참고). 자격증명 저장/해제(`onSaveCredential`/`onClearCredential`)가 성공하면
  `refresh()`를 다시 불러서 이 컬럼도 같이 갱신된다.
  "계좌 별칭"
  카드는 CSV 전용 브로커의 `(broker, accountId) → label` 매핑을 관리하는 **유일한
  화면**이다(Dashboard.tsx/Trades.tsx/Dividends.tsx는 표시할 때 읽기만 함 — 편집 UI를
  세 군데에 중복해서 두지 않으려는 결정). "알려진 계좌" 목록은 이미 라벨이 붙은
  accountId와 `listHoldingsStore`/`listTradesStore`/`listDividends`에 실제로 나온
  accountId 전체의 합집합이라, 데이터가 없어도 "새 계좌 등록" 폼으로 라벨만 미리
  등록해둘 수 있고(사용자가 실제로 이렇게 씀 — 계좌부터 이름 붙이고 나중에 CSV로
  채움), 반대로 라벨이 없어도 실제 데이터가 있으면 목록에 뜬다. "KB증권 실시간
  동기화" 카드는 `status?.kb`(자격증명 저장됨)일 때만 나타난다 — KB Open API가
  계좌 하나에만 고정 바인딩돼(backend/CLAUDE.md의 "KB증권 Open API" 참고) 여러 계좌
  중 어디에 연결됐는지 API가 알려주지 않으므로, 그 계좌의 실제 accountId는 "API 키
  등록" 폼의 세 번째 필드(계좌번호)로 미리 등록해둔다(위 "계좌 별칭"에 이미
  등록해둔 값과 같은 문자열을 쓰면 라벨이 자동으로 연결됨) — 동기화 카드 자체는
  accountId를 다시 묻지 않고 그 값을 백엔드가 알아서 쓴다. `api.syncKbHoldings()`/
  `api.syncKbTrades(from, to)`(매매내역은 항상 올해 1/1~오늘로 고정, 기간 선택 UI
  없음 — 필요해지면 나중에 추가, accountId 인자는 선택적이고 보통 안 넘김)가
  `POST /api/kb/sync-holdings`/`POST /api/kb/sync-trades`를 호출해 로컬 저장소를
  채우고, 그 결과(`{synced: n, accountId}`)를 그대로 보여준다 — 동기화 후에는
  보유종목/매매내역 화면에서 다른 CSV 전용 계좌와
  완전히 동일하게 보인다(별도 프론트 분기 없음).
  "USD/KRW 환율" 카드에 한국수출입은행 Open API 인증키 입력칸이 있다
  (`eximbankKey` 상태, `api.setEximbankKey`/`POST /settings/eximbank-key`) — 토스
  환율 조회가 실패했을 때의 대체 소스(backend/CLAUDE.md의 "환율 조회" 절 참고).
  이 값도 `api.getFxRate()`가 `usdKrwRate`와 함께 평문으로 돌려준다(브로커
  자격증명처럼 암호화 안 함 — 계좌 접근 권한 없는 공개 데이터 조회 키라서).

## 공용 패턴 (여러 페이지가 공유)

이 프로젝트 화면 대부분(Dashboard/Dividends/Trades)이 아래 패턴을 반복해서 쓴다 —
페이지별 절에서는 그 패턴을 벗어나는 부분만 적는다.

- **브로커/계좌 선택 + `accountId` 동기 리셋**: 브로커 `<select>`의 `onChange`에서
  `accountId`를 **같은 커밋에 동기적으로** `null`로 리셋한다. 계좌 재조회 effect의
  비동기 본문 안에서 리셋하면, `selectedBroker`는 새 값인데 `accountId`는 이전 브로커
  것인 렌더가 한 번 존재해서, 포트폴리오/매매내역 조회 effect가 그 잘못된 조합으로
  즉시 실행된다(과거 실제로 KIS 계좌번호를 토스 accountSeq로 보내는 버그가 있었음 —
  토스는 `account-not-found`로 거부하지만 요청 자체는 그대로 나간다).
- **페이지네이션**: `pageSize`(10/20/30/전체) + `page`. `page`를 effect로 되돌리지
  않고 매 렌더 `currentPage = Math.min(page, pageCount)`로 clamp — 필터가 좁아져
  `pageCount`가 줄어도 이 값 하나로 슬라이스/표시를 다 처리한다. 필터/표시개수를 바꿀
  때만 명시적으로 `setPage(1)`. 페이지 번호 버튼은 `PAGE_GROUP_SIZE`(10) 단위로만
  그리고 그룹 양 끝에 "이전 10개"/"다음 10개" 버튼으로 그룹 자체를 점프시킨다.
- **환율 처리**: `manualFxRate`(설정에서 직접 입력) > `liveFxRate`(실시간 조회)를
  `effectiveFxRate`로 합친다. 환율을 못 가져오면 "환율 미적용"으로 표시하고 합산을
  생략한다(조용히 틀린 숫자를 보여주지 않기 위함). `liveFxRate`는 `api.getUsdKrwRate()`
  (`Dashboard.tsx`/`Trades.tsx`/`Dividends.tsx`/`Overview.tsx` 네 곳 전부 동일 호출) —
  브로커를 지정하는 `api.getExchangeRate('toss', ...)`를 예전엔 하드코딩해서 호출하고
  실패를 `try/catch`로 삼켰는데, 지금은 백엔드가 토스→한국수출입은행 순으로 대체
  조회를 해주는 브로커 무관 엔드포인트로 바뀌면서(backend/CLAUDE.md의 "환율 조회"
  절 참고) 프론트 쪽 `try/catch`가 필요 없어졌다 — 이 엔드포인트는 완전히 실패해도
  예외를 안 던지고 `{rate: null}`을 주므로, `.catch(() => ({rate: null}))`로 방어한
  뒤 `live.rate`만 확인하면 된다.
- **CSV 내보내기/가져오기**(배당금/보유종목/매매내역 공통): 컬럼 헤더는 백엔드 필드명
  그대로 써서 내보낸 파일을 그대로 다시 가져올 수 있게 한다(헤더 이름으로 컬럼을
  찾으므로 순서가 바뀐 파일도 읽음). **`name`(종목명)은 어느 CSV에도 없다** — 배당금/
  보유종목은 백엔드가 심볼로 자동조회하고, 매매내역은 애초에 표시가 심볼 폴백이라
  자동조회 자체가 불필요. 가져오기는 백엔드에 그대로 배열로 보내고, 백엔드가 행별로
  검증해 `{ added, failed: [{row, error}] }`를 돌려주면 그 메시지를 그대로 보여준다
  (실패 행이 있어도 나머지는 저장됨 — backend/CLAUDE.md의 "CSV 가져오기" 참고).
- **CSV 전용 브로커 분기**(Dashboard.tsx/Trades.tsx): 브로커/계좌 관련 effect마다
  `API_BROKER_IDS.includes(selectedBroker)`로 갈라진다 — API 브로커는 기존 라이브
  조회(`api.listAccounts`/`getPortfolio`/`getTradeHistory`) 그대로, CSV 전용은 계좌
  목록을 `api.listHoldingsStore({broker})`/`listTradesStore({broker})` 결과의 고유
  `accountId`로 대신하고(별도 백엔드 엔드포인트 없음), 포트폴리오/매매내역도 로컬
  저장소 조회 결과를 화면이 원래 쓰는 모양(`PortfolioOverview`/`TradeRecord[]`)으로
  그 자리에서 바꿔 넣는다 — 그 아래 렌더링(스탯 타일/표/차트)은 API 브로커와 완전히
  동일하게 재사용된다. **브로커를 바꾸는 effect는 항상 이전 브로커의 데이터부터
  지운다**(`setPortfolio(null)`/`setTrades([])`) — 새 브로커의 계좌가 0개면(CSV
  전용인데 아직 아무 것도 안 넣은 경우) 그 아래 조회 effect 자체가 `accountId===null`
  이라 안 도는데, 이 reset이 없으면 이전 브로커의 데이터가 화면에 그대로 남는다(실제로
  Trades.tsx에서 한 번 발생해서 고침 — Dashboard.tsx는 원래도 이 reset이 있어서
  안 겪었음). CSV 가져오기가 성공하면 지금 보고 있는 브로커가 CSV 전용일 때 계좌
  목록/데이터를 재조회해서 브로커 재선택 없이 바로 반영한다.

## 페이지

- `src/pages/Overview.tsx` — 대시보드(기본 랜딩 페이지). 다른 화면은 전부 브로커/
  계좌 하나를 골라 파고드는 화면인데, 이 화면만 유일하게 **모든 브로커·모든 계좌를
  합쳐서** 보여준다 — 카드 4개: 1) 전체 계좌 보유종목 비중(도넛, 종목별 평가금액
  상위 5 + 기타), 2) 선택 연도 월별 배당금(막대, `DividendsChart` 재사용), 3) 같은
  연도 배당금 비중(도넛, 종목별), 4) 매월 보유종목 투자금 대비 수익률(diverging
  막대, `MonthlyReturnChart`). 데이터는 마운트 시 한 번만 불러온다(자동 새로고침 없음,
  수동 "새로고침" 버튼만) — 브로커마다 계좌 목록 조회 + 계좌마다 보유종목 조회를
  전부 병렬로 하는 호출량이 다른 화면보다 훨씬 많아서(Dashboard.tsx의 "전체 계좌"
  모드를 브로커 여러 개로 넓힌 것), 1분 간격 폴링까지 얹으면 과함. API 브로커는
  `listAccounts`→`getPortfolio`(계좌별), CSV 전용 브로커는 `listHoldingsStore
  ({broker})`로 모아서 하나의 `FlatHolding[]`으로 정규화한다. 배당금/매매내역은
  이미 전체를 한 번에 주는 기존 엔드포인트(`listDividends`/`listTradesStore`)를
  그대로 쓴다 — 새 백엔드 라우트가 필요 없었다(순수 클라이언트 집계). 2)/3)
  카드의 달러 배당금은 `toKrw`(오늘/수동 환율)가 아니라 `dividendFxRateFor`
  (그 배당금 지급월의 평균 환율, `backend/CLAUDE.md`의 "배당금 월평균 환율"
  절 참고)로 환산한다 — `loadAll()`이 `loadMonthlyAvgFxRates(divs)`를
  `void`로(=await 안 하고) 호출해 두고, 응답이 오기 전까진
  `dividendFxRateFor`가 `effectiveFxRate`로 자동 대체하므로 화면 자체는
  느려지지 않는다(아래 종가 조회와 같은 비동기 분리 패턴).
  **"매월 보유종목 투자금 대비 수익률"의 의미**: "평균 구입금액 대비 현재가"는
  종목당 스냅샷 하나뿐이라 그 자체로는 월별 축이 없다 — 처음엔 매수 시점(월)별로
  "코호트"를 나눠 그 달 매수분만 따로 보여주는 방식으로 만들었다가(격리형), "매월
  누적으로 보여달라"는 피드백을 받고 **누적형**으로 바꿨다: 지금 보유 중인 종목만
  대상으로, 그 종목의 매매내역을 시간순으로 훑어 "그 달 말 기준 누적 수량/누적
  투자금(매입원가)" 체크포인트를 종목별로 만든다(매도는 평균원가법으로 투자금에서
  그만큼 빼고 수량도 줄임 — 평균매입가 계산과 같은 방식). 거래가 없던 달은 직전
  상태를 그대로 이어간다(forward-fill). 그 뒤 월별로 전 종목의 누적 투자금/오늘
  현재가 기준 평가금액을 합산해 수익률을 낸다 — "지금까지 얼마를 넣었고 그게 지금
  얼마가 됐는지"가 매월 어떻게 바뀌어왔는지 보여주는 게 목적. 전량 매도한 종목은
  "지금 보유 중"이 아니라서 아예 대상에서 빠진다 — 이 한계를 카드 설명 문구에
  그대로 적어뒀다. 매매내역이 로컬 저장소(`trades-store`) 기준이라 한 번도
  조회/동기화/가져오기를 안 한 계좌의 과거 매수는 안 잡힐 수 있다(다른 화면의
  "전체" 모드와 같은 한계).
  **환율 처리**는 다른 화면들과 같은 패턴(`toKrw(amount, currency)` — KRW 1:1,
  USD는 `effectiveFxRate` 있을 때만 곱하고 없으면 `null` 반환해 그 항목을 집계에서
  뺀 뒤 배너로 안내).
- `src/pages/Dashboard.tsx` — 보유 종목. 브로커 선택 → 계좌/환율 조회 → 포트폴리오
  조회, 3단계 `useEffect` 체인(환율은 토스일 때만). 네 스탯 타일(`AmountTile`/
  `RateTile`)은 달러 보유분이 있으면(`hasUsdHoldings`) 원화/달러/합계(환산) 3줄,
  없으면 한 줄만 보여준다 — **굵은 글씨는 항상 합계(환산) 한 줄에만** 쓴다.
  `hasUsd` 판단은 개별 타일 값이 아니라 포트폴리오 전체의 달러 투자금 여부로 넘겨서,
  손익금액이 우연히 0이어도 3줄 구조가 안 깨지게 한다. `RateTile`의 합계 손익률은
  브로커가 주는 단일 `profitLossRate`를 안 쓰고 `AmountTile`과 같은 `effectiveFxRate`로
  직접 계산한다(같은 환율 가정을 써야 화면 숫자들이 안 어긋남).
  **1분 자동 새로고침**: 초기 조회 + `setInterval(60_000)`을 한 effect에서 관리
  (`fetchPortfolio` 함수를 초기 호출과 인터벌이 공유). 보유종목 조회는 초당 4~5건
  한도라(backend/CLAUDE.md) 분당 한 번은 여유가 크다. **수동 새로고침 버튼**은 이제
  진짜로 `forceRefresh: true`를 보내되(예전엔 StrictMode 이중요청이 KIS 레이트리밋을
  건드린 전례 때문에 항상 5초 캐시를 타게 해뒀었음), `lastFetchedAt` 기준
  `MANUAL_REFRESH_COOLDOWN_MS`(10초) 이내 재클릭은 실제 호출 없이 "N초 후 다시
  시도해주세요" 메시지만 보여준다 — 자동 갱신이 방금 라이브 호출을 했어도
  `lastFetchedAt`을 같이 갱신하므로 직후 수동 클릭도 이 쿨다운을 탄다.
  **CSV 내보내기**는 현재 화면의 브로커/계좌 하나가 아니라 `GET /api/holdings-store`
  전체(모든 브로커/계좌)를 대상으로 한다 — 컬럼에 `accountId`가 있어서 대상을 고르는
  UI가 따로 필요 없다(배당금과 다른 점: 배당금은 계좌 개념이 없어 목록 필터를 그대로
  내보내기 범위로 재사용했지만, 보유종목은 행 자체에 이미 범위 정보가 있음).
  CSV 전용 브로커는 `buildPortfolioFromStored()`가 로컬 저장소 행을 통화별로 합산해
  `PortfolioOverview`를 그 자리에서 만든다(위 "CSV 전용 브로커 분기" 참고) — 1분
  자동갱신/새로고침 버튼은 라이브 소스가 없어서 안 돈다(새로고침 버튼 자체를 안
  보여줌). 저장된 데이터가 하나도 없으면(막 추가된 CSV 전용 브로커) 예전엔
  `if (!portfolio) return null`이라 헤더의 CSV 가져오기 버튼까지 같이 사라져서
  가져오기를 할 방법이 없어졌었다 — 지금은 `portfolio`가 없어도 헤더/선택
  드롭다운은 항상 그리고, 그 아래(스탯 타일/표)만 `portfolio &&`로 조건부 렌더링한다.
  **CSV 가져오기는 덮어쓰기다**: 가져온 CSV에 등장한 (broker,accountId)마다 그 계좌의
  기존 저장 행을 전부 지우고 CSV 내용으로 교체한다(백엔드
  `replaceHoldingsFromImport`, backend/CLAUDE.md의 "CSV 가져오기" 절 참고) — 같은
  CSV를 다시 가져와도 행이 계속 누적되지 않는다. **선택 컬럼 `memo`**: IRP 계좌처럼
  같은 종목을 "개인납입액"/"회사납입액"으로 나눠 관리하는 경우를 위한 것 — 덮어쓰기
  방식이라 CSV에 같은 심볼이 여러 번 나와도 그대로 각각 별도 행이 되고, memo는 화면
  구분 표시 용도일 뿐 행 식별에는 안 쓰인다. `HoldingsTable.tsx`가 종목명 옆에
  `· {memo}`로 표시하고, 표의 React `key`도 더 이상 `r.symbol` 단독이 아니라
  `` `${symbol}:${memo ?? ''}:${idx}` ``다 — 심볼만 쓰면 중복 심볼 행에서 key 충돌이 난다.
  **"전체 계좌" 모드**: 계좌 select에 개별 계좌들과 나란히 특수값 `ALL_ACCOUNTS`
  (`'__ALL_ACCOUNTS__'`)를 추가해서, KB증권처럼 한 브로커에 계좌가 여러 개일 때
  전부 합쳐서 한 화면에 볼 수 있게 한다 — 개별 계좌 선택 UI/동작은 그대로 두고
  옵션만 하나 추가한 것(기본 선택은 여전히 첫 번째 개별 계좌). 데이터 소스는
  브로커 종류에 따라 갈린다: CSV 전용 브로커는 `loadStoredPortfolioAll`이
  `listHoldingsStore({broker})`(계좌 필터 없이 전체)를 한 번에 받아 계좌별로 묶은
  뒤 `buildPortfolioFromStored`로 각각 만들고, API 브로커는 `loadLivePortfolioAll`이
  계좌마다 `api.getPortfolio`를 병렬로 호출한다(계좌 수가 몇 개뿐이라 레이트리밋
  걱정 없음). 두 경우 다 `mergePortfolios`(금액/손익을 통화별로 합산하고 포지션을
  이어붙이며 각 포지션에 `accountId`를 남김)로 합친다. 1분 자동 새로고침/수동
  새로고침 버튼(API 브로커)과 CSV 가져오기 후 재조회(CSV 전용 브로커) 둘 다
  `accountId === ALL_ACCOUNTS` 분기를 타도록 갈라둬야 한다 — 하나라도 빠뜨리면
  "전체 계좌"로 보고 있다가 갱신 시점에 조용히 첫 번째 개별 계좌로 되돌아간다.
  `rows` useMemo가 각 포지션의 `accountId`로 `accountLabel`(`formatAccountOption`)을
  계산해 `HoldingsTable`에 넘기고, `HoldingsTable`은 `accountLabel`이 있는 행이
  하나라도 있으면 "계좌" 열을 보여준다(개별 계좌 모드에선 이 필드가 없어서 열 자체가
  안 생김 — Trades.tsx의 `isAllMode` 전용 컬럼과 같은 패턴이지만 여긴 별도 상태
  플래그 없이 데이터 유무로 판단).
- `src/pages/Dividends.tsx` — 배당 기록 수동 입력/조회(두 브로커 다 개인 배당 지급
  내역 API가 없음 — 안내 문구 유지). `currency`(KRW/USD) 기준 `amount`를 원본 통화
  그대로 저장(backend/CLAUDE.md 참고). `accountId`(선택, `string | null`)로 한 증권사
  안의 여러 계좌를 구분할 수 있다 — "배당 기록 추가" 폼의 "계좌 (선택)" 입력칸(브로커
  종류와 무관하게 항상 노출 — CSV 전용 브로커뿐 아니라 토스/KIS도 계좌가 여러 개일 수
  있으므로), 인라인 수정 행, 목록의 "계좌" 컬럼(라벨이 있으면 라벨, 없으면 accountId
  원문, 둘 다 없으면 `-` — 라벨 조회는 `accountLabels.ts` 참고), CSV
  헤더(`DIVIDEND_CSV_HEADER`)의 선택 컬럼까지 전부 이 필드로 연결된다. **계좌
  필터(별도 드롭다운)는 의도적으로 안 만들었다** — 목록에 계좌 컬럼이 보이는 것만으로
  "구분 가능"이라는 요청은 충족된다고 판단, 필요해지면 추가 요청으로 처리. "증권사별 배당금 총계" 표는 달러 투자금/배당금이
  있으면 원화/달러/합계(환산) 3행(별도 "구분" 컬럼 없이 첫 컬럼 안에 들여쓴 라벨로
  표현). **"합계(환산)" 행의 배당금은 투자금과 환산 방식이 다르다** —
  투자금(매입원가)은 지금 이 순간의 값이라 `effectiveFxRate`(오늘/수동 환율)
  하나로 환산하지만, 배당금은 `brokerDividendKrwByBroker`(useMemo)가 기록 하나
  하나를 그 기록의 지급월 평균 환율로 먼저 환산한 뒤 브로커별로 더한 값이다
  (브로커 합계를 낸 뒤 환율 하나로 한꺼번에 곱하면 서로 다른 달의 환율을 반영할
  수 없어서 — 사용자 요청으로 추가, `backend/CLAUDE.md`의 "배당금 월평균 환율"
  절 참고). `grandTotal`(총합계 스탯 타일)도 같은 맵을 그대로 합산해서 쓴다.
  "환율 미적용" 표시도 투자금 쪽(`effectiveFxRate` 유무)과 배당금 쪽(레코드별
  변환 성공 여부, `unconvertedUsd`)을 따로 판단한다 — 둘 중 하나만 환산이
  안 됐는데 나머지까지 같이 숨기지 않기 위함. 투자금(`totalPurchaseAmountKrw`/`Usd`)은 배당 DB에 없어 마운트 시 브로커별로
  따로 조회해 합산한다(브로커 하나 실패해도 나머지는 보여야 하므로 개별 try/catch) —
  **연도 필터를 안 탄다**(지금 시점의 실제 투자 원금이라 연도별로 안 나뉨). API
  브로커(`API_BROKER_IDS`)는 `listAccounts`→`getPortfolio`로, **CSV 전용 브로커는
  라이브 API가 없어 그 대신 `api.listHoldingsStore({broker})`로 로컬 저장소(CSV로
  가져온 실제 보유종목)를 읽어 `purchaseAmount`를 통화별로 합산한다**(Dashboard.tsx의
  `buildPortfolioFromStored`와 같은 집계 방식) — 한 번은 이 분기를 통째로 빼먹고 CSV
  전용 브로커를 조회 자체에서 걸러버려서 투자금이 항상 "-"로만 뜨는 버그가 있었다
  (라이브 API 소스가 없다는 것과 "그래서 투자금을 아예 안 보여준다"는 건 다른
  얘기 — 로컬에 진짜 데이터가 있으면 그걸 보여줘야 함). 연도 필터(`year`)는 서버에
  다시 안 묻고 클라이언트에서 걸러 월별/증권사별 집계·목록까지 전부 다시 계산한다.
  그래프 전용 증권사 필터
  (`chartBroker`)와 목록 전용 필터(`listBroker`)는 완전히 독립된 state — 후자가
  페이지네이션 대상(`listFilteredRecords`)의 기준이다. "월별 배당금"+"증권사별 배당금
  총계"는 카드 하나를 공유하며 `CollapseToggle` 하나로 같이 접힌다. 종목코드 입력 후
  500ms 디바운스로 `api.getStockInfo`를 불러 종목명을 자동으로 채운다(실패/사용자
  선택 시 "직접 입력"으로 폴백, 그 이후엔 자동조회가 name을 안 덮어씀). "종목명 일괄
  갱신" 버튼은 이미 저장된 기록의 이름을 다시 채운다(`POST
  /api/dividends/refresh-names`) — 기록 자체엔 여전히 `name`을 그 당시 스냅샷으로
  저장한다(정규화해서 항상 조인하는 방식으로 안 바꿈 — 나중에 종목명이 바뀌어도 과거
  기록엔 그 당시 이름이 남는 게 맞다고 판단). **CSV 내보내기**는 `listBroker`(목록
  필터)를 그대로 범위로 쓰고, **가져오기**는 화면 표시 범위와 무관한 별도
  `importBroker` state로 대상을 고른다(옵션은 `BROKER_ORDER` 전체 — 아직 기록이 없는
  증권사의 첫 데이터를 넣는 경우가 있어서). 목록의 각 행은 **인라인 수정**이 된다
  (`editingId`/`editDraft` — 한 번에 한 행만, 다른 행 "수정"을 누르면 저장 안 한
  편집은 그냥 버려짐, 개인용 기록 관리라 별도 경고는 안 둠). "수정" 클릭 시 그 행의
  셀들이 입력 필드(날짜/증권사 select/종목코드/종목명/통화+배당금/메모)로 바뀌고
  "저장"/"취소" 버튼이 대신 뜬다 — `PUT /api/dividends/:id`(백엔드 `updateDividend`,
  단건 추가와 같은 검증) 호출 후 `refresh()`. 종목명은 자동조회를 다시 안 돌리고
  직접 입력한 값을 그대로 쓴다(추가 폼과 달리 디바운스 조회를 안 둠 — 이미 있는
  값을 고치는 상황이라 자동조회가 오히려 방해가 될 수 있어서).
- `src/pages/Trades.tsx` — 매매내역. 위쪽 증권사 `<select>`는 개별 브로커 외에
  **"전체"**(`BrokerSelection = 'ALL' | BrokerId`)도 고를 수 있다 — "전체"는 계좌
  개념이 없다(여러 브로커/계좌를 한 화면에 합쳐서 봄, 계좌 select 자체가 숨겨짐).
  개별 브로커를 고르면 기존과 동일하게 연도 `<select>`(최근 5개년)로
  `[YYYY-01-01, YYYY-12-31]`(올해면 오늘까지) 범위를 **연 단위로 한 번만**
  라이브/로컬 조회해 `trades`에 담고, "전체"를 고르면 `GET /trades-store`(필터
  없이, 모든 브로커/계좌)로 받아온 로컬 저장소 전체(`allTrades`, 마운트 시 이미
  받아둠)를 그대로 쓴다 — 어느 쪽이든 `periodTrades`(연도로 좁힌 것)/
  `visibleTrades`(연간이면 `periodTrades` 그대로, 월간이면 그 달만 추가로 좁힘)로
  정규화해 차트(`chartRows`)/스탯 타일(`totals`)/**하단 매매내역 목록** 셋 다 같은
  데이터를 쓴다 — **목록은 더 이상 별도 증권사 필터가 없고 위쪽 select를 그대로
  따라간다**(예전엔 Dividends.tsx의 `chartBroker`/`listBroker`처럼 목록 전용
  필터를 독립시켰다가, 위쪽 select 하나로 차트·목록이 같이 움직이는 게 더
  직관적이라는 피드백을 받고 되돌림). "전체" 모드는 write-through 캐시 기반이라
  API 브로커(토스/KIS)는 실제로 한 번 라이브 조회한 적 있는 연도만 나타난다
  ("CSV 내보내기 (전체)"가 이미 같은 전제로 동작함) — 완전성보다 "여러 증권사를
  한 표에서 훑어보고 CSV 전용 계좌는 바로 고칠 수 있게" 하는 게 목적이라 허용
  가능한 트레이드오프. `chartRows`가 연간 보기에서 `periodTrades`(연도로 이미
  좁힌 것)를 쓰는 게 중요한데, CSV 전용 브로커는 계좌 전체 히스토리를 한 번에
  받아와 `trades`가 여러 해를 걸쳐 있을 수 있어서 연도 필터 없이 월별로만
  묶으면 서로 다른 해의 같은 달이 합산되는 버그가 있었다(전체 모드를 만들며
  같이 고침). 상단 스탯 타일은 `effectiveFxRate`로 환산한 단일 숫자를 보여주지만
  **그래프는 원화·달러를 합치지 않고 따로 보여준다**(`TradesChart.tsx` 참고).
  "월별 매수/매도" 그래프 카드도 `CollapseToggle`로 접힌다.

  개별 브로커 모드와 "전체" 모드는 목록 행의 모양이 다르다(개별 모드의
  `TradeRecord`엔 broker/accountId가 없고, "전체" 모드의 `StoredTrade`엔 있음) —
  렌더링/수정/삭제 로직을 하나로 합치려고 둘 다 `DisplayTrade`(broker/accountId/
  id/name 포함)로 정규화한다(`displayTrades`). 개별 모드는 위쪽에서 이미 아는
  `selectedBroker`/`accountId`를 채워 넣고, "전체" 모드는 행 자체의 값을 그대로
  쓴다. 표의 증권사/계좌 컬럼은 `isAllMode`일 때만 보여준다(개별 모드는 이미
  위쪽 select로 보이므로 매 행 반복이 불필요) — "종목" 컬럼은 `name`이 있으면
  이름+심볼을, 없으면 심볼만 보여준다. **`name`은 이제 거의 항상 채워진다** —
  `StoredTrade`도 `HoldingPosition`의 `memo`처럼 `name` 필드를 갖고, 백엔드가
  실시간 조회/KB 동기화/CSV 가져오기 세 경로 전부에서 토스→KIS→KB 순으로 자동
  조회해 채운다(backend/CLAUDE.md의 "매매내역 종목명" 절 참고) — 프론트는 그냥
  받은 값을 표시만 하면 된다. `mapStoredTrade`(개별 CSV 전용 브로커 모드)가
  예전엔 `name: null`을 하드코딩했었는데 지금은 `t.name`을 그대로 넘긴다.
  **`displayTrades`의 "전체" 모드 분기에도 똑같은 하드코딩이 하나 더 있었다** —
  `mapStoredTrade`만 고치고 이건 놓쳤다가, "KB/KIS 매매내역에 종목명이 안 보인다"는
  버그 리포트로 뒤늦게 발견해서 `{ ...t, name: null }`를 지우고 `StoredTrade`를
  그대로 `DisplayTrade`로 썼다(두 타입이 필드 구성이 완전히 같아서 캐스팅만 하면
  됨) — 같은 필드를 두 곳에서 따로 하드코딩해뒀던 게 원인이라, 비슷한 필드를 여러
  분기에서 다루는 코드는 값이 실제로 갱신되는지 각 분기를 다 확인해야 한다는
  교훈.

  **CSV 내보내기**는 Dashboard.tsx와 같은 이유로 `GET /api/trades-store` 전체를
  대상으로 하고, **가져오기**도 대상 선택 없이 CSV 행 자체의 `broker`/`accountId`를
  그대로 쓴다. `TRADES_CSV_HEADER`에 선택 컬럼 `name`이 있다 — 비우면 백엔드가
  자동조회하고, 채우면 그 값을 그대로 쓴다(API 연동이 전혀 없을 때의 유일한 채움
  경로). **"매매내역 추가"**(수동 입력) 폼은 `CSV_ONLY_BROKER_IDS`만 증권사
  선택지로 준다(Dividends.tsx의 배당 기록 추가 폼과 다른 점 — 토스/KIS는 실시간
  API로 실제 체결 내역이 write-through 동기화되므로, 그 위에 수동 입력을 섞으면
  어느 쪽이 진짜 체결 내역인지 알 수 없어진다) — 별도 백엔드 라우트 없이 기존 CSV
  가져오기 엔드포인트(`POST /trades-store/import`)를 행 1개짜리 배열로 호출한다
  (`id`를 안 주면 서버가 새로 발급). 폼에도 "종목명 (선택)" 입력칸이 있고(비우면
  자동조회), 인라인 수정 행도 종목코드 입력 바로 아래에 같은 칸을 하나 더
  둔다(별도 테이블 컬럼을 안 늘리려고 한 `<td>` 안에 세로로 쌓음).

  **"종목명 일괄 갱신" 버튼**(`onRefreshNames`, `POST /trades-store/refresh-names`) —
  Dividends.tsx의 "종목명 일괄 갱신"과 같은 자리(헤더 버튼 그룹)에 있는 같은 패턴
  버튼. `name`이 생기기 전에 저장된 행이나 그때는 API 연동이 없어서 못 채웠던
  로컬 저장소 행을 나중에 한 번에 채워 넣는 용도(backend/CLAUDE.md의 "매매내역
  종목명" 절 참고) — CSV 다시 가져오기나 KB 재동기화 없이도 기존 행을 고칠 수
  있다. 성공하면 `refreshAllTrades()`로 "전체" 모드 데이터를 다시 받고, 지금 보고
  있는 화면이 CSV 전용 브로커의 개별 계좌 모드면 그 목록도 같이 다시 읽는다(API
  브로커 개별 모드는 다음 실시간 조회 때 이미 자동으로 채워지므로 손댈 게 없음).

  **수수료/세금은 표에 전용 컬럼이 있고 인라인 수정으로 고칠 수 있다** — 상태
  (`editDraft.commission`/`tax`)는 원래부터 있었는데(저장 시 그대로 넘김) 입력
  UI가 없어서 사실상 못 고쳤던 걸, 단가 컬럼 뒤에 "수수료"/"세금" `<input>` 두 칸을
  새로 추가해 실제로 편집 가능하게 했다. **표시되는 "체결금액"은 항상 저장된
  `amount`(수량*단가) + `commission` + `tax`**(`netTradeAmount(amount, commission,
  tax)`, 매수/매도 구분 없이 항상 더함 — 처음엔 매수는 더하고 매도는 뺐었는데
  "더해서 표시" 피드백을 받고 단순 합산으로 바꿨다)다. 저장된 `amount` 자체는
  건드리지 않고 화면에 보여줄 때만 더한다 — 그래서 표의 "체결금액" 열, 매매내역
  추가 폼의 "체결금액 (자동계산)" 미리보기, 인라인 수정 행의 계산값 셋 다 같은
  `netTradeAmount` 함수를 재사용해서 항상 같은 공식을 쓴다. 표 셀엔 `title`
  툴팁으로 원본 체결금액 + 수수료 + 세금 내역을 풀어서 보여준다. **KIS는
  `commission`/`tax`를 항상 `null`로 내려줘서**(`kisAdapter.ts`의 `mapTrade`,
  backend가 이 TR에서 해당 필드를 아직 안 채움) 표시 금액이 사실상 원본과 같다 —
  실제 차이는 토스/KB증권/CSV·수동 입력 행에서만 보인다. **차트(`chartRows`)와
  상단 스탯 타일(`totals`)은 여전히 원본 `amount` 합계를 쓴다** — 이 요청은
  "표에 보이는 체결금액"만 지정했고, 집계 숫자까지 바꾸면 기존에 보던 총
  매수/매도금액 숫자가 달라지는 더 큰 범위의 변경이 돼서 범위를 좁혔다.

  **"매매내역 추가"/인라인 수정 둘 다 체결금액을 직접 입력받지 않는다** —
  `computeAmount(quantity, price)`(수량*단가, 숫자가 아니면 0)로 원본 금액을 계산하고,
  거기에 `netTradeAmount`로 수수료·세금을 더한 값을 `<input readOnly>`(추가 폼)
  또는 통화 select 옆 텍스트(인라인 수정, 예전엔 여기도 editDraft.amount를 받는
  입력칸이었음)로 보여주기만 한다 — CSV 전용 브로커는 브로커가 따로 내려주는
  체결금액이 없어(사용자가 직접 기록) 수량/단가만 맞으면 체결금액은 항상 그 곱과
  같아야 하고, 따로 입력받으면 두 값이 어긋날 위험만 생긴다. **저장되는 `amount`
  자체는 수수료/세금을 더하지 않은 순수 `quantityNum * priceNum`이다** — 화면에
  보여주는 값과 저장하는 값이 다른데, 이건 표시 레이어에서만 수수료/세금을 얹는
  위 규칙과 일관성을 맞춘 것(저장 단계에서 더해버리면 표시할 때 또 더해서 이중
  계산됨). `editDraft`/수동 추가 상태에서 `amount` 필드 자체를 없앴고, 저장/추가
  시점에 `quantityNum * priceNum`을 계산해 보낸다 — 검증 로직도 "체결금액(0 이상)"
  문구가 빠졌다(수량이 양수, 단가가 0 이상이면 곱도 자동으로 0 이상이라 별도 검증이
  불필요해짐). CSV 가져오기는 안 건드렸다 — 그쪽 `amount`는 여러 줄을 한 번에
  올리는 파일 컬럼이라 사용자가 이미 파일에 값을 채워서 가져오는 경우가 흔하고,
  요청도 "매매내역에서"(화면의 입력 폼)로 한정됐다고 판단했다.

  **인라인 수정/삭제는 `CSV_ONLY_BROKER_IDS` 행에만 허용한다**(그 외 행은
  "실시간 연동" 텍스트만 표시) — 토스/KIS 행은 write-through로 실시간 조회가
  성공할 때마다 같은 `id`로 덮어써지므로, 여기서 고쳐도 다음 라이브 조회에 그대로
  되돌아가 의미가 없다. 수정 저장은 추가와 같은 엔드포인트를 그 행의 기존
  `(broker, accountId, id)`를 그대로 실어 재호출한다 — `upsertFromImport`가 같은
  키를 찾아 덮어쓰므로(`backend/src/db/tradesStore.ts`) 별도 수정 전용 라우트가
  필요 없다. 삭제는 `DELETE /trades-store/:broker/:accountId/:id`
  (`api.deleteTradeStore`). 행 식별은 `id` 하나만으로는 브로커 간 우연히 겹칠 수
  있어 `tradeKey(t)` = `broker|accountId|id` 조합을 React key와 편집 상태
  (`editingKey`) 양쪽에 쓴다. 추가/가져오기/수정/삭제 전부 성공 시 `allTrades`를
  다시 받아온다(개별 모드로 보고 있어도 "전체"로 전환했을 때 바로 최신 데이터가
  보이도록) — 지금 보고 있는 화면이 그 브로커/계좌와 같으면 `trades`도 같이
  갱신한다.
- `src/components/TradesChart.tsx` — 월별 매수(`--series-1`)/매도(`--series-2`) 그룹형
  막대 그래프. **원화·달러를 환율로 합쳐서 하나의 막대로 그리지 않는다**(단위/스케일이
  달라서 — dataviz 스킬의 "두 측정값은 두 차트로" 원칙) — 달러 거래가 있으면 원화
  패널·달러 패널을 위아래로 따로 그린다. 막대 위 금액 라벨을 항상 표시(compact 표기).
  호버 상태는 각 패널이 자기 SVG 안에서 독립적으로 관리한다(공유하면 패널별 세로
  오프셋 계산이 필요해 좌표 버그가 나기 쉬움). 매수/매도는 손익의 좋음/나쁨이 아니므로
  `--good`/`--critical`(상태色)을 재사용하지 않고 카테고리 색(마커)으로 구분한다.
- **공용 `.tooltip` 클래스**(`styles.css`, `DividendsChart`/`TradesChart`/
  `MonthlyReturnChart`가 다 씀)는 `white-space: normal` + `max-width: 200px`다 —
  예전엔 `nowrap`이라 내용이 길면(금액이 큰 손익 차트 등) 한 줄로 쭉 늘어나서
  차트 컨테이너의 `overflow-x: auto` 클리핑 영역 밖으로 잘리는 경우가 많았다.
  짧은 내용은 지금도 한 줄 그대로 유지되고, 긴 내용만 자연스럽게 줄바꿈된다.
  다만 이것만으로는 **가장자리 막대**(툴팁이 중앙 정렬이라 폭의 절반만큼
  좌우로 튀어나감)까지는 못 막아서, `MonthlyReturnChart.tsx`처럼 값 자체가
  길어질 수 있는 차트는 컴포넌트 쪽에서 좌/우/상/하 정렬을 직접 뒤집는 로직이
  따로 필요했다(위 참고).

## 개발

- `npm run dev`(frontend 워크스페이스) → Vite `localhost:5173`. 보통 루트의
  `npm run dev`로 electron과 함께 띄운다. HMR 자동 반영(백엔드와 달리 재빌드 불필요).
- `npm run build` → `tsc` 타입체크 후 `vite build`.
- **`vite.config.ts`의 `base: './'`는 지우면 안 된다.** 패키징된 Electron 앱은
  `electron/src/main.ts`가 `mainWindow.loadFile()`로 `frontend/dist/index.html`을
  `file://`로 직접 연다(dev처럼 `http://localhost`가 아님) — Vite 기본값인 절대경로
  (`/assets/...`)로 빌드하면 브라우저가 그걸 파일시스템 루트 기준으로 풀어서
  `file:///assets/...`를 찾다가 전부 404가 나고, JS가 하나도 안 실행돼 흰 화면(메뉴바만
  있고 콘텐츠 없음)이 된다. 실제로 Linux 패키징 빌드를 처음 화면으로 띄워봤을 때
  이 증상으로 발견됐다 — 그 전까지는 Mac 빌드도 백엔드 API 응답만 확인했지 렌더러가
  실제로 그려지는지 눈으로 확인한 적이 없어서 안 걸렸다(플랫폼과 무관한 버그였다).
  `base: './'`로 상대경로(`./assets/...`) 빌드를 강제하면 `file://`/`http://` 어느
  쪽에서도 index.html 기준 상대 경로로 풀려서 둘 다 동작한다.

## 차트/시각화

새 차트 추가/수정 시 dataviz 스킬 절차(폼 선택 → 색상 배정 → 팔레트 검증 → 마크 스펙 →
인터랙션 → 접근성 점검)를 따른다. 색상은 카테고리/시퀀셜/다이버징/상태 중 용도에 맞게
고정 순서로 배정하고 임의로 순환시키지 않는다.
