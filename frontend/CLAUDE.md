# frontend

React + Vite 렌더러 UI (TypeScript). 라우터 라이브러리 없이 `App.tsx`가 `useState`로
페이지 상태를 직접 관리하는 단순 구조 — 페이지가 늘어나도 라우터를 도입하기보다 이 패턴을
유지한다.

## 구조

- `src/App.tsx` — 좌측 사이드바 네비게이션 + `page` 상태(`'dashboard' | 'dividends' |
  'settings'`)로 세 페이지 전환. 새 페이지 추가 시 `Page` 타입과 `NAV_ITEMS`에 항목 추가.
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
  나타난 이유였다. "총 매입금액"/"총 평가금액" 스탯 타일은 `AmountTile` 컴포넌트로
  분리했다 — 달러 보유분(`totalPurchaseAmountUsd`/`totalMarketValueUsd`, 현재는 토스
  해외주식만 해당)이 있으면 원화/달러/합계(환산) 3줄로 보여주고, 없으면 기존처럼 원화
  한 줄만 보여준다. **굵은 글씨(`.value`)는 합계(환산) 한 줄에만 쓴다** — 원화/달러
  개별 줄은 작은 글씨(12px, 일반 굵기)로 내려서 "이 타일의 대표 숫자는 총 합계"라는 게
  한눈에 보이게 한다(처음엔 원화 줄이 굵고 달러/합계가 작았는데, 그러면 원화 금액이
  대표값처럼 보여서 반대로 바꿨다). 환율은 이미 비중 계산에 쓰던 `effectiveFxRate`를
  그대로 재사용한다(새로 조회하지 않음).
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
  `CredentialFieldSpec` 등). 백엔드 `brokers/types.ts`와 형태를 맞춰 유지한다.

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
