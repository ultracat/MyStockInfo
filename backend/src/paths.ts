import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolves where local data (encrypted credentials, dividend records) is
 * stored. Uses Electron's userData directory when running inside Electron
 * (main process), otherwise falls back to ./data for standalone/dev runs.
 */
// 경로는 프로세스가 사는 동안 바뀌지 않는다 — 모든 저장소 접근마다
// require('electron') + mkdirSync를 반복하지 않도록 한 번만 계산한다.
let resolvedDir: string | null = null;

export function getDataDir(): string {
  if (resolvedDir) return resolvedDir;
  let dir: string;
  // 테스트(backend/test/)가 임시 폴더를 쓰게 하는 탈출구 — 없으면 backend/data/의
  // 실제 dev 데이터를 건드린다. Electron 안에서는 쓰지 않는다(userData가 항상 이긴다).
  const override = process.env.MYSTOCK_DATA_DIR;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    if (electron && typeof electron.app?.getPath === 'function') {
      dir = path.join(electron.app.getPath('userData'), 'data');
    } else if (override) {
      dir = override;
    } else {
      // Standalone (non-Electron) dev/test run — keep it inside the backend
      // package regardless of the shell's cwd, matching .gitignore's `backend/data/`.
      dir = path.join(__dirname, '..', 'data');
    }
  } catch {
    dir = override || path.join(__dirname, '..', 'data');
  }

  fs.mkdirSync(dir, { recursive: true });
  resolvedDir = dir;
  return dir;
}
