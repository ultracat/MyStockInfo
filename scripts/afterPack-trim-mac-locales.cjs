// electron-builder의 electronLanguages 옵션(package.json build 절)은 Windows/Linux의
// locales/*.pak은 정리하지만, Mac은 packager.getResourcesDir()가 앱 최상위
// Contents/Resources만 가리켜서 실제 무거운 Chromium 로케일 데이터가 들어있는
// Electron Framework.framework/Versions/A/Resources/*.lproj(개당 최대 ~1.6MB, 총합
// ~47MB — Windows의 locales/ 47MB와 같은 데이터)는 손대지 않는다(app-builder-lib
// 25.1.8, electron/ElectronFramework.js의 getLocalesConfig 확인, 2026-08-19). 그래서
// 이 afterPack 훅으로 같은 정리를 Mac 프레임워크 안에도 직접 적용한다 — 언어 목록은
// package.json의 electronLanguages(["ko","en-US"])와 같은 의도지만, Mac의 .lproj
// 이름은 "en-US"가 아니라 "en"이라 여기 따로 하드코딩한다(다국어 지원을 추가하면
// 이 배열도 같이 늘릴 것).
const fs = require('fs');
const path = require('path');

const WANTED_BASE_LANGUAGES = new Set(['ko', 'en']);

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const resourcesDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Frameworks',
    'Electron Framework.framework',
    'Versions',
    'A',
    'Resources'
  );

  if (!fs.existsSync(resourcesDir)) {
    console.warn('[afterPack-trim-mac-locales] Electron Framework Resources 디렉터리를 찾지 못했습니다:', resourcesDir);
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

  console.log(`[afterPack-trim-mac-locales] Electron Framework에서 불필요한 로케일 ${removed}개 제거`);
};
