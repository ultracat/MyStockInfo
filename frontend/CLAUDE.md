# frontend

React + Vite 렌더러 UI (TypeScript). 라우터 라이브러리 없이 `App.tsx`가 `useState`로
페이지 상태를 직접 관리한다 — 페이지가 늘어나도 라우터를 도입하지 않는다.

## 구조

- `src/format.ts` — 공용 `Intl.NumberFormat` 인스턴스(`krw`, `usdFmt`, `formatKrw` 등).
  **렌더 바디나 행마다 호출되는 함수 안에서 `new Intl.NumberFormat(...)`을 직접 만들지
  않는다** — 로케일 데이터 조회가 있어 공짜가 아니라서, 행마다 새로 만들면 포지션
  30~50개짜리 렌더 한 번에 수백 번 생성된다(과거 `HoldingsTable.tsx`에서 실제 발생).
- `src/App.tsx` — 좌측 네비 + `page` 상태(`'dashboard'|'dividends'|'trades'|'settings'`).
  새 페이지 추가 시 `Page` 타입과 `NAV_ITEMS`에 항목 추가.
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
- **환율 처리**: `manualFxRate`(설정에서 직접 입력) > `liveFxRate`(토스 실시간 조회,
  토스만 환율 API 제공)를 `effectiveFxRate`로 합친다. 환율을 못 가져오면 "환율
  미적용"으로 표시하고 합산을 생략한다(조용히 틀린 숫자를 보여주지 않기 위함).
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
  표현). 투자금(`totalPurchaseAmountKrw`/`Usd`)은 배당 DB에 없어 마운트 시 브로커별로
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
  (개별 모드의 KIS 라이브 데이터, `prdt_name`) 이름+심볼을, 없으면(전체 모드는
  `StoredTrade`에 `name` 자체가 없어 항상, 개별 모드의 토스는 원래도 null이라)
  심볼만 보여준다.

  **CSV 내보내기**는 Dashboard.tsx와 같은 이유로 `GET /api/trades-store` 전체를
  대상으로 하고, **가져오기**도 대상 선택 없이 CSV 행 자체의 `broker`/`accountId`를
  그대로 쓴다. **"매매내역 추가"**(수동 입력) 폼은 `CSV_ONLY_BROKER_IDS`만 증권사
  선택지로 준다(Dividends.tsx의 배당 기록 추가 폼과 다른 점 — 토스/KIS는 실시간
  API로 실제 체결 내역이 write-through 동기화되므로, 그 위에 수동 입력을 섞으면
  어느 쪽이 진짜 체결 내역인지 알 수 없어진다) — 별도 백엔드 라우트 없이 기존 CSV
  가져오기 엔드포인트(`POST /trades-store/import`)를 행 1개짜리 배열로 호출한다
  (`id`를 안 주면 서버가 새로 발급).

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
