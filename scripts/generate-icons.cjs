/**
 * build/icon.svg(단일 원천) 하나에서 세 OS용 아이콘 파일을 전부 만든다.
 *
 *   build/icon.png            1024  — 마스터 PNG(나머지 전부의 원본)
 *   build/icons/<N>x<N>.png         — Linux 아이콘 세트(electron-builder가 hicolor에 설치)
 *   build/icon.icns                 — macOS 실행 파일/DMG 아이콘
 *   build/icon.ico                  — Windows 실행 파일/NSIS 설치본 아이콘
 *   build/wordmark.png        1800x600 — README/문서용 워드마크
 *   electron/assets/icon.png  512   — 런타임 아이콘(Linux 창, mac dev Dock)
 *   frontend/public/icon.svg        — 브라우저 탭 파비콘(Vite dev 화면)
 *
 * 실행:  npm run generate:icons      (= electron scripts/generate-icons.cjs)
 *
 * 왜 Electron으로 렌더하나: 이 머신에 ImageMagick/rsvg/inkscape가 없다. 이미
 * 의존성으로 있는 Electron의 Chromium이 가장 정확한 SVG 렌더러이고, 크기별
 * 리샘플링은 macOS 기본 `sips`, icns 패키징은 `iconutil`로 한다. ICO는 표준
 * 포맷이 PNG를 그대로 품을 수 있어서 헤더만 직접 쓴다(아래 writeIco).
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const RUNTIME_DIR = path.join(ROOT, 'electron', 'assets');

/**
 * 렌더용 투명 창. **창 하나를 재사용한다** — 두 번째 BrowserWindow를 새로 만들면
 * 그 창의 첫 로드가 ERR_FAILED로 거부됐다(투명+프레임 없는 창을 destroy한 직후
 * 같은 프로세스에서 또 만들 때 재현). 크기만 매번 바꿔서 다시 로드한다.
 */
let renderWindow = null;

function getRenderWindow() {
  if (!renderWindow) {
    renderWindow = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: false },
    });
  }
  return renderWindow;
}

/**
 * SVG 파일을 지정한 픽셀 크기로 렌더해 PNG 버퍼를 돌려준다.
 * SVG 마크업을 HTML에 **인라인**한다 — `<img src="...svg">`로 참조하면 Chromium이
 * file:// 페이지의 file:// 하위 리소스를 막아서 깨진 이미지가 캡처됐다.
 */
async function renderSvg(svgPath, width, height, tmpDir) {
  const stem = `${path.basename(svgPath, '.svg')}-${width}x${height}`;
  const htmlPath = path.join(tmpDir, `${stem}.html`);
  fs.writeFileSync(
    htmlPath,
    `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${width}px;height:${height}px}</style>
    ${fs.readFileSync(svgPath, 'utf8')}`,
  );

  const win = getRenderWindow();
  win.setContentSize(width, height);
  await win.loadFile(htmlPath);
  // 첫 페인트가 끝나기 전에 캡처하면 투명한 빈 이미지가 나온다.
  await new Promise((resolve) => setTimeout(resolve, 500));
  let image = await win.webContents.capturePage();

  // HiDPI 화면에서는 캡처가 2배 크기로 돌아온다 — 항상 요청한 픽셀로 맞춘다.
  const size = image.getSize();
  if (size.width !== width || size.height !== height) {
    image = image.resize({ width, height, quality: 'best' });
  }
  if (image.isEmpty()) throw new Error(`렌더 결과가 비어 있다: ${svgPath}`);
  return image.toPNG();
}

/** PNG들을 그대로 품는 ICO 파일을 쓴다(Vista 이후 표준 형식). */
function writeIco(outPath, entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // 256은 0으로 적는 것이 규약
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // 팔레트 색 수(트루컬러는 0)
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    dir.push(e);
  }
  fs.writeFileSync(outPath, Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]));
}

/** sips로 1024 PNG를 size로 리샘플링해 PNG 버퍼를 돌려준다. */
function resizePng(srcPath, size, tmpDir) {
  const out = path.join(tmpDir, `${size}.png`);
  execFileSync('/usr/bin/sips', ['-z', String(size), String(size), srcPath, '--out', out], {
    stdio: 'ignore',
  });
  return fs.readFileSync(out);
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(BUILD, { recursive: true });
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mystock-icons-'));

    // 1) 1024 마스터 PNG (Linux용 + 나머지 전부의 원본)
    const masterPath = path.join(BUILD, 'icon.png');
    fs.writeFileSync(masterPath, await renderSvg(path.join(BUILD, 'icon.svg'), 1024, 1024, tmpDir));
    console.log('✓ build/icon.png (1024)');

    // 2) macOS .icns — iconset 폴더를 만들고 iconutil로 묶는다
    const iconset = path.join(tmpDir, 'icon.iconset');
    fs.mkdirSync(iconset, { recursive: true });
    for (const base of [16, 32, 128, 256, 512]) {
      fs.writeFileSync(path.join(iconset, `icon_${base}x${base}.png`), resizePng(masterPath, base, tmpDir));
      fs.writeFileSync(
        path.join(iconset, `icon_${base}x${base}@2x.png`),
        resizePng(masterPath, base * 2, tmpDir),
      );
    }
    execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(BUILD, 'icon.icns')], {
      stdio: 'inherit',
    });
    console.log('✓ build/icon.icns');

    // 3) Windows .ico
    const icoSizes = [16, 24, 32, 48, 64, 128, 256];
    writeIco(
      path.join(BUILD, 'icon.ico'),
      icoSizes.map((size) => ({ size, data: resizePng(masterPath, size, tmpDir) })),
    );
    console.log(`✓ build/icon.ico (${icoSizes.join(', ')})`);

    // 4) Linux 아이콘 세트 — electron-builder의 linux.icon에 **디렉터리**를 주면
    //    여기 있는 크기를 전부 hicolor에 설치한다. 단일 PNG를 주면 그 크기 하나만
    //    설치돼서(실측: 1024 하나뿐) 데스크톱 메뉴/작업표시줄이 매번 축소해 써야 한다.
    const linuxDir = path.join(BUILD, 'icons');
    fs.rmSync(linuxDir, { recursive: true, force: true });
    fs.mkdirSync(linuxDir, { recursive: true });
    const linuxSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
    for (const size of linuxSizes) {
      fs.writeFileSync(path.join(linuxDir, `${size}x${size}.png`), resizePng(masterPath, size, tmpDir));
    }
    console.log(`✓ build/icons/ (${linuxSizes.join(', ')})`);

    // 5) 런타임 아이콘 — BrowserWindow.icon / app.dock.setIcon용 (asar에 들어간다)
    fs.writeFileSync(path.join(RUNTIME_DIR, 'icon.png'), resizePng(masterPath, 512, tmpDir));
    console.log('✓ electron/assets/icon.png (512)');

    // 6) 프론트엔드 파비콘 — 원본 SVG를 그대로 복사한다(브라우저가 SVG를 직접 읽는다).
    //    Vite가 frontend/public/을 dist 루트로 복사하고, index.html이 './icon.svg'로 건다.
    const publicDir = path.join(ROOT, 'frontend', 'public');
    fs.mkdirSync(publicDir, { recursive: true });
    fs.copyFileSync(path.join(BUILD, 'icon.svg'), path.join(publicDir, 'icon.svg'));
    console.log('✓ frontend/public/icon.svg');

    // 7) 워드마크(README/문서용)
    const wordmark = path.join(BUILD, 'wordmark.svg');
    if (fs.existsSync(wordmark)) {
      fs.writeFileSync(path.join(BUILD, 'wordmark.png'), await renderSvg(wordmark, 1800, 600, tmpDir));
      console.log('✓ build/wordmark.png (1800x600)');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    app.exit(0);
  } catch (err) {
    console.error('아이콘 생성 실패:', err);
    app.exit(1);
  }
});
