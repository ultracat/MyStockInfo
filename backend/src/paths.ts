import path from 'node:path';
import fs from 'node:fs';

/**
 * Resolves where local data (encrypted credentials, dividend records) is
 * stored. Uses Electron's userData directory when running inside Electron
 * (main process), otherwise falls back to ./data for standalone/dev runs.
 */
export function getDataDir(): string {
  let dir: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron');
    if (electron && typeof electron.app?.getPath === 'function') {
      dir = path.join(electron.app.getPath('userData'), 'data');
    } else {
      // Standalone (non-Electron) dev/test run — keep it inside the backend
      // package regardless of the shell's cwd, matching .gitignore's `backend/data/`.
      dir = path.join(__dirname, '..', 'data');
    }
  } catch {
    dir = path.join(__dirname, '..', 'data');
  }

  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
