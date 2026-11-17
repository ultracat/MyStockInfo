import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  brokerDividendSums,
  brokerLines,
  buildAvgCostMap,
  grandTotal,
  investedAsOf,
  quantityBySymbol,
  excludeReceived,
  upcomingMonthlyRows,
} from '../src/calc/dividends';
import type { DividendRecord, StoredTrade, UpcomingDividend } from '../src/types';

let seq = 0;
const trade = (symbol: string, side: 'BUY' | 'SELL', quantity: number, executedAt: string): StoredTrade => ({
  broker: 'toss', accountId: 'a', id: `t${++seq}`, symbol, name: null, side, quantity, price: 0, amount: 0,
  currency: 'KRW', commission: null, tax: null, executedAt,
});

test('평단가: 여러 계좌의 같은 종목은 가중평균, 수량 0·통화 없는 행은 뺀다', () => {
  const m = buildAvgCostMap([
    { symbol: 'A', currency: 'KRW', quantity: 10, purchaseAmount: 1000 },
    { symbol: 'A', currency: 'KRW', quantity: 30, purchaseAmount: 6000 },
    { symbol: 'B', currency: 'USD', quantity: 0, purchaseAmount: 50 },
    { symbol: 'C', currency: null, quantity: 5, purchaseAmount: 50 },
  ]);
  assert.deepEqual(m.get('A'), { avgCost: 175, currency: 'KRW', quantity: 40 });
  assert.equal(m.has('B'), false);
  assert.equal(m.has('C'), false);
});

test('연도 말 투자금: 그때까지의 매매로 수량을 다시 세고 오늘 평단가를 곱한다', () => {
  const costs = new Map([
    ['A', { avgCost: 100, currency: 'KRW', quantity: 20 }],
    ['U', { avgCost: 10, currency: 'USD', quantity: 5 }],
  ]);
  const trades = [
    trade('A', 'BUY', 10, '2024-03-01'),
    trade('A', 'BUY', 10, '2025-03-01'), // 2024년 말엔 아직 없다
    trade('U', 'BUY', 5, '2024-06-01'),
    trade('Z', 'BUY', 99, '2024-01-01'), // 지금 안 갖고 있는 종목은 대상 아님
  ];
  assert.deepEqual(investedAsOf(costs, trades, '2024-12-31'), { krw: 1000, usd: 50 });
  assert.deepEqual(investedAsOf(costs, trades, '2025-12-31'), { krw: 2000, usd: 50 });
});

test('연도 말 투자금: 중복 저장으로 재구성 수량이 부풀어도 오늘 수량을 넘지 않는다(실사례 방지)', () => {
  const costs = new Map([['N', { avgCost: 10, currency: 'USD', quantity: 448 }]]);
  const dup = [trade('N', 'BUY', 448, '2024-01-01'), trade('N', 'BUY', 448, '2024-01-01'), trade('N', 'BUY', 448, '2024-01-01')];
  assert.deepEqual(investedAsOf(costs, dup, '2024-12-31'), { krw: 0, usd: 4480 });
});

test('연도 말 투자금: 매수 기록보다 많이 판 매도는 가진 만큼만 뺀다', () => {
  const costs = new Map([['A', { avgCost: 100, currency: 'KRW', quantity: 10 }]]);
  const trades = [trade('A', 'SELL', 5, '2024-01-01'), trade('A', 'BUY', 10, '2024-02-01'), trade('A', 'SELL', 3, '2024-03-01')];
  assert.deepEqual(investedAsOf(costs, trades, '2024-12-31'), { krw: 700, usd: 0 });
});

// ---- 배당금 화면 요약(calc/dividends.ts, 2026-11-17)

const rec = (p: Partial<DividendRecord>): DividendRecord =>
  ({ id: `r${++seq}`, broker: 'toss', accountId: null, symbol: 'A', name: 'A', currency: 'KRW', amount: 100, tax: null, paidDate: '2026-03-10', memo: null, ...p }) as DividendRecord;

test('예상 배당: 확정은 세전−세금, 나머지는 국내 15.4%·미국 15% 원천징수 가정, 증권사·연도 필터', () => {
  const up = (p: Partial<UpcomingDividend>): UpcomingDividend =>
    ({ status: 'projected', broker: 'kis', accountId: '1', symbol: 'A', name: 'A', currency: 'KRW', payDate: '2026-12-20', recordDate: null, quantity: 1, perShare: null, grossAmount: 1000, tax: null, source: 'history', ...p }) as UpcomingDividend;
  const rows = upcomingMonthlyRows(
    [up({}), up({ currency: 'USD', grossAmount: 10 }), up({ tax: 100, status: 'confirmed' }), up({ broker: 'toss' }), up({ payDate: '2027-01-05' })],
    'kis',
    2026
  );
  assert.deepEqual(rows, [{ month: '2026-12', totalKrw: 846 + 900, totalUsd: 8.5, count: 3 }]);
});

test('다가오는 배당: 받은 기록이 있는 것만 뺀다 — 같은 증권사라도 계좌가 다르면 남기고, 계좌 칸이 빈 기록은 증권사 단위', () => {
  const up = (p: Partial<UpcomingDividend>): UpcomingDividend =>
    ({ status: 'estimated', broker: 'kb', accountId: '111-11', symbol: 'A', name: 'A', currency: 'KRW', payDate: '2026-11-17', recordDate: null, quantity: 1, perShare: null, grossAmount: 1000, tax: null, source: 'ksd-schedule', ...p }) as UpcomingDividend;
  const items = [up({}), up({ accountId: '222-22' }), up({ broker: 'kis', accountId: '333-33' }), up({ payDate: '2026-12-17' })];
  const left = excludeReceived(items, [{ broker: 'kb', accountId: '111-11', symbol: 'A', paidDate: '2026-11-17' }]);
  assert.deepEqual(left.map((i) => `${i.broker}/${i.accountId}/${i.payDate}`), ['kb/222-22/2026-11-17', 'kis/333-33/2026-11-17', 'kb/111-11/2026-12-17']);
  const byBroker = excludeReceived(items, [{ broker: 'kb', accountId: null, symbol: 'A', paidDate: '2026-11-17' }]);
  assert.deepEqual(byBroker.map((i) => `${i.broker}/${i.accountId}`), ['kis/333-33', 'kb/111-11']);
  // 입금일이 예상 지급일과 3일 안으로 어긋나도 같은 배당, 7일 뒤(주간 분배)는 다른 배당
  assert.equal(excludeReceived([up({})], [{ broker: 'kb', accountId: '111-11', symbol: 'A', paidDate: '2026-11-19' }]).length, 0);
  assert.equal(excludeReceived([up({})], [{ broker: 'kb', accountId: '111-11', symbol: 'A', paidDate: '2026-11-10' }]).length, 1);
  assert.equal(excludeReceived([up({})], [{ broker: 'kb', accountId: '111-11', symbol: 'B', paidDate: '2026-11-17' }]).length, 1, '다른 종목');
});

test('증권사별 줄: 달러가 있으면 원화/달러/합계(환산) 3줄, 배당은 지급월 환율, 투자금은 오늘 환율', () => {
  const sums = brokerDividendSums(
    [rec({ amount: 100 }), rec({ currency: 'USD', amount: 2, paidDate: '2026-03-01' }), rec({ broker: 'kb', amount: 50 })],
    (m) => (m === '2026-03' ? 1000 : null)
  );
  const lines = brokerLines(sums, { toss: { krw: 10000, usd: 10 }, kb: { krw: 0, usd: 0 } }, 1500, () => '-');
  assert.deepEqual(
    lines.map((l) => [l.label, l.invested, l.dividend, l.yieldText]),
    [
      ['토스증권', '10,000원', '100원', '1.00%'],
      ['　달러', '$10.00', '$2.00', '20.00%'],
      ['　합계(환산)', '25,000원', '2,100원', '8.40%'],
      ['KB증권', '0원', '50원', '-'],
    ]
  );
  // 투자금이 없는 증권사가 있으면 총합계는 "일부 조회 실패"
  assert.equal(grandTotal(sums, { toss: { krw: 10000, usd: 10 } }, 1500, false).investedText, '일부 조회 실패');
  assert.deepEqual(grandTotal(sums, { toss: { krw: 10000, usd: 10 }, kb: { krw: 0, usd: 0 } }, 1500, false), {
    hasAny: true, dividendText: '2,150원', investedText: '25,000원', yieldText: '8.60%',
  });
  // 환율이 없는 달의 달러 배당이 있으면 배당 합계는 "환율 미적용"
  const noFx = brokerDividendSums([rec({ currency: 'USD', amount: 2 })], () => null);
  assert.equal(grandTotal(noFx, { toss: { krw: 1, usd: 0 } }, null, false).dividendText, '환율 미적용');
});

test('보유수량: 전체면 증권사 합, 특정 증권사면 그 증권사만', () => {
  const cost = (quantity: number) => ({ avgCost: 1, currency: 'KRW', quantity });
  const m = { toss: new Map([['A', cost(2)]]), kis: new Map([['A', cost(3)], ['B', cost(1)]]) };
  assert.deepEqual([...quantityBySymbol(m, 'ALL')], [['A', 5], ['B', 1]]);
  assert.deepEqual([...quantityBySymbol(m, 'toss')], [['A', 2]]);
});
