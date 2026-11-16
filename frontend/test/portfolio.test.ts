import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_ACCOUNTS, buildPortfolioFromStored, mergePortfolios } from '../src/calc/portfolio';
import type { StoredHolding } from '../src/types';

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
