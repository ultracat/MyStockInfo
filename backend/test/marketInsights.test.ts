import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeWarnings, lookThroughEtf, marketStatusFrom, monthEndCloses } from '../src/marketInsights';

const krDay = (date: string, open = true) => ({
  date,
  integrated: open
    ? {
        preMarket: { startTime: `${date}T08:00:00+09:00`, endTime: `${date}T09:00:00+09:00` },
        regularMarket: { startTime: `${date}T09:00:00+09:00`, endTime: `${date}T15:30:00+09:00` },
        afterMarket: { startTime: `${date}T15:30:00+09:00`, endTime: `${date}T20:00:00+09:00` },
      }
    : null,
});

test('장 상태(국내): 세션 시각으로 지금 세션을 고르고, 장 마감 후엔 closed', () => {
  const cal = { previousBusinessDay: krDay('2026-11-06'), today: krDay('2026-11-09'), nextBusinessDay: krDay('2026-11-10') };
  assert.equal(marketStatusFrom('KR', cal, Date.parse('2026-11-09T10:00:00+09:00')).session, 'regular');
  assert.equal(marketStatusFrom('KR', cal, Date.parse('2026-11-09T08:30:00+09:00')).session, 'pre');
  const night = marketStatusFrom('KR', cal, Date.parse('2026-11-09T21:00:00+09:00'));
  assert.equal(night.session, 'closed');
  assert.equal(night.holidayToday, false);
  assert.equal(night.nextBusinessDay, '2026-11-10');
});

test('장 상태(국내): 오늘 세션이 전부 null이면 휴장', () => {
  const cal = { previousBusinessDay: krDay('2026-11-06'), today: krDay('2026-11-07', false), nextBusinessDay: krDay('2026-11-09') };
  const s = marketStatusFrom('KR', cal, Date.parse('2026-11-07T10:00:00+09:00'));
  assert.equal(s.session, 'closed');
  assert.equal(s.holidayToday, true);
});

test('장 상태(미국): KST로 자정을 넘기는 전일 정규장도 찾는다', () => {
  const usDay = (d: string, next: string) => ({
    date: d,
    dayMarket: null,
    preMarket: null,
    regularMarket: { startTime: `${d}T23:30:00+09:00`, endTime: `${next}T06:00:00+09:00` },
    afterMarket: { startTime: `${next}T06:00:00+09:00`, endTime: `${next}T09:50:00+09:00` },
  });
  const cal = { previousBusinessDay: usDay('2026-11-08', '2026-11-09'), today: usDay('2026-11-09', '2026-11-10'), nextBusinessDay: usDay('2026-11-10', '2026-11-11') };
  assert.equal(marketStatusFrom('US', cal, Date.parse('2026-11-09T02:00:00+09:00')).session, 'regular');
  assert.equal(marketStatusFrom('US', cal, Date.parse('2026-11-09T07:00:00+09:00')).session, 'after');
  assert.equal(marketStatusFrom('US', cal, Date.parse('2026-11-09T12:00:00+09:00')).session, 'closed');
});

test('경고: 오늘이 기간 안이거나 종료일이 없는 것만, 모르는 유형은 코드 그대로', () => {
  const list = [
    { warningType: 'INVESTMENT_WARNING', startDate: '2026-11-01', endDate: '2026-11-20' },
    { warningType: 'OVERHEATED', startDate: '2026-10-01', endDate: '2026-10-05' },
    { warningType: 'VI_DYNAMIC', startDate: '2026-11-09', endDate: null },
    { warningType: 'NEW_CODE', startDate: null, endDate: null },
    { warningType: 'INVESTMENT_RISK', startDate: '2026-12-01', endDate: null },
  ];
  assert.deepEqual(activeWarnings(list, '2026-11-09').map((w) => w.label), ['투자경고', 'VI 발동', 'NEW_CODE']);
});

test('월말 종가: 달마다 마지막 거래일 종가, 오래된 달부터', () => {
  const candles = [
    { timestamp: '2026-11-09T00:00:00+09:00', closePrice: '110' },
    { timestamp: '2026-10-31T00:00:00+09:00', closePrice: '105' },
    { timestamp: '2026-10-30T00:00:00+09:00', closePrice: '104' },
    { timestamp: '2026-09-30T00:00:00+09:00', closePrice: '100' },
  ];
  assert.deepEqual(monthEndCloses(candles), [
    { month: '2026-09', close: 100 },
    { month: '2026-10', close: 105 },
    { month: '2026-11', close: 110 },
  ]);
});

test('ETF 구성종목 쪼개기: 비중대로 섹터 배분, 여러 섹터면 균등, 표에 없거나 상위 밖 비중은 null', () => {
  const map: Record<string, string[]> = { A: ['반도체'], B: ['반도체', 'IT'], C: ['금융'] };
  const r = lookThroughEtf(
    [
      { symbol: 'A', weightPct: 40 },
      { symbol: 'B', weightPct: 20 },
      { symbol: 'C', weightPct: 10 },
      { symbol: 'BOND', weightPct: 10 },
    ],
    (s) => map[s]
  )!;
  const get = (k: string | null) => r.find((x) => x.sector === k)?.weight ?? 0;
  assert.ok(Math.abs(get('반도체') - 0.5) < 1e-9);
  assert.ok(Math.abs(get('IT') - 0.1) < 1e-9);
  assert.ok(Math.abs(get('금융') - 0.1) < 1e-9);
  assert.ok(Math.abs(get(null) - 0.3) < 1e-9, '표에 없는 10% + 상위 30개 밖 20%');
  assert.ok(Math.abs(r.reduce((s, x) => s + x.weight, 0) - 1) < 1e-9);
});

test('ETF 구성종목 쪼개기: 하나도 분류 못 하면 null(토스 ETF 분류로 넘어감), 100% 넘으면 정규화', () => {
  assert.equal(lookThroughEtf([{ symbol: 'X', weightPct: 50 }], () => undefined), null);
  assert.equal(lookThroughEtf([], () => ['반도체']), null);
  const r = lookThroughEtf([{ symbol: 'A', weightPct: 120 }], () => ['반도체'])!;
  assert.deepEqual(r, [{ sector: '반도체', weight: 1 }]);
});
