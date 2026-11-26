import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidateCacheByPrefix, withCache } from '../src/brokers/responseCache';
import { invalidateBrokerTokens } from '../src/brokers/tokenManager';

// 자격증명을 바꾸거나 지우면(invalidateBrokerTokens) 그 증권사의 응답 캐시도 버린다 — 이전 키로 받은 보유·잔고가
// 최대 30초 동안 새 키 화면에 나오던 것.
test('invalidateBrokerTokens: 그 증권사 키(<broker>:)의 응답 캐시만 버린다', async () => {
  let calls = 0;
  const fetcher = async () => ++calls;
  assert.equal(await withCache('toss:holdings:1', 30_000, fetcher), 1);
  assert.equal(await withCache('kis:price:005930', 30_000, fetcher), 2);
  assert.equal(await withCache('toss:holdings:1', 30_000, fetcher), 1, '캐시 적중');

  invalidateBrokerTokens('toss');

  assert.equal(await withCache('toss:holdings:1', 30_000, fetcher), 3, '토스는 다시 받는다');
  assert.equal(await withCache('kis:price:005930', 30_000, fetcher), 2, '다른 증권사는 그대로');
});

test('invalidateCacheByPrefix: 진행 중이던 요청의 결과는 캐시하지 않는다', async () => {
  let release!: (v: string) => void;
  const slow = withCache('nh:balance:1', 30_000, () => new Promise<string>((r) => (release = r)));
  await Promise.resolve();
  invalidateCacheByPrefix('nh:');
  release('이전 키 응답');
  assert.equal(await slow, '이전 키 응답', '기다리던 호출부는 결과를 받는다');
  assert.equal(await withCache('nh:balance:1', 30_000, async () => '새 키 응답'), '새 키 응답', '캐시엔 남지 않는다');
});
