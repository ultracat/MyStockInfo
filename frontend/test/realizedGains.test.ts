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

// ---- 실현손익 화면의 연도별 합계(calc/realizedGains.ts — RealizedGains.tsx에서 옮김) ----
import { dividendIncomeSummary, generalGrossDividendKrwForYear, isaRealizedSales, overseasGeneralGainForYear } from '../src/calc/realizedGains';
import type { DividendRecord } from '../src/types';

function d(p: Partial<DividendRecord> & Pick<DividendRecord, 'amount' | 'paidDate'>): DividendRecord {
  return { id: `d${++seq}`, broker: 'toss', accountId: 'a1', symbol: 'AAA', name: '가짜', currency: 'KRW', memo: null, tax: null, ...p } as DividendRecord;
}

test('배당소득 요약: 그 해·일반 계좌만, 세전은 세금 포함, 환율 없는 달러는 건수만', () => {
  const divs = [
    d({ amount: 1000, tax: 100, paidDate: '2026-03-10' }),
    d({ amount: 10, tax: 2, currency: 'USD', paidDate: '2026-04-10', broker: 'kis' }),
    d({ amount: 5, currency: 'USD', paidDate: '2026-05-10', broker: 'kis' }), // 5월 환율 없음
    d({ amount: 999, paidDate: '2025-12-31' }), // 다른 해
    d({ amount: 777, paidDate: '2026-06-01', accountId: 'isa' }), // ISA
  ];
  const s = dividendIncomeSummary(divs, {
    year: 2026,
    broker: 'ALL',
    taxTypeOf: (r) => (r.accountId === 'isa' ? 'ISA' : 'GENERAL'),
    rateFor: (m) => (m === '2026-04' ? 1000 : null),
  });
  assert.equal(s.count, 3);
  assert.equal(s.krwTotal, 1000);
  assert.equal(s.usdTotal, 15);
  assert.equal(s.convertedKrw, 1000 + 10_000);
  assert.equal(s.grossKrw, 1100 + 12_000);
  assert.equal(s.unconvertedCount, 1);
  assert.deepEqual(s.brokerRows.map((r) => [r.broker, r.count, r.totalKrw]), [
    ['toss', 1, 1000],
    ['kis', 2, 10_000],
  ]);
  const onlyKis = dividendIncomeSummary(divs, { year: 2026, broker: 'kis', taxTypeOf: () => 'GENERAL', rateFor: () => 1000 });
  assert.equal(onlyKis.count, 2);
});

test('올해 해외 일반 계좌 실현손익·세전 배당 합', () => {
  const sales = [
    { date: '2026-02-01', broker: 'toss', accountId: 'a1', symbol: 'X', name: null, quantity: 1, currency: 'USD', proceedsKrw: 0, costKrw: 0, gainKrw: 100 },
    { date: '2026-03-01', broker: 'toss', accountId: 'a1', symbol: 'Y', name: null, quantity: 1, currency: 'KRW', proceedsKrw: 0, costKrw: 0, gainKrw: 50 },
    { date: '2026-03-01', broker: 'toss', accountId: 'isa', symbol: 'Z', name: null, quantity: 1, currency: 'USD', proceedsKrw: 0, costKrw: 0, gainKrw: 70 },
    { date: '2025-03-01', broker: 'toss', accountId: 'a1', symbol: 'Z', name: null, quantity: 1, currency: 'USD', proceedsKrw: 0, costKrw: 0, gainKrw: 30 },
  ] as const;
  assert.equal(overseasGeneralGainForYear([...sales], 2026, (_b, acc) => acc !== 'isa'), 100);
  const divs = [d({ amount: 100, tax: 10, paidDate: '2026-01-05' }), d({ amount: 1, tax: 0.5, currency: 'USD', paidDate: '2026-02-05' })];
  assert.equal(generalGrossDividendKrwForYear(divs, 2026, () => 'GENERAL', () => 1000), 110 + 1500);
  assert.equal(generalGrossDividendKrwForYear(divs, 2026, () => 'GENERAL', () => null), 110);
});

test('ISA 매매손익은 계좌마다 따로 이동평균한다', () => {
  const trades = [
    t({ side: 'BUY', quantity: 1, price: 100, executedAt: '2026-01-01', accountId: 'isa', symbol: 'S' }),
    t({ side: 'BUY', quantity: 1, price: 1000, executedAt: '2026-01-01', accountId: 'gen', symbol: 'S' }),
    t({ side: 'SELL', quantity: 1, price: 200, executedAt: '2026-02-01', accountId: 'isa', symbol: 'S' }),
  ];
  const sales = isaRealizedSales([{ broker: 'toss', accountId: 'isa', taxType: 'ISA' }, { broker: 'toss', accountId: 'gen', taxType: 'GENERAL' }], trades, won);
  assert.equal(sales.length, 1);
  assert.equal(sales[0].gainKrw, 100); // 일반 계좌 매입가(1000)가 섞이지 않는다
});
