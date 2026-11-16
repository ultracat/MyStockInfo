import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRate, monthlyRateOr, pickLiveRate, toKrw } from '../src/fx';

test('환율: 수동 환율이 있으면 우선, 0·음수·NaN은 없는 것으로 본다', () => {
  assert.equal(effectiveRate(1400, 1350), 1400);
  assert.equal(effectiveRate(null, 1350), 1350);
  assert.equal(effectiveRate(0, 1350), 1350);
  assert.equal(effectiveRate(-1, null), null);
  assert.equal(effectiveRate(Number.NaN, undefined), null);
});

test('실시간 응답: 중간값이 있으면 그것, rate가 없으면 null', () => {
  assert.equal(pickLiveRate({ rate: 1360, midRate: 1355 }), 1355);
  assert.equal(pickLiveRate({ rate: 1360 }), 1360);
  assert.equal(pickLiveRate({ rate: null, midRate: 1355 }), null);
  assert.equal(pickLiveRate(null), null);
});

test('원화 환산: 달러는 환율이 없으면 null(합산 생략), 원화는 그대로', () => {
  assert.equal(toKrw(10, 'USD', 1400), 14000);
  assert.equal(toKrw(10, 'USD', null), null);
  assert.equal(toKrw(5000, 'KRW', null), 5000);
  assert.equal(toKrw(5000, null, 1400), 5000);
});

test('지급월 평균 환율: 그 달이 없으면 대체 환율', () => {
  const monthly = { '2026-10': { rate: 1380 }, '2026-09': null };
  assert.equal(monthlyRateOr(monthly, '2026-10', 1400), 1380);
  assert.equal(monthlyRateOr(monthly, '2026-09', 1400), 1400);
  assert.equal(monthlyRateOr(monthly, '2026-08', null), null);
});
