import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAvgCostMap, investedAsOf } from '../src/calc/dividends';
import type { StoredTrade } from '../src/types';

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
