import { DATA_DIR, readJson, resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCredentialFields } from '../src/credentials';
import { NhApiError } from '../src/brokers/nh/nhClient';
import { nhAdapter } from '../src/brokers/nh/nhAdapter';
import { syncNhDividends } from '../src/brokers/nh/nhDividendSync';
import { listDividends } from '../src/db/dividends';

// NH 클라이언트의 HTTP 흐름을 가짜 서버(fetch 대체)로 확인한다 — 실키 없이 도는 테스트.
// 요청 모양(경로·헤더·Input_0)은 www.nhplug.com 명세, 응답은 명세 필드명으로 지은 가짜 값이다.
// 실서버 대상 점검은 scripts/nh-live-check.cjs(`npm run check:nh`).

const LIVE = '11111111101';
const AGENT = '22222222202';
const MOCK = '33333333303';

interface Call {
  host: string;
  path: string;
  headers: Record<string, string>;
  input: Record<string, string> | null;
  query: URLSearchParams;
}

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Handler = (call: Call, nth: number) => Reply;

let calls: Call[] = [];
let handlers: Record<string, Handler> = {};
let tokenSeq = 0;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const defaultHandlers = (): Record<string, Handler> => ({
  '/oauth2/token': () => ({ body: { access_token: `tok-${++tokenSeq}`, token_type: 'Bearer', expires_in: 86400 } }),
  '/n2/acctinfo': () => ({
    body: {
      rsp_cd: '00000',
      rsp_msg: '조회가 완료되었습니다.',
      Output_0: [
        { acct_no: MOCK, acct_type: '03' },
        { acct_no: LIVE, acct_type: '01' },
        { acct_no: AGENT, acct_type: '02' },
        { acct_no: '99999999999', acct_type: '09' },
      ],
    },
  }),
  '/krstock/inquiry/v1/balance': () => ({
    body: { rsp_cd: '00166', rsp_msg: '조회가 완료되었습니다.', Output_0: { dca: 1000, tot_byn_amt: 0, tot_eal_amt: 0, tot_eal_pls: 0 } },
    headers: { cts: 'END', cts_flag: 'N' },
  }),
  '/gbstock/inquiry/v1/balance': () => ({ body: { rsp_cd: '00166', rsp_msg: '조회가 완료되었습니다.', Output_0: { fc_dca: 12.5 } } }),
  '/common/inquiry/v1/totalTransaction': () => ({ body: { rsp_cd: '00000', rsp_msg: '조회할 내용이 없습니다.' } }),
  '/gbstock/inquiry/v1/dailyTransaction': () => ({ body: { rsp_cd: '00000', rsp_msg: '조회할 내용이 없습니다.' } }),
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null;
  const call: Call = { host: u.host, path: u.pathname, headers, input: body?.Input_0 ?? null, query: u.searchParams };
  calls.push(call);
  const h = handlers[u.pathname];
  if (!h) return json({ error: `no handler ${u.pathname}` }, 404);
  const nth = calls.filter((c) => c.path === u.pathname).length;
  const r = h(call, nth);
  return json(r.body, r.status ?? 200, r.headers);
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

let keySeq = 0;
beforeEach(() => {
  resetDataDir();
  calls = [];
  handlers = defaultHandlers();
  // 테스트마다 앱키를 바꿔 메모리·파일 토큰 캐시가 이전 테스트 토큰을 재사용하지 않게 한다(키 해시가 달라짐).
  setCredentialFields('nh', { appKey: `app-key-${++keySeq}`, appSecret: 'app-secret' });
});

const apiCalls = (p: string) => calls.filter((c) => c.path === p);

test('토큰: 명세 형식으로 한 번만 발급하고, 파일에 저장해 다음 호출에 재사용한다', async () => {
  await nhAdapter.listAccounts({ forceRefresh: true });
  await nhAdapter.getPortfolio(LIVE, { forceRefresh: true });

  const tokenCalls = apiCalls('/oauth2/token');
  assert.equal(tokenCalls.length, 1, '토큰은 한 번만');
  const q = tokenCalls[0].query;
  assert.equal(tokenCalls[0].host, 'api.nhplug.com:8443');
  assert.equal(q.get('appkey'), `app-key-${keySeq}`);
  assert.equal(q.get('appsecretkey'), 'app-secret');
  assert.equal(q.get('grant_type'), 'client_credentials');
  assert.equal(q.get('scope'), 'oob');
  assert.equal(tokenCalls[0].headers['content-type'], 'application/x-www-form-urlencoded');

  for (const c of calls.filter((x) => x.path !== '/oauth2/token')) {
    assert.equal(c.headers.authorization, `Bearer tok-${tokenSeq}`, `${c.path} Bearer 헤더`);
    assert.match(c.headers['content-type'], /^application\/json/);
    assert.ok(c.input, `${c.path} Input_0 봉투`);
  }
  const stored = readJson<{ accessToken: string; keyHash: string; expiresAt: number }>('nh-token.json');
  assert.equal(stored.accessToken, `tok-${tokenSeq}`);
  assert.ok(!JSON.stringify(stored).includes('app-key'), '앱키 원문은 저장하지 않는다');
  assert.ok(stored.expiresAt > Date.now() + 23 * 3600_000);
});

test('토큰: 앱키를 바꾸면 저장된 토큰을 쓰지 않고 새로 받는다', async () => {
  await nhAdapter.listAccounts({ forceRefresh: true });
  setCredentialFields('nh', { appKey: 'another-key', appSecret: 'app-secret' });
  await nhAdapter.listAccounts({ forceRefresh: true });
  assert.equal(apiCalls('/oauth2/token').length, 2);
});

test('401(토큰 무효)이면 한 번만 재발급해 다시 부른다', async () => {
  handlers['/n2/acctinfo'] = (call, nth) =>
    nth === 1 ? { status: 401, body: { rsp_cd: 'IGW40043', rsp_msg: '유효하지 않은 토큰입니다.' } } : defaultHandlers()['/n2/acctinfo'](call, nth);
  const accounts = await nhAdapter.listAccounts({ forceRefresh: true });
  assert.equal(accounts.length, 2);
  assert.equal(apiCalls('/oauth2/token').length, 2, '처음 + 401 뒤 재발급');
  assert.equal(apiCalls('/n2/acctinfo')[1].headers.authorization, `Bearer tok-${tokenSeq}`);
});

test('호출 한도 초과(IGW42902)는 토큰을 다시 받지 않고 쉬었다가 재시도한다', async () => {
  handlers['/n2/acctinfo'] = (call, nth) =>
    nth === 1 ? { status: 429, body: { rsp_cd: 'IGW42902', rsp_msg: 'APP 호출 건수 초과' } } : defaultHandlers()['/n2/acctinfo'](call, nth);
  const accounts = await nhAdapter.listAccounts({ forceRefresh: true });
  assert.equal(accounts.length, 2);
  assert.equal(apiCalls('/oauth2/token').length, 1);
  assert.equal(apiCalls('/n2/acctinfo').length, 2);
});

test('게이트웨이 오류(HTTP 200 아님)는 IGW 코드를 담은 NhApiError — 라우트가 502로 바꾸는 모양(status·body)', async () => {
  handlers['/n2/acctinfo'] = () => ({ status: 400, body: { rsp_cd: 'IGW40031', rsp_msg: '유효하지 않은 AppKey입니다.' } });
  await assert.rejects(nhAdapter.listAccounts({ forceRefresh: true }), (err: unknown) => {
    assert.ok(err instanceof NhApiError);
    assert.match(err.message, /IGW40031/);
    assert.equal(err.status, 400);
    assert.match(err.body, /AppKey/);
    return true;
  });
});

test('계좌 목록: 기본은 실전(01·02)만, includePaper면 모의투자(03)도 — 실전이 앞, 모르는 구분은 버린다', async () => {
  const live = await nhAdapter.listAccounts({ forceRefresh: true });
  assert.deepEqual(live.map((a) => [a.id, a.accountType, !!a.paper]), [
    [LIVE, '일반', false],
    [AGENT, '주문대리인', false],
  ]);
  const all = await nhAdapter.listAccounts({ includePaper: true });
  assert.deepEqual(all.map((a) => [a.id, !!a.paper]), [
    [LIVE, false],
    [AGENT, false],
    [MOCK, true],
  ]);
  assert.equal(await nhAdapter.isPaperAccount!(MOCK), true);
  assert.equal(await nhAdapter.isPaperAccount!(LIVE), false);
});

test('모의투자 계좌는 moapi, 실전 계좌는 api 도메인으로 조회한다(토큰은 운영에서 받은 것 그대로)', async () => {
  await nhAdapter.listAccounts({ forceRefresh: true });
  await nhAdapter.getPortfolio(MOCK, { forceRefresh: true });
  await nhAdapter.getPortfolio(LIVE, { forceRefresh: true });
  const hostOf = (acct: string) =>
    calls.filter((c) => c.path === '/krstock/inquiry/v1/balance' && c.input?.act_no === acct).map((c) => c.host);
  assert.deepEqual(hostOf(MOCK), ['moapi.nhplug.com:8443']);
  assert.deepEqual(hostOf(LIVE), ['api.nhplug.com:8443']);
  assert.ok(apiCalls('/oauth2/token').every((c) => c.host === 'api.nhplug.com:8443'));
});

test('국내 잔고: 필수 입력값, 연속조회(헤더 cts) 끝까지, 요약은 마지막 페이지, 종목은 모든 페이지', async () => {
  handlers['/krstock/inquiry/v1/balance'] = (call, nth) =>
    nth === 1
      ? {
          body: {
            rsp_cd: '00165',
            rsp_msg: '다음 자료가 있습니다.',
            Output_0: { dca: 0, tot_byn_amt: 0, tot_eal_amt: 0, tot_eal_pls: 0 },
            Output_1: [{ iem_cd: 'A005930', iem_nm: '가짜전자', itg_bnc_qty: 10, phs_pr: 100, now_pr: 120, eal_amt: 1200, eal_pls_amt: 200, pft_rt: 20 }],
          },
          headers: { cts: 'PAGE2' },
        }
      : {
          body: {
            rsp_cd: '00166',
            rsp_msg: '조회가 완료되었습니다.',
            Output_0: { dca: 5000, tot_byn_amt: 1500, tot_eal_amt: 1700, tot_eal_pls: 200 },
            Output_1: [{ iem_cd: '000660', iem_nm: '가짜하이', itg_bnc_qty: 0 }, { iem_cd: '069500', iem_nm: '가짜ETF', itg_bnc_qty: 1, eal_amt: 500, eal_pls_amt: 0 }],
          },
          headers: { cts: 'PAGE2', cts_flag: 'N' },
        };
  handlers['/gbstock/inquiry/v1/balance'] = () => ({
    body: {
      Output_0: { fc_dca: 12.5 },
      Output_1: [{ iem_cd: 'AAPL', iem_nm: '가짜애플', cns_bse_bnc_qty: 2, fc_abk_amt: 300, fc_eal_amt: 360, fc_eal_pls_amt: 60, eal_pft_rt: 20 }],
    },
  });
  await nhAdapter.listAccounts({ forceRefresh: true });
  const p = await nhAdapter.getPortfolio(LIVE, { forceRefresh: true });

  const bal = apiCalls('/krstock/inquiry/v1/balance');
  assert.equal(bal.length, 2);
  assert.deepEqual(bal[0].input, { act_no: LIVE, bnc_bse_cd: '5', ltg_aot_dit_cd: '9', aet_bse: '2', qut_dit_cd: 'UNT', aly_qut_cd: '1' });
  assert.equal(bal[0].headers.cts, undefined, '첫 페이지는 cts 없이');
  assert.equal(bal[1].headers.cts, 'PAGE2', '다음 페이지는 직전 cts를 헤더로');
  assert.deepEqual(apiCalls('/gbstock/inquiry/v1/balance')[0].input, {
    act_no: LIVE, qut_iqr_dit_cd: '9', fc_sec_trd_nat_cd: '200', cur_cd: 'USD', xns_dit_cd: '0',
  });

  assert.equal(p.cashBalanceKrw, 5000, '요약은 마지막 페이지');
  assert.equal(p.totalPurchaseAmountKrw, 1500);
  assert.equal(p.cashBalanceUsd, 12.5);
  assert.deepEqual(p.positions.map((x) => [x.symbol, x.currency]), [['005930', 'KRW'], ['069500', 'KRW'], ['AAPL', 'USD']], '수량 0은 뺀다');
  assert.equal(p.totalMarketValueUsd, 360);
});

test('연속조회: 같은 cts가 다시 오면 끝낸다(무한루프 방지)', async () => {
  handlers['/common/inquiry/v1/totalTransaction'] = () => ({ body: { rsp_cd: '00000', Output_0: [] }, headers: { cts: 'SAME', cts_flag: 'Y' } });
  await nhAdapter.listAccounts({ forceRefresh: true });
  await nhAdapter.getTradeHistory!(LIVE, { from: '2026-01-01', to: '2026-01-31' }, { forceRefresh: true });
  assert.equal(apiCalls('/common/inquiry/v1/totalTransaction').length, 2);
});

test('잔고 요약이 없으면(조회 실패) rsp_msg를 담아 던진다 — 0원 계좌로 보이지 않게', async () => {
  handlers['/krstock/inquiry/v1/balance'] = () => ({ body: { rsp_cd: '40310', rsp_msg: '계좌번호를 확인하세요.' } });
  await nhAdapter.listAccounts({ forceRefresh: true });
  await assert.rejects(nhAdapter.getPortfolio(LIVE, { forceRefresh: true }), /계좌번호를 확인하세요/);
});

test('해외 잔고가 실패해도 국내 보유는 보여준다', async () => {
  handlers['/gbstock/inquiry/v1/balance'] = () => ({ status: 500, body: { rsp_cd: 'IGW50025', rsp_msg: '일시 오류' } });
  await nhAdapter.listAccounts({ forceRefresh: true });
  const p = await nhAdapter.getPortfolio(LIVE, { forceRefresh: true });
  assert.equal(p.cashBalanceKrw, 1000);
  assert.equal(p.cashBalanceUsd, null);
});

test('매매내역: 국내(종합거래내역 매매)와 미국(일별거래내역 매수·매도)을 요청 코드대로 받아 합친다', async () => {
  handlers['/common/inquiry/v1/totalTransaction'] = () => ({
    body: { Output_0: [{ trd_dt: '20260105', iem_cd: 'A005930', iem_nm: '가짜전자', sps_cd_krl_anm: '장내매수', cur_cd: 'KRW', trd_qty: 1, trd_uit_pr: 100, trd_amt: 100 }] },
  });
  handlers['/gbstock/inquiry/v1/dailyTransaction'] = (call) => ({
    body: {
      Output_0:
        call.input?.act_trd_cfc_cd === '06'
          ? [{ trd_dt: '20260106', trd_sno: 7, iem_cd: 'AAPL', trd_qty: 1, trd_uit_pr: 200, fc_trd_amt: 200, cur_cd_nm: 'USD' }]
          : [],
    },
  });
  await nhAdapter.listAccounts({ forceRefresh: true });
  const t = await nhAdapter.getTradeHistory!(LIVE, { from: '2026-01-01', to: '2026-01-31' }, { forceRefresh: true });

  const dom = apiCalls('/common/inquiry/v1/totalTransaction')[0].input!;
  assert.deepEqual([dom.act_no, dom.iqr_sta_dt, dom.iqr_end_dt, dom.act_trd_dtl_cd], [LIVE, '20260101', '20260131', '03']);
  assert.deepEqual(apiCalls('/gbstock/inquiry/v1/dailyTransaction').map((c) => c.input!.act_trd_cfc_cd).sort(), ['05', '06']);
  assert.deepEqual(t.map((x) => [x.side, x.symbol, x.currency]), [['BUY', '005930', 'KRW'], ['SELL', 'AAPL', 'USD']]);
});

test('배당 동기화: 실전 계좌만 조회하고(모의투자는 moapi도 부르지 않음) 그 계좌 NH 배당을 API 내용으로 교체한다', async () => {
  handlers['/common/inquiry/v1/totalTransaction'] = (call) => ({
    body: {
      Output_0:
        call.input?.act_no === LIVE
          ? [{ trd_dt: '20260415', iem_cd: 'A005930', iem_nm: '가짜전자', sps_cd_krl_anm: '배당금입금', cur_cd: 'KRW', trd_amt: 846, tax_sum: 154 }]
          : [],
    },
  });
  handlers['/gbstock/inquiry/v1/dailyTransaction'] = () => ({
    body: { Output_0: [{ trd_dt: '20260512', iem_cd: 'AAPL', sps_cd_nm: '해외배당금입금', cur_cd_nm: 'USD', fc_trd_amt: 2.55, fc_tax_sum: 0.45 }] },
  });
  // 이전에 있던 NH 기록(다음 동기화에서 API에 없으면 지워져야 함)과 다른 증권사 기록(그대로 남아야 함)
  fs.writeFileSync(
    path.join(DATA_DIR, 'dividends.json'),
    JSON.stringify([
      { id: 'old-nh', broker: 'nh', accountId: LIVE, symbol: '000660', name: '옛기록', currency: 'KRW', amount: 1, tax: 0, paidDate: '2025-01-01', memo: null },
      { id: 'keep', broker: 'samsung', accountId: 'X', symbol: '005930', name: '삼성', currency: 'KRW', amount: 1, tax: 0, paidDate: '2025-01-01', memo: null },
    ])
  );

  const r = await syncNhDividends();
  assert.equal(r.broker, 'nh');
  assert.deepEqual([r.added, r.removed, r.total], [3, 1, 3], '일반 계좌 국내 1·해외 1 + 주문대리인 계좌 해외 1');
  assert.ok(calls.every((c) => c.host === 'api.nhplug.com:8443'), '모의투자 도메인은 부르지 않는다');
  assert.ok(!calls.some((c) => c.input?.act_no === MOCK), '모의투자 계좌는 조회하지 않는다');

  const all = listDividends();
  assert.ok(all.some((d) => d.id === 'keep'));
  assert.ok(!all.some((d) => d.id === 'old-nh'));
  const nh = all.filter((d) => d.broker === 'nh');
  assert.deepEqual(
    nh.map((d) => [d.accountId, d.symbol, d.currency, d.amount, d.tax]).sort(),
    [
      [AGENT, 'AAPL', 'USD', 2.55, 0.45],
      [LIVE, '005930', 'KRW', 846, 154],
      [LIVE, 'AAPL', 'USD', 2.55, 0.45],
    ].sort()
  );
});
