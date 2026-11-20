import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ACCOUNTS, buildPortfolioFromStored, dividendTotals, holdingRows, mergePortfolios, sortHoldingRows } from '../src/calc/portfolio';
import type { DividendRecord, StoredHolding } from '../src/types';

function h(p: Partial<StoredHolding>): StoredHolding {
  return {
    broker: 'kb', accountId: 'acc', symbol: '005930', name: '종목', market: 'KR', currency: 'KRW',
    quantity: 1, lastPrice: 0, averagePurchasePrice: 0, purchaseAmount: 0, marketValue: 0, profitLossAmount: 0,
    profitLossRate: 0, commission: null, tax: null, memo: null, updatedAt: '2026-11-17', ...p,
  };
}

test('CSV 보유종목 합산: 통화별로 따로 더하고, 달러가 없으면 달러 칸은 null', () => {
  const krwOnly = buildPortfolioFromStored('kb', 'acc', [h({ purchaseAmount: 1000, marketValue: 1200, profitLossAmount: 200 })]);
  assert.equal(krwOnly.totalPurchaseAmountKrw, 1000);
  assert.equal(krwOnly.totalPurchaseAmountUsd, null);
  assert.equal(krwOnly.profitLossRate, 0.2);
  assert.equal(krwOnly.cashBalanceKrw, null); // CSV 계좌는 예수금을 모른다

  const mixed = buildPortfolioFromStored('kb', 'acc', [
    h({ purchaseAmount: 1000, marketValue: 900, profitLossAmount: -100 }),
    h({ symbol: 'AAPL', currency: 'USD', purchaseAmount: 10, marketValue: 12, profitLossAmount: 2 }),
  ]);
  assert.equal(mixed.totalPurchaseAmountKrw, 1000);
  assert.equal(mixed.totalPurchaseAmountUsd, 10);
  assert.equal(mixed.totalProfitLossUsd, 2);
  assert.equal(mixed.positions.length, 2);
});

test('전체 계좌 합치기: 금액·예수금을 더하고 포지션에 출처 계좌를 남긴다', () => {
  const a = buildPortfolioFromStored('kb', 'A', [h({ purchaseAmount: 100, marketValue: 110, profitLossAmount: 10 })]);
  const b = { ...buildPortfolioFromStored('kb', 'B', [h({ symbol: 'AAPL', currency: 'USD', purchaseAmount: 5, marketValue: 6, profitLossAmount: 1 })]), cashBalanceKrw: 50 };
  const merged = mergePortfolios('kb', [
    { accountId: 'A', overview: a },
    { accountId: 'B', overview: b },
  ]);
  assert.equal(merged.accountId, ALL_ACCOUNTS);
  assert.equal(merged.totalPurchaseAmountKrw, 100);
  assert.equal(merged.totalPurchaseAmountUsd, 5);
  assert.equal(merged.cashBalanceKrw, 50); // 한 계좌라도 값이 있으면 나머지는 0으로
  assert.equal(merged.cashBalanceUsd, null); // 전부 없으면 "정보 없음"
  assert.deepEqual(merged.positions.map((p) => p.accountId), ['A', 'B']);
});

test('보유 표 행: 원화 기준 비중, 이 계좌의 이 종목 배당만, memo로 나뉜 행은 수량 비율로, 통화가 다르면 환율', () => {
  const pf = buildPortfolioFromStored('kb', 'acc', [
    h({ symbol: 'A', quantity: 3, marketValue: 300, memo: '개인' }),
    h({ symbol: 'A', quantity: 1, marketValue: 100, memo: '회사' }),
    h({ symbol: 'U', currency: 'USD', quantity: 1, marketValue: 1 }),
  ]);
  const div = (p: Partial<DividendRecord>) =>
    ({ id: 'd', broker: 'kb', accountId: 'acc', symbol: 'A', name: 'A', currency: 'KRW', amount: 40, tax: null, paidDate: '2026-01-01', memo: null, ...p }) as DividendRecord;
  const dividends = [div({}), div({ accountId: 'other', amount: 999 }), div({ symbol: 'U', amount: 1000 }), div({ broker: 'toss', amount: 5 })];
  const base = { broker: 'kb' as const, selectedAccountId: 'acc', soleAccountId: null, dividends, accountLabels: [] };

  const rows = holdingRows(pf, { ...base, fxRate: 1000 });
  assert.deepEqual(rows.map((r) => [r.symbol, r.memo, r.weight, r.dividendAmount]), [
    ['A', '개인', 300 / 1400, 30],
    ['A', '회사', 100 / 1400, 10],
    ['U', null, 1000 / 1400, 1], // 원화 배당 1000원 → 달러 종목이라 1000/1000 = $1
  ]);
  assert.equal(rows[0].accountLabel, undefined); // 개별 계좌 모드엔 계좌 열 없음

  const noFx = holdingRows(pf, { ...base, fxRate: null });
  assert.equal(noFx[2].weight, null);
  assert.equal(noFx[2].dividendAmount, null); // 통화가 다른 배당을 환산할 수 없음
  assert.deepEqual(dividendTotals(noFx), { krw: 40, usd: 0, unconverted: true });
});

test('보유 종목 정렬: 달러는 원화로 환산해 비교하고, 환산 못 한 행은 방향과 상관없이 맨 뒤', () => {
  const row = (symbol: string, currency: string, marketValue: number, dividendAmount: number | null = 0) => ({
    symbol, currency, purchaseAmount: 0, marketValue, profitLossAmount: marketValue, dividendAmount,
  });
  const rows = [row('A', 'KRW', 100_000), row('B', 'USD', 100), row('C', 'KRW', 200_000)];
  const order = (r: { symbol: string }[]) => r.map((x) => x.symbol).join('');
  assert.equal(order(sortHoldingRows(rows, 'market', false, 1400)), 'CBA'); // $100 = 14만원
  assert.equal(order(sortHoldingRows(rows, 'market', true, 1400)), 'ABC');
  assert.equal(order(sortHoldingRows(rows, 'market', false, null)), 'CAB');
  assert.equal(order(sortHoldingRows(rows, 'market', true, null)), 'ACB');
  // 배당 포함 손익이 "환율 미적용"(null)인 행도 맨 뒤
  const withDiv = [row('A', 'KRW', 100, null), row('B', 'KRW', 50, 10)];
  assert.equal(order(sortHoldingRows(withDiv, 'profitWithDividend', false, null)), 'BA');
  assert.equal(order(sortHoldingRows(rows, 'symbol', true, null)), 'ABC');
});
