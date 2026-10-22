# MyStock

여러 증권사 Open API를 연동해 보유 종목, 매입가, 손익, 비중, 배당금을 한 화면에서 보는
Electron 데스크톱 앱. 현재 **토스증권**, **한국투자증권(KIS)**이 API로 연동되어 있고,
**삼성증권/미래에셋증권**은 API 연동 없이 CSV로 보유종목·매매내역을 직접 관리한다
(어댑터를 만들 계획 없음 — CSV 전용으로 확정된 결정, `backend/CLAUDE.md`의
`knownBrokers.ts` 참고). **KB증권**은 둘의 중간 형태다 — Open API를 연동했지만
`appKey`/`appSecret`이 발급 시점에 계좌 하나에만 고정 바인딩되는 구조라(계좌 목록
조회 API 자체가 없음) 토스/KIS처럼 여러 계좌를 실시간으로 보여줄 수 없다. 그래서
"CSV 전용 브로커의 로컬 저장소를 실시간 API로 채우는 자동 동기화"만 추가했다 —
그 계좌가 보유종목/매매내역 화면에 보이는 시점에 백그라운드로 동기화되고
수동 새로고침 버튼도 있다, `backend/CLAUDE.md`의 "KB증권 Open API" 절 참고.
새 증권사를 API로 연동하려면 아래
"브로커 확장 포인트"를 따르고, API 연동 없이 CSV로만 지원하려면
`backend/src/brokers/knownBrokers.ts`에 `hasApiIntegration: false`로 한 줄만
추가하면 된다.

> **`web-app` 브랜치**에 이 Electron 전용 구조를 건드리지 않고 일반 Node
> 서버로도 띄울 수 있게 만드는 작업(개인/가족용 1단계 웹 배포, PWA)이 진행
> 중이다 — `main`에는 사용자가 머지를 명시적으로 요청하기 전까지 들어오지
> 않는다. 상세는 그 브랜치의 `backend/CLAUDE.md` 참고.

## 워크스페이스 구조

npm workspaces 모노레포이며, 각 폴더에 더 상세한 `CLAUDE.md`가 있다.

```
backend/    Express 서버 — 증권사 API 호출, 자격증명 암호화 저장, 배당 기록 로컬 저장
frontend/   React + Vite 렌더러 UI
electron/   Electron 메인 프로세스 — backend를 같은 프로세스에서 구동하고 창을 띄움
```

## 왜 백엔드가 Electron 메인 프로세스 안에서 도는가

API 키 암호화(`Electron safeStorage`, OS 키체인 기반)가 Electron 메인 프로세스에서만
동작한다. `electron/src/main.ts`가 `@mystock/backend`를 직접 `import`해서 같은 프로세스
안에서 `startServer()`를 호출한다 — 별도 서버 프로세스가 아니다.

## 개발 워크플로

```bash
npm install
npm run build:backend   # electron이 dist/index.js를 require하므로 최초 1회 필요
npm run dev              # frontend(Vite) + electron을 동시에 실행
```

- **백엔드(`backend/src/**`)를 수정하면 `npm run build:backend`로 재빌드 후 Electron을
  재시작해야 반영된다.** Vite처럼 자동 반영되지 않는다.
- 프론트엔드(`frontend/src/**`)는 Vite HMR로 자동 반영된다.
- 백엔드는 `127.0.0.1:4317`에서만 리슨한다 (외부 노출 없음).
- `npm run build` (backend → frontend → electron 순서)로 전체 빌드 검증 가능.
- **앱 아이콘/로고의 원본은 `build/icon.svg` 하나다.** 바꾸려면 그 SVG를 고치고
  `npm run generate:icons`로 세 OS용 파일(`icon.icns`/`icon.ico`/`icons/`)과 런타임
  아이콘·파비콘·워드마크를 다시 만든다 — 생성물은 직접 고치지 않는다. 상세와 함정은
  `electron/CLAUDE.md`의 "앱 아이콘" 절 참고.
- `npm run package:mac`/`package:linux`/`package:win`으로 배포용 산출물(`.dmg`,
  `.AppImage`, `.exe` 설치본)을 만든다 — 상세 설정과 이 모노레포 구조 때문에 필요했던
  우회는 `electron/CLAUDE.md`의 "플랫폼별 배포용 빌드" 참고. 코드 서명/공증은 어느
  플랫폼도 안 돼 있어 Mac은 Gatekeeper, Windows는 SmartScreen 경고가 뜬다.

## 브로커 확장 포인트

새 증권사를 추가하려면:
1. `backend/src/brokers/<broker>/`에 어댑터 구현 (`BrokerAdapter` 인터페이스,
   `backend/src/brokers/types.ts` 참조)
2. `backend/src/brokers/registry.ts`에 등록
3. `backend/src/brokers/credentialFields.ts`에 그 브로커가 필요로 하는 자격증명 필드 선언
   → 설정 화면 폼이 자동으로 그에 맞게 렌더링됨 (프론트엔드 수정 불필요)

라우트/프론트엔드 코드는 `BrokerAdapter` 인터페이스만 의존하므로 그대로 재사용된다.

## 알아둘 것

- **각 증권사 API는 실제 공식 문서/레포를 확인하고 반영한다** — 필드명, 엔드포인트,
  에러 처리 방식을 추측하지 않는다 (토스: developers.tossinvest.com/docs, KIS:
  github.com/koreainvestment/open-trading-api).
- **API 자격증명은 절대 커밋하지 않는다.** 실제 저장 위치는 Electron의 userData
  디렉터리(`app.getPath('userData')`)이고, `backend/data/`는 Electron 밖에서 백엔드를
  단독 실행할 때(dev/테스트)만 쓰는 로컬 폴백 경로다 — `.gitignore`에서 제외됨.
- 배당금은 두 증권사 모두 "계좌에 실제 입금된 배당금" 조회 API가 없어 수동 입력 방식이다.
- 브로커별 상세(인증 방식, Rate Limit, 알려진 제약)는 `README.md`와
  `backend/CLAUDE.md`를 참고.

## 다음 단계 (미구현)

- KIS 모의투자(paper trading) 지원
- 배포용 빌드 코드 서명/공증 (Mac은 Apple Developer ID, Windows는 코드 서명 인증서
  필요 — 현재는 서명 없이 본인 머신 실행 전용)
- 백엔드 dev 모드 파일 변경 시 Electron 자동 재시작
