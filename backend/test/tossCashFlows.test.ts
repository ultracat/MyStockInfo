import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeTossCashFlows } from '../src/brokers/toss/tossCashFlows';
import type { TossTransaction } from '../src/brokers/toss/tossClient';

const tx = (o: Partial<TossTransaction>): TossTransaction => ({
  transactionType: 'DEPOSIT', marketCountry: 'KR', currency: 'KRW', symbol: null, assetClass: null, isinCode: null,
  amount: '0', tax: '0', netAmount: '0', exchangeRate: null, settlementDate: '2026-01-02', settled: true,
  transactionTime: null, isCancellation: false, ...o,
});

test('투자원금: 은행 입출금만 세고 분배금·세금 출금·채권·환전·미결제·취소는 뺀다', () => {
  const s = summarizeTossCashFlows([
    tx({ amount: '1000000', settlementDate: '2025-03-01' }),
    tx({ amount: '500000' }),
    tx({ transactionType: 'WITHDRAWAL', amount: '200000' }),
    tx({ symbol: '123450', assetClass: 'STOCK', amount: '3000' }), // ETF 분배금
    tx({ transactionType: 'WITHDRAWAL', symbol: '123450', assetClass: 'STOCK', amount: '400', tax: '400' }), // 세금 출금
    tx({ assetClass: 'BOND', currency: 'USD', amount: '100', exchangeRate: '1300' }),
    tx({ transactionType: 'EXCHANGE_OUT', amount: '130000' }),
    tx({ amount: '999', settled: false }),
    tx({ amount: '888', isCancellation: true }),
    tx({ currency: 'USD', amount: '100', exchangeRate: '1400' }),
    tx({ transactionType: 'SECURITIES_TRANSFER_IN', symbol: 'ABC', assetClass: 'STOCK', amount: null }),
  ]);
  assert.equal(s.depositKrw, 1_500_000);
  assert.equal(s.withdrawalKrw, 200_000);
  assert.equal(s.depositUsd, 100);
  assert.equal(s.netPrincipalKrw, 1_300_000 + 140_000);
  assert.equal(s.transferIn, 1);
  assert.equal(s.firstDate, '2025-03-01');
  assert.deepEqual(s.byYear.map((y) => [y.year, y.depositKrw, y.withdrawalKrw]), [['2025', 1_000_000, 0], ['2026', 500_000, 200_000]]);
});

test('투자원금: 환율 없는 달러 입출금이 있으면 원화 환산 원금은 null', () => {
  assert.equal(summarizeTossCashFlows([tx({ currency: 'USD', amount: '10' })]).netPrincipalKrw, null);
});
