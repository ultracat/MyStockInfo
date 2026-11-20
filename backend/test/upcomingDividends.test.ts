import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsFromSnapshot, overseasScheduleRows, parseKsdDate, planSymbolDividends } from '../src/upcomingDividends';
import type { UpcomingDividend } from '../src/upcomingDividends';

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

test('planSymbolDividends: 예탁원에 아직 없는 다음 달 분배를 지난 일정으로 추정한다(금액은 최근 3회 중간값 — 한 번 튄 60원은 걸러짐, 주말 반영)', () => {
  const out = planSymbolDividends(monthly, '2026-11-10', '2027-03-10');
  // 지난 지급은 기준일 뒤 2영업일(중간값). 2026-11-15는 일요일 → 직전 영업일 13일(금), 지급 17일(화).
  // 2027-01-15는 금요일 → 지급은 주말을 건너 19일(화).
  assert.deepEqual(
    out.map((p) => [p.status, p.recordDate, p.payDate, p.perShare]),
    [
      ['projected', '2026-11-13', '2026-11-17', 30],
      ['projected', '2026-12-15', '2026-12-17', 30],
      ['projected', '2027-01-15', '2027-01-19', 30],
      ['projected', '2027-02-15', '2027-02-17', 30],
    ]
  );
});

test('planSymbolDividends: 분배금이 한 단계 오르면 2회 뒤부터 오른 금액으로 추정한다(최근 3회 중간값)', () => {
  // 30원 안팎이 이어지다 최근 두 번 45원 — 예전 12회 중간값이면 계속 30원이었다.
  const raised = [...monthly.slice(0, 9), row('20260915', 45, '2026/09/17'), row('20261015', 45, '2026/10/17')];
  assert.deepEqual(planSymbolDividends(raised, '2026-11-10', '2026-12-31').map((p) => p.perShare), [45, 45]);
  // 오른 지 한 번뿐이면 아직 예전 금액(튄 달과 구별할 수 없다)
  assert.deepEqual(planSymbolDividends(monthly, '2026-11-10', '2026-11-30').map((p) => p.perShare), [30]);
});

test('planSymbolDividends: 매주 분배는 7일씩 이어서 추정한다(휴일이면 직전 영업일)', () => {
  // 목요일 기준·다음 날 지급. 마지막 두 건은 일정만 있고 금액 미정.
  const thursdays = ['20261008', '20261015', '20261022', '20261029', '20261105', '20261112'];
  const pays = ['2026/10/09', '2026/10/16', '2026/10/23', '2026/10/30', '2026/11/06', '2026/11/13'];
  const weekly = [
    ...thursdays.map((d, i) => row(d, [0.08, 0.07, 0.075, 0.09, 0.085, 0.07][i], pays[i])),
    row('20261119', 0, '2026/11/20'),
  ];
  const cal = { '2026-11-26': false }; // 추수감사절(목) 휴장 가정 → 25일(수)
  const out = planSymbolDividends(weekly, '2026-11-16', '2026-12-31', cal);
  const per = 0.085; // 최근 3회(0.09, 0.085, 0.07) 중간값
  assert.deepEqual(
    out.map((p) => [p.status, p.recordDate, p.payDate, p.perShare]),
    [
      ['projected', '2026-11-19', '2026-11-20', per], // 일정은 있는데 금액 미정
      ['projected', '2026-11-25', '2026-11-27', per], // 26일(목) 휴장 → 기준 25일, 지급은 휴장 건너 27일
      ['projected', '2026-12-03', '2026-12-04', per], // 다음 주는 원래 요일(목)로
      ['projected', '2026-12-10', '2026-12-11', per],
      ['projected', '2026-12-17', '2026-12-18', per],
      ['projected', '2026-12-24', '2026-12-25', per],
      // 12-31 기준분은 지급(1-1)이 범위 밖이라 빠진다
    ]
  );
  // 오래 끊긴 주간 분배(마지막 기준일이 3주 넘게 전)는 추정하지 않는다
  assert.equal(planSymbolDividends(weekly.slice(0, 4), '2026-11-30', '2026-12-31', cal).length, 0);
});

test('planSymbolDividends: 휴장일 정보로 기준일을 앞당기고 지급일은 휴일을 건너뛴다', () => {
  // 가상의 휴일: 2026-11-13(금)·11-16(월) 휴장 → 기준일 15일(일)은 12일(목)로, 지급은 12일 뒤 2영업일 = 18일(수).
  const cal = { '2026-11-12': true, '2026-11-13': false, '2026-11-14': false, '2026-11-15': false, '2026-11-16': false, '2026-11-17': true };
  const out = planSymbolDividends(monthly, '2026-11-10', '2026-11-30', cal);
  assert.deepEqual(out.map((p) => [p.recordDate, p.payDate]), [['2026-11-12', '2026-11-18']]);
});

test('planSymbolDividends: 말일 기준 분기 배당은 말일(휴일이면 직전 영업일)로 추정한다', () => {
  const quarterly = [row('20251231', 100, '2026/01/05'), row('20260331', 100, '2026/04/02'), row('20260630', 110, '2026/07/02'), row('20260930', 100, '2026/10/02')];
  const out = planSymbolDividends(quarterly, '2026-11-10', '2027-04-30');
  assert.deepEqual(out.map((p) => [p.recordDate, p.perShare]), [['2026-12-31', 100], ['2027-03-31', 100]]);
});

test('planSymbolDividends: 기준일이 지났어도 지급 전이면 예탁원 금액으로 예상하고, 그 뒤부터 추정한다', () => {
  const rows = [...monthly, row('20261115', 28, '2026/11/17')];
  const out = planSymbolDividends(rows, '2026-11-16', '2026-12-31');
  assert.deepEqual(out.map((p) => [p.status, p.source, p.recordDate, p.perShare]), [
    ['estimated', 'ksd-schedule', '2026-11-15', 28],
    ['projected', 'history', '2026-12-15', 29], // 최근 3회(29·60·28) 중간값
  ]);
  // 지급일 당일까지는 남고(입금이 오후 늦게 되기도 함 — 2026-11-17 사용자 요청), 다음 날 빠진다
  assert.equal(planSymbolDividends(rows, '2026-11-17', '2026-11-30').length, 1);
  assert.equal(planSymbolDividends(rows, '2026-11-18', '2026-11-30').length, 0);
});

test('planSymbolDividends: 금액 미정(0) 일정은 중간값으로 추정하고, 다음 추정은 그다음 달 "매달 며칠"로 잇는다', () => {
  const rows = [...monthly, row('20261116', 0)];
  const out = planSymbolDividends(rows, '2026-11-10', '2026-12-31');
  assert.deepEqual(out.map((p) => [p.status, p.recordDate, p.payDate, p.perShare]), [
    ['projected', '2026-11-16', null, 30],
    ['projected', '2026-12-15', '2026-12-17', 30], // 지난 기준일의 일자 중간값(15일)
  ]);
});

test('planSymbolDividends: 주기가 일정하지 않거나 기록이 부족하거나 오래 끊긴 종목은 추정하지 않는다', () => {
  // 연 1회 결산 배당 — 2회면 추정(다음 기준일이 범위 안일 때만)
  const annual = [row('20241231', 1000, '2025/04/18'), row('20251231', 1100, '2026/04/17')];
  assert.deepEqual(
    planSymbolDividends(annual, '2026-11-10', '2027-05-01').map((p) => [p.recordDate, p.payDate, p.perShare]),
    [['2026-12-31', '2027-04-20', 1050]] // 지급까지 영업일 78일(중간값)
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

// --- 미국(달러): ICE 일정(HHDFS78330900) + 해외 기간별권리(CTRGT011R) 주당 금액 — 2026-11-16 실측 모양, 값은 지어낸 것 ---
const ice = (record: string, pay: string, title = '현금배당') => ({ anno_dt: '', ca_title: title, div_lock_dt: record, pay_dt: pay, record_dt: record });
const right = (record: string, per: string, type = '03') => ({ pdno: 'X', rght_type_cd: type, acpl_bass_dt: record, alct_frcr_unpr: per, crcy_cd: 'USD', dfnt_yn: 'Y' });

test('overseasScheduleRows: ICE 날짜에 기간별권리 주당 금액을 붙이고, 금액 없는 발표 건은 0(미정), 지난 권리는 지급일 없이 더한다', () => {
  const rows = overseasScheduleRows(
    [ice('20261030', '20261113'), ice('20261130', '20261215'), ice('20261101', '', '티커변경')],
    [right('20260930', '0.27150'), right('20261030', '0.27150'), right('20261030', '1', '02')]
  );
  assert.deepEqual(rows, [
    { record_date: '2026-10-30', per_sto_divi_amt: '0.2715', divi_pay_dt: '20261113' },
    { record_date: '2026-11-30', per_sto_divi_amt: '0', divi_pay_dt: '20261215' },
    { record_date: '2026-09-30', per_sto_divi_amt: '0.2715', divi_pay_dt: '' },
  ]);
});

test('미국 배당: 권리 금액이 있으면 예상, 발표만 된 건은 최근 중간값으로 추정(이번 달 지급분만)', () => {
  // 주간 분배 ETF — 11-12 기준분은 금액 등록됨, 11-19·11-27 기준분은 ICE에만 있음.
  const rows = overseasScheduleRows(
    [ice('20261105', '20261106'), ice('20261112', '20261113'), ice('20261119', '20261120'), ice('20261127', '20261130')],
    [right('20261029', '0.05'), right('20261105', '0.06'), right('20261112', '0.0537')]
  );
  const out = planSymbolDividends(rows, '2026-11-16', '2026-11-30');
  assert.deepEqual(
    out.map((p) => [p.status, p.recordDate, p.payDate, p.perShare]),
    [
      ['projected', '2026-11-19', '2026-11-20', 0.0537],
      ['projected', '2026-11-27', '2026-11-30', 0.0537],
    ]
  );
  // 11-12 기준·11-13 지급분은 이미 지급돼(오늘 11-16 — 지급 다음 날 이후) 빠진다. 지급 전이면 예상(estimated)으로 나온다.
  const before = planSymbolDividends(rows, '2026-11-12', '2026-11-30');
  assert.deepEqual(before[0], { status: 'estimated', source: 'ksd-schedule', recordDate: '2026-11-12', payDate: '2026-11-13', perShare: 0.0537 });
});

// ---- 저장된 일정 → 화면 줄(itemsFromSnapshot) ----

const holding = (broker: string, accountId: string, symbol: string, quantity: number, currency = 'KRW') =>
  ({
    broker, accountId, symbol, name: symbol, market: null, currency, quantity, lastPrice: 0, averagePurchasePrice: 0,
    purchaseAmount: 0, marketValue: 0, profitLossAmount: 0, profitLossRate: 0, commission: null, tax: null, memo: null,
    updatedAt: '2026-11-16T00:00:00Z',
  }) as Parameters<typeof itemsFromSnapshot>[1][number];

const confirmedRow = (symbol: string, record: string, pay: string): UpcomingDividend => ({
  status: 'confirmed', broker: 'kis', accountId: '12345678-01', symbol, name: symbol, currency: 'KRW', payDate: pay,
  recordDate: record, quantity: 0, perShare: null, grossAmount: 1000, tax: 154, source: 'kis-account',
});

test('itemsFromSnapshot: 저장된 일정에 지금 보유 수량을 곱한다(저장 뒤 수량이 바뀌어도 맞음)', () => {
  const snap = { confirmed: [], krCalendar: {}, kr: { '111110': monthly }, us: {} };
  const [p] = planSymbolDividends(monthly, '2026-11-16', '2026-11-30');
  const items = itemsFromSnapshot(snap, [holding('toss', '1', '111110', 10), holding('samsung', 'a', '111110', 3)], '2026-11-16', '');
  assert.deepEqual(
    items.map((i) => [i.broker, i.quantity, i.grossAmount, i.recordDate]),
    [
      ['toss', 10, Math.round(p.perShare * 10), p.recordDate],
      ['samsung', 3, Math.round(p.perShare * 3), p.recordDate],
    ]
  );
  // 같은 저장본, 수량만 바뀜 → 금액도 따라간다.
  const more = itemsFromSnapshot(snap, [holding('toss', '1', '111110', 20)], '2026-11-16', '');
  assert.equal(more[0].grossAmount, Math.round(p.perShare * 20));
});

test('itemsFromSnapshot: 저장본에 없는 종목·수량 0은 빼고, 확정 건은 지급일 당일까지 남기고 지난 건은 거른다', () => {
  const snap = {
    confirmed: [
      confirmedRow('222220', '2026-09-30', '2026-11-15'),
      confirmedRow('222220', '2026-10-31', '2026-11-16'),
      confirmedRow('222220', '2026-11-30', '2026-12-20'),
    ],
    krCalendar: {},
    kr: { '111110': monthly },
    us: {},
  };
  const items = itemsFromSnapshot(snap, [holding('toss', '1', '333330', 5), holding('toss', '1', '111110', 0)], '2026-11-16', '12345678-01');
  assert.deepEqual(items.map((i) => [i.status, i.payDate]), [['confirmed', '2026-11-16'], ['confirmed', '2026-12-20']]);
});

test('itemsFromSnapshot: KIS 계좌에 같은 종목·기준월 확정이 있으면 그 계좌엔 예상·추정을 안 만든다', () => {
  const [p] = planSymbolDividends(monthly, '2026-11-16', '2026-11-30');
  const snap = { confirmed: [confirmedRow('111110', p.recordDate, '2026-11-25')], krCalendar: {}, kr: { '111110': monthly }, us: {} };
  const items = itemsFromSnapshot(snap, [holding('kis', '12345678-01', '111110', 10), holding('toss', '1', '111110', 4)], '2026-11-16', '12345678-01');
  assert.deepEqual(items.map((i) => [i.status, i.broker]).sort(), [['confirmed', 'kis'], ['projected', 'toss']]);
});

test('itemsFromSnapshot: ISA·연금 계좌(세금 이연)의 원화 건은 확정·예상·추정 모두 세금 0, 다른 계좌·달러는 그대로', () => {
  const [p] = planSymbolDividends(monthly, '2026-11-16', '2026-11-30');
  const snap = { confirmed: [{ ...confirmedRow('222220', '2026-11-30', '2026-12-20'), tax: 154 }], krCalendar: {}, kr: { '111110': monthly }, us: {} };
  const deferred = (broker: string, accountId: string) => broker === 'kis' ? accountId === '12345678-01' : accountId === 'isa';
  const items = itemsFromSnapshot(snap, [holding('toss', 'isa', '111110', 10), holding('toss', '1', '111110', 4)], '2026-11-16', '12345678-01', deferred);
  assert.ok(p);
  assert.deepEqual(items.map((i) => [i.status, i.accountId, i.tax]).sort(), [
    ['confirmed', '12345678-01', 0],
    [p.status, '1', null],
    [p.status, 'isa', 0],
  ].sort());
  // 함수를 안 주면 예전 그대로(확정은 API 세금, 예상·추정은 null)
  assert.deepEqual(itemsFromSnapshot(snap, [holding('toss', 'isa', '111110', 10)], '2026-11-16', '12345678-01').map((i) => i.tax).sort(), [154, null].sort());
});

test('itemsFromSnapshot: 미국 종목은 달러·센트 반올림, 출처는 kis-overseas/history', () => {
  const rows = overseasScheduleRows(
    [ice('20261105', '20261106'), ice('20261112', '20261113'), ice('20261119', '20261120')],
    [right('20261029', '0.05'), right('20261105', '0.06'), right('20261119', '0.0537')]
  );
  const items = itemsFromSnapshot({ confirmed: [], krCalendar: {}, kr: {}, us: { XYZ: rows } }, [holding('toss', '1', 'XYZ', 7, 'USD')], '2026-11-16', '');
  assert.deepEqual(items.map((i) => [i.currency, i.source, i.grossAmount]), [['USD', 'kis-overseas', Math.round(0.0537 * 7 * 100) / 100]]);
});
