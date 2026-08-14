import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { startServer } from '@mystock/backend';

const BACKEND_PORT = 4317;
const FRONTEND_DEV_URL = 'http://localhost:5173';

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
