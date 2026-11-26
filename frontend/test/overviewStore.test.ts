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

test('증권사 하나가 실패해도 나머지 보유는 보이고 error로 알리며, 그날 순자산은 기록하지 않는다', async () => {
  const ok = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/accounts') return Response.json([{ id: 'samsung', configured: true }, { id: 'mirae', configured: true }]);
    if (path === '/holdings-store' && url.searchParams.get('broker') === 'mirae') return Response.json({ error: 'boom' }, { status: 500 });
    return ok(input, init);
  }) as typeof fetch;
  try {
    await reloadOverview();
  } finally {
    globalThis.fetch = ok;
  }
  const s = getOverviewState();
  assert.equal(s.holdings.length, 1);
  assert.match(s.error ?? '', /불러오지 못해/);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count('POST /portfolio-snapshots'), 0);
});

test('API 증권사의 계좌 하나만 실패해도 error로 알리고 그날 순자산은 기록하지 않는다', async () => {
  const ok = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/accounts') return Response.json([{ id: 'toss', configured: true }]);
    if (path === '/accounts/toss') return Response.json([{ id: 'acc-1' }, { id: 'acc-2' }]);
    if (path === '/holdings/toss/acc-1') {
      return Response.json({
        broker: 'toss', accountId: 'acc-1', totalPurchaseAmount: [], totalMarketValue: [], totalProfitLoss: [],
        positions: [{ symbol: '111110', name: '가짜', currency: 'KRW', quantity: 1, lastPrice: 100, purchaseAmount: 90, marketValue: 100, profitLossAmount: 10 }],
      });
    }
    if (path === '/holdings/toss/acc-2') return Response.json({ error: 'boom' }, { status: 500 });
    return ok(input, init);
  }) as typeof fetch;
  try {
    await reloadOverview();
  } finally {
    globalThis.fetch = ok;
  }
  const s = getOverviewState();
  assert.equal(s.holdings.length, 1);
  assert.match(s.error ?? '', /계좌 1개/);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count('POST /portfolio-snapshots'), 0);
});

test('해외 잔고만 못 받은 계좌(failedMarkets)가 있으면 error로 알리고 그날 순자산은 기록하지 않는다', async () => {
  const ok = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/accounts') return Response.json([{ id: 'kis', configured: true }]);
    if (path === '/accounts/kis') return Response.json([{ id: 'acc-1' }]);
    if (path === '/holdings/kis/acc-1') {
      return Response.json({
        broker: 'kis', accountId: 'acc-1', totalPurchaseAmount: [], totalMarketValue: [], totalProfitLoss: [], failedMarkets: ['US'],
        positions: [{ symbol: '111110', name: '가짜', currency: 'KRW', quantity: 1, lastPrice: 100, purchaseAmount: 90, marketValue: 100, profitLossAmount: 10 }],
      });
    }
    return ok(input, init);
  }) as typeof fetch;
  try {
    await reloadOverview();
  } finally {
    globalThis.fetch = ok;
  }
  const s = getOverviewState();
  assert.equal(s.holdings.length, 1);
  assert.match(s.error ?? '', /계좌 1개의 미국 잔고/);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count('POST /portfolio-snapshots'), 0);
});

test('환율이 없어 달러 보유가 합계에서 빠지면 그날 순자산은 기록하지 않는다', async () => {
  const ok = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === '/settings/fx-rate') return Response.json({ usdKrwRate: null });
    if (path.startsWith('/market-info/exchange-rate')) return Response.json({ rate: null });
    if (path === '/holdings-store') {
      return Response.json([{ broker: 'samsung', accountId: 'a', symbol: 'FAKE', name: '가짜', currency: 'USD', quantity: 1, lastPrice: 10, purchaseAmount: 9, marketValue: 10, profitLossAmount: 1 }]);
    }
    return ok(input, init);
  }) as typeof fetch;
  try {
    await reloadOverview();
  } finally {
    globalThis.fetch = ok;
  }
  const s = getOverviewState();
  assert.equal(s.unconvertedUsdHoldings, true);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count('POST /portfolio-snapshots'), 0);
});

test('다 받았으면 순자산을 기록한다', async () => {
  await reloadOverview();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count('POST /portfolio-snapshots'), 1);
});
