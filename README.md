<p align="center">
  <img src="build/wordmark.png" alt="MyStock" width="420">
</p>

# MyStock

여러 증권사 Open API를 연동해 보유 종목, 매입가, 손익, 비중, 배당금을 한 화면에서 보는 데스크톱 앱.
현재 **토스증권**, **한국투자증권(KIS)**이 API로 연동되어 있고, **삼성증권/미래에셋증권**은
API 연동 없이 CSV로 보유종목·매매내역을 직접 관리합니다(어댑터를 만들 계획 없음 — CSV 전용으로
확정된 결정). **KB증권**은 둘의 중간 형태입니다 — Open API를 연동했지만 `appKey`/`appSecret`이
발급 시점에 계좌 하나에만 고정 바인딩되는 구조라(계좌 목록 조회 API 자체가 없음) 토스/KIS처럼
여러 계좌를 실시간으로 보여줄 수 없어서, "CSV 전용 브로커의 로컬 저장소를 실시간 API로 채우는
자동 동기화"만 추가했습니다(보유종목/매매내역 화면에 그 계좌가 보이는 시점에 백그라운드로
동기화 + 수동 새로고침 버튼, 상세는 `backend/CLAUDE.md`의 "KB증권 Open API" 절 참고).

> 이 저장소엔 `web-app`이라는 별도 브랜치도 있습니다 — 같은 앱을 Electron 데스크톱 대신
> 일반 웹 서버(개인/가족용, PWA)로 띄울 수 있게 만드는 작업 중입니다. `main`에는 아직
> 머지되지 않았고, 상세는 그 브랜치의 `backend/CLAUDE.md`를 참고하세요.

## 릴리스

세 OS 설치 파일(`.dmg` / `.AppImage` / `.exe`)은 GitHub Actions가 각 OS 러너에서
만듭니다 — Apple Silicon 맥에서는 Windows/Linux 산출물을 만들 수 없기 때문입니다.

1. 루트 `version.json`의 버전을 올립니다(여기가 단일 원천입니다).
2. 커밋 후 `git tag -a v0.3.0 -m "..." && git push origin v0.3.0`
3. Actions가 세 산출물을 만들고 **초안** 릴리스를 올립니다. 내용을 확인하고 직접 공개하세요.

필요한 OS만 빌드하려면 Actions 탭에서 수동 실행 후 플랫폼을 고르면 됩니다(릴리스는 안 만듭니다).
세 산출물 모두 코드 서명이 안 돼 있어 macOS는 Gatekeeper, Windows는 SmartScreen 경고가 뜹니다.

## 로고

파란 스퀘어클 위의 흰 **M**은 앱 이름(**My** Stock)이자, 왼쪽보다 오른쪽 봉우리가
높은 비대칭이라 "올랐다 → 조정받았다 → 더 올랐다"는 주가 선으로도 읽힙니다. M의
오른쪽 기둥 위에 떠 있는 초록 점은 그 기둥을 소문자 **i**(information)로 만들어
"여러 증권사의 정보를 한 화면에 모은다"는 이 앱의 역할을 가리키고, 동시에 현재가
데이터 포인트로도 읽힙니다. 뒤의 그리드와 기준선은 그 정보의 바탕입니다.

원본은 `build/icon.svg` 하나이고, 세 OS용 아이콘(`.icns`/`.ico`/hicolor PNG 세트)과
런타임 아이콘·파비콘·워드마크는 전부 `npm run generate:icons`로 거기서 생성됩니다 —
생성물은 직접 고치지 마세요(`electron/CLAUDE.md`의 "앱 아이콘" 절 참고).

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

위 과정을 한 번에 해 주는 실행 파일도 저장소 루트에 있습니다 — 처음 실행이면 `npm install`까지
하고, 이미 실행 중(포트 4317/5173 사용 중)이면 중복 실행하지 않습니다.

| 플랫폼 | 실행 방법 |
|---|---|
| macOS | Finder에서 `start-mac.command` 더블클릭 (또는 터미널에서 `./start.sh`) |
| Linux | 터미널에서 `./start.sh` |
| Windows | 탐색기에서 `start-windows.bat` 더블클릭 |

nvm/Homebrew로 설치한 node는 셸 설정을 읽지 않는 더블클릭 실행에서도 찾도록 했습니다.
macOS에서 처음 더블클릭할 때 "확인되지 않은 개발자" 경고가 뜨면 우클릭 → 열기로 한 번 허용하세요.

Electron 창이 뜨면 좌측 **설정** 메뉴에서 증권사별 API 키를 입력하세요.
저장된 키는 OS 키체인 기반으로 암호화되어 로컬에만 저장되고, `backend/data/`(gitignore됨)
아래 파일로 유지됩니다.

> 백엔드 코드(`backend/src/**`)를 수정하면 `npm run build:backend`로 다시 빌드한 뒤
> Electron을 재시작해야 반영됩니다. 프론트엔드(`frontend/src/**`)는 Vite가 자동 반영합니다.

## Mac 배포용 빌드 만들기

```bash
npm run package:mac
```

`backend`/`frontend`/`electron`을 전부 빌드한 뒤 `electron-builder`로 `release/` 아래에
`MyStock.app`(및 `Applications` 폴더로 드래그해서 설치하는 `.dmg`)를 만듭니다.

- **코드 서명·공증이 되어 있지 않습니다** (Apple Developer ID 인증서가 없어서 의도적으로
  뺐습니다). 만든 사람 본인 Mac에서 실행하는 건 문제없지만(첫 실행 시 우클릭 → 열기),
  **다른 사람에게 그대로 배포하면 macOS Gatekeeper가 "손상되었거나 확인할 수 없는
  개발자입니다" 경고를 띄웁니다.** 여러 사람에게 배포하려면 유료 Apple Developer Program
  인증서로 서명 + 공증이 추가로 필요합니다.
- 앱 아이콘은 아직 별도로 만들지 않아 Electron 기본 아이콘이 붙습니다.
- 패키징된 앱은 `npm run dev`로 띄운 개발용 앱과 **같은** 자격증명/배당 데이터
  (`~/Library/Application Support/@mystock/electron/`)를 씁니다 — `main.ts`가 앱 이름을
  고정해두기 때문에, dev에서 입력해둔 내용을 그대로 이어서 볼 수 있습니다.
- 설정 상세와 이 모노레포 구조 때문에 필요했던 우회(예: npm workspaces 심볼릭 링크
  처리)는 `electron/CLAUDE.md`의 "Mac 배포용 빌드" 절을 참고하세요.

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

## 주요 화면/기능

- **대시보드(Overview)** — 모든 브로커·계좌를 합쳐 보유종목 비중, 월별 배당금/비중, 매월
  수익률을 한 화면에서 봅니다(기본 랜딩 페이지).
- **보유 종목 / 매매내역 / 배당금** — 브로커·계좌별로 조회, CSV 가져오기/내보내기, Google
  Sheets 동기화를 지원합니다.
- **종목별 수익** — 전체 증권사·계좌의 보유종목을 종목 단위로 합쳐 투자금(매입금액)·현재평가금·
  누적배당금을 한 줄로 보여주고, 평가손익과 배당을 더한 총 수익/총 수익률까지 계산합니다
  (달러 보유분은 지금 환율, 달러 배당금은 지급월 평균 환율로 환산).
- **실현손익** — 매도 거래를 이동평균법으로 계산한 참고용 추정치(해외주식 양도소득세
  기본공제 250만원/22% 기준)를 보여줍니다. ISA/연금저축/IRP로 분류해둔 계좌는 이 22%
  계산에서 제외됩니다(분류는 설정 화면에서).
- **관심종목** — 보유하지 않은 종목의 현재가/차트만 추적합니다.
- **순자산 추이** — 하루 한 번 기록한 실제 자산 스냅샷으로 장기 추이를 보여줍니다.
- **데이터 백업/복원** — 설정 화면에서 전체 데이터를 zip으로 내려받거나 복원할 수 있습니다.
- **계좌 별칭 · 세금 유형** — 설정 화면에서 계좌마다 별칭을 붙이고(CSV 전용 브로커),
  세금 유형(ISA/연금저축/IRP/일반)을 지정합니다(모든 브로커).

## 다음 단계 (미구현)

- KIS 모의투자(paper trading) 지원
- 배포용 빌드 코드 서명/공증 (Apple Developer ID 필요 — 현재는 본인 Mac 실행 전용)
- 백엔드 dev 모드 파일 변경 시 Electron 자동 재시작
