import { resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCredentialFields } from '../src/credentials';
import {
  fetchTossAccounts,
  fetchTossBuyingPower,
  fetchTossExchangeRate,
  fetchTossHoldings,
  fetchTossIndicatorDailyCandles,
  fetchTossMarketCalendar,
  fetchTossMonthlyClosePrices,
  fetchTossOrders,
  fetchTossPrices,
  fetchTossSectorEtfs,
  fetchTossSectorStocks,
  fetchTossSectors,
  fetchTossStockInfo,
  fetchTossStockWarnings,
  fetchTossTransactions,
} from '../src/brokers/toss/tossClient';
import { classifyTossTransactions } from '../src/brokers/toss/tossDividendSync';
import { summarizeTossCashFlows } from '../src/brokers/toss/tossCashFlows';

// 토스증권 — **공식 명세(openapi.json)의 응답 예시**를 그대로 가짜 서버 응답으로 써서, 클라이언트가 명세가 보여 주는 모든
// 경우(빈 목록·미국 종목만·다음 페이지 있음 등)를 예외 없이 읽고 숫자로 바꾸는지 본다. 예시는 `npm run spec:update`가
// fixtures/toss-spec-examples.json에 뽑아 둔다(scripts/spec-watch.cjs) — 명세가 예시를 바꾸면 이 테스트가 새 예시로 다시 돈다.
// 요청 흐름(토큰 재사용·재시도)은 tossClient.test.ts가 본다.

type Examples = Record<string, Record<string, any>>;
const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'toss-spec-examples.json'), 'utf-8')) as Examples;

/** 경로 → operationId. 경로 변수는 정규식으로. */
const ROUTES: Array<[RegExp, string]> = [
  [/^\/oauth2\/token$/, 'issueOAuth2Token'],
  [/^\/api\/v1\/accounts$/, 'getAccounts'],
  [/^\/api\/v1\/holdings$/, 'getHoldings'],
  [/^\/api\/v1\/buying-power$/, 'getBuyingPower'],
  [/^\/api\/v1\/orders$/, 'getOrders'],
  [/^\/api\/v1\/transactions$/, 'getTransactions'],
  [/^\/api\/v1\/prices$/, 'getPrices'],
  [/^\/api\/v1\/candles$/, 'getCandles'],
  [/^\/api\/v1\/stocks$/, 'getStocks'],
  [/^\/api\/v1\/stocks\/[^/]+\/warnings$/, 'getStockWarnings'],
  [/^\/api\/v1\/exchange-rate$/, 'getExchangeRate'],
  [/^\/api\/v1\/market-calendar\/KR$/, 'getKrMarketCalendar'],
  [/^\/api\/v1\/market-calendar\/US$/, 'getUsMarketCalendar'],
  [/^\/api\/v1\/market-indicators\/[^/]+\/candles$/, 'getMarketIndicatorCandles'],
  [/^\/api\/v1\/sectors$/, 'listSectors'],
  [/^\/api\/v1\/sectors\/[^/]+\/stocks$/, 'getSectorStocks'],
  [/^\/api\/v1\/sectors\/[^/]+\/etfs$/, 'getSectorEtfs'],
];

/** 이번 테스트에서 operation마다 돌려줄 예시 이름(없으면 그 operation의 첫 예시). */
let pick: Record<string, string> = {};
/** 같은 operation을 여러 번 부를 때 차례로 돌려줄 예시 이름(연속조회). */
let sequence: Record<string, string[]> = {};
let keySeq = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL) => {
  const u = new URL(String(url));
  const op = ROUTES.find(([re]) => re.test(u.pathname))?.[1];
  if (!op || !EX[op]) return new Response(JSON.stringify({ error: `no example for ${u.pathname}` }), { status: 404 });
  const name = sequence[op]?.length ? sequence[op].shift()! : (pick[op] ?? Object.keys(EX[op])[0]);
  const body = EX[op][name];
  assert.ok(body !== undefined, `${op}에 ${name} 예시가 없다`);
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

beforeEach(async () => {
  resetDataDir();
  pick = {};
  sequence = {};
  // 응답 캐시(withCache)가 테스트 사이에 남지 않게 키를 바꾸고 forceRefresh로 부른다.
  await setCredentialFields('toss', { clientId: `toss-client-${++keySeq}`, clientSecret: 'toss-secret' });
});

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

test('명세 예시: 모든 operation에 응답 예시가 하나 이상 있다(스냅샷과 픽스처가 같이 갱신됐는지)', () => {
  for (const [, op] of ROUTES) assert.ok(EX[op] && Object.keys(EX[op]).length > 0, `${op} 예시 없음`);
});

test('명세 예시: 계좌 목록 — 계좌 있음·빈 목록', async () => {
  pick.getAccounts = 'brokerageAccount';
  const accounts = await fetchTossAccounts({ forceRefresh: true });
  assert.ok(accounts.length > 0);
  assert.ok(isNum(accounts[0].accountSeq));
  pick.getAccounts = 'emptyAccounts';
  assert.deepEqual(await fetchTossAccounts({ forceRefresh: true }), []);
});

test('명세 예시: 보유 종목 — 다섯 경우 모두 숫자로 바뀌고, usd·tax가 null·생략이어도 던지지 않는다', async () => {
  for (const name of Object.keys(EX.getHoldings)) {
    pick.getHoldings = name;
    const h = await fetchTossHoldings(1, { forceRefresh: true });
    assert.ok(isNum(h.totalPurchaseAmount.krw), `${name}: totalPurchaseAmount.krw`);
    assert.ok(h.totalPurchaseAmount.usd === null || isNum(h.totalPurchaseAmount.usd), `${name}: usd`);
    for (const item of h.items) {
      for (const v of [item.quantity, item.lastPrice, item.averagePurchasePrice, item.marketValue.amount, item.profitLoss.rate]) {
        assert.ok(isNum(v), `${name}/${item.symbol}: 숫자여야 한다`);
      }
      assert.ok(item.cost.tax === null || isNum(item.cost.tax));
    }
  }
  // 예시 값 그대로(withHoldings — 문자열 "6500000" → 6500000).
  pick.getHoldings = 'withHoldings';
  const h = await fetchTossHoldings(1, { forceRefresh: true });
  assert.equal(h.totalPurchaseAmount.krw, Number(EX.getHoldings.withHoldings.result.totalPurchaseAmount.krw));
  assert.equal(h.items.length, EX.getHoldings.withHoldings.result.items.length);
});

test('명세 예시: 매수 가능 금액 — 원화·달러', async () => {
  pick.getBuyingPower = 'krw';
  assert.ok(isNum(await fetchTossBuyingPower(1, 'KRW', { forceRefresh: true })));
  pick.getBuyingPower = 'usd';
  assert.ok(isNum(await fetchTossBuyingPower(1, 'USD', { forceRefresh: true })));
});

test('명세 예시: 주문 내역 — 다음 페이지 있음 → 빈 페이지로 끝, 미체결 섞임', async () => {
  sequence.getOrders = ['completedWithNextPage', 'empty'];
  const orders = await fetchTossOrders(1, '2026-01-01', '2026-12-31', { forceRefresh: true });
  assert.ok(orders.length > 0);
  for (const o of orders) {
    assert.ok(isNum(o.quantity) && isNum(o.execution.filledQuantity));
    assert.ok(o.price === null || isNum(o.price));
  }
  sequence.getOrders = ['pendingMixed'];
  const pending = await fetchTossOrders(1, '2025-01-01', '2025-12-31', { forceRefresh: true });
  for (const o of pending) assert.ok(o.price === null || isNum(o.price), `${o.orderId}: 가격`);
});

test('명세 예시: 거래내역 — 여섯 경우를 읽고, 배당 분류·투자원금 요약이 던지지 않는다', async () => {
  for (const name of Object.keys(EX.getTransactions)) {
    // 다음 페이지가 있다는 예시(trades)는 그다음에 빈 페이지를 준다.
    const hasNext = EX.getTransactions[name].result.hasNext;
    sequence.getTransactions = hasNext ? [name, 'empty'] : [name];
    const txns = await fetchTossTransactions(1, { types: ['DIVIDEND', 'DEPOSIT', 'WITHDRAWAL'] });
    assert.equal(txns.length, EX.getTransactions[name].result.transactions.length, name);
    classifyTossTransactions(txns);
    const summary = summarizeTossCashFlows(txns);
    assert.ok(isNum(summary.depositKrw), `${name}: depositKrw`);
  }
});

test('명세 예시: 시세·종목 정보·환율', async () => {
  for (const name of Object.keys(EX.getPrices)) {
    pick.getPrices = name;
    const prices = await fetchTossPrices([`P${name}`], { forceRefresh: true });
    assert.ok(prices.length > 0 && prices.every((p) => isNum(p.lastPrice)), name);
  }
  for (const name of Object.keys(EX.getStocks)) {
    pick.getStocks = name;
    const info = await fetchTossStockInfo([`S${name}`], { forceRefresh: true });
    assert.ok(info.length > 0 && info.every((s) => typeof s.name === 'string'), name);
  }
  for (const name of Object.keys(EX.getExchangeRate)) {
    pick.getExchangeRate = name;
    const fx = await fetchTossExchangeRate('USD', 'KRW', { forceRefresh: true });
    assert.ok(isNum(fx.rate) && fx.rate > 100, name);
  }
});

test('명세 예시: 시장 정보 — 장 캘린더·매수 유의사항·지표 일봉·섹터', async () => {
  for (const name of Object.keys(EX.getKrMarketCalendar)) {
    pick.getKrMarketCalendar = name;
    assert.equal(typeof (await fetchTossMarketCalendar('KR')), 'object');
  }
  for (const name of Object.keys(EX.getStockWarnings)) {
    pick.getStockWarnings = name;
    assert.ok(Array.isArray(await fetchTossStockWarnings(`W${name}`)));
  }
  sequence.getMarketIndicatorCandles = ['dailyCandles', 'lastPage'];
  const candles = await fetchTossIndicatorDailyCandles('KOSPI', 2);
  assert.ok(candles.length > 0);
  assert.ok((await fetchTossSectors()).length > 0);
  for (const name of Object.keys(EX.getSectorStocks)) {
    pick.getSectorStocks = name;
    assert.ok(Array.isArray(await fetchTossSectorStocks(`s-${name}`, 'KR')));
  }
  for (const name of Object.keys(EX.getSectorEtfs)) {
    pick.getSectorEtfs = name;
    assert.ok(Array.isArray(await fetchTossSectorEtfs(`e-${name}`, 'KR')));
  }
});

test('명세 예시: 일봉 → 월말 종가(다음 페이지 → 마지막 페이지)', async () => {
  sequence.getCandles = ['dailyCandles', 'lastPage'];
  const closes = await fetchTossMonthlyClosePrices('005930', 24, { forceRefresh: true });
  assert.ok(closes.length > 0);
  assert.ok(closes.every((c) => isNum(c.closePrice)));
});

test('거래내역: 같은 커서가 다시 오면 같은 페이지를 반복해 받지 않고 던진다(잘린 목록으로 배당을 교체하지 않게)', async () => {
  // 명세의 trades 예시는 hasNext=true + nextCursor — 같은 응답을 계속 주면 커서가 반복된다.
  pick.getTransactions = 'trades';
  await assert.rejects(fetchTossTransactions(1, { types: ['BUY', 'SELL'] }), /커서가 반복/);
});
