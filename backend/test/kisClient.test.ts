import { DATA_DIR, readJson, resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCredentialFields } from '../src/credentials';
import { KisApiError, fetchKisPeriodRights } from '../src/brokers/kis/kisClient';
import { kisAdapter } from '../src/brokers/kis/kisAdapter';

// 한국투자증권 클라이언트의 HTTP 흐름을 가짜 서버(fetch 대체)로 확인한다 — 실키 없이 도는 테스트.
// 요청 모양(TR ID·헤더·쿼리)은 koreainvestment/open-trading-api 공식 예제 기준, 응답은 그 필드명으로 지은 가짜 값.
// 실서버 대상 점검은 scripts/kis-live-check.cjs(`npm run check:kis`).
// ⚠ KIS 토큰은 하루 1회만 발급된다 — 그래서 "파일에 저장한 토큰을 재사용하는지"가 가장 중요한 확인 항목이다.

interface Call {
  path: string;
  headers: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
}
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Handler = (call: Call, nth: number) => Reply;

let calls: Call[] = [];
let handlers: Record<string, Handler> = {};
let tokenSeq = 0;

const ok = (extra: Record<string, unknown>) => ({ rt_cd: '0', msg_cd: 'KIOK0000', msg1: '정상처리 되었습니다.', ...extra });

const BALANCE = '/uapi/domestic-stock/v1/trading/inquire-balance';
const OVERSEAS_BALANCE = '/uapi/overseas-stock/v1/trading/inquire-present-balance';
const DAILY_CCLD = '/uapi/domestic-stock/v1/trading/inquire-daily-ccld';
const OVERSEAS_CCNL = '/uapi/overseas-stock/v1/trading/inquire-ccnl';
const PERIOD_RIGHTS = '/uapi/domestic-stock/v1/trading/period-rights';

const defaultHandlers = (): Record<string, Handler> => ({
  '/oauth2/tokenP': () => ({ body: { access_token: `kis-tok-${++tokenSeq}`, token_type: 'Bearer', expires_in: 86400 } }),
  [BALANCE]: () => ({
    body: ok({
      output1: [
        { pdno: '005930', prdt_name: '가짜전자', hldg_qty: '10', ord_psbl_qty: '10', pchs_avg_pric: '50000', pchs_amt: '500000', prpr: '60000', evlu_amt: '600000', evlu_pfls_amt: '100000', evlu_pfls_rt: '20.00' },
      ],
      output2: [{ pchs_amt_smtl_amt: '500000', evlu_amt_smtl_amt: '600000', evlu_pfls_smtl_amt: '100000', scts_evlu_amt: '600000', dnca_tot_amt: '12345', tot_evlu_amt: '612345' }],
    }),
  }),
  [OVERSEAS_BALANCE]: () => ({
    body: ok({
      output1: [{ pdno: 'AAPL', prdt_name: '가짜애플', cblc_qty13: '2', avg_unpr3: '150', ovrs_now_pric1: '180', frcr_pchs_amt: '300', frcr_evlu_amt2: '360', evlu_pfls_amt2: '60', evlu_pfls_rt1: '20', buy_crcy_cd: 'USD' }],
      output2: [{ crcy_cd: 'USD', frcr_dncl_amt_2: '42.5' }],
    }),
  }),
  [DAILY_CCLD]: () => ({ body: ok({ output1: [] }) }),
  [OVERSEAS_CCNL]: () => ({ body: ok({ output: [] }) }),
});

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  const body = typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : null;
  const call: Call = { path: u.pathname, headers, query: u.searchParams, body };
  calls.push(call);
  const h = handlers[u.pathname];
  if (!h) return new Response(JSON.stringify({ rt_cd: '1', msg1: `no handler ${u.pathname}` }), { status: 404 });
  const nth = calls.filter((c) => c.path === u.pathname).length;
  const r = h(call, nth);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } });
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

let keySeq = 0;
beforeEach(() => {
  resetDataDir();
  calls = [];
  handlers = defaultHandlers();
  setCredentialFields('kis', { appKey: `kis-app-${++keySeq}`, appSecret: 'kis-secret', accountNumber: '12345678', accountProductCode: '01' });
});
const pathCalls = (p: string) => calls.filter((c) => c.path === p);

test('KIS 토큰: 파일(kis-token.json)에 저장된 유효 토큰이 있으면 발급하지 않는다(하루 1회 제한 보호)', async () => {
  // 앱 재시작 직후 상황 — 메모리 캐시는 비었고 파일만 있다. 다른 테스트가 메모리에 토큰을 남겼을 수 있어
  // 파일 토큰을 그보다 늦게 만료되게 써서, 어느 쪽이든 "새 발급 0회"를 확인한다.
  fs.writeFileSync(path.join(DATA_DIR, 'kis-token.json'), JSON.stringify({ accessToken: 'from-file', expiresAt: Date.now() + 3600_000 }));
  await kisAdapter.getPortfolio('12345678-01', { forceRefresh: true });
  assert.equal(pathCalls('/oauth2/tokenP').length, 0, '토큰을 새로 받지 않는다');
  assert.match(pathCalls(BALANCE)[0].headers.authorization, /^Bearer /);
});

test('KIS 토큰: 만료됐으면 한 번 발급해 파일에 저장, 동시에 들어온 호출들도 발급은 한 번만 한다', async () => {
  fs.writeFileSync(path.join(DATA_DIR, 'kis-token.json'), JSON.stringify({ accessToken: 'expired', expiresAt: Date.now() - 1000 }));
  // 메모리 캐시를 무효로 만들려면 401을 한 번 받아 강제 재발급 경로를 타게 한다.
  handlers[BALANCE] = (call, nth) => (nth === 1 ? { status: 401, body: { rt_cd: '1', msg1: '기간이 만료된 token 입니다.' } } : defaultHandlers()[BALANCE](call, nth));
  await Promise.all([
    kisAdapter.getPortfolio('12345678-01', { forceRefresh: true }),
    kisAdapter.getPortfolio('12345678-01', { forceRefresh: true }),
  ]);
  const tokenCalls = pathCalls('/oauth2/tokenP');
  assert.equal(tokenCalls.length, 1, '동시 호출도 발급은 한 번');
  assert.deepEqual(
    { grant: tokenCalls[0].body?.grant_type, key: tokenCalls[0].body?.appkey, secret: tokenCalls[0].body?.appsecret },
    { grant: 'client_credentials', key: `kis-app-${keySeq}`, secret: 'kis-secret' }
  );
  const stored = readJson<{ accessToken: string; expiresAt: number }>('kis-token.json');
  assert.equal(stored.accessToken, `kis-tok-${tokenSeq}`);
  assert.ok(stored.expiresAt > Date.now() + 23 * 3600_000);
});

test('KIS 조회 헤더: appkey·appsecret·tr_id·custtype=P·Bearer, 잔고 TR(TTTC8434R) 필수 쿼리', async () => {
  await kisAdapter.getPortfolio('12345678-01', { forceRefresh: true });
  const c = pathCalls(BALANCE)[0];
  assert.equal(c.headers.appkey, `kis-app-${keySeq}`);
  assert.equal(c.headers.appsecret, 'kis-secret');
  assert.equal(c.headers.tr_id, 'TTTC8434R');
  assert.equal(c.headers.custtype, 'P');
  assert.equal(c.query.get('CANO'), '12345678');
  assert.equal(c.query.get('ACNT_PRDT_CD'), '01');
  assert.equal(c.query.get('INQR_DVSN'), '01');
  assert.equal(pathCalls(OVERSEAS_BALANCE)[0].headers.tr_id, 'CTRP6504R');
});

test('KIS 잔고 매핑: 퍼센트 수익률을 소수로, 예수금 dnca_tot_amt, 미국 보유·달러 예수금', async () => {
  const p = await kisAdapter.getPortfolio('12345678-01', { forceRefresh: true });
  assert.equal(p.cashBalanceKrw, 12345);
  assert.equal(p.cashBalanceUsd, 42.5);
  assert.equal(p.totalPurchaseAmountKrw, 500000);
  assert.equal(p.profitLossRate, 0.2);
  assert.deepEqual(
    p.positions.map((x) => [x.symbol, x.currency, x.profitLossRate]),
    [['005930', 'KRW', 0.2], ['AAPL', 'USD', 0.2]]
  );
  assert.equal(p.totalMarketValueUsd, 360);
});

test('KIS 해외 잔고가 실패해도 국내 보유는 보여준다', async () => {
  handlers[OVERSEAS_BALANCE] = () => ({ body: { rt_cd: '1', msg_cd: 'OPSQ0001', msg1: '해외 오류' } });
  const p = await kisAdapter.getPortfolio('12345678-01', { forceRefresh: true });
  assert.equal(p.positions.length, 1);
  assert.equal(p.cashBalanceUsd, null);
  assert.equal(p.totalMarketValueUsd, null);
});

test('KIS 업무 오류(rt_cd≠0)는 msg_cd를 담은 KisApiError — 라우트가 502로 바꾸는 모양', async () => {
  handlers[BALANCE] = () => ({ body: { rt_cd: '1', msg_cd: 'OPSQ0002', msg1: '계좌번호를 확인하세요' } });
  await assert.rejects(kisAdapter.getPortfolio('12345678-01', { forceRefresh: true }), (err: unknown) => {
    assert.ok(err instanceof KisApiError);
    assert.match(err.message, /OPSQ0002/);
    assert.equal(typeof err.status, 'number');
    assert.match(err.body, /계좌번호/);
    return true;
  });
});

test('KIS 초당 건수 초과(EGW00201)는 쉬었다가 같은 호출을 재시도한다(HTTP 500으로 와도)', async () => {
  handlers[BALANCE] = (call, nth) =>
    nth === 1 ? { status: 500, body: { rt_cd: '1', msg_cd: 'EGW00201', msg1: '초당 거래건수를 초과하였습니다.' } } : defaultHandlers()[BALANCE](call, nth);
  const p = await kisAdapter.getPortfolio('12345678-01', { forceRefresh: true });
  assert.equal(p.positions.length, 2);
  assert.equal(pathCalls(BALANCE).length, 2);
});

test('KIS 매매내역: 3개월 이전/이내 TR 분할, tr_cont=M이면 ctx_area 키로 다음 페이지, 체결수량 0·국내/해외 합치기', async () => {
  const day = (offsetDays: number) => new Date(Date.now() - offsetDays * 864e5).toISOString().slice(0, 10);
  handlers[DAILY_CCLD] = (call, nth) => {
    const tr = call.headers.tr_id;
    if (tr === 'TTTC0081R' && !call.query.get('CTX_AREA_FK100')) {
      return {
        body: ok({ output1: [{ ord_dt: '20260105', odno: '0001', pdno: '005930', prdt_name: '가짜전자', sll_buy_dvsn_cd: '02', tot_ccld_qty: '3', avg_prvs: '100', tot_ccld_amt: '300' }], ctx_area_fk100: 'FK1', ctx_area_nk100: 'NK1' }),
        headers: { tr_cont: 'M' },
      };
    }
    if (tr === 'TTTC0081R') {
      return { body: ok({ output1: [{ ord_dt: '20260106', odno: '0002', pdno: '005930', prdt_name: '가짜전자', sll_buy_dvsn_cd: '01', tot_ccld_qty: '0', avg_prvs: '0', tot_ccld_amt: '0' }] }), headers: { tr_cont: 'D' } };
    }
    return { body: ok({ output1: [{ ord_dt: '20250105', odno: '0009', pdno: '000660', prdt_name: '가짜하이', sll_buy_dvsn_cd: '01', tot_ccld_qty: '1', avg_prvs: '10', tot_ccld_amt: '10' }] }) };
  };
  handlers[OVERSEAS_CCNL] = () => ({
    body: ok({ output: [{ ord_dt: '20260107', odno: '7', pdno: 'AAPL', prdt_name: '가짜애플', sll_buy_dvsn_cd: '02', ft_ccld_qty: '1', ft_ccld_unpr3: '200', ft_ccld_amt3: '200', tr_crcy_cd: 'USD' }] }),
  });
  const t = await kisAdapter.getTradeHistory!('12345678-01', { from: day(200), to: day(0) }, { forceRefresh: true });

  const trs = pathCalls(DAILY_CCLD).map((c) => c.headers.tr_id);
  assert.ok(trs.includes('CTSC9215R') && trs.includes('TTTC0081R'), '3개월 이전·이내 TR을 나눠 부른다');
  const second = pathCalls(DAILY_CCLD).find((c) => c.query.get('CTX_AREA_FK100') === 'FK1');
  assert.ok(second, '다음 페이지는 직전 ctx_area 키로');
  assert.equal(second!.headers.tr_cont, 'N');
  assert.equal(pathCalls(OVERSEAS_CCNL)[0].headers.tr_id, 'TTTS3035R');
  assert.deepEqual(
    t.map((x) => [x.id, x.side, x.currency]).sort(),
    [['0001', 'BUY', 'KRW'], ['0009', 'SELL', 'KRW'], ['ovrs-20260107-7', 'BUY', 'USD']].sort(),
    '체결수량 0은 뺀다, 해외는 접두어 id'
  );
});

test('KIS 권리현황(배당 원천): 연속조회 끝까지, CTRGA011R', async () => {
  handlers[PERIOD_RIGHTS] = (call, nth) =>
    nth === 1
      ? { body: ok({ output: [{ pdno: '005930', last_alct_amt: '1000' }], ctx_area_fk100: 'A', ctx_area_nk100: 'B' }), headers: { tr_cont: 'F' } }
      : { body: ok({ output: [{ pdno: '000660', last_alct_amt: '500' }] }) };
  const rows = await fetchKisPeriodRights();
  assert.equal(rows.length, 2);
  assert.equal(pathCalls(PERIOD_RIGHTS)[0].headers.tr_id, 'CTRGA011R');
  assert.equal(pathCalls(PERIOD_RIGHTS)[1].query.get('CTX_AREA_NK100'), 'B');
});
