import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAddDividendManually, isDividendRowSyncOwned, manualDividendUsdOnly } from '../src/dividendOwnership';
import type { BrokerId } from '../src/types';

// 배당 동기화 소유 규칙 — 백엔드 rowOwnership.ts isDividendSyncOwned와 같아야 한다(한국투자·LS 달러 배당은 직접 입력).
const owned = new Set<BrokerId>(['toss', 'kis', 'nh', 'ls']);

test('동기화 중인 증권사의 배당은 소유, 한국투자·LS 달러만 예외', () => {
  assert.equal(isDividendRowSyncOwned(owned, 'toss', 'USD'), true);
  assert.equal(isDividendRowSyncOwned(owned, 'nh', 'USD'), true);
  assert.equal(isDividendRowSyncOwned(owned, 'kis', 'KRW'), true);
  assert.equal(isDividendRowSyncOwned(owned, 'kis', 'USD'), false);
  assert.equal(isDividendRowSyncOwned(owned, 'ls', 'KRW'), true);
  assert.equal(isDividendRowSyncOwned(owned, 'ls', 'USD'), false);
  assert.equal(isDividendRowSyncOwned(owned, 'samsung', 'KRW'), false);
  assert.equal(isDividendRowSyncOwned(owned, 'db', 'KRW'), false); // 키 없음
});

test('직접 입력 폼: 고를 수 있는 증권사와 달러 고정', () => {
  assert.equal(canAddDividendManually(owned, 'toss'), false);
  assert.equal(canAddDividendManually(owned, 'kis'), true);
  assert.equal(canAddDividendManually(owned, 'ls'), true);
  assert.equal(canAddDividendManually(owned, 'samsung'), true);
  assert.equal(manualDividendUsdOnly(owned, 'ls'), true);
  assert.equal(manualDividendUsdOnly(owned, 'samsung'), false);
  assert.equal(manualDividendUsdOnly(new Set(), 'kis'), false);
});
