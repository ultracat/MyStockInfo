import { app, BrowserWindow, dialog, Menu, nativeImage, shell } from 'electron';
import path from 'node:path';
import { startServer } from '@mystock/backend';

const BACKEND_PORT = 4317;
const FRONTEND_DEV_URL = 'http://localhost:5173';

// 런타임 아이콘. 실행 파일/설치본 아이콘(Finder·탐색기에서 보이는 것)은 빌드 때
// electron-builder가 박는 별개의 파일(build/icon.icns|ico|png)이고, 이 PNG는
// Linux의 **창/작업표시줄 아이콘**과 mac dev 실행의 **Dock 아이콘**용이다 —
// 둘 다 런타임에 지정하지 않으면 Electron 기본 아이콘이 그대로 보인다.
// `electron/assets/**`가 루트 package.json의 build.files에 있어야 asar에 들어간다.
// dev(electron/src)와 패키징(electron/dist) 둘 다 ../assets로 풀린다.
const APP_ICON_PATH = path.join(__dirname, '../assets/icon.png');

// Electron derives the default app name (and therefore
// `app.getPath('userData')`, where credentials.json/dividends.json/
// kis-token.json live) from whichever package.json it happens to find
// near the launched entry point — and it only looks for one when it's
// launched with a DIRECTORY (`electron .`), not a plain script path
// (`electron ./src/index.cjs`, what `npm run dev` uses so main.ts changes
// run via tsx without a separate compile step). Pin the name explicitly so
// userData is the same regardless of how this process was launched.
// '@mystock/electron' matches the historical default (from
// electron/package.json's scoped "name", which Electron used as a literal
// path segment — hence the nested "@mystock/electron" folder) so existing
// local data keeps working without migration.
app.setName('@mystock/electron');

// Mac은 기본 메뉴가 창 안이 아니라 OS 전역 메뉴바로 가서 눈에 안 띄지만(Cmd+Q 등
// 표준 단축키도 거기 얹혀 있어서 그대로 둔다), Windows/Linux는 기본 메뉴(File/Edit/
// View/Window)가 창 안에 그대로 그려져서 커스텀 메뉴 항목이 하나도 없는 이 앱에선
// 그냥 불필요한 줄로 보인다 — 그 두 플랫폼에서만 완전히 없앤다.
if (process.platform !== 'darwin') {
  Menu.setApplicationMenu(null);
} else {
  // ⚠ Mac에서 기본 메뉴를 **그대로** 두면 안 된다. Electron 기본 메뉴의 View에는
  // `zoomIn`/`zoomOut`/`resetZoom` 역할이 ⌘+ · ⌘- · ⌘0으로 들어 있는데, 이건
  // **페이지 줌**(`webContents.zoomLevel`)이다 — 렌더러가 CSS `transform: scale`로
  // 하는 화면 줌과 별개라서, 그대로 두면 ⌘+ 한 번에 두 줌이 **곱해진다**.
  // 메뉴 accelerator는 네이티브 쪽에서 먼저 잡아가므로 렌더러의 `preventDefault()`로는
  // 막을 수 없다 — 항목 자체를 빼서 그 조합이 렌더러까지 내려가게 한다.
  //
  // 기본 메뉴를 통째로 없애지는 않는다(⌘Q·⌘W·복사/붙여넣기가 전부 여기 얹혀 있다).
  // 나머지 표준 역할은 그대로 두고 줌 세 항목만 뺀 View를 직접 만든다.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      {
        label: '보기',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          // 화면 확대/축소(⌘+ · ⌘- · ⌘0)는 렌더러가 직접 처리한다 —
          // frontend/src/useZoom.ts 참고.
        ],
      },
      { role: 'windowMenu' },
    ]),
  );
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'MyStock',
    // Windows/Linux에서만 쓰인다(mac은 창 아이콘 개념이 없고 Dock 아이콘을 따로 지정).
    icon: APP_ICON_PATH,
    // 처음부터 보여주면 로드가 끝나기 전의 흰 화면이 그대로 노출된다 —
    // 렌더러가 첫 페인트를 마친 뒤('ready-to-show') 보여줘서 그 틈을 없앤다.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // 화면 줌은 렌더러가 CSS `transform: scale`로 직접 한다(frontend/CLAUDE.md의
  // "화면 줌" 절). 여기선 **Chromium이 같은 제스처에 자기 줌을 겹쳐 걸지 않도록**
  // 두 경로를 막는다 — 이게 없으면 핀치 한 번에 두 줌이 곱해진다.
  //
  // 1) 비주얼 줌(터치스크린/트랙패드 핀치로 페이지를 통째로 확대하는 것)을 1배로 고정.
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {
    // 창이 이미 닫혔으면 실패할 수 있다 — 줌은 부가 기능이라 조용히 넘긴다.
  });

  // 2) ⚠ 페이지 줌은 **origin별로 디스크에 기억된다.** 사용자가 이 앱(또는 같은
  //    localhost origin)에서 과거에 ⌘+를 눌러 페이지 줌이 남아 있으면, CSS 배율과
  //    **이중으로 곱해져** 똑같은 100%인데 화면이 커 보인다. 매 로드마다 1로 되돌린다.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(1);
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  } else {
    mainWindow.loadURL(FRONTEND_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // 렌더러가 target="_blank"로 여는 링크(연결된 Google 스프레드시트 바로가기 등)를
  // 앱 안 새 창이 아니라 시스템 브라우저로 연다.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // 패키징된 mac 앱은 번들의 .icns를 쓰므로 건드리지 않는다 — dev 실행만
  // Electron 기본 아이콘으로 뜨기 때문에 여기서 Dock 아이콘을 채워준다.
  if (process.platform === 'darwin' && !app.isPackaged) {
    const dockIcon = nativeImage.createFromPath(APP_ICON_PATH);
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  }

  // Runs in Electron's main process, so backend/src/credentials.ts can
  // reach `electron.safeStorage` and `electron.app.getPath('userData')`.
  const server = startServer(BACKEND_PORT);

  // startServer() no longer throws on a listen failure (e.g. a leftover
  // process from a previous run still holding the port) — it logs and
  // emits 'error' instead. Without this, the window would still open but
  // every API call would silently fail with no explanation.
  server.on('error', (err: NodeJS.ErrnoException) => {
    const message =
      err.code === 'EADDRINUSE'
        ? `포트 ${BACKEND_PORT}이 이미 사용 중이라 백엔드를 시작하지 못했습니다.\n` +
          `이전에 실행된 MyStock 프로세스가 남아있는지 확인 후 종료하고 다시 실행해주세요.`
        : `백엔드 서버 시작에 실패했습니다: ${err.message}`;
    dialog.showErrorBox('MyStock 시작 실패', message);
    app.quit();
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
