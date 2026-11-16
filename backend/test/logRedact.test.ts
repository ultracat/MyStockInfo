import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShape, redactText, shapeForLog } from '../src/logRedact';

test('describeShape: 값은 버리고 키·타입·길이만 남긴다', () => {
  const shape = shapeForLog({ accountNo: '12345678-01', qty: 10, items: [{ name: '삼성전자', price: 70000 }], ok: true, x: null });
  assert.ok(!shape.includes('12345678') && !shape.includes('70000') && !shape.includes('삼성전자'));
  assert.deepEqual(describeShape({ a: 'abc', b: [1, 2] }), { a: '<string:3>', b: ['<array:2>', '<number>'] });
});

test('redactText: 6자리 이상 숫자열(계좌번호 등)을 가리고 길이를 자른다', () => {
  assert.equal(redactText('계좌 12345678-01 오류 code 42'), '계좌 ########### 오류 code 42');
  assert.match(redactText('x'.repeat(600)), /…\(\+100\)$/);
});
