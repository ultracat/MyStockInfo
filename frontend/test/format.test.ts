import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDividendMeta, formatKrwValue, formatRatePct, formatSignedKrw, ratioOf } from '../src/format';

test('비율 표시: 기준 0이면 없음, 부호는 선택', () => {
  assert.equal(ratioOf(50, 0), null);
  assert.equal(formatRatePct(ratioOf(123, 1000)), '+12.30%');
  assert.equal(formatRatePct(ratioOf(-5, 1000)), '-0.50%');
  assert.equal(formatRatePct(ratioOf(31, 1000), false), '3.10%');
  assert.equal(formatRatePct(null), '-');
});

test('원화 표시: 반올림·천 단위·부호', () => {
  assert.equal(formatKrwValue(1234.6), '1,235원');
  assert.equal(formatSignedKrw(1500), '+1,500원');
  assert.equal(formatSignedKrw(-1500), '-1,500원');
  assert.equal(formatSignedKrw(0), '+0원');
});

test('배당 meta: 보유 수량이 없으면 건수만', () => {
  assert.equal(formatDividendMeta(3, 10), '배당 3건 · 보유 10주');
  assert.equal(formatDividendMeta(3, undefined), '배당 3건');
  assert.equal(formatDividendMeta(3, 0), '배당 3건');
});
