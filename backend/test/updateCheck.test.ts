import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion } from '../src/updateCheck';

test('새 버전 비교: 숫자 단위로 비교하고 형식이 다르면 알리지 않는다', () => {
  assert.equal(isNewerVersion('1.3.1', '1.3.0'), true);
  assert.equal(isNewerVersion('v1.10.0', '1.9.9'), true);
  assert.equal(isNewerVersion('1.3.0', '1.3.0'), false);
  assert.equal(isNewerVersion('1.2.9', '1.3.0'), false);
  assert.equal(isNewerVersion('2.0.0-beta', '1.3.0'), false);
  assert.equal(isNewerVersion('garbage', '1.3.0'), false);
});
