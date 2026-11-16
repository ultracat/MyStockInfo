import { DATA_DIR, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { AUTO_BACKUP_NAME_RE, createAutoBackup, getBackupDir, listAutoBackups, readAutoBackup } from '../src/autoBackup';
import { setCredentialFields } from '../src/credentials';

beforeEach(() => {
  resetDataDir();
  fs.rmSync(getBackupDir(), { recursive: true, force: true });
});

test('자동 백업: 데이터 폴더 옆 backups/에 만들고, 비밀 파일은 넣지 않는다', async () => {
  await setCredentialFields('kis', { appKey: 'k', appSecret: 'very-secret', accountNumber: '1' });
  fs.writeFileSync(path.join(DATA_DIR, 'holdings.json'), '[]');
  fs.writeFileSync(path.join(DATA_DIR, 'kis-token.json'), '{"accessToken":"t"}');
  const entry = await createAutoBackup();
  assert.match(entry.name, AUTO_BACKUP_NAME_RE);
  assert.equal(path.dirname(getBackupDir()), path.dirname(DATA_DIR)); // 데이터 폴더 안이 아니다
  const names = new AdmZip(readAutoBackup(entry.name)).getEntries().map((e) => e.entryName);
  assert.ok(names.includes('holdings.json'));
  assert.ok(!names.includes('credentials.json') && !names.includes('kis-token.json') && !names.includes('secrets.enc.json'));
});

test('자동 백업: 최근 7개만 남긴다', async () => {
  const dir = getBackupDir();
  for (let i = 0; i < 9; i++) fs.writeFileSync(path.join(dir, `auto-2026010${i}-000000.zip`), 'x');
  await createAutoBackup();
  assert.equal(listAutoBackups().length, 7);
});

test('자동 백업 복원: 형식이 다른 이름(경로 조작)은 읽지 않는다', () => {
  assert.throws(() => readAutoBackup('../credentials.json'));
  assert.throws(() => readAutoBackup('auto-20260101-000000.zip/../../x'));
});
