# frontend

React + Vite 렌더러 UI (TypeScript). 라우터 라이브러리 없이 `App.tsx`가 `useState`로
페이지 상태를 직접 관리하는 단순 구조 — 페이지가 늘어나도 라우터를 도입하기보다 이 패턴을
유지한다.

## 구조

- `src/format.ts` — 공용 `Intl.NumberFormat` 인스턴스(`krw`, `krw2dp`, `krwCompact`,
  `usdFmt`, `usdCompact`, `formatKrw`)를 모아둔 곳. **`Intl.NumberFormat` 생성자는 로케일
  데이터 조회가 있어서 공짜가 아니다** — `HoldingsTable.tsx`의 `formatMoney`가 행마다(컬럼당
  1번씩, 한 행에 6번) 새로 생성하고 있어서 포지션 30~50개짜리 포트폴리오 렌더 한 번에
  수백 번 생성되던 걸 여기로 옮기며 고쳤다(`Dashboard.tsx`의 `formatKrw`와 인라인
  환율 표시도 같은 문제였음). 새 페이지/컴포넌트에서 숫자 포맷이 필요하면 직접
  `new Intl.NumberFormat(...)`를 쓰지 말고 여기서 가져다 쓴다 — 렌더 바디나 행마다 호출되는
  함수 안에서 새로 만들면 똑같은 문제가 재발한다.
- `src/App.tsx` — 좌측 사이드바 네비게이션 + `page` 상태(`'dashboard' | 'dividends' |
  'trades' | 'settings'`)로 페이지 전환. 새 페이지 추가 시 `Page` 타입과 `NAV_ITEMS`에 항목 추가.
- `src/pages/Dashboard.tsx` — 보유 종목 화면. 브로커 선택 드롭다운 → 해당 브로커 계좌/환율
  조회 → 선택 계좌 포트폴리오 조회, 3단계 `useEffect` 체인. 환율은 `selectedBroker ===
  'toss'`일 때만 조회한다(토스만 환율 API 제공). **브로커 전환 시 `accountId`는 브로커
  `<select>`의 `onChange`에서 `selectedBroker`와 같은 커밋에 동기적으로 `null`로 리셋한다**
  — effect2(계좌 목록 재조회)의 비동기 본문 안에서 리셋하면, `selectedBroker`는 이미 새
  브로커인데 `accountId`는 아직 이전 브로커 것인 렌더가 한 번 존재하게 되고, 그 조합으로
  effect3(`[selectedBroker, accountId]` 의존, 보유종목 조회)가 즉시 실행돼 예를 들어 KIS
  계좌번호를 토스 accountSeq인 것처럼 실어 `/api/v1/holdings`를 호출한다 — 토스는 이를
  `account-not-found`(400)로 정확히 거부하고, 이 요청은 실제로는 곧 cancelled 처리되어
  화면엔 안 보이지만 백엔드 로그엔 에러로 남는다(실제로 한 번 발생해서 고침). 반대 방향
  (토스→KIS)이 무해했던 건 `kisAdapter.getPortfolio`가 `accountId` 인자를 아예 안 쓰고
  자격증명에 저장된 계좌로만 조회하기 때문 — 이 비대칭성이 이 버그가 한쪽 방향에서만
  나타난 이유였다. 네 개 스탯 타일(총 매입금액/총 평가금액/총 손익금액은 `AmountTile`,
  손익률은 `RateTile`)은 모두 같은 시각 언어를 쓴다 — 포트폴리오에 달러 보유분이 있으면
  (`hasUsdHoldings = !!portfolio.totalPurchaseAmountUsd`, 현재는 토스 해외주식만 해당)
  원화/달러/합계(환산) 3줄로 보여주고, 없으면 기존처럼 한 줄만 보여준다. **굵은 글씨
  (`.value`)는 항상 합계(환산) 한 줄에만 쓴다** — 원화/달러 개별 줄은 작은 글씨(12px,
  일반 굵기)로 내려서 "이 타일의 대표 숫자는 총 합계"라는 게 한눈에 보이게 한다(처음엔
  원화 줄이 굵고 달러/합계가 작았는데, 그러면 원화 금액이 대표값처럼 보여서 반대로
  바꿨다). `hasUsd` 판단을 타일 자신의 값(예: 손익금액이 우연히 0)이 아니라 포트폴리오
  전체의 달러 투자금 여부로 넘기는 이유는, 그래야 손익금액이 0이거나 부호가 바뀌어도
  3줄 구조가 안 깨지기 때문. `RateTile`의 "합계" 손익률은 브로커가 내려주는
  `profitLossRate`(단일 값)를 재사용하지 않고 `AmountTile`과 같은 `effectiveFxRate`로
  직접 계산한다 — 그래야 이 화면의 금액 타일들과 같은 환율 가정을 쓰게 되어 숫자가
  서로 어긋나지 않는다(원화/달러 개별 손익률은 같은 통화끼리 나눈 값이라 환율 없이도
  정확함). 환율은 이미 비중 계산에 쓰던 `effectiveFxRate`를 그대로 재사용한다(새로
  조회하지 않음).
- `src/pages/Dividends.tsx` — 배당 기록 수동 입력/조회. 두 브로커 모두 개인 배당 지급
  내역 API가 없어서 수동 입력 방식임을 화면에 안내한다 — 이 사실이 바뀌지 않는 한 안내
  문구를 지우지 않는다. 배당 기록마다 `currency`(KRW/USD)와 그 통화 기준 `amount`를
  저장한다(backend/CLAUDE.md 참고) — 예전엔 입력 시 무조건 원화로 수동 환산해서 저장했지만
  지금은 원본 통화 그대로 저장하고 화면에서 환산한다. "증권사별 배당금 총계" 표는 브로커에
  달러 투자금/배당금이 하나라도 있으면 **원화 / 달러 / 합계(환산)** 3행으로 나눠서 통화별
  실제 수익률과 환산 합계를 각각 보여준다(하나로 합치면 통화별 수익률을 알 수 없어서). 이
  3행은 별도의 "구분" `<th>`를 두지 않는다 — 한 번 그렇게 만들었다가 "증권사"/"구분" 두
  컬럼으로 보인다는 피드백을 받고, 첫 컬럼(증권사) 안에 첫 줄엔 증권사명·나머지 줄엔 들여쓴
  구분 라벨(`　달러`, `　합계(환산)`)만 넣는 방식으로 바꿨다 — 컬럼 수를 늘리지 않으면서
  3행 구조는 유지. 투자금(총 매입금액,
  `totalPurchaseAmountKrw`/`Usd`)은 배당 DB에 없는 값이라 마운트 시 별도 effect에서
  `listBrokers` → 브로커별 `listAccounts` → 계좌별 `getPortfolio`를 호출해 합산한다 —
  배당금 합계(로컬 DB)와 투자금(실시간 브로커 API)은 출처와 신선도가 다른 값임을 유의.
  브로커 하나가 미연동/레이트리밋 등으로 실패해도 나머지 행은 계속 보여야 하므로 브로커별로
  개별 try/catch로 감싼다(Dashboard.tsx의 목록형 엔드포인트 방침과 동일한 이유). 달러→원화
  환산 환율은 Dashboard.tsx와 동일한 우선순위(설정에서 직접 입력한 값 > 토스 실시간
  환율, 토스만 환율 API 제공)로 별도 effect에서 가져와 `effectiveFxRate`로 "합계(환산)"
  행과 `DividendsChart`(월별 그래프)에 전달한다 — 환율을 못 가져오면 "환율 미적용"으로
  표시하고 합산을 생략한다(조용히 틀린 숫자를 보여주지 않기 위함).
  **연도 필터(`year: 'ALL' | number`)**는 서버에 다시 안 물어보고 `listDividends()`로
  받아온 전체 `records`를 `visibleRecords`로 클라이언트에서 걸러서 월별 집계
  (`monthlyRows`)·증권사별 집계(`brokerDividendTotals`)·하단 기록 목록까지 전부 이걸
  기준으로 다시 계산한다 — Trades.tsx의 `visibleTrades`와 같은 패턴. 그래서 백엔드의
  `monthlySummary()`(연도 개념 없이 항상 전체 기간)는 통째로 지웠다(backend/CLAUDE.md
  참고). **투자금(`investedByBroker`)만 연도 필터를 안 탄다** — 이건 "지금 시점에
  실제로 들고 있는 투자 원금"이라 애초에 연도별로 나뉘는 값이 아니고, 배당 DB가 아니라
  실시간 브로커 API에서 오기 때문. 전체 상단에 있는 "총 배당금/총 투자금/총
  배당수익률" 스탯 타일(`grandTotal`)은 모든 브로커를 합친 환산 단일 숫자만 보여준다 —
  통화별 상세는 이미 그 아래 "증권사별 배당금 총계" 표에 있어서 중복 표시하지 않는다.
  브로커 중 하나라도 투자금 조회가 실패/로딩 중이면 총 투자금·총 배당수익률을 부분합으로
  조용히 보여주지 않고 "일부 조회 실패"/"불러오는 중..."이라고 명시한다. "월별 배당금"
  그래프에는 연도 필터와 별개로 **그래프 전용** 증권사 필터(`chartBroker`)가 카드 안에
  따로 있다 — 연도 필터(`year`)는 표/목록까지 전부 같이 좁히는 페이지 전역 필터인 반면,
  이건 그래프 하나만 좁힌다(증권사별 표는 이미 모든 증권사를 나란히 비교해서 보여주는
  게 목적이라 거기까지 필터링하면 오히려 그 표의 존재 이유가 없어짐). 옵션 목록
  (`chartBrokerOptions`)은 연도로 좁히기 전 `records` 전체 기준으로 계산한다 — 연도를
  바꿀 때마다 드롭다운 옵션 자체가 들쭉날쭉 생겼다 사라졌다 하지 않게 하기 위해서다.
  하단 "배당 기록" 목록의 페이지네이션(`pageSize`: 10/20/30/전체, `page`)은 **`page`를
  effect로 되돌리지 않는다** — 연도 필터를 바꾸거나 마지막 페이지의 항목을 삭제해서
  실제 페이지 수(`pageCount`)가 줄어들면, `page` state는 그대로 두고 매 렌더마다
  `currentPage = Math.min(page, pageCount)`로 clamp해서 슬라이스에도 "현재 페이지"
  표시에도 이 값 하나만 쓴다 — 필터가 다시 넓어지면 이전에 보던 페이지로 자연스럽게
  돌아가고, effect 기반으로 짰을 때 생기는 리셋 타이밍 경쟁도 없다. 연도/표시개수를
  직접 바꿀 때만 `setPage(1)`을 명시적으로 같이 호출한다. "월별 배당금"과 "증권사별
  배당금 총계"는 **카드 하나**를 공유한다(처음엔 카드 두 개로 나란히 놓았다가, "따로
  접혔다 펴지지 말고 한 번에 같이"라는 피드백을 받고 합쳤다) — `dividendPanelsCollapsed`
  하나로 둘 다 같이 접고 펴며, `CollapseToggle`(파일 내부 컴포넌트)도 카드 헤더 행에
  하나만 둔다. 헤더 행엔 "월별 배당금 제목 + 증권사 `<select>`"와 "증권사별 배당금
  총계 제목"이 나란히 있고 토글은 그 행 **맨 오른쪽**에 온다. 본문(그래프+표)은
  `!dividendPanelsCollapsed`일 때만 렌더링하고, 내부에서 `flex-wrap: wrap`인 행
  (그래프 `flex: '1 1 420px'` 왼쪽, 폭 1px `--border`색 세로선 구분자, 표
  `flex: '1 1 420px'` 오른쪽)으로 나눈다 — `alignItems: 'stretch'`라 표 행 개수가
  달라져도 구분선이 항상 그래프와 같은 높이로 이어진다. 카드 폭이 줄어드는 만큼
  `DividendsChart`도 `overflowX: auto`로 감싸서(`TradesChart`와 동일한 이유) 달이
  많을 때 카드 밖으로 넘치지 않고 그래프 자체가 가로 스크롤되게 했다. "월별 배당금"
  옆 증권사 `<select>`는 `.form-row`(라벨-위/셀렉트-아래 세로 배치용 클래스)를 안
  쓴다 — 제목 `<h3>` 바로 옆, 라벨과 셀렉트가 한 줄에 나란히 오도록 얕은 flex row로
  직접 짰다(이 화면에서만 쓰는 예외적 레이아웃 — 폼 입력 필드는 계속 `.form-row`를
  쓴다).
- `src/pages/Trades.tsx` — 매매내역 화면. Dashboard.tsx와 같은 브로커/계좌 선택 +
  `accountId` 동기 리셋 패턴에, 연도 `<select>`(최근 5개년)를 추가해서 `[YYYY-01-01,
  YYYY-12-31]`(올해면 오늘까지) 범위로 `GET /api/trades`를 **연 단위로 한 번만** 호출한다.
  "연간/월간" 보기 전환과 월 선택은 서버를 다시 안 부르고, 이미 받아온 그 해 전체
  `trades`를 `viewMode`/`month`에 따라 `useMemo`로 다르게 집계/필터링한다
  (`visibleTrades`, `chartRows`) — 월 하나만 보고 싶다고 매번 새로 fetch할 이유가 없어서.
  `chartRows`는 연간이면 12개월 버킷, 월간이면 그 달의 날짜 수만큼(`daysInMonth`) 일별
  버킷을 만든다(`TradesChart`의 `TradeSummaryBucket[]`, `label` 필드에 그대로 들어감).
  백엔드가 원시 `TradeRecord[]`만 돌려주므로(로컬 DB가 없어 "월별/일별 요약" 같은 걸
  백엔드가 미리 계산해둘 이유가 없음), 이 집계는 전부 프론트 쪽 책임이다(Dividends.tsx의
  `brokerDividendTotals`와 같은 패턴). 상단 스탯 타일(총 매수금액/총 매도금액)과 거래
  목록 테이블은 항상 현재 보기 범위(연간이면 그 해 전체, 월간이면 그 달만)인
  `visibleTrades` 기준으로 계산해서 화면 안 숫자들이 서로 어긋나지 않게 했다. 스탯
  타일은 `effectiveFxRate`로 원화 환산해서 하나의 숫자로 보여주지만(Dividends.tsx/
  Dashboard.tsx와 같은 패턴), **그래프는 원화·달러를 환산해 합치지 않고 따로 보여준다** —
  아래 `TradesChart.tsx` 참고.
- `src/components/TradesChart.tsx` — 월별 매수(파랑, `--series-1`)/매도(주황, `--series-2`)
  그룹형 막대 그래프. **원화와 달러를 환율로 합쳐서 하나의 막대로 그리지 않는다** — 둘은
  단위/스케일 자체가 달라서(dataviz 스킬: "Two measures of different scale → 두 차트 또는
  스몰 멀티플로 나눈다") 그 해에 달러 거래가 하나라도 있으면 원화 패널·달러 패널을
  위아래로 따로 그리는 `Panel` 내부 컴포넌트를 하나 또는 둘 렌더링한다(없으면 원화
  패널만). 처음엔 fxRate로 환산해 하나로 합치고 막대마다 라벨도 안 달았는데(24개 막대라
  DividendsChart.tsx처럼 다 라벨링하면 빽빽해질까봐 호버 툴팁만 썼다), "달러 내역은
  따로 보여달라" + "막대가 크면 금액이 잘려 안 보인다"는 피드백을 받고 지금 구조로
  바꿨다 — 막대 위에 금액 라벨을 항상 표시하되(compact 표기), `LABEL_SPACE`를
  DividendsChart.tsx(18px)보다 더 키워서(24px) 최댓값에 가까운 막대의 라벨도 위로 안
  잘리게 했다. 호버 상태는 각 `Panel`이 자기 SVG 안에서 독립적으로 관리한다 — 패널을
  위아래로 쌓았을 때 툴팁 좌표를 상위 컴포넌트와 공유하면 패널마다 다른 세로 오프셋을
  더해줘야 해서 좌표 버그가 나기 쉽다(실제로 한 번 겪고 각 패널 로컬 상태로 바꿨다).
  `--series-2`(주황, `#eb6834`/`#d95926`)는 이 차트 때문에 `styles.css`에 새로 추가했다 —
  dataviz 스킬 팔레트의 카테고리 슬롯 1(파랑) 다음 순서인 슬롯 2를 그대로 썼다(문서화된
  순서라 인접 쌍 CVD 검증을 통과한 상태 — 임의로 다른 슬롯을 고르지 않는다). 매수/매도는
  손익의 좋음/나쁨이 아니므로 `--good`/`--critical`(상태色)을 재사용하지 않는다 — 거래
  목록 테이블의 "구분" 열도 텍스트 색이 아니라 이 카테고리 색의 작은 사각형 마커로
  구분한다("텍스트는 항상 텍스트 색, 색은 마커가 담당" 원칙).
- `src/pages/Settings.tsx` — 브로커별 자격증명 입력 폼. **하드코딩된 필드가 아니라
  백엔드의 `GET /api/settings/credential-fields`(=`CREDENTIAL_FIELDS`)를 읽어 동적으로
  렌더링한다.** 새 브로커/필드는 백엔드의 `credentialFields.ts`만 고치면 여기는 자동
  반영됨 — 프론트에 브로커별 폼을 새로 만들지 않는다.
- `src/components/HoldingsTable.tsx`, `DividendsChart.tsx` — 표시 전용 컴포넌트.
- `src/api.ts` — 백엔드 호출 레이어. `BASE_URL = 'http://127.0.0.1:4317/api'` —
  `electron/src/main.ts`의 `BACKEND_PORT`와 반드시 일치해야 한다. 에러 응답은
  `{error, detail?}` 형태를 기대하고 `detail`이 있으면 메시지에 이어 붙인다 (백엔드 원본
  에러 바디를 그대로 보여주기 위함).
- `src/types.ts` — 백엔드 응답 타입 미러링 (`BrokerAccount`, `PortfolioOverview`,
  `TradeRecord`, `CredentialFieldSpec` 등). 백엔드 `brokers/types.ts`와 형태를 맞춰 유지한다.

## 개발

- `npm run dev` (frontend 워크스페이스) → Vite dev 서버, `localhost:5173`. 보통은 루트의
  `npm run dev`로 electron과 함께 띄운다.
- HMR 자동 반영 — 백엔드와 달리 재빌드/재시작 불필요.
- `npm run build` → `tsc` 타입체크 후 `vite build` (프로덕션 패키징 시 electron이 이
  결과물을 로드).

## 차트/시각화

새 차트를 추가하거나 기존 차트(`DividendsChart.tsx` 등)를 수정할 때는 dataviz 스킬의
절차(폼 선택 → 색상 배정 → 팔레트 검증 → 마크 스펙 → 인터랙션 → 접근성 점검)를 따른다.
색상은 카테고리/시퀀셜/다이버징/상태 중 용도에 맞게 고정 순서로 배정하고, 임의로 순환시키지
않는다.
