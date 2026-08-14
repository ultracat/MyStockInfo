# MyStock

여러 증권사 Open API를 연동해 보유 종목, 매입가, 손익, 비중, 배당금을 한 화면에서 보는 데스크톱 앱.
현재 **토스증권**, **한국투자증권(KIS)**이 연동되어 있고, KB증권은 `backend/src/brokers/registry.ts`에
어댑터를 추가하는 방식으로 확장하도록 설계되어 있습니다.

## 구조

```
backend/    Express 서버 — 증권사 API 호출, 자격증명 암호화 저장, 배당 기록 로컬 저장
frontend/   React + Vite 렌더러 UI
electron/   Electron 메인 프로세스 — 위 backend를 같은 프로세스에서 구동하고 창을 띄움
```

- **왜 백엔드가 Electron 메인 프로세스 안에서 도나요?** API 키 암호화(`Electron safeStorage`,
  OS 키체인 기반)가 Electron 메인 프로세스에서만 동작하기 때문입니다. `electron/src/main.ts`가
  `@mystock/backend`를 직접 `import`해서 같은 프로세스에서 `startServer()`를 호출합니다.
- **브로커 확장 포인트**: `backend/src/brokers/types.ts`의 `BrokerAdapter` 인터페이스를 구현하고
  `registry.ts`에 등록하면 라우트/프론트엔드 코드는 그대로 재사용됩니다. 각 브로커가 요구하는
  자격증명 필드(예: 토스는 Client ID/Secret, KIS는 앱키/앱시크릿/계좌번호/상품코드)는
  `backend/src/brokers/credentialFields.ts`에 선언하면 설정 화면 폼이 자동으로 그에 맞게 렌더링됩니다.

## 시작하기

```bash
npm install
npm run build:backend   # electron이 dist/index.js를 require하므로 최초 1회 필요
npm run dev              # frontend(Vite) + electron을 동시에 실행
```

Electron 창이 뜨면 좌측 **설정** 메뉴에서 증권사별 API 키를 입력하세요.
저장된 키는 OS 키체인 기반으로 암호화되어 로컬에만 저장되고, `backend/data/`(gitignore됨)
아래 파일로 유지됩니다.

> 백엔드 코드(`backend/src/**`)를 수정하면 `npm run build:backend`로 다시 빌드한 뒤
> Electron을 재시작해야 반영됩니다. 프론트엔드(`frontend/src/**`)는 Vite가 자동 반영합니다.

## 브로커별로 알아둘 점

### 토스증권
- 인증: OAuth2 Client Credentials (`Client ID` / `Client Secret`)
- 계좌 목록을 API로 조회할 수 있습니다.
- 해외 종목 비중(%) 계산용 환율을 실시간 조회합니다 (`GET /api/v1/exchange-rate`, `MARKET_INFO`
  그룹). 설정 화면에 값을 입력하면 실시간 조회보다 그 값이 우선 적용되는 수동 override로 동작합니다.
- API 요청은 [developers.tossinvest.com/docs](https://developers.tossinvest.com/docs)의 Rate
  Limits 표를 따라 자동으로 속도 조절됩니다. `backend/src/brokers/toss/rateLimitGroups.ts`에
  그룹별 문서상 기본값(AUTH 5/s, ACCOUNT 1/s, ASSET 5/s, MARKET_INFO 3/s 등, ORDER/ORDER_INFO
  피크시간 포함)이 등록되어 있고, `backend/src/brokers/rateLimiter.ts`가 응답의
  `X-RateLimit-Limit`/`Remaining`/`Reset` 헤더로 실시간 보정합니다. 429 응답은 `Retry-After` +
  지수 백오프로 자동 재시도합니다.

### 한국투자증권 (KIS)
- API 명세 출처: [github.com/koreainvestment/open-trading-api](https://github.com/koreainvestment/open-trading-api)
- 인증: `POST /oauth2/tokenP` (JSON body, `appkey`/`appsecret`) — 토스와 달리 form-urlencoded가
  아니라 JSON 바디입니다.
- **계좌 목록을 조회하는 API가 없습니다.** 계좌번호(CANO, 8자리)와 상품코드(ACNT_PRDT_CD, 2자리,
  보통 `01`)를 설정 화면에서 직접 입력해야 합니다.
- **실전투자 계좌만 지원합니다.** 모의투자(paper trading, `openapivts.koreainvestment.com:29443`)는
  연동돼 있지 않습니다.
- 국내주식 잔고조회(`GET /uapi/domestic-stock/v1/trading/inquire-balance`)만 연동되어 있어 보유
  종목은 전부 KRW/국내(KR) 기준입니다.
- **에러/속도제한 신호 방식이 토스와 다릅니다.** HTTP 상태 코드가 아니라 응답 바디의
  `rt_cd`/`msg_cd`/`msg1`로 성공·실패를 판단합니다 (`EGW00201`이 "초당 거래건수 초과" 에러코드).
  레포/README에 정확한 초당 요청 한도 숫자가 공개돼 있지 않아, `backend/src/brokers/kis/kisClient.ts`는
  보수적인 기본 페이싱 + `EGW00201` 감지 시 지수 백오프로 처리합니다. 실제 한도가 다르다면
  [apiportal.koreainvestment.com](https://apiportal.koreainvestment.com/)에서 확인 후
  `kisLimiter`의 `tps` 값을 조정하세요.

### 공통
- **배당금은 두 증권사 모두 API로 자동 수집되지 않습니다.** "내 계좌에 실제 입금된 배당금" 내역을
  조회하는 API가 없어서 (KIS는 종목별 배당 일정/배당률 같은 공개 시세 데이터는 있지만 개인 계좌
  지급 내역은 없음), `배당금` 화면에서 지급 시 직접 입력하는 방식으로 구현했습니다.
  - 기록마다 통화(원화/달러)를 선택해 원래 통화 그대로 저장합니다.
  - 월별 배당금 그래프에 합계와 막대별 금액을 표시하고, 증권사별로 투자금·배당금·배당수익률을
    보여줍니다. 달러 투자금/배당금이 있는 브로커는 원화·달러·합계(환산) 3줄로 나눠 보여주며,
    환산에 쓰는 환율은 설정 화면의 수동 입력값 또는 토스 실시간 환율(`GET /api/v1/exchange-rate`)을
    Dashboard와 같은 우선순위로 사용합니다. 환율을 가져오지 못하면 "환율 미적용"으로 표시하고
    억지로 합산하지 않습니다.
- **API 자격증명은 절대 커밋되지 않습니다.** `.gitignore`가 `backend/data/`를 제외합니다.

## 다음 단계 (미구현)

- KB증권 어댑터 추가
- KIS 모의투자(paper trading) 지원
- 프로덕션 패키징 (electron-builder 등 설치형 빌드 구성)
- 백엔드 dev 모드 파일 변경 시 Electron 자동 재시작
