import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortByText, sortByValue } from '../src/calc/sort';
import { sortStockReturnRows, type SymbolRow } from '../src/calc/stockReturns';

const ids = (rows: { id?: string; symbol?: string }[]) => rows.map((r) => r.id ?? r.symbol).join('');

test('숫자 정렬: 값 없는 행은 방향과 상관없이 맨 뒤, 같은 값은 원래 순서', () => {
  const rows = [{ id: 'a', v: 2 }, { id: 'b', v: null }, { id: 'c', v: 5 }, { id: 'd', v: 2 }];
  assert.equal(ids(sortByValue(rows, (r) => r.v, false)), 'cadb');
  assert.equal(ids(sortByValue(rows, (r) => r.v, true)), 'adcb');
});

test('글자 정렬: 가나다(한국어 로캘이라 한글이 영문보다 앞), 숫자는 크기순, 빈 값은 맨 뒤', () => {
  const rows = [{ id: 'a', t: '한빛전자' }, { id: 'b', t: '' }, { id: 'c', t: '계좌10' }, { id: 'd', t: '계좌2' }, { id: 'e', t: 'Apple' }];
  assert.equal(ids(sortByText(rows, (r) => r.t, true)), 'dcaeb');
  assert.equal(ids(sortByText(rows, (r) => r.t, false)), 'eacdb');
});

function sr(p: Partial<SymbolRow> & { symbol: string }): SymbolRow {
  return { name: p.symbol, currency: 'KRW', quantity: 1, purchaseKrw: 100, marketKrw: 100, dividendKrw: 0, held: true, unconverted: false, ...p };
}

test('종목별 수익 정렬: 환율 미적용은 맨 뒤, 비율은 투자금 0이면 맨 뒤', () => {
  const rows = [
    sr({ symbol: 'A', purchaseKrw: 100, marketKrw: 150 }), // +50, +50%
    sr({ symbol: 'B', purchaseKrw: 1000, marketKrw: 1100, unconverted: true }),
    sr({ symbol: 'C', purchaseKrw: 1000, marketKrw: 1200 }), // +200, +20%
    sr({ symbol: 'D', purchaseKrw: 0, marketKrw: 0, dividendKrw: 30, held: false }),
  ];
  assert.equal(ids(sortStockReturnRows(rows, 'valuation', false)), 'CADB');
  assert.equal(ids(sortStockReturnRows(rows, 'valuation', true)), 'DACB');
  // 값이 없는 B(환율 미적용)·D(투자금 0)는 둘 다 맨 뒤, 그 둘끼리는 원래 순서
  assert.equal(ids(sortStockReturnRows(rows, 'valuationRate', false)), 'ACBD');
  assert.equal(ids(sortStockReturnRows(rows, 'valuationRate', true)), 'CABD');
  assert.equal(ids(sortStockReturnRows(rows, 'totalReturn', false)), 'CADB');
  assert.equal(ids(sortStockReturnRows(rows, 'dividendRate', false)), 'ACBD');
  assert.equal(ids(sortStockReturnRows(rows, 'name', true)), 'ABCD');
});

test('매매내역 정렬: 체결금액은 수수료·세금 포함·달러 환산, 환율 없으면 달러는 맨 뒤', async () => {
  const { sortTrades } = await import('../src/calc/trades');
  const t = (id: string, executedAt: string, amount: number, currency = 'KRW', commission: number | null = null) => ({
    broker: 'kb' as const, accountId: 'a', id, symbol: id, name: id, side: 'BUY' as const, quantity: 1, price: amount, amount, currency,
    commission, tax: null, executedAt,
  });
  const rows = [t('A', '2026-01-02', 1000), t('B', '2026-03-01', 1, 'USD'), t('C', '2026-02-01', 900, 'KRW', 200)];
  assert.equal(ids(sortTrades(rows, 'date', false, null)), 'BCA');
  assert.equal(ids(sortTrades(rows, 'amount', false, 1400)), 'BCA'); // $1=1400 > 900+200 > 1000
  assert.equal(ids(sortTrades(rows, 'amount', false, null)), 'CAB');
});

test('배당 기록 정렬: 달러는 지급월 환율로 환산', async () => {
  const { sortDividendRecords } = await import('../src/calc/dividends');
  const d = (id: string, paidDate: string, amount: number, currency: 'KRW' | 'USD' = 'KRW') =>
    ({ id, broker: 'kb', accountId: null, symbol: id, name: id, paidDate, amount, tax: null, currency, memo: null }) as never;
  const rows = [d('A', '2026-01-10', 5000), d('B', '2026-02-10', 2, 'USD'), d('C', '2026-03-10', 3000)];
  const rate = (m: string) => (m === '2026-02' ? 2000 : null);
  assert.equal(ids(sortDividendRecords(rows, 'amount', false, rate)), 'ABC');
  assert.equal(ids(sortDividendRecords(rows, 'amount', false, () => null)), 'ACB');
  assert.equal(ids(sortDividendRecords(rows, 'date', false, rate)), 'CBA');
});

test('실현손익 정렬·합계: 손익률은 취득 0이면 맨 뒤', async () => {
  const { sortRealizedSales, realizedTotals } = await import('../src/calc/realizedGains');
  const s = (symbol: string, date: string, proceedsKrw: number, costKrw: number) =>
    ({ date, broker: 'kb', accountId: 'a', symbol, name: symbol, quantity: 1, currency: 'USD', proceedsKrw, costKrw, gainKrw: proceedsKrw - costKrw }) as never;
  const rows = [s('A', '2026-01-01', 150, 100), s('B', '2026-02-01', 50, 0), s('C', '2026-03-01', 500, 400)];
  assert.equal(ids(sortRealizedSales(rows, 'gain', false)), 'CAB');
  assert.equal(ids(sortRealizedSales(rows, 'gainRate', false)), 'ACB');
  assert.deepEqual(realizedTotals(rows), { proceedsKrw: 700, costKrw: 500, gainKrw: 200, rate: 0.4 });
});

test('관심종목 정렬: 목표가는 가장 가까운 목표까지 남은 비율, 기본은 등록 순서', async () => {
  const { sortWatchRows, targetGap } = await import('../src/calc/watchlist');
  assert.equal(targetGap(100, { above: 110, below: 95 }), 0.05);
  assert.equal(targetGap(100, { above: 90, below: null }), -0.1); // 이미 넘음
  assert.equal(targetGap(null, { above: 110, below: null }), null);
  const rows = [
    { symbol: 'A', name: 'A', lastPrice: 100, changeRate: 0.01 },
    { symbol: 'B', name: 'B', lastPrice: 100, changeRate: null },
    { symbol: 'C', name: 'C', lastPrice: 100, changeRate: -0.02 },
  ];
  const targets: Record<string, { above: number | null; below: number | null }> = { A: { above: 130, below: null }, C: { above: 105, below: null } };
  assert.equal(ids(sortWatchRows(rows, 'added', false, (s) => targets[s])), 'ABC');
  assert.equal(ids(sortWatchRows(rows, 'target', true, (s) => targets[s])), 'CAB');
  assert.equal(ids(sortWatchRows(rows, 'change', false, (s) => targets[s])), 'ACB');
});
