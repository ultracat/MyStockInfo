import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyseHolidays, usMarketClosedDays } from '../src/usMarketCalendar';
import { planSymbolDividends } from '../src/upcomingDividends';

// NYSE 공식 휴장일표(nyse.com/markets/hours-calendars, 2026-11-16 확인)와 같아야 한다.
test('nyseHolidays: 2026~2028 공식 휴장일표와 같다(토·일 대체, 1/1 토요일은 휴장 없음)', () => {
  assert.deepEqual(nyseHolidays(2026), [
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  ]);
  assert.deepEqual(nyseHolidays(2027), [
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  ]);
  assert.deepEqual(nyseHolidays(2028), [
    '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29',
    '2028-06-19', '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
  ]);
});

test('usMarketClosedDays: 범위 안 휴장일만 false로', () => {
  assert.deepEqual(usMarketClosedDays('2026-11-01', '2026-12-31'), { '2026-11-26': false, '2026-12-25': false });
});

test('미국 추정 날짜: 기준일이 휴장일이면 직전 영업일, 지급일은 휴장일을 건너뛴다', () => {
  // 매달 25일 기준·2영업일 뒤 지급하는 가상 종목(11월은 추수감사절 11-26을 건너 11-30 지급 — 휴장일로 세야 2영업일).
  // 2026-12-25(금)는 크리스마스 휴장 → 기준일은 직전 영업일 24일(목), 지급은 25일을 건너 2영업일 뒤 29일(화).
  // 휴장일을 모르면 기준일이 휴장일인 25일로 나온다.
  const row = (record: string, pay: string) => ({ record_date: record, per_sto_divi_amt: '0.1', divi_pay_dt: pay });
  const rows = [row('20260825', '20260827'), row('20260925', '20260929'), row('20261023', '20261027'), row('20261125', '20261130')];
  const cal = usMarketClosedDays('2025-01-01', '2027-12-31');
  const out = planSymbolDividends(rows, '2026-12-01', '2026-12-31', cal);
  assert.deepEqual(out.map((p) => [p.recordDate, p.payDate]), [['2026-12-24', '2026-12-29']]);
  assert.equal(planSymbolDividends(rows, '2026-12-01', '2026-12-31')[0].recordDate, '2026-12-25');
});
