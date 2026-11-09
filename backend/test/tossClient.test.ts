import { resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setCredentialFields } from '../src/credentials';
import { TossApiError, fetchTossTransactions } from '../src/brokers/toss/tossClient';
import { tossAdapter } from '../src/brokers/toss/tossAdapter';

// 토스증권 클라이언트의 HTTP 흐름을 가짜 서버(fetch 대체)로 확인한다 — 실키 없이 도는 테스트.
// 요청 모양은 developers.tossinvest.com/docs 공식 스펙, 응답은 그 스키마로 지은 가짜 값(금액은 문자열 — 스펙대로).
// 실서버 대상 점검은 scripts/toss-live-check.cjs(`npm run check:toss`).
// ⚠ 토스는 클라이언트당 유효 토큰이 하나뿐이라(재발급하면 이전 토큰 무효) 쓸데없는 재발급이 없는지가 핵심이다.

interface Call {
  path: string;
  headers: Record<string, string>;
  query: URLSearchParams;
  form: URLSearchParams | null;
}
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Handler = (call: Call, nth: number) => Reply;

let calls: Call[] = [];
let handlers: Record<string, Handler> = {};
let tokenSeq = 0;

const price = (krw: string, usd: string | null = null) => ({ krw, usd });
const holdingItem = (o: Record<string, unknown> = {}) => ({
  symbol: '005930', name: '가짜전자', marketCountry: 'KR', currency: 'KRW', quantity: '10', lastPrice: '60000',
  averagePurchasePrice: '50000',
  marketValue: { purchaseAmount: '500000', amount: '600000', amountAfterCost: '598000' },
  profitLoss: { amount: '100000', amountAfterCost: '98000', rate: '0.2', rateAfterCost: '0.196' },
  cost: { commission: '1000', tax: '1000' },
  ...o,
});

const defaultHandlers = (): Record<string, Handler> => ({
  '/oauth2/token': () => ({ body: { access_token: `toss-tok-${++tokenSeq}`, token_type: 'Bearer', expires_in: 3600 } }),
  '/api/v1/accounts': () => ({ body: { result: [{ accountNo: '123-45-678901', accountSeq: 1, accountType: '종합' }] } }),
  '/api/v1/holdings': () => ({
    body: {
      result: {
        totalPurchaseAmount: price('500000', '300'),
        marketValue: { amount: price('600000', '360'), amountAfterCost: price('598000', '359') },
        profitLoss: { amount: price('100000', '60'), amountAfterCost: price('98000', '59'), rate: '0.2', rateAfterCost: '0.196' },
        items: [holdingItem()],
      },
    },
  }),
  '/api/v1/buying-power': (call) => ({ body: { result: { cashBuyingPower: call.query.get('currency') === 'USD' ? '12.5' : '1000' } } }),
  '/api/v1/orders': () => ({ body: { result: { orders: [], nextCursor: null, hasNext: false } } }),
  '/api/v1/transactions': () => ({ body: { result: { transactions: [], nextCursor: null, hasNext: false } } }),
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  const form = init?.body instanceof URLSearchParams ? init.body : null;
  const call: Call = { path: u.pathname, headers, query: u.searchParams, form };
  calls.push(call);
  const h = handlers[u.pathname];
  if (!h) return new Response(JSON.stringify({ error: `no handler ${u.pathname}` }), { status: 404 });
  const nth = calls.filter((c) => c.path === u.pathname).length;
  const r = h(call, nth);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } });
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

beforeEach(() => {
  resetDataDir();
  calls = [];
  handlers = defaultHandlers();
  setCredentialFields('toss', { clientId: 'toss-client', clientSecret: 'toss-secret' });
});
const pathCalls = (p: string) => calls.filter((c) => c.path === p);

test('토스 토큰: client_credentials 폼으로 발급, 이후 호출은 재발급 없이 Bearer로 재사용', async () => {
  await tossAdapter.listAccounts({ forceRefresh: true });
  await tossAdapter.getPortfolio('1', { forceRefresh: true });
  const tokens = pathCalls('/oauth2/token');
  assert.ok(tokens.length <= 1, '이 파일의 첫 테스트에서만 한 번(메모리 캐시)');
  if (tokens.length) {
    assert.equal(tokens[0].form?.get('grant_type'), 'client_credentials');
    assert.equal(tokens[0].form?.get('client_id'), 'toss-client');
    assert.equal(tokens[0].form?.get('client_secret'), 'toss-secret');
    assert.equal(tokens[0].headers['content-type'], 'application/x-www-form-urlencoded');
  }
  for (const c of calls.filter((x) => x.path.startsWith('/api/'))) assert.match(c.headers.authorization, /^Bearer toss-tok-\d+$/);
});

test('토스 계좌 헤더: 계좌별 API에 X-Tossinvest-Account=accountSeq, 계좌 목록에는 없음', async () => {
  await tossAdapter.listAccounts({ forceRefresh: true });
  await tossAdapter.getPortfolio('1', { forceRefresh: true });
  assert.equal(pathCalls('/api/v1/accounts')[0].headers['x-tossinvest-account'], undefined);
  for (const p of ['/api/v1/holdings', '/api/v1/buying-power']) {
    assert.ok(pathCalls(p).every((c) => c.headers['x-tossinvest-account'] === '1'), p);
  }
  assert.deepEqual(pathCalls('/api/v1/buying-power').map((c) => c.query.get('currency')).sort(), ['KRW', 'USD']);
});

test('토스 401이면 토큰을 한 번만 다시 받아 재시도한다', async () => {
  handlers['/api/v1/accounts'] = (call, nth) =>
    nth === 1 ? { status: 401, body: { error: { code: 'invalid-token' } } } : defaultHandlers()['/api/v1/accounts'](call, nth);
  const before = pathCalls('/oauth2/token').length;
  const accounts = await tossAdapter.listAccounts({ forceRefresh: true });
  assert.deepEqual(accounts, [{ id: '1', accountNumber: '123-45-678901', accountType: '종합' }]);
  assert.equal(pathCalls('/oauth2/token').length - before, 1);
  assert.equal(pathCalls('/api/v1/accounts').length, 2);
});

test('토스 429는 Retry-After만큼 기다렸다가 재시도한다', async () => {
  handlers['/api/v1/accounts'] = (call, nth) =>
    nth === 1 ? { status: 429, body: { error: { code: 'rate-limit-exceeded' } }, headers: { 'Retry-After': '1' } } : defaultHandlers()['/api/v1/accounts'](call, nth);
  const t0 = Date.now();
  await tossAdapter.listAccounts({ forceRefresh: true });
  assert.equal(pathCalls('/api/v1/accounts').length, 2);
  assert.ok(Date.now() - t0 >= 900, 'Retry-After 1초를 지킨다');
});

test('토스 오류 응답은 상태·본문을 담은 TossApiError — 라우트가 502로 바꾸는 모양', async () => {
  handlers['/api/v1/accounts'] = () => ({ status: 403, body: { error: { code: 'ip-not-allowed', message: '허용되지 않은 IP' } } });
  await assert.rejects(tossAdapter.listAccounts({ forceRefresh: true }), (err: unknown) => {
    assert.ok(err instanceof TossApiError);
    assert.equal(err.status, 403);
    assert.match(err.body, /ip-not-allowed/);
    return true;
  });
});

test('토스 보유 매핑: 문자열 금액을 숫자로, 비용 차감 후 값, 원·달러 합계, 예수금은 매수가능금액', async () => {
  const p = await tossAdapter.getPortfolio('1', { forceRefresh: true });
  assert.equal(p.totalPurchaseAmountKrw, 500000);
  assert.equal(p.totalMarketValueKrw, 598000, '비용 차감 후(amountAfterCost)');
  assert.equal(p.totalMarketValueUsd, 359);
  assert.equal(p.profitLossRate, 0.196);
  assert.equal(p.cashBalanceKrw, 1000);
  assert.equal(p.cashBalanceUsd, 12.5);
  assert.deepEqual([p.positions[0].quantity, p.positions[0].marketValue, p.positions[0].commission], [10, 598000, 1000]);
});

test('토스 보유: result 봉투가 없어도 읽는다(라이브 응답 모양이 둘 다 가능)', async () => {
  const wrapped = defaultHandlers()['/api/v1/holdings']({} as Call, 1).body as { result: unknown };
  handlers['/api/v1/holdings'] = () => ({ body: wrapped.result });
  const p = await tossAdapter.getPortfolio('1', { forceRefresh: true });
  assert.equal(p.positions.length, 1);
});

test('토스 예수금 조회가 실패해도 보유는 보여준다(null)', async () => {
  handlers['/api/v1/buying-power'] = () => ({ status: 500, body: { error: { code: 'internal' } } });
  const p = await tossAdapter.getPortfolio('1', { forceRefresh: true });
  assert.equal(p.positions.length, 1);
  assert.equal(p.cashBalanceKrw, null);
});

test('토스 숫자로 못 읽는 금액이 오면 조용히 0이 되지 않고 오류를 낸다', async () => {
  handlers['/api/v1/holdings'] = () => ({
    body: { result: { ...(defaultHandlers()['/api/v1/holdings']({} as Call, 1).body as any).result, items: [holdingItem({ quantity: 'abc' })] } },
  });
  await assert.rejects(tossAdapter.getPortfolio('1', { forceRefresh: true }), /숫자로 파싱할 수 없는/);
});

test('토스 매매내역: status=CLOSED·기간 쿼리, 커서로 끝까지, 체결 0건 주문은 뺀다', async () => {
  const order = (id: string, filled: string, side = 'BUY') => ({
    orderId: id, symbol: 'AAPL', side, status: 'FILLED', price: '200', quantity: '1', currency: 'USD', orderedAt: '2026-01-05T10:00:00+09:00',
    execution: { filledQuantity: filled, averageFilledPrice: '199.5', filledAmount: '199.5', commission: '0.1', tax: null, filledAt: '2026-01-05T23:31:00+09:00', settlementDate: null },
  });
  handlers['/api/v1/orders'] = (call) =>
    call.query.get('cursor') === 'C2'
      ? { body: { result: { orders: [order('o3', '0')], nextCursor: null, hasNext: false } } }
      : { body: { result: { orders: [order('o1', '1'), order('o2', '2', 'SELL')], nextCursor: 'C2', hasNext: true } } };
  const t = await tossAdapter.getTradeHistory!('1', { from: '2026-01-01', to: '2026-01-31' }, { forceRefresh: true });
  const first = pathCalls('/api/v1/orders')[0].query;
  assert.deepEqual([first.get('status'), first.get('from'), first.get('to'), first.get('limit')], ['CLOSED', '2026-01-01', '2026-01-31', '100']);
  assert.equal(pathCalls('/api/v1/orders')[1].query.get('cursor'), 'C2');
  assert.deepEqual(t.map((x) => [x.id, x.side, x.quantity, x.price, x.executedAt]), [
    ['o1', 'BUY', 1, 199.5, '2026-01-05'],
    ['o2', 'SELL', 2, 199.5, '2026-01-05'],
  ]);
});

test('토스 거래내역(배당·입출금 원천): 종류 필터·커서 페이지를 끝까지', async () => {
  const tx = (type: string) => ({ transactionType: type, marketCountry: 'KR', currency: 'KRW', symbol: null, assetClass: null, isinCode: null, amount: '1', tax: '0', netAmount: '1', exchangeRate: null, settlementDate: '2026-01-02', settled: true, transactionTime: null, isCancellation: false });
  handlers['/api/v1/transactions'] = (call) =>
    call.query.get('cursor')
      ? { body: { result: { transactions: [tx('DIVIDEND')], nextCursor: null, hasNext: false } } }
      : { body: { result: { transactions: [tx('DEPOSIT')], nextCursor: 'N1', hasNext: true } } };
  const rows = await fetchTossTransactions(1, { types: ['DIVIDEND', 'DEPOSIT'] });
  assert.deepEqual(rows.map((r) => r.transactionType), ['DEPOSIT', 'DIVIDEND']);
  const q = pathCalls('/api/v1/transactions')[0].query;
  assert.equal(q.get('transactionTypes'), 'DIVIDEND,DEPOSIT');
  assert.equal(pathCalls('/api/v1/transactions')[1].query.get('cursor'), 'N1');
});
