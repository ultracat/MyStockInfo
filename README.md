<p align="center">
  <img src="build/wordmark.png" alt="MyStock" width="420">
</p>

# MyStock

여러 증권사에 흩어진 계좌의 보유 종목, 매입가, 손익, 비중, 배당금을 한 화면에서 보는 데스크톱 앱입니다
(macOS · Windows · Linux). 서버 없이 모든 데이터를 내 컴퓨터에만 저장합니다.

| 증권사 | 연동 방식 |
|---|---|
| **토스증권** | Open API — 계좌·보유 종목·매매내역 실시간 조회, **배당 자동 동기화** |
| **한국투자증권(KIS)** | Open API — 국내 계좌 보유 종목·매매내역 실시간 조회, **국내 배당 자동 동기화** |
| **KB증권** | Open API로 연동한 계좌 하나만 보유 종목·매매내역 자동 동기화, 나머지 계좌와 배당은 CSV·직접 입력 |
| **삼성증권 · 미래에셋증권** | API 연동 없음 — CSV로 보유 종목·매매내역 관리, 배당은 직접 입력 |

## 다운로드와 사용법

- **설치 파일**: [GitHub Releases](https://github.com/ultracat/MyStockInfo/releases)에서 OS에 맞는 파일을 받습니다.
  - macOS(Apple 칩) `.dmg`, Windows `.exe`, Linux `.AppImage`
- **사용자 매뉴얼**: [`doc/user-manual.md`](doc/user-manual.md) — 화면별 사용법, 증권사 API 키 발급 안내, 백업/복원, 문제 해결.
- ⚠ 설치 파일은 **OS별 코드 서명 인증서로 서명되어 있지 않아** 처음 실행할 때 macOS·Windows가 막습니다.
  OS별 허용 방법(macOS 15부터는 우클릭 → 열기가 통하지 않음)은
  [매뉴얼의 "서명하지 않은 앱 처음 실행하기"](doc/user-manual.md#서명하지-않은-앱-처음-실행하기)를 보세요.

## 주요 기능

- **대시보드** — 모든 증권사·계좌를 합친 총 매입/평가금액, 손익(배당 제외·포함), 보유 비중, 월별 배당금,
  월별 수익률, 순자산 추이(하루 한 번 기록한 실제 자산 스냅샷).
- **보유 종목** — 증권사·계좌별 손익과 비중, 그 계좌에서 그 종목으로 받은 배당까지 더한 **배당 포함 손익**.
- **종목별 수익** — 여러 계좌에 나눠 산 같은 종목을 합쳐 투자금·평가금·누적배당·총 수익률을 한 줄로.
- **배당금** — 월별·증권사별 배당과 배당수익률. 토스증권·한국투자증권은 API로 자동 동기화하고, 그 밖의 증권사는
  직접 기록합니다. 배당금은 **세후 실수령액**으로 저장하고 원천징수 세금은 따로 둡니다(세전 = 배당금 + 세금).
  달러 배당은 받은 달의 평균 환율로 원화 환산합니다.
- **매매내역 · 실현손익** — 월별 매수/매도, 이동평균법 실현손익과 해외주식 양도세 **참고용** 추정치
  (ISA·연금저축·IRP 계좌는 제외).
- **관심종목 · 종목 링크** — 보유하지 않은 종목의 현재가와 월별 종가 차트, 종목명을 눌렀을 때 열 웹페이지.
- **설정** — 증권사 API 키(OS 키체인 기반 암호화, 로컬 저장), 계좌 별칭·세금 유형, 수동 환율,
  **데이터 백업/복원**(비밀번호로 API 키까지 암호화), Google Sheets 연동(실험적 기능).
- **편의** — 화면 확대/축소(핀치 · ⌘휠 · ⌘+/−/0), 기본 포트가 사용 중이면 빈 포트로 자동 이동,
  중복 실행 시 기존 창을 앞으로 가져옴.

## 증권사별로 알아둘 점

### 토스증권
- 인증: OAuth2 Client Credentials(`Client ID` / `Client Secret`). 토스증권 WTS의 Open API 설정에서 **허용 IP**를
  등록해야 조회됩니다(매뉴얼 부록 참고).
- 계좌 목록을 API로 조회합니다. 환율(`GET /api/v1/exchange-rate`)을 실시간 조회하고, 설정에 수동 환율을
  넣으면 그 값이 우선합니다. 실시간 환율을 못 받으면 한국수출입은행 환율로 대체합니다.
- **배당**: 거래내역(`GET /api/v1/transactions`)에서 배당, 국내 ETF 분배금(입금으로 옴), 외화세금환급
  (메모 "외화세금환급")을 받아 토스 계좌의 배당 기록을 API 내용으로 맞춥니다. 우선주 배당은 보통주 코드로
  오므로 보유·매매한 우선주 코드로 저장합니다.
- 요청은 [공식 문서](https://developers.tossinvest.com/docs)의 Rate Limits 표에 맞춰 자동으로 속도를 조절합니다
  (`backend/src/brokers/toss/rateLimitGroups.ts` + 응답 `X-RateLimit-*` 헤더로 실시간 보정, 429는 자동 재시도).

### 한국투자증권 (KIS)
- API 명세 출처: [github.com/koreainvestment/open-trading-api](https://github.com/koreainvestment/open-trading-api)
- 인증: `POST /oauth2/tokenP`(JSON 바디). 접속 토큰은 하루 1회 발급 제한이 있어 저장해 두고 재사용합니다.
- **계좌 목록 조회 API가 없어** 계좌번호(8자리)와 상품코드(2자리, 종합계좌는 보통 `01`)를 설정에서 입력합니다.
- **실전투자 계좌·국내주식만** 지원합니다(모의투자 미지원). 성공/실패와 속도 제한은 HTTP 상태가 아니라
  응답 바디의 `rt_cd`/`msg_cd`로 판단하고, 보수적인 페이싱 + 지수 백오프로 처리합니다.
- **배당**: 기간별계좌권리현황조회(`CTRGA011R`)로 국내 배당·ETF 분배금을 받아 계좌의 배당 기록을 API 내용으로
  맞춥니다. 세전 배정금액에서 세금을 빼 세후로 저장하고, 지급 예정인 배당은 지급일이 지나야 들어옵니다.
  해외 배당을 계좌 기준으로 주는 API는 없습니다.

### KB증권
- `appKey`/`appSecret`이 발급 시점에 **계좌 하나에 묶여** 있고 계좌 목록 조회 API가 없습니다. 그래서 KB는
  CSV 전용 증권사처럼 로컬 저장소로 관리하되, API로 연동한 그 계좌의 보유 종목·매매내역만 화면에 들어갈 때
  자동으로 동기화합니다(수동 새로고침 버튼도 있음).
- IRP·연금저축과 예전 종합계좌는 API로 연동할 수 없어 CSV로 관리합니다. 배당은 직접 입력합니다.

### 삼성증권 · 미래에셋증권
- API 연동 없이 CSV(또는 Google Sheets)로 보유 종목·매매내역을 가져오고, 배당은 직접 입력합니다.

### 공통
- 토스증권·한국투자증권 계좌의 배당 행은 API가 원천이라 직접 수정하거나 CSV·Sheets로 가져올 수 없습니다.
- 환율을 가져오지 못하면 달러 금액을 억지로 합산하지 않고 "환율 미적용"으로 표시합니다.
- **API 자격증명은 절대 커밋되지 않습니다.** 실제 데이터는 OS의 앱 데이터 폴더에 저장됩니다(아래).

---

## 개발자용

### 구조

```
backend/    Express 서버 — 증권사 API 호출, 자격증명 암호화 저장, 로컬 저장소(보유종목·매매내역·배당 등)
frontend/   React + Vite 렌더러 UI
electron/   Electron 메인 프로세스 — backend를 같은 프로세스에서 구동하고 창을 띄움
doc/        사용자 매뉴얼과 스크린샷
```

- **왜 백엔드가 Electron 메인 프로세스 안에서 도나요?** API 키 암호화(`Electron safeStorage`, OS 키체인 기반)가
  Electron 메인 프로세스에서만 동작하기 때문입니다. `electron/src/main.ts`가 `@mystock/backend`를 직접 `import`해
  같은 프로세스에서 `startServer()`를 호출합니다. 백엔드는 `127.0.0.1`에서만 리슨하고, 요청마다 실행별 API 토큰을
  요구합니다.
- **브로커 확장 포인트**: `backend/src/brokers/types.ts`의 `BrokerAdapter`를 구현해 `registry.ts`에 등록하고,
  필요한 자격증명 필드를 `credentialFields.ts`에 선언하면 라우트·설정 화면 폼이 그대로 재사용됩니다.
  API 없이 CSV로만 지원하려면 `knownBrokers.ts`에 `hasApiIntegration: false`로 한 줄만 추가합니다.
- 각 폴더의 `CLAUDE.md`(= `AGENTS.md`, 심볼릭 링크)에 설계 이유와 함정이 정리돼 있습니다.

### 소스에서 실행

```bash
npm install
npm run build:backend   # electron이 backend/dist를 require하므로 최초 1회 필요
npm run dev              # frontend(Vite) + electron을 동시에 실행
npm test                 # 백엔드 자동 테스트
```

위 과정을 한 번에 해 주는 실행 파일도 있습니다(첫 실행이면 `npm install`까지 함). nvm/Homebrew로 설치한 node도
더블클릭 실행에서 찾습니다. 기본 포트(백엔드 4317, Vite 5173)를 다른 프로그램이 쓰고 있으면 다음 빈 포트로 옮겨 뜹니다.

| 플랫폼 | 실행 방법 |
|---|---|
| macOS | Finder에서 `start-mac.command` 더블클릭 (또는 터미널에서 `./start.sh`) |
| Linux | 터미널에서 `./start.sh` |
| Windows | 탐색기에서 `start-windows.bat` 더블클릭 |

> 백엔드(`backend/src/**`)를 고치면 `npm run build:backend`로 다시 빌드하고 Electron을 재시작해야 반영됩니다.
> 프론트엔드(`frontend/src/**`)는 Vite가 자동 반영합니다.

**데이터 위치**: 설치본과 `npm run dev`는 **같은** 데이터 폴더를 씁니다(`main.ts`가 앱 이름을 고정) —
macOS `~/Library/Application Support/@mystock/electron/data/`, Windows `%APPDATA%\@mystock\electron\data\`,
Linux `~/.config/@mystock/electron/data/`. `backend/data/`는 Electron 밖에서 백엔드만 단독 실행할 때(개발·테스트)
쓰는 폴백이며 `.gitignore`에 있습니다.

### 배포용 빌드

```bash
npm run package:mac     # .dmg   (Apple 칩)
npm run package:linux   # .AppImage
npm run package:win     # .exe (NSIS)
```

전체를 빌드한 뒤 `electron-builder`로 `release/`에 산출물을 만듭니다. Apple Silicon 맥에서는 Windows·Linux
산출물을 만들 수 없어(크로스 빌드 도구가 x86_64 전용) 정식 배포는 GitHub Actions로 합니다. 모노레포 구조 때문에
필요했던 우회와 플랫폼별 설정은 `electron/CLAUDE.md`를 참고하세요.

### 릴리스

1. 루트 `version.json`의 버전을 올립니다(단일 원천 — `package.json`은 빌드 스크립트가 맞추고,
   `package-lock.json`은 같이 고칩니다).
2. 커밋 후 `git tag -a vX.Y.Z -m "..." && git push origin vX.Y.Z`
3. Actions가 세 OS 러너에서 산출물을 만들고 **초안** 릴리스를 올립니다. 내용을 확인하고 직접 공개하세요.

필요한 OS만 빌드하려면 Actions 탭에서 수동 실행 후 플랫폼을 고르면 됩니다(릴리스는 만들지 않음).
Google Sheets·실시간 환율용 키는 저장소 Secrets(`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `EXIMBANK_AUTH_KEY`)로
넣으며, 없으면 템플릿으로 빌드돼 두 기능만 동작하지 않습니다.

### 로고

파란 스퀘어클 위의 흰 **M**은 앱 이름(**My** Stock)이자, 왼쪽보다 오른쪽 봉우리가 높은 비대칭이라
"올랐다 → 조정받았다 → 더 올랐다"는 주가 선으로도 읽힙니다. M의 오른쪽 기둥 위 초록 점은 그 기둥을 소문자
**i**(information)로 만들어 "여러 증권사의 정보를 한 화면에 모은다"는 역할을 가리키고, 현재가 데이터 포인트로도
읽힙니다. 원본은 `build/icon.svg` 하나이고, 세 OS용 아이콘과 런타임 아이콘·파비콘·워드마크는 전부
`npm run generate:icons`로 생성합니다 — 생성물은 직접 고치지 마세요(`electron/CLAUDE.md`의 "앱 아이콘" 절).

### 다음 단계 (미구현)

- KIS 모의투자(paper trading)·해외주식 지원
- 코드 서명/공증(macOS Apple Developer ID, Windows 코드 서명 인증서) — 지금은 서명 없이 배포
- Intel Mac용 설치 파일
- 백엔드 dev 모드 파일 변경 시 Electron 자동 재시작

## 라이선스

MyStock은 **이중 라이선스**로 배포됩니다.

- **AGPL-3.0 (오픈소스)** — [`LICENSE`](LICENSE) 조건을 지키면 누구나 사용·수정·배포할 수 있습니다.
  수정한 버전을 배포하거나 **네트워크 서비스로 다른 사람이 쓰게 하면, 그 전체 소스를 같은 AGPL-3.0으로 공개**해야 합니다.
- **상업 라이선스** — 소스를 공개하지 않고 제품·서비스에 포함하는 등 AGPL-3.0 조건을 따를 수 없는 상업적 이용은
  저작권자의 허락(별도 상업 라이선스)이 필요합니다. 이메일 [ultracat.lcw@gmail.com](mailto:ultracat.lcw@gmail.com)으로 문의해 주세요.

기여는 fork → Pull Request로 받으며, 기여 코드도 두 라이선스로 배포할 수 있도록
[기여자 라이선스 동의서(CLA)](CLA.md)에 동의해 주셔야 합니다 — [CONTRIBUTING.md](CONTRIBUTING.md) 참고.

Copyright © 2026 ChangWoo Lee
