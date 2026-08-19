// Mac 패키징 후처리 두 가지를 한 훅에서 순서대로 한다 — 반드시 이 순서여야 한다
// (로케일 파일을 지운 "다음"에 서명해야 서명이 실제 파일 구성과 일치한다).
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
    console.warn('[afterPack-mac-finalize] Electron Framework Resources 디렉터리를 찾지 못했습니다:', resourcesDir);
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

  console.log(`[afterPack-mac-finalize] Electron Framework에서 불필요한 로케일 ${removed}개 제거`);
}

function resignAdHoc(appPath) {
  execFileSync('codesign', ['--deep', '--force', '--sign', '-', appPath], { stdio: 'inherit' });
  console.log('[afterPack-mac-finalize] 번들 전체를 ad-hoc으로 재서명함:', appPath);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!fs.existsSync(appPath)) {
    console.warn('[afterPack-mac-finalize] 앱 번들을 찾지 못했습니다:', appPath);
    return;
  }

  trimLocales(appPath);
  resignAdHoc(appPath);
};
