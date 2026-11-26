import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeShape, maskDigitRuns, redactText, shapeForLog } from '../src/logRedact';

test('describeShape: 값은 버리고 키·타입·길이만 남긴다', () => {
  const shape = shapeForLog({ accountNo: '12345678-01', qty: 10, items: [{ name: '삼성전자', price: 70000 }], ok: true, x: null });
  assert.ok(!shape.includes('12345678') && !shape.includes('70000') && !shape.includes('삼성전자'));
  assert.deepEqual(describeShape({ a: 'abc', b: [1, 2] }), { a: '<string:3>', b: ['<array:2>', '<number>'] });
});

test('redactText: 6자리 이상 숫자열(계좌번호 등)을 가리고 길이를 자른다', () => {
  assert.equal(redactText('계좌 12345678-01 오류 code 42'), '계좌 ########### 오류 code 42');
  assert.match(redactText('x'.repeat(600)), /…\(\+100\)$/);
});

test('maskDigitRuns: 숫자 6개 이상인 덩어리를 가린다(쉼표·소수점·하이픈 포함)', () => {
  for (const s of ['123456', '1,234,567', '12345.67', '1,234.56', '12345678-01', '123-45-678901', '2026-11-26', '005930']) {
    assert.equal(maskDigitRuns(`앞 ${s} 뒤`), `앞 ${'#'.repeat(s.length)} 뒤`, s);
  }
  // ISO 시각은 날짜 부분이 가려지고 시:분:초는 남는다
  assert.equal(maskDigitRuns('2026-11-26T01:02:03Z'), '##########T01:02:03Z');
});

test('maskDigitRuns: 읽어야 하는 짧은 숫자·버전·IPv4는 남긴다', () => {
  for (const s of ['4317', '12345', '00123', '70,000', '45.5.0', '24.22.3', '127.0.0.1', '12:34:56', 'HTTP 502']) {
    assert.equal(maskDigitRuns(`x ${s} y`), `x ${s} y`, s);
  }
  assert.equal(maskDigitRuns('http://127.0.0.1:4317/api'), 'http://127.0.0.1:4317/api');
  // 문턱값을 바꿔 쓸 수 있다
  assert.equal(maskDigitRuns('1234', 4), '####');
});

test('redactText: 소수점·6자리도 가린다(예전 정규식이 놓치던 것)', () => {
  assert.equal(redactText('잔고 123456 평가 1234.56'), '잔고 ###### 평가 #######');
});
