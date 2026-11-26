# MyStock

여러 증권사 Open API를 연동해 보유 종목, 매입가, 손익, 비중, 배당금을 한 화면에서 보는
Electron 데스크톱 앱. API 연동: **토스증권**, **한국투자증권(KIS, 국내 + 미국)**, **NH투자증권(나무, 모의투자 포함)**,
**키움·LS·DB증권(셋 다 실키 미확인)**. **삼성증권/미래에셋증권**은 CSV로만 관리한다(어댑터를 만들 계획 없음 — 확정된 결정).
**KB증권**은 중간 형태 — 앱키가 계좌 하나에 고정돼(계좌 목록 API 없음) 여러 계좌를 실시간으로 못 보여 줘서, CSV 전용 저장소를 API로
채우는 자동 동기화만 한다(`backend/CLAUDE.md` "KB증권 Open API"). 새 증권사: API 연동은 아래 "브로커 확장 포인트", CSV 전용은
`backend/src/brokers/knownBrokers.ts`에 `hasApiIntegration: false` 한 줄.

## 워크스페이스 구조

npm workspaces 모노레포이며, 각 폴더에 더 상세한 `CLAUDE.md`가 있다. 같은 폴더의 `AGENTS.md`는
`CLAUDE.md`를 가리키는 심볼릭 링크다(다른 코딩 에이전트도 같은 지침을 읽게) — **`CLAUDE.md`만 고친다.**

```
backend/    Express 서버 — 증권사 API 호출, 자격증명 암호화 저장, 로컬 저장소(보유종목·매매·배당 등)
frontend/   React + Vite 렌더러 UI
electron/   Electron 메인 프로세스 — backend를 같은 프로세스에서 구동하고 창을 띄움
doc/        사용자 매뉴얼(user-manual.md) + 스크린샷(images/) — 버전별 변경은 루트 CHANGELOG.md
```

- **사용자가 보는 동작을 바꾸면 `doc/user-manual.md`와 `README.md`도 같은 커밋에서 고친다** — 둘 다 공개
  저장소의 사용자 문서다. 매뉴얼 스크린샷은 **금액·종목·계좌·이메일을 찍기 전에 DOM 텍스트를 가짜 문자로 바꾸고
  블러를 겹친 뒤, OCR로 실데이터가 안 읽히는지 확인**해서 넣는다(사용자 데이터 사본으로 따로 띄운 인스턴스에서,
  `--user-data-dir` + `--remote-debugging-port`, 토스 토큰이 계정당 1개라 메인 앱은 닫고). 원본 캡처는 저장소에 두지 않는다.
  관심종목 상세처럼 종목 하나를 크게 보여 주는 화면은 사본의 관심종목·매매내역을 **사용자가 보유하지 않은 공개 종목과 가짜 계좌**로 바꿔 찍어도 된다
  (2026-11-19 — 보유 종목 목록과 대조해 고르고, 그래도 OCR 확인은 한다).

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

- **`npm run dev` 중엔 백엔드(`backend/src/**`)·Electron 메인(`electron/src/**`)을 고치면 저절로 다시 빌드하고 Electron을 다시 띄운다**
  (`scripts/dev-electron.cjs` — `tsc -w`가 오류 0건으로 끝날 때마다, 오류가 있으면 지금 앱을 둔다. 다시 뜰 때마다 토스 토큰을 새로 받는다).
  프론트엔드(`frontend/src/**`)는 Vite HMR로 자동 반영된다. dev 밖에서 백엔드를 쓰는 것(실서버 점검 `check:*` 등)은 여전히 `npm run build:backend`.
- 백엔드는 `127.0.0.1`에서만 리슨한다 (외부 노출 없음). 포트는 4317이 기본이고, 사용 중이면
  빈 포트로 옮긴다(dev Vite 5173도 마찬가지) — `electron/CLAUDE.md`의 "포트는 고정이 아니다" 참고.
- `npm run build` (backend → frontend → electron 순서)로 전체 빌드 검증 가능.
- **증권사 공식 명세 감시**: `spec:check`/`spec:update`/`spec:types`(쓰는 API 목록 `backend/spec/watch.json`, 생성 타입 `*Spec.gen.ts`는 손으로 안 고침),
  KIS는 `kis:verify`/`kis:record`, 실서버 점검 `-- --record`, 매주 `spec-watch.yml`이 업데이트 PR — 전부 `backend/CLAUDE.md` "공식 명세 감시".
- `npm test`(백엔드 + 프론트엔드 순수 함수 + Electron 로그 가림 테스트), `npm run lint`(ESLint — 스타일이 아니라 `await` 누락·Promise 조건·React 훅
  규칙·프론트의 `toISOString().slice` 금지만, `eslint.config.mjs`), `npm run typecheck:test`(테스트 파일까지 타입 검사 — `tsx --test`는 타입을 안 본다).
  **푸시·PR마다 `.github/workflows/ci.yml`이 build → lint → typecheck:test → test → `npm audit --omit=dev`**를 돌린다 — `backend/CLAUDE.md` "자동 테스트".
  CI의 Node는 **`.nvmrc`(24 — Electron 번들 Node와 같은 메이저)** 하나로 정한다. Electron 메이저를 올리면 `.nvmrc`·`@types/node`도 같이.
- **앱 아이콘 원본은 `build/icon.svg` 하나** — 고친 뒤 `npm run generate:icons`, 생성물은 직접 안 고침(`electron/CLAUDE.md` "앱 아이콘").
- **화면 줌은 CSS `transform: scale`(돋보기 줌)** — 페이지 줌이 아니다. 사이드바는 배율 밖, 확대하면 리플로우 없이 스크롤. 배율의 단일 원천은
  `frontend/src/useZoom.ts` — `frontend/CLAUDE.md`·`electron/CLAUDE.md`의 "화면 줌" 절.
- **릴리스는 GitHub Actions**(Apple Silicon에선 Windows·Linux 크로스 빌드 불가): `version.json`만 올리고 `npm run release:tag` →
  `release:build`(세 OS 빌드 + **초안** 릴리스, 노트는 `CHANGELOG.md`). 로컬 산출물은 `npm run package:mac|linux|win`. 코드 서명 없음 →
  Gatekeeper·SmartScreen 경고 — `electron/CLAUDE.md` "GitHub Actions 릴리스"·"플랫폼별 배포용 빌드".

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
- **API 자격증명은 절대 커밋하지 않는다.** **빌드에 넣는 비밀값은 없다** — 외부 서비스 키(Google OAuth 클라이언트,
  수출입은행 환율)는 개발자 키를 넣지 않고 사용자가 설정에서 입력한다(`backend/CLAUDE.md` "환율 조회"·"Google Sheets 연동"). 실제 저장 위치는 Electron의 userData
  디렉터리(`app.getPath('userData')`)이고, `backend/data/`는 Electron 밖에서 백엔드를
  단독 실행할 때(dev/테스트)만 쓰는 로컬 폴백 경로다 — `.gitignore`에서 제외됨.
- **커밋 작성자는 저장소 소유자 한 사람**(`ultracat <ultracat.lcw@gmail.com>`)이다 — Claude 공동작성자
  트레일러를 넣지 않는다. 쓰기 권한도 소유자만 있고 외부 변경은 fork → PR로 받는다
  (`.github/CODEOWNERS`가 리뷰어를 자동 지정). **저장소는 공개(public)다**(2026-11-09 전환). 적용된 설정:
  - `main`/`v*` 태그 보호 규칙(GitHub rulesets) — 정의는 `.github/rulesets/*.json`. `main`은 PR·리뷰 필수,
    강제 push·삭제 금지, 태그는 생성·수정·삭제 금지. **관리자 역할은 항상 우회**라 소유자는 `main`에 직접
    push하고 태그를 만들 수 있다. JSON을 고치면 GitHub 쪽 규칙도
    `gh api -X PUT repos/ultracat/MyStockInfo/rulesets/<id> --input <json>`으로 같이 갱신한다(파일만 고치면 반영 안 됨).
  - 외부 기여자 PR은 Actions 실행 전 소유자 승인 필요, 비밀값 스캔 + push 차단, 비공개 취약점 신고,
    Actions 기본 토큰은 읽기 전용(릴리스 잡만 `contents: write`).
- **라이선스는 AGPL-3.0 + 상업 라이선스(이중 라이선스)**다 — `LICENSE`(GNU 공식 원문 그대로, 고치지 않는다),
  `package.json`의 `"license": "AGPL-3.0-only"`, README "라이선스" 절. 외부 PR은 `CLA.md` 동의(PR 템플릿 체크박스)가
  있어야 반영한다 — 기여 코드도 상업 라이선스로 재허락하려면 그 권리가 필요해서다. 새 의존성은 AGPL-3.0과 호환되는
  라이선스만 들인다.
- **실제 계좌번호·금액·보유 종목 같은 개인 데이터를 코드·문서·예시값에 쓰지 않는다** — 예시는
  `123-45-678901`처럼 가짜 값으로(2026-11 공개 준비 때 이력에서 실제 계좌번호를 지웠다).
- 배당금은 **토스·한국투자·NH·키움·LS·DB증권은 API가 원천**이다 — 배당금 화면 진입 시 그 계좌 배당 기록을 API 내용으로
  통째로 교체하고(직접 수정·가져오기 불가, **KIS·LS 달러 배당만 예외로 수동**), 다른 증권사는 직접 입력한다. `amount`는
  **세후**, `tax`는 원천징수 세금(세전 = 합). `backend/CLAUDE.md`의 "배당 동기화(토스·한국투자증권·NH)" 절.
- 계좌와 무관한 **API 부가 기능**(장 상태·매수 유의사항·지수·섹터(ETF 포함), 다가오는 배당, KIS 공식 실현손익,
  종목 정보·ETF 구성, 토스·NH·키움 투자원금)과 **KIS 해외주식·NH(실데이터 미검증, 모의투자 합계 제외)·키움(실키 미확인)**은 `backend/CLAUDE.md`의 해당 절.
- **사용자 계획·목표 값(월 배당 목표·ISA/연금 납입과 한도·목표 비중·알림·목표가·은퇴 시뮬레이션·적립식 계획)은 `planner.json` 하나**, OS 알림과 보고서 PDF는 백엔드가 메인 프로세스에서 —
  `backend/CLAUDE.md` "계획·목표 값, 알림, 보고서 PDF". 세법 한도는 기본값이 2025년 확정치라 개정되면 화면에서 바꾼다.
- **화면 공용 부품**(2026-11-18 UX 정리): 설명 문단은 `Hint`(한 줄 + 자세히), 버튼 묶음은 `ActionMenu`, 긴 화면은 `SectionNav`, 표 열 정렬은 `SortButton`, 표의 종목·계좌 칸은 `StockCell`·`AccountCell`(코드·번호 위, 이름·별칭 아래 작게), 차트 폭은 `useContainerWidth`,
  표는 금액 칸 안 `cell-sub`로 열을 줄인다 — 새 화면·카드도 이걸 쓴다. `frontend/CLAUDE.md` "화면 UX 정리" 절.
- **보안 하드닝**(CSP·fuses·원격 디버깅 차단)은 `electron/CLAUDE.md` "보안 하드닝" 절 — 렌더러에 외부 자원을 들이면 **패키징본에서만** 깨진다.
- 브로커별 상세(인증·Rate Limit·제약)는 `README.md`와 `backend/CLAUDE.md`. 연동 점검은 `npm test`(가짜 서버) + `npm run check:<broker>`(실서버).

## 다음 단계 (미구현)

- **키움·LS·DB 실키 연동 확인**(키를 받으면 `check:kiwoom`/`check:ls`/`check:db -- --record` 먼저), KIS 해외·NH 실데이터 검증(`check:kis`/`check:nh`), KIS 모의투자
- 배포용 빌드 코드 서명/공증 (Mac Apple Developer ID, Windows 코드 서명 인증서 — 현재는 서명 없이 배포)
