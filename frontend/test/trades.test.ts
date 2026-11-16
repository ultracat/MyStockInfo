import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accumulate,
  computeAmount,
  daysInMonth,
  formatTradeAmount,
  netTradeAmount,
  toDisplayTrades,
  tradeBuckets,
  tradeKey,
  tradeTotals,
} from '../src/calc/trades';

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

test('매매 집계: 연간은 12개월, 월간은 그 달 날짜 수만큼, 원화·달러 따로 + 타일 합계', () => {
  const t = (side: 'BUY' | 'SELL', currency: string, amount: number, executedAt: string) => ({ side, currency, amount, executedAt });
  const trades = [t('BUY', 'KRW', 1000, '2026-02-03'), t('SELL', 'USD', 5, '2026-02-28'), t('BUY', 'USD', 2, '2026-11-01')];
  const year = tradeBuckets(trades, trades, 'year', 2026, 2);
  assert.equal(year.length, 12);
  assert.deepEqual(year[1], { label: '02', buyKrw: 1000, buyUsd: 0, sellKrw: 0, sellUsd: 5 });
  const feb = tradeBuckets(trades, trades.slice(0, 2), 'month', 2026, 2);
  assert.equal(feb.length, 28);
  assert.equal(feb[27].sellUsd, 5);
  assert.deepEqual(tradeTotals(trades), { buyKrw: 1000, buyUsd: 2, sellKrw: 0, sellUsd: 5, buyCount: 2, sellCount: 1 });
  assert.equal(formatTradeAmount(1234.6, 'KRW'), '1,235원');
  assert.equal(formatTradeAmount(1.5, 'USD'), '$1.50');
});

test('개별 모드 행은 위에서 고른 증권사·계좌를 채워 목록 모양으로', () => {
  const [d] = toDisplayTrades(
    [{ id: 'x', symbol: 'A', name: null, side: 'BUY', quantity: 1, price: 2, amount: 2, currency: 'KRW', commission: null, tax: null, executedAt: '2026-01-01' }],
    'kb',
    '123-45-678901'
  );
  assert.equal(d.broker, 'kb');
  assert.equal(d.accountId, '123-45-678901');
  assert.equal(d.amount, 2);
});
