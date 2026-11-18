import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMoneyIn, qtyFmt } from '../src/format';

// 포지션 통화 그대로의 금액 표기(보유 종목 표) — 달러는 "$58.00", 원화는 "1,234.5원"(예전 "58 USD"). 값은 지어낸 것.
test('달러는 $ 기호와 센트 두 자리, 원화는 원, 그 밖은 통화 코드', () => {
  assert.equal(formatMoneyIn(58, 'USD'), '$58.00');
  assert.equal(formatMoneyIn(-1234.5, 'USD'), '-$1,234.50');
  assert.equal(formatMoneyIn(1234.5, 'KRW'), '1,234.5원');
  assert.equal(formatMoneyIn(1000, null), '1,000원');
  assert.equal(formatMoneyIn(10, 'JPY'), '10 JPY');
});

test('수량은 천 단위 쉼표, 소수는 6자리까지', () => {
  assert.equal(qtyFmt.format(12345), '12,345');
  assert.equal(qtyFmt.format(8.0100234), '8.010023');
});
