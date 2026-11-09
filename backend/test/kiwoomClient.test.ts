import { DATA_DIR, readJson, resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCredentialFields } from '../src/credentials';
import { KiwoomApiError, parseKiwoomExpiry, yearWindows } from '../src/brokers/kiwoom/kiwoomClient';
import { kiwoomAdapter } from '../src/brokers/kiwoom/kiwoomAdapter';
import { syncKiwoomDividends } from '../src/brokers/kiwoom/kiwoomDividendSync';
import {
  classifyKiwoomDividends,
  kiwoomFlowDirection,
  kwNum,
  kwSymbol,
  mapKiwoomDomesticPositions,
  mapKiwoomDomesticRealized,
  mapKiwoomTrades,
  mapKiwoomUsPositions,
  summarizeKiwoomCashFlows,
} from '../src/brokers/kiwoom/kiwoomMappers';
import { listDividends } from '../src/db/dividends';

// 키움증권 — 실키 없이 도는 테스트. 응답은 **공식 명세(kiwoom_api_spec.json)의 응답 예시**를 그대로 쓴다
// (fixtures/kiwoom-spec-examples.json — 명세 예시의 빠진 쉼표만 보정, 예시 계좌 표기는 가짜로 바꿈). 배당·입출금 줄은
// 명세에 예시가 없어 필드명대로 지어낸 값이다. ⚠ 실키 확인 전 — 실서버 점검은 `npm run check:kiwoom`.

const EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'kiwoom-spec-examples.json'), 'utf-8')) as Record<string, any>;

interface Call {
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Handler = (call: Call, nth: number) => Reply;

let calls: Call[] = [];
let handlers: Record<string, Handler> = {};
let tokenSeq = 0;

const byApiId = (map: Record<string, Handler>): Handler => (call, nth) => {
  const h = map[call.headers['api-id']];
  return h ? h(call, nth) : { body: { return_code: 1505, return_msg: `no handler ${call.headers['api-id']}` } };
};

const defaultApi = (): Record<string, Handler> => ({
  ka00001: () => ({ body: EX.ka00001 }),
  kt00018: () => ({ body: EX.kt00018 }),
  kt00001: () => ({ body: EX.kt00001 }),
  ust21070: () => ({ body: EX.ust21070 }),
  ust21110: () => ({ body: EX.ust21110 }),
  kt00015: () => ({ body: { trst_ovrl_trde_prps_array: [], return_code: 0, return_msg: '조회가 완료되었습니다' } }),
});
let api: Record<string, Handler> = {};

const reset = () => {
  api = defaultApi();
  handlers = {
    '/oauth2/token': () => ({ body: { ...EX.au10001, token: `kw-tok-${++tokenSeq}`, expires_dt: '20991231235959' } }),
    '/api/dostk/acnt': byApiId(api),
    '/api/us/acnt': byApiId(api),
  };
};

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null;
  const call: Call = { path: u.pathname, headers, body };
  calls.push(call);
  const h = handlers[u.pathname];
  if (!h) return new Response('{}', { status: 404 });
  const nth = calls.filter((c) => c.path === u.pathname && c.headers['api-id'] === headers['api-id']).length;
  const r = h(call, nth);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } });
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

let keySeq = 0;
beforeEach(() => {
  resetDataDir();
  calls = [];
  reset();
  setCredentialFields('kiwoom', { appKey: `kw-app-${++keySeq}`, appSecret: 'kw-secret' });
});
const apiCalls = (id: string) => calls.filter((c) => c.headers['api-id'] === id);

// ── 순수 해석 ──────────────────────────────────────────────────────────────────

test('키움 숫자·코드: 0 채움 부호 문자열, 쉼표, 소수, 접두어 A/J/Q 제거', () => {
  assert.equal(kwNum('000000017598258'), 17598258);
  assert.equal(kwNum('-00000000196888'), -196888);
  assert.equal(kwNum('+61.28'), 61.28);
  assert.equal(kwNum('56,900'), 56900);
  assert.equal(kwNum('0.00'), 0);
  assert.equal(kwNum(''), 0);
  assert.equal(kwSymbol('A005930'), '005930');
  assert.equal(kwSymbol('Q500001'), '500001');
  assert.equal(kwSymbol('AAPL'), 'AAPL');
  assert.equal(parseKiwoomExpiry('20241107083713'), Date.parse('2024-11-07T08:37:13+09:00'));
  assert.deepEqual(yearWindows('2024-05-01', '2026-02-03'), [['2024-05-01', '2024-12-31'], ['2025-01-01', '2025-12-31'], ['2026-01-01', '2026-02-03']]);
});

test('키움 국내 잔고(공식 예시 kt00018): 같은 종목 여러 줄을 합치고 평균가·수익률을 다시 구한다', () => {
  const items = EX.kt00018.acnt_evlt_remn_indv_tot as Record<string, unknown>[];
  const p = mapKiwoomDomesticPositions(items);
  const sum = (k: string) => items.reduce((s, r) => s + kwNum(r[k]), 0);
  assert.equal(p.length, new Set(items.map((r) => kwSymbol(r.stk_cd))).size);
  assert.equal(p[0].symbol, '005930');
  assert.equal(p[0].quantity, sum('rmnd_qty'));
  assert.equal(p[0].purchaseAmount, sum('pur_amt'));
  assert.equal(p[0].marketValue, sum('evlt_amt'));
  assert.equal(p[0].profitLossAmount, sum('evltv_prft'));
  assert.ok(Math.abs(p[0].averagePurchasePrice - sum('pur_amt') / sum('rmnd_qty')) < 1e-9);
  assert.ok(p[0].lastPrice > 0, '현재가는 절댓값');
});

test('키움 미국 잔고(공식 예시 ust21070): 외화 필드, 퍼센트 수익률을 소수로', () => {
  const p = mapKiwoomUsPositions(EX.ust21070.result_list);
  assert.deepEqual([p[0].symbol, p[0].currency, p[0].quantity, p[0].marketValue], ['AAPL', 'USD', 395, 108719.8]);
  assert.equal(p[0].profitLossRate, -0.0294);
});

test('키움 매매(공식 예시 kt00015 장내매도): 거래번호 id, 단가 쉼표, 수수료·세금', () => {
  const t = mapKiwoomTrades(EX.kt00015.trst_ovrl_trde_prps_array, 'SELL');
  assert.deepEqual([t[0].id, t[0].symbol, t[0].side, t[0].quantity, t[0].price, t[0].amount, t[0].currency, t[0].tax], [
    'kw-20241121-000000001', '005930', 'SELL', 1, 56900, 56900, 'KRW', 102,
  ]);
  const usd = mapKiwoomTrades([{ trde_dt: '20260105', trde_no: '000000009', stk_cd: 'AAPL', trde_qty_jwa_cnt: '2', crnc_cd: 'USD', fc_trde_amt: '400.50', fc_cmsn: '0.20', rmrk_nm: '해외주식매수' }], 'BUY');
  assert.deepEqual([usd[0].currency, usd[0].price, usd[0].amount, usd[0].commission], ['USD', 200.25, 400.5, 0.2]);
  assert.equal(mapKiwoomTrades([{ trde_dt: '20260105', trde_no: '1', stk_cd: 'X', trde_qty_jwa_cnt: '1', crnc_cd: 'JPY' }], 'BUY').length, 0);
});

test('키움 실현손익(공식 예시 ka10073): tdy_sel_pl은 수수료·세금 차감 후(158200 − 97602.96 − 500 − 284)', () => {
  const rows = mapKiwoomDomesticRealized(EX.ka10073.dt_stk_rlzt_pl);
  const r = rows[0];
  assert.equal(r.symbol, '005930');
  assert.ok(Math.abs(r.sellAmount - r.buyAmount - r.fee - r.tax - r.realized) < 0.01);
});

test('키움 배당: 입금 중 배당·분배 적요만, 원화는 정산금액(세후)+소득/주민세, 달러는 외화 정산금액+외국납부세액', () => {
  const c = classifyKiwoomDividends([
    { trde_dt: '20260415', stk_cd: 'A005930', stk_nm: '가짜전자', rmrk_nm: '배당금입금', crnc_cd: 'KRW', trde_amt: '000000000001000', exct_amt: '000000000000846', incm_resi_tax: '000000000000154' },
    { trde_dt: '20260415', stk_cd: 'A069500', stk_nm: '가짜ETF', rmrk_nm: 'ETF분배금입금', crnc_cd: 'KRW', trde_amt: '000000000000500', exct_amt: '000000000000000', incm_resi_tax: '000000000000077' },
    { trde_dt: '20260512', stk_cd: 'AAPL', stk_nm: '가짜애플', rmrk_nm: '해외배당금입금', crnc_cd: 'USD', fc_trde_amt: '3.00', fc_exct_amt: '2.55', frgn_pay_txam: '0.45' },
    { trde_dt: '20260416', stk_cd: 'A005930', rmrk_nm: '배당금입금취소', crnc_cd: 'KRW', exct_amt: '000000000000846' },
    { trde_dt: '20260416', stk_cd: '', rmrk_nm: '배당금입금', crnc_cd: 'KRW', exct_amt: '000000000000846' },
    { trde_dt: '20260416', stk_cd: 'A005930', rmrk_nm: '이체입금', crnc_cd: 'KRW', trde_amt: '000000000100000' },
  ]);
  assert.deepEqual(
    c.map((x) => [x.symbol, x.kind, x.currency, x.amount, x.tax]),
    [
      ['005930', 'dividend', 'KRW', 846, 154],
      ['069500', 'etfDistribution', 'KRW', 423, 77],
      ['AAPL', 'dividend', 'USD', 2.55, 0.45],
    ]
  );
});

test('키움 입금 기준 원금: 입출금 중 입금/출금만, 배당·이자·환전은 빼고 원화만, 입고 건수', () => {
  assert.equal(kiwoomFlowDirection({ io_tp_nm: '입금', rmrk_nm: '이체입금' }), 'in');
  assert.equal(kiwoomFlowDirection({ io_tp_nm: '출금', rmrk_nm: '이체출금' }), 'out');
  assert.equal(kiwoomFlowDirection({ io_tp_nm: '입금', rmrk_nm: '예탁금이용료' }), null);
  const s = summarizeKiwoomCashFlows(
    [
      { trde_dt: '20250310', io_tp_nm: '입금', rmrk_nm: '이체입금', crnc_cd: 'KRW', trde_amt: '000000001000000' },
      { trde_dt: '20260105', io_tp_nm: '출금', rmrk_nm: '이체출금', crnc_cd: 'KRW', trde_amt: '-00000000300000' },
      { trde_dt: '20260106', io_tp_nm: '입금', rmrk_nm: '외화입금', crnc_cd: 'USD', fc_trde_amt: '100.00' },
      { trde_dt: '20260107', io_tp_nm: '입금', rmrk_nm: '환전입금', crnc_cd: 'KRW', trde_amt: '000000000050000' },
    ],
    [{ stk_cd: 'A005930', rmrk_nm: '타사대체입고' }]
  );
  assert.deepEqual([s.depositKrw, s.withdrawalKrw, s.netPrincipalKrw, s.firstDate, s.transferIn], [1000000, 300000, 700000, '2025-03-10', 1]);
});

// ── HTTP 흐름(가짜 서버) ───────────────────────────────────────────────────────

test('키움 토큰: JSON 본문(grant_type·appkey·secretkey)으로 한 번 발급, 파일에 저장해 재사용, 앱키 원문은 안 남김', async () => {
  await kiwoomAdapter.listAccounts({ forceRefresh: true });
  await kiwoomAdapter.getPortfolio('0123456789', { forceRefresh: true });
  const tokens = calls.filter((c) => c.path === '/oauth2/token');
  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0].body, { grant_type: 'client_credentials', appkey: `kw-app-${keySeq}`, secretkey: 'kw-secret' });
  for (const c of calls.filter((x) => x.path.startsWith('/api/'))) {
    assert.equal(c.headers.authorization, `Bearer kw-tok-${tokenSeq}`);
    assert.ok(c.headers['api-id'], 'api-id 헤더');
    assert.match(c.headers['content-type'], /^application\/json/);
  }
  const stored = readJson<{ accessToken: string; expiresAt: number }>('kiwoom-token.json');
  assert.equal(stored.accessToken, `kw-tok-${tokenSeq}`);
  assert.ok(!JSON.stringify(stored).includes('kw-app'));
});

test('키움 계좌: 계좌번호조회(ka00001)가 준 계좌 하나', async () => {
  const accounts = await kiwoomAdapter.listAccounts({ forceRefresh: true });
  assert.deepEqual(accounts.map((a) => a.id), [EX.ka00001.acctNo]);
});

test('키움 포트폴리오: 요청 본문(kt00018 qry_tp·거래소), 원화·달러 예수금, 국내+미국 보유', async () => {
  const p = await kiwoomAdapter.getPortfolio('0123456789', { forceRefresh: true });
  assert.deepEqual(apiCalls('kt00018')[0].body, { qry_tp: '1', dmst_stex_tp: 'KRX' });
  assert.equal(apiCalls('kt00018')[0].path, '/api/dostk/acnt');
  assert.equal(apiCalls('ust21070')[0].path, '/api/us/acnt');
  assert.equal(p.totalPurchaseAmountKrw, kwNum(EX.kt00018.tot_pur_amt));
  assert.equal(p.cashBalanceKrw, kwNum(EX.kt00001.entr));
  assert.equal(p.cashBalanceUsd, 18039493.57);
  assert.deepEqual([...new Set(p.positions.map((x) => x.currency))], ['KRW', 'USD']);
});

test('키움 업무 오류는 HTTP 200이어도 return_code로 KiwoomApiError', async () => {
  api.kt00018 = () => ({ body: { return_code: 1511, return_msg: '필수 입력 값에 값이 존재하지 않습니다' } });
  await assert.rejects(kiwoomAdapter.getPortfolio('0123456789', { forceRefresh: true }), (err: unknown) => {
    assert.ok(err instanceof KiwoomApiError);
    assert.equal(err.returnCode, 1511);
    assert.match(err.message, /kt00018.*1511/);
    return true;
  });
});

test('키움 토큰 무효(8005·"[8005:" 메시지)와 IP 불일치(8010)는 한 번만 재발급해 다시 부른다', async () => {
  await kiwoomAdapter.listAccounts({ forceRefresh: true }); // 처음 발급은 여기서 — 아래는 재발급만 센다
  for (const bad of [{ return_code: 8005, return_msg: 'Token이 유효하지 않습니다' }, { return_code: 3, return_msg: '[8005:Token이 유효하지 않습니다]' }, { return_code: 8010, return_msg: 'IP 불일치' }]) {
    calls = [];
    api.ka00001 = (_c, nth) => (nth === 1 ? { body: bad } : { body: EX.ka00001 });
    const before = tokenSeq;
    const accounts = await kiwoomAdapter.listAccounts({ forceRefresh: true });
    assert.equal(accounts.length, 1);
    assert.equal(tokenSeq - before, 1, `${bad.return_code} 뒤 재발급 1회`);
  }
});

test('키움 호출 한도(1700)는 토큰을 다시 받지 않고 쉬었다가 재시도한다', async () => {
  await kiwoomAdapter.listAccounts({ forceRefresh: true });
  const before = tokenSeq;
  api.ka00001 = (_c, nth) => (nth === 1 ? { body: { return_code: 1700, return_msg: '허용된 API 요청 개수를 초과하였습니다' } } : { body: EX.ka00001 });
  calls = [];
  await kiwoomAdapter.listAccounts({ forceRefresh: true });
  assert.equal(apiCalls('ka00001').length, 2);
  assert.equal(tokenSeq, before);
});

test('키움 매매내역: kt00015 매수(4)·매도(5)를 1년 단위로, 연속조회는 응답 헤더 cont-yn/next-key', async () => {
  api.kt00015 = (call) => {
    if (call.headers['next-key'] === 'K2') return { body: { trst_ovrl_trde_prps_array: [{ ...EX.kt00015.trst_ovrl_trde_prps_array[0], trde_no: '000000002' }], return_code: 0 } };
    return { body: { trst_ovrl_trde_prps_array: [EX.kt00015.trst_ovrl_trde_prps_array[0]], return_code: 0 }, headers: { 'cont-yn': 'Y', 'next-key': 'K2' } };
  };
  const t = await kiwoomAdapter.getTradeHistory!('0123456789', { from: '2025-06-01', to: '2026-01-31' }, { forceRefresh: true });
  const reqs = apiCalls('kt00015');
  // 매수·매도 × 2개 연도 구간 × 2페이지
  assert.equal(reqs.length, 8);
  assert.deepEqual([...new Set(reqs.map((c) => c.body?.tp))].sort(), ['4', '5']);
  assert.deepEqual([...new Set(reqs.map((c) => `${c.body?.strt_dt}-${c.body?.end_dt}`))].sort(), ['20250601-20251231', '20260101-20260131']);
  const cont = reqs.find((c) => c.headers['next-key'] === 'K2');
  assert.equal(cont?.headers['cont-yn'], 'Y');
  assert.equal(t.length, 8);
});

test('키움 배당 동기화: 그 계좌 키움 배당을 API 내용으로 교체, 다른 증권사 기록은 그대로', async () => {
  api.kt00015 = (call) => ({
    body: {
      trst_ovrl_trde_prps_array:
        call.body?.tp === '6' && call.body?.strt_dt === '20260101'
          ? [{ trde_dt: '20260415', stk_cd: 'A005930', stk_nm: '가짜전자', rmrk_nm: '배당금입금', crnc_cd: 'KRW', exct_amt: '000000000000846', incm_resi_tax: '000000000000154' }]
          : [],
      return_code: 0,
    },
  });
  fs.writeFileSync(
    path.join(DATA_DIR, 'dividends.json'),
    JSON.stringify([
      { id: 'old', broker: 'kiwoom', accountId: null, symbol: '000660', name: '옛기록', currency: 'KRW', amount: 1, tax: 0, paidDate: '2025-01-01', memo: null },
      { id: 'keep', broker: 'samsung', accountId: 'X', symbol: '005930', name: '삼성', currency: 'KRW', amount: 1, tax: 0, paidDate: '2025-01-01', memo: null },
    ])
  );
  const r = await syncKiwoomDividends();
  assert.deepEqual([r.broker, r.added, r.removed, r.total], ['kiwoom', 1, 1, 1]);
  const all = listDividends();
  assert.ok(all.some((d) => d.id === 'keep') && !all.some((d) => d.id === 'old'));
  const kw = all.filter((d) => d.broker === 'kiwoom');
  assert.deepEqual(kw.map((d) => [d.accountId, d.symbol, d.amount, d.tax]), [[EX.ka00001.acctNo, '005930', 846, 154]]);
  assert.ok(apiCalls('kt00015').every((c) => c.body?.tp === '6'));
});
