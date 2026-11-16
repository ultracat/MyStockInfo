import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRealizedSales, estimateOverseasCapitalGainsTax } from '../src/calc/realizedGains';
import type { StoredTrade } from '../src/types';

let seq = 0;
function t(p: Partial<StoredTrade> & Pick<StoredTrade, 'side' | 'quantity' | 'price' | 'executedAt'>): StoredTrade {
  return {
    broker: 'toss',
    accountId: 'a1',
    id: `t${++seq}`,
    symbol: 'AAPL',
    name: 'Apple',
    amount: p.quantity * p.price,
    currency: 'KRW',
    commission: null,
    tax: null,
    ...p,
  };
}
const won = () => 1;

test('이동평균법: 두 번 산 뒤 일부 매도하면 평균단가로 원가를 뺀다', () => {
  const { sales } = computeRealizedSales(
    [
      t({ side: 'BUY', quantity: 10, price: 100, executedAt: '2026-01-02' }),
      t({ side: 'BUY', quantity: 10, price: 200, executedAt: '2026-02-02' }),
      t({ side: 'SELL', quantity: 5, price: 300, executedAt: '2026-03-02' }),
    ],
    won
  );
  assert.equal(sales.length, 1);
  assert.equal(sales[0].costKrw, 750); // 평균 150 × 5
  assert.equal(sales[0].proceedsKrw, 1500);
  assert.equal(sales[0].gainKrw, 750);
});

test('수수료: 매수 비용은 원가에 더하고, 매도 비용은 양도가액에서 뺀다', () => {
  const { sales } = computeRealizedSales(
    [
      t({ side: 'BUY', quantity: 10, price: 100, commission: 10, tax: 0, executedAt: '2026-01-02' }),
      t({ side: 'SELL', quantity: 10, price: 120, commission: 5, tax: 3, executedAt: '2026-01-03' }),
    ],
    won
  );
  assert.equal(sales[0].costKrw, 1010);
  assert.equal(sales[0].proceedsKrw, 1200 - 8);
  assert.equal(sales[0].gainKrw, 1192 - 1010);
});

test('매수 기록보다 많이 판 경우 있는 수량만큼만, 매수 없는 매도는 건너뛴다', () => {
  const { sales } = computeRealizedSales(
    [
      t({ symbol: 'X', side: 'SELL', quantity: 3, price: 100, executedAt: '2026-01-01' }),
      t({ symbol: 'Y', side: 'BUY', quantity: 2, price: 100, executedAt: '2026-01-01' }),
      t({ symbol: 'Y', side: 'SELL', quantity: 5, price: 150, executedAt: '2026-01-02' }),
    ],
    won
  );
  assert.equal(sales.length, 1);
  assert.equal(sales[0].symbol, 'Y');
  assert.equal(sales[0].quantity, 2);
  assert.equal(sales[0].proceedsKrw, 750 * (2 / 5));
  assert.equal(sales[0].costKrw, 200);
});

test('달러 거래는 그 달 환율로 환산, 한 건이라도 환율이 없으면 그 종목 전체를 뺀다', () => {
  const rates: Record<string, number | null> = { '2026-01': 1300, '2026-02': 1400, '2026-03': null };
  const rateFor = (m: string) => rates[m] ?? null;
  const ok = computeRealizedSales(
    [
      t({ symbol: 'NVDA', currency: 'USD', side: 'BUY', quantity: 1, price: 100, executedAt: '2026-01-10' }),
      t({ symbol: 'NVDA', currency: 'USD', side: 'SELL', quantity: 1, price: 110, executedAt: '2026-02-10' }),
    ],
    rateFor
  );
  assert.equal(ok.sales[0].costKrw, 130000);
  assert.equal(ok.sales[0].proceedsKrw, 154000);
  const missing = computeRealizedSales(
    [
      t({ symbol: 'TSLA', currency: 'USD', side: 'BUY', quantity: 1, price: 100, executedAt: '2026-01-10' }),
      t({ symbol: 'TSLA', currency: 'USD', side: 'SELL', quantity: 1, price: 90, executedAt: '2026-03-10' }),
    ],
    rateFor
  );
  assert.deepEqual(missing.sales, []);
  assert.deepEqual(missing.excludedSymbols, ['TSLA']);
});

test('시간순으로 계산하고 결과는 최근 매도부터', () => {
  const { sales } = computeRealizedSales(
    [
      t({ side: 'SELL', quantity: 1, price: 300, executedAt: '2026-03-01' }),
      t({ side: 'BUY', quantity: 2, price: 100, executedAt: '2026-01-01' }),
      t({ side: 'SELL', quantity: 1, price: 200, executedAt: '2026-02-01' }),
    ],
    won
  );
  assert.deepEqual(sales.map((s) => s.date), ['2026-03-01', '2026-02-01']);
  assert.deepEqual(sales.map((s) => s.gainKrw), [200, 100]);
});

test('해외주식 양도세 추정: 250만원 공제 후 22%, 손실이면 0', () => {
  assert.equal(estimateOverseasCapitalGainsTax(3_500_000), 220_000);
  assert.equal(estimateOverseasCapitalGainsTax(2_000_000), 0);
  assert.equal(estimateOverseasCapitalGainsTax(-500_000), 0);
});
