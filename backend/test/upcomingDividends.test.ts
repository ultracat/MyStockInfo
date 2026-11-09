import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKsdDate, planSymbolDividends } from '../src/upcomingDividends';

// 예탁원 배당일정(HHKDB669102C0) 행 — 기준일은 YYYYMMDD, 지급일은 YYYY/MM/DD로 온다(2026-11-10 실측). 값은 지어낸 것.
const row = (record: string, per: number, pay = '') => ({ record_date: record, per_sto_divi_amt: String(per), divi_pay_dt: pay });

/** 매달 15일 기준·2일 뒤 지급, 한 달만 두 배인 분배 ETF(실측 모양). */
const monthly = [
  row('20251215', 29, '2025/12/17'),
  row('20260115', 29, '2026/01/17'),
  row('20260215', 30, '2026/02/17'),
  row('20260315', 29, '2026/03/17'),
  row('20260415', 30, '2026/04/17'),
  row('20260515', 30, '2026/05/17'),
  row('20260615', 29, '2026/06/17'),
  row('20260715', 31, '2026/07/17'),
  row('20260815', 30, '2026/08/17'),
  row('20260915', 29, '2026/09/17'),
  row('20261015', 60, '2026/10/17'),
];

test('parseKsdDate: YYYYMMDD·빗금·하이픈을 모두 읽는다', () => {
  assert.equal(parseKsdDate('20261019'), '2026-10-19');
  assert.equal(parseKsdDate('2026/10/19'), '2026-10-19');
  assert.equal(parseKsdDate('2026-10-19'), '2026-10-19');
  assert.equal(parseKsdDate(''), null);
  assert.equal(parseKsdDate('미정'), null);
});

test('planSymbolDividends: 예탁원에 아직 없는 다음 달 분배를 지난 일정으로 추정한다(금액은 최근 12회 중간값)', () => {
  const out = planSymbolDividends(monthly, '2026-11-10', '2027-03-10');
  assert.deepEqual(
    out.map((p) => [p.status, p.recordDate, p.payDate, p.perShare]),
    [
      ['projected', '2026-11-15', '2026-11-17', 30],
      ['projected', '2026-12-15', '2026-12-17', 30],
      ['projected', '2027-01-15', '2027-01-17', 30],
      ['projected', '2027-02-15', '2027-02-17', 30],
    ]
  );
});

test('planSymbolDividends: 기준일이 지났어도 지급 전이면 예탁원 금액으로 예상하고, 그 뒤부터 추정한다', () => {
  const rows = [...monthly, row('20261115', 28, '2026/11/17')];
  const out = planSymbolDividends(rows, '2026-11-16', '2026-12-31');
  assert.deepEqual(out.map((p) => [p.status, p.source, p.recordDate, p.perShare]), [
    ['estimated', 'ksd-schedule', '2026-11-15', 28],
    ['projected', 'history', '2026-12-15', 29.5],
  ]);
  // 지급일이 지나면 빠진다
  assert.equal(planSymbolDividends(rows, '2026-11-17', '2026-11-30').length, 0);
});

test('planSymbolDividends: 금액 미정(0) 일정은 중간값으로 추정하고, 다음 추정은 그 기준일부터 잇는다', () => {
  const rows = [...monthly, row('20261116', 0)];
  const out = planSymbolDividends(rows, '2026-11-10', '2026-12-31');
  assert.deepEqual(out.map((p) => [p.status, p.recordDate, p.payDate, p.perShare]), [
    ['projected', '2026-11-16', null, 30],
    ['projected', '2026-12-16', '2026-12-18', 30],
  ]);
});

test('planSymbolDividends: 주기가 일정하지 않거나 기록이 부족하거나 오래 끊긴 종목은 추정하지 않는다', () => {
  // 연 1회 결산 배당 — 2회면 추정(다음 기준일이 범위 안일 때만)
  const annual = [row('20241231', 1000, '2025/04/18'), row('20251231', 1100, '2026/04/17')];
  assert.deepEqual(
    planSymbolDividends(annual, '2026-11-10', '2027-05-01').map((p) => [p.recordDate, p.payDate, p.perShare]),
    [['2026-12-31', '2027-04-18', 1050]]
  );
  assert.equal(planSymbolDividends(annual, '2026-11-10', '2027-03-10').length, 0); // 지급일이 범위 밖
  // 매달인데 2회뿐 → 추정 안 함
  assert.equal(planSymbolDividends(monthly.slice(-2), '2026-11-10', '2027-03-10').length, 0);
  // 간격이 불규칙(1·5·2개월) → 추정 안 함
  const irregular = [row('20260115', 10), row('20260215', 10), row('20260715', 10), row('20260915', 10)];
  assert.equal(planSymbolDividends(irregular, '2026-11-10', '2027-03-10').length, 0);
  // 매달 주다가 넉 달 전에 끊김 → 추정 안 함
  assert.equal(planSymbolDividends(monthly.slice(0, 7), '2026-11-10', '2027-03-10').length, 0);
  // 일정 없음
  assert.equal(planSymbolDividends([], '2026-11-10', '2027-03-10').length, 0);
});
