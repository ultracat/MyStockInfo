import { readJson, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonStore } from '../src/jsonStore';
import { getDataDir } from '../src/paths';
import { listTrades, upsertFromImport, upsertTrades } from '../src/db/tradesStore';
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
