import { DATA_DIR, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SecretJsonStore } from '../src/secretJsonStore';

const FILE = 'demo-token.json';
const raw = () => fs.readFileSync(path.join(DATA_DIR, FILE), 'utf-8');
const store = () => new SecretJsonStore<{ accessToken: string }>(FILE, DATA_DIR);

beforeEach(() => resetDataDir());

test('SecretJsonStore: 봉투로 저장하고 다시 풀어 읽는다 — 파일에 토큰 원문이 없다', () => {
  store().write({ accessToken: 'tok-123' });
  assert.ok(!raw().includes('tok-123'));
  assert.deepEqual(Object.keys(JSON.parse(raw())).sort(), ['data', 'encrypted']);
  assert.equal(store().read()?.accessToken, 'tok-123');
});

test('SecretJsonStore: 예전 평문 파일은 읽으면서 봉투로 다시 쓴다', () => {
  fs.writeFileSync(path.join(DATA_DIR, FILE), JSON.stringify({ accessToken: 'legacy' }));
  assert.equal(store().read()?.accessToken, 'legacy');
  assert.ok(!raw().includes('legacy'));
  assert.equal(store().read()?.accessToken, 'legacy');
});

test('SecretJsonStore: 없거나 깨졌으면 null, null을 쓰면 파일을 지운다', () => {
  assert.equal(store().read(), null);
  fs.writeFileSync(path.join(DATA_DIR, FILE), '{not json');
  assert.equal(store().read(), null);
  fs.writeFileSync(path.join(DATA_DIR, FILE), JSON.stringify({ data: 'bm90IGpzb24=', encrypted: false }));
  assert.equal(store().read(), null);
  store().write({ accessToken: 'x' });
  store().write(null);
  assert.equal(fs.existsSync(path.join(DATA_DIR, FILE)), false);
});
