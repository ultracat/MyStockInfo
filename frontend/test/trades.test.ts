import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accumulate, computeAmount, daysInMonth, netTradeAmount, tradeKey } from '../src/calc/trades';

test('체결금액 입력 미리보기: 수량×단가, 숫자가 아니면 0', () => {
  assert.equal(computeAmount('3', '1500'), 4500);
  assert.equal(computeAmount('', '1500'), 0);
  assert.equal(computeAmount('abc', '1'), 0);
});

test('표시 체결금액: 수수료·세금을 매수·매도 구분 없이 더한다', () => {
  assert.equal(netTradeAmount(1000, 10, 5), 1015);
  assert.equal(netTradeAmount(1000, null, null), 1000);
});

test('달력·키·월별 합계', () => {
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 11), 30);
  assert.equal(tradeKey({ broker: 'toss', accountId: '1', id: 'x' } as never), 'toss|1|x');
  const row = { buyKrw: 0, sellKrw: 0, buyUsd: 0, sellUsd: 0 } as never as Parameters<typeof accumulate>[0];
  accumulate(row, { side: 'BUY', currency: 'KRW', amount: 100 });
  accumulate(row, { side: 'SELL', currency: 'USD', amount: 7 });
  assert.equal((row as unknown as { buyKrw: number }).buyKrw, 100);
  assert.equal((row as unknown as { sellUsd: number }).sellUsd, 7);
});
