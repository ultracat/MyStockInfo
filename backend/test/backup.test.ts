import { DATA_DIR, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { createBackupZip, restoreBackupZip } from '../src/backup';
import { BackupPasswordError, openSecrets, sealSecrets } from '../src/backupCrypto';
import { getCredentialFields, listConfiguredBrokers, setCredentialFields } from '../src/credentials';
import * as googleStore from '../src/google/store';

const PASSWORD = 'correct horse battery';
const SECRET = 'super-secret-app-value';

function write(name: string, content: unknown): void {
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(content));
}
const exists = (name: string) => fs.existsSync(path.join(DATA_DIR, name));
const entryNames = (buf: Buffer) => new AdmZip(buf).getEntries().map((e) => e.entryName).sort();

beforeEach(() => {
  resetDataDir();
  setCredentialFields('kis', { appKey: 'kis-key', appSecret: SECRET, accountNumber: '12345678' });
  googleStore.replaceState({
    refreshToken: 'g-refresh',
    accessToken: 'g-access',
    accessTokenExpiresAt: 1,
    email: 'me@example.com',
    spreadsheetId: 'sheet-1',
    spreadsheetUrl: 'https://example.com/sheet-1',
  });
  write('kis-token.json', { accessToken: 'plain-kis-token' });
  write('kb-token.json', { accessToken: 'plain-kb-token' });
  write('holdings.json', [{ symbol: '005930' }]);
});

test('backupCrypto: 같은 비밀번호로만 열리고, 틀리면 BackupPasswordError', async () => {
  const sealed = await sealSecrets('{"a":1}', PASSWORD);
  assert.equal(await openSecrets(sealed, PASSWORD), '{"a":1}');
  await assert.rejects(openSecrets(sealed, 'wrong password'), BackupPasswordError);
});

test('비밀번호 없이 만든 백업엔 비밀 파일이 하나도 없다', async () => {
  const { buffer, includesSecrets } = await createBackupZip();
  assert.equal(includesSecrets, false);
  assert.deepEqual(entryNames(buffer), ['holdings.json', 'manifest.json']);
});

test('비밀번호로 만든 백업: 키는 secrets.enc.json에만 암호화돼 있고 접속 토큰은 없다', async () => {
  const { buffer, includesSecrets } = await createBackupZip(PASSWORD);
  assert.equal(includesSecrets, true);
  assert.deepEqual(entryNames(buffer), ['holdings.json', 'manifest.json', 'secrets.enc.json']);
  const all = new AdmZip(buffer).getEntries().map((e) => e.getData().toString('utf-8')).join('\n');
  for (const plain of [SECRET, 'g-refresh', 'plain-kis-token', 'plain-kb-token']) {
    assert.ok(!all.includes(plain), `${plain}이 zip 안에 평문으로 있다`);
  }
});

test('백업 비밀번호는 8자 이상이어야 한다', async () => {
  await assert.rejects(createBackupZip('short'), /8자 이상/);
});

test('복원: 비밀번호가 틀리거나 없으면 아무 파일도 바꾸지 않는다', async () => {
  const { buffer } = await createBackupZip(PASSWORD);
  write('holdings.json', [{ symbol: 'CHANGED' }]);
  const before = fs.readFileSync(path.join(DATA_DIR, 'holdings.json'), 'utf-8');

  await assert.rejects(restoreBackupZip(buffer, 'wrong password'), BackupPasswordError);
  await assert.rejects(restoreBackupZip(buffer), BackupPasswordError);

  assert.equal(fs.readFileSync(path.join(DATA_DIR, 'holdings.json'), 'utf-8'), before);
});

test('복원: 비밀번호가 맞으면 키·Google 연결을 백업 기준으로 되돌리고 남은 접속 토큰을 지운다', async () => {
  const { buffer } = await createBackupZip(PASSWORD);
  // 백업 뒤에 바뀐 상태 — 키 변경, 새 브로커 추가, Google 해제
  setCredentialFields('kis', { appKey: 'other', appSecret: 'other', accountNumber: '0' });
  setCredentialFields('toss', { clientId: 'x', clientSecret: 'y' });
  googleStore.clearAccount();

  const result = await restoreBackupZip(buffer, PASSWORD);

  assert.equal(result.secrets, 'restored');
  assert.deepEqual(result.restored, ['holdings.json']);
  assert.equal(getCredentialFields('kis')?.appSecret, SECRET);
  assert.deepEqual(listConfiguredBrokers(), ['kis']); // 백업에 없던 toss는 지워짐
  assert.equal(googleStore.getState().refreshToken, 'g-refresh');
  assert.equal(exists('kis-token.json'), false);
  assert.equal(exists('kb-token.json'), false);
});

test('복원: 비밀번호 없이 만든 백업은 지금 등록된 키를 그대로 둔다', async () => {
  const { buffer } = await createBackupZip();
  setCredentialFields('toss', { clientId: 'x', clientSecret: 'y' });

  const result = await restoreBackupZip(buffer);

  assert.equal(result.secrets, 'not-in-backup');
  assert.deepEqual(listConfiguredBrokers().sort(), ['kis', 'toss']);
});

test('예전 형식 백업: 키체인 파일은 받고 평문 접속 토큰은 건너뛴다', async () => {
  const legacy = new AdmZip();
  legacy.addFile('credentials.json', fs.readFileSync(path.join(DATA_DIR, 'credentials.json')));
  legacy.addFile('kis-token.json', Buffer.from('{"accessToken":"old"}'));
  legacy.addFile('holdings.json', Buffer.from('[]'));
  legacy.addFile('sub/evil.json', Buffer.from('{}')); // adm-zip이 '../'는 만들 때 지워버려서 하위 폴더로 확인
  fs.rmSync(path.join(DATA_DIR, 'kis-token.json'));

  const result = await restoreBackupZip(legacy.toBuffer());

  assert.deepEqual(result.restored.sort(), ['credentials.json', 'holdings.json']);
  assert.deepEqual(result.skipped.sort(), ['kis-token.json', 'sub/evil.json']);
  assert.equal(exists('kis-token.json'), false);
});
