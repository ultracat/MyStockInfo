import { app, BrowserWindow, dialog, Menu } from 'electron';
import path from 'node:path';
import { startServer } from '@mystock/backend';

const BACKEND_PORT = 4317;
const FRONTEND_DEV_URL = 'http://localhost:5173';

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
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'MyStock',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  } else {
    mainWindow.loadURL(FRONTEND_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
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
