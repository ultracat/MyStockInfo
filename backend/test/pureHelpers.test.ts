import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol } from '../src/routes/holdingsStore';
import { SAFE_FILENAME_RE } from '../src/backup';

test('normalizeSymbol: 국내 심볼은 앞자리 0을 채워 6자리로 맞춘다', () => {
  assert.equal(normalizeSymbol('5930', 'KR'), '005930');
  assert.equal(normalizeSymbol('5', 'KR'), '000005');
  assert.equal(normalizeSymbol('005930', 'KR'), '005930');
});

test('normalizeSymbol: 국내가 아니거나 숫자 6자리 이하가 아니면 그대로 둔다', () => {
  assert.equal(normalizeSymbol('5930', 'US'), '5930');
  assert.equal(normalizeSymbol('5930', null), '5930');
  assert.equal(normalizeSymbol('5930', undefined), '5930');
  assert.equal(normalizeSymbol('AAPL', 'KR'), 'AAPL');
  assert.equal(normalizeSymbol('1234567', 'KR'), '1234567');
  assert.equal(normalizeSymbol('0001A0', 'KR'), '0001A0');
});

test('SAFE_FILENAME_RE: 데이터 폴더의 평평한 .json/.sqlite 이름만 허용한다', () => {
  for (const ok of ['trades.json', 'accountLabels.json', 'stockNames.sqlite', 'kis-token.json', 'a_b.c.json']) {
    assert.ok(SAFE_FILENAME_RE.test(ok), ok);
  }
});

test('SAFE_FILENAME_RE: 경로·다른 확장자·임시 파일은 거부한다(zip-slip 차단)', () => {
  for (const bad of [
    '../credentials.json',
    'sub/trades.json',
    'sub\\trades.json',
    '/etc/passwd.json',
    'trades.json.tmp',
    'trades.txt',
    'trades.JSON',
    '.json',
    '',
  ]) {
    assert.ok(!SAFE_FILENAME_RE.test(bad), bad);
  }
});
