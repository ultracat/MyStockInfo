import { DATA_DIR, readJson, resetDataDir } from './setup';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { blockedDataFiles, JsonStore, JsonStoreCorruptError } from '../src/jsonStore';
import { getDataDir } from '../src/paths';
import { listTrades, migrateKisDomesticTradeIds, upsertTrades, type StoredTrade } from '../src/db/tradesStore';
import { listHoldings, replaceSnapshot } from '../src/db/holdingsStore';
import { listSnapshots, type SnapshotRecord } from '../src/db/portfolioSnapshots';
import { withCache } from '../src/brokers/responseCache';
import { handleBrokerApiError } from '../src/brokers/errors';
import { asyncRoute } from '../src/routes/asyncRoute';
import { addDays, daysInMonth, kstHour, kstToday, weekdayOf } from '../src/kstDate';
import type { HoldingPosition } from '../src/brokers/types';

beforeEach(resetDataDir);

// ─── 1. KIS 국내 체결 id 이관 ─────────────────────────────────────────────────────────────────────────
function kisTrade(id: string, executedAt: string, overrides: Partial<StoredTrade> = {}): StoredTrade {
  return {
    broker: 'kis',
    accountId: '12345678-01',
    id,
    symbol: '005930',
    name: '가짜전자',
    side: 'BUY',
    quantity: 1,
    price: 100,
    amount: 100,
    currency: 'KRW',
    commission: null,
    tax: null,
    executedAt,
    ...overrides,
  };
}

function writeTrades(trades: StoredTrade[]): void {
  new JsonStore<StoredTrade[]>('trades.json', getDataDir(), []).write(trades);
}

test('KIS 국내 체결 id: 옛 odno만인 행을 주문일자-주문번호로 한 번 옮기고, 해외·UUID·다른 증권사는 그대로', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  writeTrades([
    kisTrade('0000012345', '2026-01-05'),
    kisTrade('ovrs-20260107-7', '2026-01-07', { currency: 'USD' }),
    kisTrade(uuid, '2026-01-08'),
    kisTrade('20260109-0001', '2026-01-09'),
    { ...kisTrade('0001', '2026-01-10'), broker: 'samsung', accountId: 'S1' },
  ]);

  const ids = listTrades().map((t) => `${t.broker}:${t.id}`);
  assert.deepEqual(ids, [
    'kis:20260105-0000012345',
    'kis:ovrs-20260107-7',
    `kis:${uuid}`,
    'kis:20260109-0001',
    'samsung:0001',
  ]);
  // 파일에도 반영됐다(다음 실행엔 이관할 게 없다).
  assert.equal(readJson<StoredTrade[]>('trades.json')[0].id, '20260105-0000012345');
  // 멱등 — 이미 옮긴 목록은 다시 바꿀 게 없다.
  assert.equal(migrateKisDomesticTradeIds(readJson<StoredTrade[]>('trades.json')), null);
});

test('KIS 국내 체결 id: 새 id 행이 이미 있으면 옛 사본은 버린다(중복 없음), 실시간 조회가 같은 체결을 또 쌓지 않는다', () => {
  writeTrades([kisTrade('0001', '2026-01-05'), kisTrade('20260105-0001', '2026-01-05', { quantity: 2 })]);
  const rows = listTrades();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, '20260105-0001');
  assert.equal(rows[0].quantity, 2, '새 id 쪽(더 최근 조회분)을 남긴다');

  // 다른 날 같은 주문번호 — 이제 서로 덮어쓰지 않는다.
  const { broker: _b, accountId: _a, ...rec } = kisTrade('20260106-0001', '2026-01-06');
  upsertTrades('kis', '12345678-01', [rec]);
  assert.deepEqual(listTrades().map((t) => t.id).sort(), ['20260105-0001', '20260106-0001']);
});

// ─── 2. 부분 결과(해외 잔고 실패) write-through ────────────────────────────────────────────────────
function pos(symbol: string, market: 'KR' | 'US', quantity = 1): HoldingPosition {
  return {
    symbol,
    name: symbol,
    market,
    currency: market === 'KR' ? 'KRW' : 'USD',
    quantity,
    lastPrice: 1,
    averagePurchasePrice: 1,
    purchaseAmount: quantity,
    marketValue: quantity,
    profitLossAmount: 0,
    profitLossRate: 0,
    commission: null,
    tax: null,
  };
}

test('replaceSnapshot: 실패한 시장(keepMarkets)의 저장 행은 지우지 않고, 나머지 시장만 교체한다', () => {
  replaceSnapshot('kis', 'A1', [pos('005930', 'KR'), pos('AAPL', 'US', 3)]);
  replaceSnapshot('kis', 'B1', [pos('000660', 'KR')]);

  // 해외 조회 실패 → positions에 미국 종목이 없다.
  replaceSnapshot('kis', 'A1', [pos('005930', 'KR', 5)], { keepMarkets: ['US'] });
  const a1 = listHoldings({ broker: 'kis', accountId: 'A1' });
  assert.deepEqual(a1.map((h) => [h.symbol, h.quantity]).sort(), [['005930', 5], ['AAPL', 3]]);
  assert.equal(listHoldings({ broker: 'kis', accountId: 'B1' }).length, 1, '다른 계좌는 그대로');

  // 전부 성공한 조회는 예전처럼 통째로 교체(미국을 다 팔았으면 지워진다).
  replaceSnapshot('kis', 'A1', [pos('005930', 'KR', 5)]);
  assert.deepEqual(listHoldings({ broker: 'kis', accountId: 'A1' }).map((h) => h.symbol), ['005930']);
});

// ─── 6. 손상된 JSON 파일 ─────────────────────────────────────────────────────────────────────────────
test('JsonStore: 손상된 파일은 격리하고, 복원 전까지 읽기·쓰기를 거부한다(빈 데이터로 덮어쓰지 않게)', () => {
  const file = path.join(DATA_DIR, 'corrupt-test.json');
  fs.writeFileSync(file, '[{"a":1},'); // 쓰다 끊긴 파일
  const s = new JsonStore<unknown[]>('corrupt-test.json', DATA_DIR, []);

  assert.throws(() => s.read(), (e: unknown) => e instanceof JsonStoreCorruptError && /백업/.test(e.message));
  assert.equal(fs.existsSync(file), false, '원래 자리에서 옮겼다');
  const quarantined = fs.readdirSync(DATA_DIR).filter((n) => n.startsWith('corrupt-test.json.corrupt-'));
  assert.equal(quarantined.length, 1, '손상본은 지우지 않고 남긴다');
  assert.equal(fs.readFileSync(path.join(DATA_DIR, quarantined[0]), 'utf-8'), '[{"a":1},');

  // 파일이 없어도 기본값([])을 주지 않는다 — 그걸 받은 호출부가 곧바로 써 버린다.
  assert.throws(() => s.read(), JsonStoreCorruptError);
  assert.throws(() => s.write([]), JsonStoreCorruptError);
  assert.throws(() => s.update((c) => c), JsonStoreCorruptError);
  assert.deepEqual(blockedDataFiles(DATA_DIR), ['corrupt-test.json'], '자동 백업이 건너뛰도록 알린다');

  // 백업 복원(restoreBackupZip은 파일을 직접 쓴다) 뒤엔 정상.
  fs.writeFileSync(file, '[{"a":2}]');
  assert.deepEqual(s.read(), [{ a: 2 }]);
  assert.deepEqual(blockedDataFiles(DATA_DIR), [], '복원했으면 막힘이 풀린다');
});

test('JsonStore: 격리본을 치우면 비어 있는 상태로 다시 시작한다', () => {
  fs.writeFileSync(path.join(DATA_DIR, 'corrupt-b.json'), '{');
  const s = new JsonStore<unknown[]>('corrupt-b.json', DATA_DIR, []);
  assert.throws(() => s.read(), JsonStoreCorruptError);
  for (const n of fs.readdirSync(DATA_DIR).filter((n) => n.startsWith('corrupt-b.json.corrupt-'))) {
    fs.rmSync(path.join(DATA_DIR, n));
  }
  assert.deepEqual(s.read(), []);
  s.write([1]);
  assert.deepEqual(s.read(), [1]);
});

test("JsonStore: 캐시 저장소(onCorrupt: 'reset')는 격리 후 기본값으로 계속 간다", () => {
  fs.writeFileSync(path.join(DATA_DIR, 'cache-x.json'), 'not json');
  const s = new JsonStore<Record<string, number>>('cache-x.json', DATA_DIR, {}, { onCorrupt: 'reset' });
  assert.deepEqual(s.read(), {});
  assert.deepEqual(s.read(), {});
  s.write({ a: 1 });
  assert.deepEqual(s.read(), { a: 1 });
  assert.equal(fs.readdirSync(DATA_DIR).filter((n) => n.startsWith('cache-x.json.cache-corrupt-')).length, 1);
  assert.deepEqual(blockedDataFiles(DATA_DIR), [], '캐시 손상은 자동 백업을 막지 않는다');
});

test('JsonStore.write: 임시 파일을 남기지 않고 0600으로 쓴다', () => {
  const s = new JsonStore<number[]>('durable.json', DATA_DIR, []);
  s.write([1, 2, 3]);
  assert.deepEqual(readJson<number[]>('durable.json'), [1, 2, 3]);
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'durable.json.tmp')), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(DATA_DIR, 'durable.json')).mode & 0o777, 0o600);
});

// ─── 11. portfolioSnapshots 정렬이 캐시를 바꾸지 않는다 ───────────────────────────────────────────────
test('listSnapshots: 저장 순서(캐시 배열)를 제자리에서 바꾸지 않는다', () => {
  const rec = (date: string): SnapshotRecord => ({ date, totalMarketValueKrw: 1, totalPurchaseAmountKrw: 1, totalProfitLossKrw: 0 });
  const store = new JsonStore<SnapshotRecord[]>('portfolio-snapshots.json', getDataDir(), []);
  store.write([rec('2026-03-01'), rec('2026-01-01')]);
  assert.deepEqual(listSnapshots().map((r) => r.date), ['2026-01-01', '2026-03-01']);
  assert.deepEqual(store.read().map((r) => r.date), ['2026-03-01', '2026-01-01']);
});

// ─── 10. withCache: forceRefresh와 진행 중 요청의 경합 ────────────────────────────────────────────────
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

test('withCache: forceRefresh 뒤에 늦게 끝난 옛 요청이 캐시·진행 중 항목을 덮지 않는다', async () => {
  const key = `race:${Math.random()}`;
  const oldReq = deferred<string>();
  const newReq = deferred<string>();
  const p1 = withCache(key, 60_000, () => oldReq.promise);
  const p2 = withCache(key, 60_000, () => newReq.promise, { forceRefresh: true });

  oldReq.resolve('old');
  assert.equal(await p1, 'old');
  // 옛 요청이 끝나도 새 요청의 진행 중 항목은 남아 있어야 한다 — 지금 부르면 새 요청을 공유한다.
  let calledAgain = false;
  const p3 = withCache(key, 60_000, async () => {
    calledAgain = true;
    return 'third';
  });
  newReq.resolve('new');
  assert.equal(await p2, 'new');
  assert.equal(await p3, 'new');
  assert.equal(calledAgain, false);
  // 캐시엔 새 값.
  assert.equal(await withCache(key, 60_000, async () => 'fetched'), 'new');
});

test('withCache: 값에 따라 TTL을 정할 수 있고, 0이면 캐시하지 않는다', async () => {
  const key = `ttl:${Math.random()}`;
  let n = 0;
  const fetcher = async () => ++n;
  const ttl = (v: number) => (v < 2 ? 0 : 60_000);
  assert.equal(await withCache(key, ttl, fetcher), 1);
  assert.equal(await withCache(key, ttl, fetcher), 2, '첫 값은 캐시 안 됨');
  assert.equal(await withCache(key, ttl, fetcher), 2, '둘째 값은 캐시됨');
});

test('withCache: 동기로 던지는 fetcher도 거부로 받고 진행 중 항목을 남기지 않는다', async () => {
  const key = `sync-throw:${Math.random()}`;
  await assert.rejects(
    withCache(key, 1000, () => {
      throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(await withCache(key, 1000, async () => 'ok'), 'ok');
});

// ─── 5. 오류 응답 가리기 ─────────────────────────────────────────────────────────────────────────────
function fakeRes() {
  const out: { status?: number; body?: any } = {};
  const res = {
    status(code: number) {
      out.status = code;
      return res;
    },
    json(body: unknown) {
      out.body = body;
      return res;
    },
  };
  return { res: res as any, out };
}

test('handleBrokerApiError: 응답의 메시지·본문에서 긴 숫자열(계좌번호 등)을 가린다', () => {
  const origError = console.error;
  console.error = () => {};
  try {
    const err = Object.assign(new Error('계좌 12345678901 조회 실패'), { status: 500, body: '{"acct":"98765432101"}' });
    const a = fakeRes();
    handleBrokerApiError(err, a.res);
    assert.equal(a.out.status, 502);
    assert.doesNotMatch(JSON.stringify(a.out.body), /12345678901|98765432101/);

    const b = fakeRes();
    handleBrokerApiError(new Error('번호 1234567890 처리 중 오류'), b.res);
    assert.equal(b.out.status, 500);
    assert.doesNotMatch(b.out.body.error, /1234567890/);
  } finally {
    console.error = origError;
  }
});

// ─── 3. async 라우트 ─────────────────────────────────────────────────────────────────────────────────
test('asyncRoute: 거부된 핸들러를 next(err)로 넘긴다', async () => {
  const boom = new Error('boom');
  const got = deferred<unknown>();
  asyncRoute(async () => {
    throw boom;
  })({} as any, {} as any, (err?: unknown) => got.resolve(err));
  assert.equal(await got.promise, boom);
});

// ─── 8. 한국 날짜 ────────────────────────────────────────────────────────────────────────────────────
test('kstDate: 시간대와 무관하게 한국 날짜·요일·달 일수', () => {
  assert.equal(kstToday(Date.UTC(2026, 0, 1, 15, 30)), '2026-01-02', 'UTC 15:30 = KST 다음 날 00:30');
  assert.equal(kstToday(Date.UTC(2026, 0, 1, 14, 59)), '2026-01-01');
  assert.equal(kstHour(Date.UTC(2026, 0, 1, 15, 30)), 0);
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('20261231', 1), '2027-01-01');
  assert.equal(weekdayOf('2026-11-26'), 4, '목요일');
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
});
