import { DATA_DIR } from './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('예전 평문 settings.json의 eximbankAuthKey는 봉투로 옮기고 평문 필드를 지운다', async () => {
  fs.writeFileSync(path.join(DATA_DIR, 'settings.json'), JSON.stringify({ usdKrwRate: 1400, eximbankAuthKey: 'LEGACYKEY1234567890' }));
  const { getEximbankAuthKey, hasEximbankAuthKey } = await import('../src/fx/eximbankKey');
  assert.equal(hasEximbankAuthKey(), true);
  assert.equal(getEximbankAuthKey(), 'LEGACYKEY1234567890');
  const settings = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'settings.json'), 'utf-8'));
  assert.deepEqual(settings, { usdKrwRate: 1400 });
  assert.ok(!fs.readFileSync(path.join(DATA_DIR, 'eximbank-key.json'), 'utf-8').includes('LEGACYKEY1234567890'));
});
