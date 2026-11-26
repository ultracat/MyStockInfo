import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accountDividendRows,
  dividendSymbolRows,
  heldDividendTotal,
  holdingAccountRows,
  holdingSlices,
  indexComparisonRows,
  monthlyAmountRows,
  sectorSlices,
  topNSlices,
  yearDividendTotal,
  type FlatHolding,
} from '../src/calc/overview';
import type { AccountLabel, DividendRecord, StoredTrade } from '../src/types';

const toKrw = (amount: number, currency: string | null) => (currency === 'USD' ? amount * 1000 : amount);
const noFx = (amount: number, currency: string | null) => (currency === 'USD' ? null : amount);

const h = (p: Partial<FlatHolding>): FlatHolding => ({
  broker: 'toss', accountId: '1', symbol: 'A', name: 'A', currency: 'KRW', quantity: 1, lastPrice: 100, purchaseAmount: 100, ...p,
});
let seq = 0;
const div = (p: Partial<DividendRecord>): DividendRecord =>
  ({ id: `d${++seq}`, broker: 'toss', accountId: '1', symbol: 'A', name: 'A', currency: 'KRW', amount: 10, tax: null, paidDate: '2026-03-15', memo: null, ...p }) as DividendRecord;
const trade = (symbol: string, side: 'BUY' | 'SELL', quantity: number, executedAt: string): StoredTrade => ({
  broker: 'toss', accountId: '1', id: `t${++seq}`, symbol, name: null, side, quantity, price: 0, amount: 0,
  currency: 'KRW', commission: null, tax: null, executedAt,
});

test('topNSlices: 상위 5 + 기타 N종목, 0 이하는 뺀다', () => {
  const m = new Map(Array.from({ length: 7 }, (_, i) => [`S${i}`, { name: `N${i}`, valueKrw: 70 - i * 10 }]));
  const s = topNSlices(m);
  assert.equal(s.length, 6);
  assert.equal(s[0].label, 'N0 (S0)');
  assert.equal(s[5].label, '기타 2종목'); // 6·7위(20, 10)를 합친다
  assert.equal(s[5].value, 30);
  assert.equal(topNSlices(new Map([['Z', { name: 'Z', valueKrw: 0 }]])).length, 0);
});

test('보유 비중: 같은 종목은 계좌를 넘어 합치고, 환율 없는 달러 종목은 뺀다', () => {
  const holdings = [h({ symbol: 'A', quantity: 2 }), h({ symbol: 'A', accountId: '2', quantity: 1 }), h({ symbol: 'U', name: 'U', currency: 'USD', lastPrice: 1 })];
  assert.deepEqual(holdingSlices(holdings, toKrw).map((s) => [s.label, s.value]), [['U (U)', 1000], ['A (A)', 300]]);
  assert.deepEqual(holdingSlices(holdings, noFx).map((s) => s.value), [300]);
});

test('섹터 비중: 배분대로 나누고 섹터 없는 종목은 마지막 "분류 안 됨"', () => {
  const holdings = [h({ symbol: 'A', lastPrice: 100 }), h({ symbol: 'E', lastPrice: 50 })];
  const s = sectorSlices(holdings, { A: [{ sector: 'IT', weight: 0.6 }, { sector: '금융', weight: 0.4 }] }, toKrw);
  assert.deepEqual(s.map((x) => [x.label, Math.round(x.value)]), [['IT', 60], ['금융', 40], ['분류 안 됨', 50]]);
});

test('계좌별 보유: 계좌마다 매입·손익률 메타, memo로 나뉜 같은 종목은 합친다', () => {
  const rows = holdingAccountRows([h({ quantity: 1, purchaseAmount: 50 }), h({ quantity: 1, purchaseAmount: 50 })], [], toKrw);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].valueKrw, 200);
  assert.match(rows[0].meta, /^1개 종목 · 매입 .+ · 손익 \+100\.00%$/);
  assert.equal(rows[0].details[0].label, 'A (A) · 2주');
});

test('배당 종목별/계좌별: 달러는 지급월 환율, 표시용 계좌번호는 내부 계좌로 묶는다', () => {
  const labels = [{ broker: 'toss', accountId: '1', label: '', accountNumber: '123-45-678901' }] as AccountLabel[];
  const divs = [
    div({ accountId: '1', amount: 10 }),
    div({ accountId: '123-45-678901', amount: 5 }),
    div({ symbol: 'U', name: 'U', currency: 'USD', amount: 2, paidDate: '2026-03-20' }),
    div({ symbol: 'X', currency: 'USD', amount: 9, paidDate: '2026-04-01' }), // 환율 없음 → 빠짐
  ];
  const rateFor = (m: string) => (m === '2026-03' ? 1300 : null);
  assert.deepEqual(dividendSymbolRows(divs, '2026', rateFor).map((r) => [r.symbol, r.valueKrw, r.count]), [['U', 2600, 1], ['A', 15, 2]]);
  const acc = accountDividendRows(divs, labels, '2026', rateFor);
  assert.equal(acc.length, 1);
  assert.equal(acc[0].count, 3);
  // 계좌 행 제목: 번호(보통 글씨) + 아래 증권사·별칭 — 별칭이 비었으면 증권사만
  assert.deepEqual([acc[0].label, acc[0].sub], ['123-45-678901', '토스증권']);
  assert.equal(acc[0].details.find((d) => d.label.startsWith('A'))?.label, 'A (A) · 배당 2건');
});

test('연간 배당 합계: 환율 없는 달의 달러는 빠지고 표시', () => {
  const rows = [{ month: '2026-01', totalKrw: 100, totalUsd: 1, count: 2 }, { month: '2026-02', totalKrw: 0, totalUsd: 1, count: 1 }];
  assert.deepEqual(yearDividendTotal(rows, (m) => (m === '2026-01' ? 1000 : null)), { totalKrw: 1100, hasUnconvertedUsd: true });
});

test('배당 포함 손익: 지금 보유 중인 (계좌, 종목)의 배당만', () => {
  const holdings = [h({ symbol: 'A', accountId: '1' })];
  const divs = [div({ symbol: 'A', accountId: '1', amount: 10 }), div({ symbol: 'B', accountId: '1', amount: 99 }), div({ symbol: 'A', accountId: null, amount: 1 })];
  // 계좌가 빈 기록은 그 증권사 계좌가 하나뿐이면 그 계좌 것으로 본다.
  assert.deepEqual(heldDividendTotal(holdings, divs, [], () => null), { totalKrw: 11, unconverted: false });
});

test('월별 투자금: 오늘 평단가 × 그 달 수량, 평가는 그 달 종가(없으면 현재가), 거래 없는 달은 이어간다', () => {
  const holdings = [h({ symbol: 'A', quantity: 3, lastPrice: 200, purchaseAmount: 300 })]; // 평단 100
  const trades = [trade('A', 'BUY', 2, '2026-01-10'), trade('A', 'BUY', 2, '2026-03-05'), trade('A', 'SELL', 1, '2026-03-20'), trade('Z', 'BUY', 5, '2025-01-01')];
  const rows = monthlyAmountRows(holdings, trades, { A: [{ month: '2026-01', closePrice: 150, currency: 'KRW' }] }, toKrw, new Date('2026-04-15T00:00:00'));
  assert.deepEqual(rows, [
    { month: '2026-01', investedKrw: 200, currentKrw: 300 },
    { month: '2026-02', investedKrw: 200, currentKrw: 400 },
    { month: '2026-03', investedKrw: 300, currentKrw: 600 },
    { month: '2026-04', investedKrw: 300, currentKrw: 600 },
  ]);
  const cmp = indexComparisonRows(rows, { KOSPI: [{ month: '2026-01', close: 100 }, { month: '2026-02', close: 110 }] });
  assert.equal(cmp[0].mine, null);
  assert.equal(cmp[1].mine, (400 - 300) / 300);
  assert.equal(cmp[2].mine, (600 - 400 - 100) / 400); // 새로 넣은 투자금 100은 수익에서 뺀다
  assert.ok(Math.abs((cmp[1].kospi ?? 0) - 0.1) < 1e-9);
  assert.equal(cmp[2].kospi, null);
});

test('월별 투자금: 같은 종목을 여러 계좌에 들고 있으면 평단가는 전 계좌 매입금액 합 ÷ 수량 합', () => {
  // 계좌 1: 1주 100원, 계좌 2: 3주 900원 → 평단 1000 / 4 = 250(첫 계좌 평단 100만 쓰면 400이 된다).
  const holdings = [
    h({ symbol: 'A', accountId: '1', quantity: 1, lastPrice: 300, purchaseAmount: 100 }),
    h({ symbol: 'A', accountId: '2', quantity: 3, lastPrice: 300, purchaseAmount: 900 }),
  ];
  const trades = [trade('A', 'BUY', 4, '2026-04-01')];
  const rows = monthlyAmountRows(holdings, trades, {}, toKrw, new Date('2026-04-15T00:00:00'));
  assert.deepEqual(rows, [{ month: '2026-04', investedKrw: 1000, currentKrw: 1200 }]);
});
