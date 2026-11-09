import { readJson, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonStore } from '../src/jsonStore';
import { getDataDir } from '../src/paths';
import { listTrades, removeImportedDuplicates, upsertFromImport, upsertTrades } from '../src/db/tradesStore';
import type { StoredTrade } from '../src/db/tradesStore';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function trade(id: string, overrides: Partial<StoredTrade> = {}): StoredTrade {
  return {
    broker: 'toss',
    accountId: 'T1',
    id,
    symbol: '005930',
    name: '삼성전자',
    side: 'BUY',
    quantity: 10,
    price: 70000,
    amount: 700000,
    currency: 'KRW',
    commission: null,
    tax: null,
    executedAt: '2026-10-19T10:00:00+09:00',
    ...overrides,
  };
}

// 이미 중복이 쌓인 파일 상태를 직접 만든다(upsertTrades는 쓰면서 중복을 지워버린다).
function writeTrades(trades: StoredTrade[]): void {
  new JsonStore<StoredTrade[]>('trades.json', getDataDir(), []).write(trades);
}

beforeEach(resetDataDir);

test('removeImportedDuplicates: 같은 체결의 가져오기 UUID 행은 브로커 id 행이 있으면 지운다', () => {
  writeTrades([trade('ORDER-1'), trade(UUID_A), trade(UUID_B)]);

  const result = removeImportedDuplicates();

  assert.deepEqual(result, { removed: 2, ambiguousGroups: 0 });
  assert.deepEqual(listTrades().map((t) => t.id), ['ORDER-1']);
});

test('removeImportedDuplicates: 브로커 id 행이 없는 묶음은 진짜 반복 체결일 수 있어 남긴다', () => {
  writeTrades([trade(UUID_A, { broker: 'samsung', accountId: 'S1' }), trade(UUID_B, { broker: 'samsung', accountId: 'S1' })]);

  const result = removeImportedDuplicates();

  assert.deepEqual(result, { removed: 0, ambiguousGroups: 1 });
  assert.equal(listTrades().length, 2);
});

test('removeImportedDuplicates: 수수료·세금·종목명만 다른 행도 같은 체결로 본다', () => {
  writeTrades([trade('ORDER-1', { commission: 15, name: null }), trade(UUID_A, { tax: 3, name: '삼성' })]);

  assert.equal(removeImportedDuplicates().removed, 1);
});

test('removeImportedDuplicates: 수량·가격·시각이 다르면 다른 체결이다', () => {
  writeTrades([trade('ORDER-1'), trade(UUID_A, { quantity: 11 }), trade(UUID_B, { executedAt: '2026-10-20T10:00:00+09:00' })]);

  assert.equal(removeImportedDuplicates().removed, 0);
  assert.equal(listTrades().length, 3);
});

test('upsertFromImport: id 없는 행은 내용이 같은 기존 행의 id를 이어받아 중복을 만들지 않는다', () => {
  writeTrades([trade('ORDER-1')]);
  const { id: _id, ...noId } = trade('');

  upsertFromImport([noId]);

  assert.deepEqual(listTrades().map((t) => t.id), ['ORDER-1']);
});

test('upsertFromImport: 같은 내용의 행 두 개는 기존 행에 1:1로만 짝지어진다', () => {
  writeTrades([trade('ORDER-1')]);
  const { id: _id, ...noId } = trade('');

  upsertFromImport([noId, noId]);

  const ids = readJson<StoredTrade[]>('trades.json').map((t) => t.id);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], 'ORDER-1');
  assert.match(ids[1], /^[0-9a-f-]{36}$/); // 두 번째는 새 UUID
});

test('upsertTrades(실시간 조회): 같은 체결의 가져오기 UUID 사본을 지우고 브로커 id 행으로 대체한다', () => {
  writeTrades([trade(UUID_A), trade(UUID_B, { broker: 'samsung', accountId: 'S1' })]);
  const { broker: _b, accountId: _a, ...live } = trade('ORDER-1');

  upsertTrades('toss', 'T1', [live]);

  const keys = listTrades().map((t) => `${t.broker}/${t.id}`).sort();
  assert.deepEqual(keys, [`samsung/${UUID_B}`, 'toss/ORDER-1']); // 다른 계좌의 UUID 행은 그대로
});
