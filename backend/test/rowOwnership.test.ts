import { resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { isSyncOwned } from '../src/brokers/rowOwnership';
import { setCredentialFields } from '../src/credentials';

beforeEach(resetDataDir);

test('토스/KIS 계좌는 자격증명 등록 여부와 상관없이 전부 동기화 소유다', () => {
  assert.equal(isSyncOwned('toss', 'any-account'), true);
  assert.equal(isSyncOwned('kis', '12345678-01'), true);
});

test('삼성/미래에셋 계좌는 항상 수동 행이다', () => {
  assert.equal(isSyncOwned('samsung', '111'), false);
  assert.equal(isSyncOwned('mirae', '222'), false);
});

test('KB는 연동 안 했으면 모든 계좌가 수동 행이다', () => {
  assert.equal(isSyncOwned('kb', '333'), false);
});

test('KB는 자격증명에 등록한 연동 계좌 하나만 동기화 소유다', () => {
  setCredentialFields('kb', { appKey: 'k', appSecret: 's', accountId: '333' });
  assert.equal(isSyncOwned('kb', '333'), true);
  assert.equal(isSyncOwned('kb', '444'), false); // IRP/연금저축 등 API로 못 읽는 다른 KB 계좌
});
