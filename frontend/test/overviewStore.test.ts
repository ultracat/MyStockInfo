import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 대시보드·분석 공용 저장소(pages/overview/overviewStore.ts) — 두 화면이 같이 불러도 한 번만 받고, 방금 받았으면 건너뛰며,
// 새로고침은 진행 중인 받기 뒤에 캐시를 건너뛰고 한 번 더 받는지. api.ts가 불러올 때 window.location.hash를 읽으므로 가짜 window와
// 가짜 fetch(경로별 응답·호출 수)를 먼저 둔다. 값은 지어낸 것.
(globalThis as unknown as { window: unknown }).window = { location: { hash: '#token=t&port=1' } };

const calls: string[] = [];
let delayMs = 0;
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const path = url.pathname.replace(/^\/api/, '');
  calls.push(`${init?.method ?? 'GET'} ${path}${url.searchParams.get('refresh') ? '?refresh' : ''}`);
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  const body: unknown =
    path === '/accounts' ? [{ id: 'samsung', configured: true }]
    : path === '/holdings-store' ? [{ broker: 'samsung', accountId: 'a', symbol: '111110', name: '가짜', currency: 'KRW', quantity: 2, lastPrice: 100, purchaseAmount: 150, marketValue: 200, profitLossAmount: 50 }]
    : path === '/dividends' || path === '/trades-store' || path === '/account-labels' || path === '/portfolio-snapshots' ? []
    : path === '/settings/fx-rate' ? { usdKrwRate: 1000 }
    : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

type Store = typeof import('../src/pages/overview/overviewStore');
let reloadOverview: Store['reloadOverview'];
let getOverviewState: Store['getOverviewState'];
let resetOverviewStore: Store['resetOverviewStore'];
before(async () => {
  ({ reloadOverview, getOverviewState, resetOverviewStore } = await import('../src/pages/overview/overviewStore'));
});
const count = (p: string) => calls.filter((c) => c === p).length;

beforeEach(() => {
  resetOverviewStore();
  calls.length = 0;
  delayMs = 0;
});

test('한 번 받으면 보유·합계가 채워지고 loading이 풀린다', async () => {
  assert.equal(getOverviewState().loading, true);
  await reloadOverview();
  const s = getOverviewState();
  assert.equal(s.loading, false);
  assert.equal(s.holdings.length, 1);
  assert.deepEqual([s.totalPurchaseKrw, s.totalMarketKrw], [150, 200]);
  assert.equal(s.manualFxRate, 1000);
});

test('두 화면이 동시에 불러도 한 번만, 방금 받았으면 건너뛴다', async () => {
  delayMs = 20;
  await Promise.all([reloadOverview({ maxAgeMs: 5000 }), reloadOverview({ maxAgeMs: 5000 })]);
  assert.equal(count('GET /holdings-store'), 1);
  await reloadOverview({ maxAgeMs: 5000 }); // 방금 받음
  assert.equal(count('GET /holdings-store'), 1);
  await reloadOverview(); // 나이 제한 없음 → 다시
  assert.equal(count('GET /holdings-store'), 2);
});

test('새로고침은 진행 중인 받기가 끝난 뒤 캐시를 건너뛰고 한 번 더 받는다', async () => {
  delayMs = 20;
  const first = reloadOverview();
  const forced = reloadOverview({ forceRefresh: true });
  await Promise.all([first, forced]);
  assert.equal(count('GET /holdings-store'), 2);
  assert.ok(calls.some((c) => c === 'GET /market-info/exchange-rate/usd-krw?refresh'), '새로고침은 실시간 환율도 캐시를 건너뛴다');
});

test('실패해도 이전 값을 지우지 않고 error만 채운다', async () => {
  await reloadOverview();
  const before = getOverviewState().holdings;
  const ok = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"error":"boom"}', { status: 500 })) as typeof fetch;
  try {
    await reloadOverview();
  } finally {
    globalThis.fetch = ok;
  }
  const s = getOverviewState();
  assert.equal(s.holdings, before);
  assert.ok(s.error);
  assert.equal(s.refreshing, false);
});
