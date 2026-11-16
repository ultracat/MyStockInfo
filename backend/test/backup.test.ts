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
  write('nh-token.json', { accessToken: 'plain-nh-token' });
  write('kiwoom-token.json', { accessToken: 'plain-kiwoom-token' });
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
  for (const plain of [SECRET, 'g-refresh', 'plain-kis-token', 'plain-kb-token', 'plain-nh-token', 'plain-kiwoom-token']) {
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
  assert.equal(exists('nh-token.json'), false);
  assert.equal(exists('kiwoom-token.json'), false);
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
  // 실제 앱의 예전 백업처럼 이 PC 키체인으로 암호화된 봉투(테스트 환경은 평문 봉투라 모양만 흉내 낸다)
  legacy.addFile('credentials.json', Buffer.from(JSON.stringify({ kis: { data: 'AAAA', encrypted: true } })));
  legacy.addFile('kis-token.json', Buffer.from('{"accessToken":"old"}'));
  legacy.addFile('holdings.json', Buffer.from('[]'));
  legacy.addFile('sub/evil.json', Buffer.from('{}')); // adm-zip이 '../'는 만들 때 지워버려서 하위 폴더로 확인
  fs.rmSync(path.join(DATA_DIR, 'kis-token.json'));

  const result = await restoreBackupZip(legacy.toBuffer());

  assert.deepEqual(result.restored.sort(), ['credentials.json', 'holdings.json']);
  assert.deepEqual(result.skipped.sort(), ['kis-token.json', 'sub/evil.json']);
  assert.equal(exists('kis-token.json'), false);
});

test('복원: 형식이 틀린 항목·평문 키 봉투는 건너뛰고, 나머지는 쓴다', async () => {
  const zip = new AdmZip();
  zip.addFile('holdings.json', Buffer.from('[{"symbol":"NEW"}]'));
  zip.addFile('trades.json', Buffer.from('{not json'));
  zip.addFile('stockNames.sqlite', Buffer.from('not a sqlite file'));
  // 조작된 예전 형식 백업 — 평문 봉투로 남의 키를 심으려는 경우
  zip.addFile('credentials.json', Buffer.from(JSON.stringify({ toss: { data: Buffer.from('{"clientId":"evil"}').toString('base64'), encrypted: false } })));

  const result = await restoreBackupZip(zip.toBuffer());

  assert.deepEqual(result.restored, ['holdings.json']);
  assert.deepEqual(result.skipped.sort(), ['credentials.json', 'stockNames.sqlite', 'trades.json']);
  assert.deepEqual(listConfiguredBrokers(), ['kis']); // 원래 키 그대로
});

test('복원: 풀면 지나치게 큰 백업(압축 폭탄)은 아무것도 쓰지 않고 거절한다', async () => {
  const zip = new AdmZip();
  zip.addFile('holdings.json', Buffer.alloc(120 * 1024 * 1024, 0x20)); // 공백 120MB — 압축하면 아주 작다
  const before = fs.readFileSync(path.join(DATA_DIR, 'holdings.json'), 'utf-8');
  await assert.rejects(restoreBackupZip(zip.toBuffer()), /너무 큽니다/);
  assert.equal(fs.readFileSync(path.join(DATA_DIR, 'holdings.json'), 'utf-8'), before);
});

test('환율 인증키: 비밀번호 백업에만 암호화돼 들어가고, 복원하면 되살아난다', async () => {
  const { setEximbankAuthKey, getEximbankAuthKey, clearEximbankAuthKey } = await import('../src/fx/eximbankKey');
  setEximbankAuthKey('EXIMKEY1234567890abcdef');
  const plain = await createBackupZip();
  assert.ok(!entryNames(plain.buffer).includes('eximbank-key.json'));
  const { buffer } = await createBackupZip(PASSWORD);
  const all = new AdmZip(buffer).getEntries().map((e) => e.getData().toString('utf-8')).join('\n');
  assert.ok(!all.includes('EXIMKEY1234567890abcdef'));

  clearEximbankAuthKey();
  assert.equal(getEximbankAuthKey(), null);
  await restoreBackupZip(buffer, PASSWORD);
  assert.equal(getEximbankAuthKey(), 'EXIMKEY1234567890abcdef');
});
