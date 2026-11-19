import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKrMarketClosed, krMarketClosedDays, krYearEndClosing } from '../src/krMarketCalendar';
import { candleTradingDate, previousCloseFrom } from '../src/brokers/toss/tossMonthlyClose';

// 국내 휴장일 표(월력요항 2026·2027 + KRX 근로자의 날·연말 휴장) — 12개월 예상 배당의 추정 날짜가 설·추석에 어긋나지 않게.
test('설·추석·대체공휴일·연말 휴장', () => {
  for (const d of ['2027-02-08', '2027-02-09', '2027-09-15', '2027-05-03', '2027-10-11', '2027-12-27', '2026-12-31', '2027-12-31', '2026-05-01'])
    assert.equal(isKrMarketClosed(d), true, d);
  for (const d of ['2027-02-10', '2027-05-04', '2026-12-30', '2026-11-18']) assert.equal(isKrMarketClosed(d), false, d);
});

test('주말은 늘 휴장, 표가 없는 해는 주말만', () => {
  assert.equal(isKrMarketClosed('2026-11-21'), true); // 토
  assert.equal(isKrMarketClosed('2030-01-01'), false); // 표 없음 → 평일이면 영업일로 본다(예전 동작)
  assert.equal(krYearEndClosing(2030), null);
});

test('기간 휴장일은 평일만 false로 — 미국 달력과 같은 모양', () => {
  const cal = krMarketClosedDays('2027-02-01', '2027-02-28');
  assert.deepEqual(Object.keys(cal).sort(), ['2027-02-08', '2027-02-09']);
  assert.ok(Object.values(cal).every((v) => v === false));
});

// 관심종목 등락률의 직전 거래일 종가 — 가격 시각보다 20시간 넘게 앞선 가장 최근 일봉. 값은 지어낸 것.
const candles = [
  { timestamp: '2026-11-18T00:00:00+09:00', closePrice: 105 }, // 오늘(장중)
  { timestamp: '2026-11-17T00:00:00+09:00', closePrice: 100 },
  { timestamp: '2026-11-16T00:00:00+09:00', closePrice: 98 },
];
test('장중: 오늘 봉은 건너뛰고 어제 종가', () => {
  assert.equal(previousCloseFrom(candles, new Date('2026-11-18T13:00:00+09:00')), 100);
});
test('주말: 마지막 거래일(금)의 전 거래일', () => {
  const week = [
    { timestamp: '2026-11-20T00:00:00+09:00', closePrice: 110 },
    { timestamp: '2026-11-19T00:00:00+09:00', closePrice: 108 },
  ];
  assert.equal(previousCloseFrom(week, new Date('2026-11-20T15:30:00+09:00')), 108);
});
test('고를 봉이 없거나 값이 0이면 null', () => {
  assert.equal(previousCloseFrom([{ timestamp: '2026-11-18T00:00:00+09:00', closePrice: 105 }], new Date('2026-11-18T13:00:00+09:00')), null);
  assert.equal(previousCloseFrom([{ timestamp: '2026-11-17T00:00:00+09:00', closePrice: 0 }], new Date('2026-11-18T13:00:00+09:00')), null);
});

// 일봉 timestamp → 거래일(관심종목 상세 차트) — 국내 00:00 KST, 미국 00:00 ET(서머타임 전후)가 모두 그날이어야 한다.
test('일봉 시각을 거래일로', () => {
  assert.equal(candleTradingDate('2026-11-18T00:00:00+09:00'), '2026-11-18');
  assert.equal(candleTradingDate('2026-11-17T15:00:00Z'), '2026-11-18');
  assert.equal(candleTradingDate('2026-11-18T00:00:00-05:00'), '2026-11-18');
  assert.equal(candleTradingDate('2026-07-01T00:00:00-04:00'), '2026-07-01');
  assert.equal(candleTradingDate('bad'), null);
});
