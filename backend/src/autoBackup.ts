import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './paths';
import { createBackupZip } from './backup';
import { blockedDataFiles } from './jsonStore';

// 자동 로컬 백업(2026-11-16) — 예전엔 사용자가 "백업 다운로드"를 눌러야만 백업이 생겼다. CSV·Sheets 가져오기로 덮어쓰기를
// 잘못하거나 파일이 깨지면 되돌릴 방법이 없었다.
// - 하루 한 번(앱이 켜져 있으면 시작 1분 뒤 + 이후 6시간마다 "마지막이 20시간 넘었나" 확인) 데이터 폴더를 zip으로 남긴다.
// - **비밀 정보는 넣지 않는다** — 비밀번호 없는 백업(createBackupZip())이라 API 키·토큰·Google 연결은 빠진다(backup.ts).
// - 위치: 데이터 폴더 **옆** `backups/`(데이터 폴더 안에 두면 다음 백업이 이전 백업을 또 담는다). 폴더 0700, 파일 0600.
// - 최근 7개만 둔다. 이름 `auto-YYYYMMDD-HHMMSS.zip` — 복원 라우트는 이 형식만 받는다(경로 조작 방지).
// - 복원(수동·자동 둘 다) 직전에도 지금 상태를 한 벌 남긴다(`reason: 'before-restore'`) — 복원을 되돌릴 수 있게.

const KEEP = 7;
const MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
export const AUTO_BACKUP_NAME_RE = /^auto-\d{8}-\d{6}(-before-restore)?\.zip$/;

export function getBackupDir(): string {
  const dir = path.join(path.dirname(getDataDir()), 'backups');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export interface AutoBackupEntry {
  name: string;
  createdAt: string;
  size: number;
  beforeRestore: boolean;
}

export function listAutoBackups(): AutoBackupEntry[] {
  const dir = getBackupDir();
  return fs
    .readdirSync(dir)
    .filter((n) => AUTO_BACKUP_NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, createdAt: st.mtime.toISOString(), size: st.size, beforeRestore: name.includes('before-restore') };
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1));
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function createAutoBackup(reason: 'daily' | 'before-restore' = 'daily'): Promise<AutoBackupEntry> {
  const dir = getBackupDir();
  const { buffer } = await createBackupZip(); // 비밀번호 없음 → 비밀 정보 제외
  const name = `auto-${stamp(new Date())}${reason === 'before-restore' ? '-before-restore' : ''}.zip`;
  fs.writeFileSync(path.join(dir, name), buffer, { mode: 0o600 });
  // 오래된 것부터 지운다 — 복원 직전 백업도 개수에 포함(무한히 쌓이지 않게).
  for (const old of listAutoBackups().slice(KEEP)) fs.rmSync(path.join(dir, old.name), { force: true });
  return listAutoBackups().find((e) => e.name === name)!;
}

export function readAutoBackup(name: string): Buffer {
  if (!AUTO_BACKUP_NAME_RE.test(name)) throw new Error('자동 백업 이름이 올바르지 않습니다.');
  return fs.readFileSync(path.join(getBackupDir(), name));
}

async function runIfDue(): Promise<void> {
  // 손상돼 격리된 사용자 데이터가 복원 전이면 건너뛴다 — 그 파일이 빠진 백업이 쌓여 손상 전 정상 백업을 밀어내지 않게.
  const blocked = blockedDataFiles(getDataDir());
  if (blocked.length > 0) {
    console.warn(`[autoBackup] 손상돼 격리된 데이터(${blocked.join(', ')})가 복원 전이라 자동 백업을 건너뜁니다.`);
    return;
  }
  const latest = listAutoBackups().find((e) => !e.beforeRestore);
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < MIN_INTERVAL_MS) return;
  await createAutoBackup('daily');
}

let started = false;
/** 서버 시작 때 한 번 부른다(index.ts). 실패는 로그만 — 백업 실패가 앱을 막으면 안 된다. */
export function startAutoBackupSchedule(): void {
  if (started) return;
  started = true;
  const tick = () => void runIfDue().catch((err) => console.error('[autoBackup] 자동 백업 실패:', err));
  setTimeout(tick, 60_000).unref();
  setInterval(tick, CHECK_EVERY_MS).unref();
}
