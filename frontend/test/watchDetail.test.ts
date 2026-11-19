import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  closeOnOrAfter,
  closeOnOrBefore,
  dividendYield,
  movingAverage,
  myTradeSummary,
  normalizedSeries,
  periodReturns,
  range52w,
  shiftDate,
  sinceAdded,
  whatIfBuy,
} from '../src/calc/watchDetail';
import type { DailyCandle, StoredTrade } from '../src/types';

const c = (date: string, close: number, high = close, low = close): DailyCandle => ({ date, open: close, high, low, close, volume: 1, currency: 'KRW' });

test('이동평균 — 앞쪽은 null', () => {
  const ma = movingAverage([1, 2, 3, 4].map((v) => ({ close: v })), 3);
  assert.deepEqual(ma, [null, null, 2, 3]);
});

test('휴장일이면 직전·다음 거래일 종가', () => {
  const rows = [c('2026-11-13', 100), c('2026-11-16', 110)];
  assert.equal(closeOnOrBefore(rows, '2026-11-15'), 100);
  assert.equal(closeOnOrAfter(rows, '2026-11-15'), 110);
  assert.equal(closeOnOrBefore(rows, '2026-11-01'), null);
});

test('기간 수익률 — 일봉이 모자라면 null, 올해는 작년 마지막 거래일 대비', () => {
  const rows = [c('2025-12-30', 80), c('2026-10-19', 100), c('2026-11-11', 110), c('2026-11-18', 120)];
  const r = Object.fromEntries(periodReturns(rows, 132, '2026-11-19').map((p) => [p.key, p.rate]));
  assert.ok(Math.abs(r['1w']! - 0.2) < 1e-9); // 11-12 이전 마지막 = 11-11의 110
  assert.ok(Math.abs(r['1m']! - 0.32) < 1e-9); // 10-20 이전 = 100
  assert.ok(Math.abs(r.ytd! - 0.65) < 1e-9); // 80 대비
  assert.equal(r['1y'], null); // 2025-11-19 이전 봉 없음
});

test('52주 범위 — 장중 고저와 위치', () => {
  const rows = [c('2025-11-01', 50), c('2026-03-02', 100, 120, 90), c('2026-06-01', 80, 85, 60)];
  const r = range52w(rows, 90, '2026-11-19')!;
  assert.equal(r.high, 120);
  assert.equal(r.low, 60);
  assert.equal(r.lowDate, '2026-06-01');
  assert.ok(Math.abs(r.position - 0.5) < 1e-9);
});

test('넣은 뒤 수익률 — 저장한 가격 우선, 없으면 추가한 날 종가', () => {
  const rows = [c('2026-11-13', 100), c('2026-11-16', 110)];
  const a = sinceAdded('2026-11-15T01:00:00Z', null, rows, 121)!;
  assert.equal(a.base, 110);
  assert.equal(a.basis, 'close');
  assert.ok(Math.abs(a.rate - 0.1) < 1e-9);
  assert.equal(sinceAdded('2026-11-15T01:00:00Z', 100, rows, 120)!.basis, 'saved');
  assert.equal(sinceAdded('2026-01-01T00:00:00Z', null, rows, 120), null);
});

test('비교 — 첫 날 0%', () => {
  const s = normalizedSeries([c('2026-01-01', 100), c('2026-01-02', 150)], '2026-01-01');
  assert.deepEqual(s.map((x) => x.rate), [0, 0.5]);
});

test('내 매매 — 통화가 다른 기록 제외, 마지막 매도 뒤 수익률', () => {
  const t = (side: 'BUY' | 'SELL', at: string, price: number, currency = 'KRW'): StoredTrade => ({
    broker: 'toss', accountId: '1', id: at, symbol: 'AAA', name: null, side, quantity: 2, price, amount: 2 * price, currency, commission: null, tax: null, executedAt: at,
  });
  const s = myTradeSummary([t('BUY', '2026-01-02', 100), t('SELL', '2026-03-02', 150), t('BUY', '2026-02-01', 120, 'USD')], 'aaa', 'KRW', 180);
  assert.equal(s.marks.length, 2);
  assert.equal(s.lastSell!.date, '2026-03-02');
  assert.ok(Math.abs(s.lastSell!.rateSince! - 0.2) < 1e-9);
  assert.equal(s.avgBuyPrice, 100);
});

test('만약 샀다면 — 정수 주, 비중', () => {
  const w = whatIfBuy(1_000_000, 300_000, 9_100_000)!;
  assert.equal(w.shares, 3);
  assert.equal(w.leftoverKrw, 100_000);
  assert.ok(Math.abs(w.weight! - 0.09) < 1e-9);
  assert.equal(whatIfBuy(0, 1, null), null);
});

test('배당수익률·주기', () => {
  const h = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'].map((d) => ({ recordDate: d, payDate: null, perShare: 100 }));
  const y = dividendYield(h, 10_000, '2026-11-19');
  assert.equal(y.perShare12m, 400);
  assert.equal(y.yield, 0.04);
  assert.equal(y.cadence, '분기');
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
});
