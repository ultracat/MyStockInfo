// 패키징 후처리(electron-builder afterPack 훅) — 모든 OS에서 0) Electron fuses를 끄고/켜고,
// Mac은 이어서 1) 로케일 정리 2) 번들 전체 ad-hoc 재서명을 한다. 반드시 이 순서여야 한다
// (fuse를 바꾸고 로케일 파일을 지운 "다음"에 서명해야 서명이 실제 파일 구성과 일치한다).
//
// 0) Electron fuses: 실행 파일에 박힌 기능 스위치라 런타임 코드로는 못 바꾸고, 패키징된
//    바이너리를 직접 고쳐야 한다(@electron/fuses). electron-builder 25에는 fuse 설정이 없어
//    여기서 한다. 목적은 "설치된 MyStock 실행 파일을 다른 용도로 쓰지 못하게" — 이 앱은
//    증권사 자격증명을 키체인(safeStorage)으로 풀 수 있는 프로세스라, 같은 실행 파일을
//    Node로 돌리거나(ELECTRON_RUN_AS_NODE·NODE_OPTIONS) 디버거를 붙이거나(--inspect)
//    asar를 바꿔치기하면 그 권한으로 남의 코드가 돈다. 각 fuse의 이유는 FUSES 옆 주석.
//    dev 실행(`npm run dev`, `electron scripts/*.cjs`)은 node_modules의 Electron을 그대로
//    쓰므로 영향이 없다 — 바뀌는 건 release/ 안의 패키징 결과물뿐이다.
//
// 1) 로케일 정리: electron-builder의 electronLanguages 옵션(package.json build 절)은
//    Windows/Linux의 locales/*.pak은 정리하지만, Mac은 packager.getResourcesDir()가
//    앱 최상위 Contents/Resources만 가리켜서 실제 무거운 Chromium 로케일 데이터가
//    있는 Electron Framework.framework/Versions/A/Resources/*.lproj(개당 최대
//    ~1.6MB, 총합 ~47MB — Windows의 locales/ 47MB와 같은 데이터)는 손대지 않는다
//    (app-builder-lib 25.1.8, electron/ElectronFramework.js의 getLocalesConfig 확인,
//    2026-08-19). 그래서 여기서 그 경로를 직접 정리한다 — 언어 목록은 package.json의
//    electronLanguages(["ko","en-US"])와 같은 의도지만, Mac의 .lproj 이름은 "en-US"가
//    아니라 "en"이라 따로 하드코딩한다(다국어 지원을 추가하면 이 배열도 같이 늘릴 것).
//
// 2) 전체 번들 ad-hoc 재서명: 이 프로젝트는 `identity: null`로 실제 코드 서명을
//    생략하는데, 그러면 Electron이 미리 심어둔 "linker-signed" ad-hoc 서명만 남는다.
//    이 서명은 번들 전체를 감싸는 리소스 시일(_CodeSignature/CodeResources) 없이
//    Mach-O 실행 파일 하나만 가리키는 불완전한 상태라(`codesign --verify --deep
//    --strict`가 "code has no resources but signature indicates they must be
//    present"로 실패, 실측 확인 2026-08-19 — 로케일 정리와 무관하게 원래부터 이랬음),
//    이 앱을 빌드한 맥에서는(quarantine 속성이 없어 Gatekeeper가 서명 검증 자체를
//    건너뜀) 문제없이 실행되지만, 다른 맥으로 옮기면(다운로드/AirDrop 등으로
//    quarantine이 붙으면) Gatekeeper가 서명 불일치를 "손상된 앱"으로 판정해 실행을
//    막는다("휴지통으로 이동해야 합니다" 다이얼로그). `codesign --deep --force
//    --sign -`(하이픈 = ad-hoc, 유료 Apple Developer 인증서 불필요)로 번들 전체를
//    다시 서명하면 리소스 시일이 새로 생겨 이 구조적 문제가 해결된다 — 여전히
//    Apple 공증은 안 된 상태라 "확인되지 않은 개발자" 경고 자체는 그대로 뜨지만
//    (README.md에 이미 안내돼 있는 대로), "손상됨"처럼 무조건 막히지는 않고
//    우클릭 "열기"로 우회 가능한 정상적인 Gatekeeper 흐름으로 돌아온다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

const FUSES = {
  version: FuseVersion.V1,
  // ELECTRON_RUN_AS_NODE=1로 실행 파일을 순수 Node처럼 쓰는 길을 막는다. 앱은 자식 프로세스를
  // 쓰지 않는다(백엔드도 메인 프로세스 안에서 돈다 — 루트 CLAUDE.md).
  [FuseV1Options.RunAsNode]: false,
  // NODE_OPTIONS(--require 등)로 시작 시 임의 코드를 끼워 넣는 길을 막는다.
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  // --inspect/--inspect-brk로 메인 프로세스에 디버거를 붙이는 길을 막는다.
  // (Chromium의 --remote-debugging-port는 이 fuse와 무관하다 — 렌더러 디버깅용이고 메인엔 못 붙는다.)
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  // app.asar가 빌드 때 기록된 해시와 다르면 실행을 거부한다(Mac·Windows만 지원, Linux는 무시).
  // 해시는 electron-builder가 Info.plist(ElectronAsarIntegrity)·exe 리소스에 넣는다.
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  // app.asar 옆에 app/ 폴더를 두어 앱 코드를 바꿔치기하는 길을 막는다(asar만 읽는다).
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  // ⚠ EnableCookieEncryption은 켜지 않는다(기본값 꺼짐 그대로) — 켰더니 시작할 때 네트워크 서비스가
  //   키체인 키를 먼저 받으려고 해서, 서명이 매 빌드 바뀌는(ad-hoc) 앱은 키체인 허용 창에 답하기 전까지
  //   화면의 모든 fetch가 멈췄다("불러오는 중…"에서 정지, 2026-11-16 실측). 이 앱은 쿠키를 쓰지 않아 얻는 게 없다.
  // ⚠ GrantFileProtocolExtraPrivileges는 기본값(켜짐) 그대로 둔다 — 패키징된 앱은 화면을
  //   file://로 연다(loadFile). 끄면 file:// 페이지가 일반 Chrome처럼 취급돼 Vite가 만든
  //   <script type="module" crossorigin>이 막힐 수 있다. 화면을 커스텀 프로토콜(app://)로
  //   옮기면 그때 끈다.
};

function electronBinaryPath(context) {
  const name = context.packager.appInfo.productFilename;
  switch (context.electronPlatformName) {
    case 'darwin':
    case 'mas':
      return path.join(context.appOutDir, `${name}.app`); // fuses가 Electron Framework를 찾아 들어간다
    case 'win32':
      return path.join(context.appOutDir, `${name}.exe`);
    default:
      return path.join(context.appOutDir, context.packager.executableName);
  }
}

async function applyFuses(context) {
  const target = electronBinaryPath(context);
  // Mac은 아래 resignAdHoc이 번들 전체를 다시 서명하므로 여기서 서명을 따로 만지지 않는다.
  await flipFuses(target, FUSES);
  console.log('[afterPack] Electron fuses 적용:', target);
}

const WANTED_BASE_LANGUAGES = new Set(['ko', 'en']);

function trimLocales(appPath) {
  const resourcesDir = path.join(
    appPath,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  if (!fs.existsSync(resourcesDir)) {
    console.warn('[afterPack] Electron Framework Resources 디렉터리를 찾지 못했습니다:', resourcesDir);
    return;
  }

  let removed = 0;
  for (const entry of fs.readdirSync(resourcesDir)) {
    if (!entry.endsWith('.lproj')) continue;
    // "ko.lproj"/"en.lproj"뿐 아니라 성별 굴절형(en_FEMININE.lproj 등)도 base
    // language가 일치하면 같이 남긴다 — 어차피 용량이 미미해서 굳이 더 세밀하게
    // 가를 이유가 없다.
    const baseLanguage = entry.replace('.lproj', '').split('_')[0];
    if (WANTED_BASE_LANGUAGES.has(baseLanguage)) continue;

    fs.rmSync(path.join(resourcesDir, entry), { recursive: true, force: true });
    removed++;
  }

  console.log(`[afterPack] Electron Framework에서 불필요한 로케일 ${removed}개 제거`);
}

function resignAdHoc(appPath) {
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log('[afterPack] 번들 전체를 ad-hoc으로 재서명함:', appPath);
}

module.exports = async function afterPack(context) {
  await applyFuses(context);
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn('[afterPack] 앱 번들을 찾지 못했습니다:', appPath);
    return;
  }

  trimLocales(appPath);
  resignAdHoc(appPath);
};
