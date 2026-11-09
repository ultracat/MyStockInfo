import { readJson, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { importHoldingsRecords } from '../src/routes/holdingsStore';
import { listHoldings, replaceSnapshot } from '../src/db/holdingsStore';
import { cacheStockName } from '../src/db/stockNames';
import type { StoredHolding } from '../src/db/holdingsStore';

// 브로커를 하나도 연동하지 않은 상태라 종목명은 캐시로만 풀린다 — 캐시에 넣은
// 심볼은 성공, 안 넣은 심볼(999999)은 "종목명 자동조회 실패"로 실패 행이 된다.
cacheStockName({ symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', cachedAt: new Date().toISOString() });
cacheStockName({ symbol: '000660', name: 'SK하이닉스', market: 'KR', currency: 'KRW', cachedAt: new Date().toISOString() });

const row = (broker: string, accountId: string, symbol: string) => ({
  broker,
  accountId,
  symbol,
  currency: 'KRW',
  market: 'KR',
  quantity: 10,
  averagePurchasePrice: 1000,
});

function seed(): void {
  // 수동 계좌 행 하나 + 실시간 조회가 쓴 토스 미러 행 하나
  replaceSnapshot('toss', 'T1', [
    {
      symbol: '005930',
      name: '삼성전자',
      market: 'KR',
      currency: 'KRW',
      quantity: 1,
      lastPrice: 1,
      averagePurchasePrice: 1,
      purchaseAmount: 1,
      marketValue: 1,
      profitLossAmount: 0,
      profitLossRate: 0,
      commission: null,
      tax: null,
    },
  ]);
}

beforeEach(async () => {
  resetDataDir();
  seed();
  await importHoldingsRecords([row('samsung', 'S1', '005930')]);
});

test('Sheets 전체 교체: 한 행이라도 실패하면 아무것도 바꾸지 않는다', async () => {
  const before = readJson<StoredHolding[]>('holdings.json');

  const result = await importHoldingsRecords(
    [row('mirae', 'M1', '000660'), row('mirae', 'M1', '999999')],
    { fullReplace: true }
  );

  assert.equal(result.aborted, true);
  assert.equal(result.added, 0);
  assert.deepEqual(result.failed.map((f) => f.row), [2]);
  assert.deepEqual(readJson<StoredHolding[]>('holdings.json'), before);
});

test('Sheets 전체 교체: 성공하면 수동 행만 바꾸고 API 계좌 행은 남긴다', async () => {
  const result = await importHoldingsRecords([row('mirae', 'M1', '000660')], { fullReplace: true });

  assert.equal(result.aborted, undefined);
  assert.equal(result.added, 1);
  const keys = listHoldings().map((h) => `${h.broker}/${h.accountId}/${h.symbol}`).sort();
  // samsung/S1은 시트에 없어서 지워지고, toss/T1은 동기화 소유라 남는다
  assert.deepEqual(keys, ['mirae/M1/000660', 'toss/T1/005930']);
});

test('가져오기는 API·동기화 계좌 행을 건너뛴다(skipped)', async () => {
  const result = await importHoldingsRecords([row('toss', 'T1', '000660'), row('samsung', 'S1', '000660')], {
    fullReplace: true,
  });

  assert.equal(result.skipped, 1);
  const toss = listHoldings({ broker: 'toss', accountId: 'T1' });
  assert.deepEqual(toss.map((h) => h.symbol), ['005930']); // 시트의 토스 행으로 덮어쓰지 않음
});

test('시트 행이 전부 API 계좌 것이면 수동 행을 지우지 않는다', async () => {
  const before = readJson<StoredHolding[]>('holdings.json');
  const result = await importHoldingsRecords([row('toss', 'T1', '000660')], { fullReplace: true });

  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(readJson<StoredHolding[]>('holdings.json'), before);
});

test('CSV 가져오기(부분 병합)는 실패 행만 빼고 나머지를 반영한다', async () => {
  const result = await importHoldingsRecords([row('mirae', 'M1', '000660'), row('mirae', 'M1', '999999')]);

  assert.equal(result.aborted, undefined);
  assert.equal(result.added, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(listHoldings({ broker: 'samsung' }).length, 1); // 다른 계좌는 그대로
});
