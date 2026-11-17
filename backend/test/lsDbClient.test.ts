import { readSecretJson, resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setCredentialFields } from '../src/credentials';
import { lsAdapter } from '../src/brokers/ls/lsAdapter';
import { LsApiError } from '../src/brokers/ls/lsClient';
import { syncLsDividends } from '../src/brokers/ls/lsDividendSync';
import { dbAdapter } from '../src/brokers/db/dbAdapter';
import { DbApiError } from '../src/brokers/db/dbClient';
import { classifyDbOverseasDividends, syncDbDividends } from '../src/brokers/db/dbDividendSync';
import { krSymbol, xNum } from '../src/brokers/xingFamily';
import { listDividends } from '../src/db/dividends';

// LS증권·DB증권 — 실키 없이 도는 테스트(2026-11-17, 두 회사 모두 실키 미확인). LS 응답은 **공식 TR 가이드의 응답 예시**
// (fixtures/ls-spec-examples.json — 계좌번호·계좌명은 가짜로 바꿈), 거래내역 줄은 예시가 비어 있어 명세 필드명으로 지어낸 값.
// DB 포털 예시는 실제 고객 데이터로 보이는 값이 있어 쓰지 않고, 명세 필드명으로 전부 지어낸 값이다. 실서버는 `check:ls`/`check:db`.

const LS_EX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ls-spec-examples.json'), 'utf-8')) as Record<string, any>;

interface Call { host: string; path: string; headers: Record<string, string>; body: any; form: URLSearchParams | null }
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };
type Handler = (call: Call, nth: number) => Reply;
let calls: Call[] = [];
let handlers: Record<string, Handler> = {};
let tokenSeq = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  const form = init?.body instanceof URLSearchParams ? init.body : null;
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  const call: Call = { host: u.host, path: u.pathname, headers, body, form };
  calls.push(call);
  const key = headers.tr_cd ? `${u.pathname}#${headers.tr_cd}` : u.pathname;
  const h = handlers[key];
  if (!h) return new Response(JSON.stringify({ rsp_cd: '99999', rsp_msg: `no handler ${key}` }), { status: 404 });
  const nth = calls.filter((c) => (c.headers.tr_cd ? `${c.path}#${c.headers.tr_cd}` : c.path) === key).length;
  const r = h(call, nth);
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'content-type': 'application/json', ...r.headers } });
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

const token = () => ({ body: { access_token: `tok-${++tokenSeq}`, token_type: 'Bearer', expires_in: 86400, scope: 'oob' } });
/** 요청 기간(YYYYMMDD) 안의 줄만 — 동기화가 1년씩 나눠 부른다. */
const inRange = (rows: Array<Record<string, any>>, from: string, to: string, key = 'TrdDt') => rows.filter((r) => r[key] >= from && r[key] <= to);
const ledgerRow = (o: Record<string, unknown>) => ({ TrdDt: '20260310', TrdNo: 1, SmryNm: '', IsuNo: '', IsuNm: '', TrdQty: 0, TrdUprc: 0, TrdAmt: 0, CmsnAmt: 0, TaxSumAmt: 0, MnyDvdAmt: 0, CrcyCode: 'KRW', ...o });

let keySeq = 0;
beforeEach(async () => {
  resetDataDir();
  calls = [];
  keySeq++;
  await setCredentialFields('ls', { appKey: `ls-key-${keySeq}`, appSecret: 'ls-secret' });
  await setCredentialFields('db', { appKey: `db-key-${keySeq}`, appSecret: 'db-secret', accountNumber: '123-45-678901' });
  handlers = {
    // LS — 경로가 같은 TR이 많아 tr_cd 헤더로 가른다.
    '/oauth2/token': token,
    '/stock/accno#CSPAQ12200': () => ({ body: LS_EX.CSPAQ12200 }),
    '/stock/accno#t0424': () => ({ body: LS_EX.t0424 }),
    '/overseas-stock/accno#COSOQ00201': () => ({ body: LS_EX.COSOQ00201 }),
    '/stock/accno#CDPCQ04700': () => ({ body: LS_EX.CDPCQ04700 }),
    // DB — 지어낸 값
    '/api/v1/trading/kr-stock/inquiry/balance': () => ({
      body: { rsp_cd: '00000', rsp_msg: '조회완료', Out: { TotBuyAmt: 1_000_000, TotEvalAmt: 1_100_000, TotEvalPnlAmt: 100_000, TotErnrat: '0.1000' }, Out1: [{ IsuNo: 'A005930', IsuNm: '가짜전자', BalQty: 10, BalQty0: 10, PchsAmt: 1_000_000, NowPrc: '110000.00', EvalAmt: 1_100_000, EvalPnlAmt: 100_000, Ernrat: '0.10000000', ExecPrc: '100000.00' }] },
    }),
    '/api/v1/trading/kr-stock/inquiry/acnt-deposit': () => ({ body: { rsp_cd: '00000', Out1: { DpsBalAmt: 50_000 } } }),
    '/api/v1/trading/overseas-stock/inquiry/balance-margin': () => ({
      body: { rsp_cd: '00000', Out1: [{ CrcyCode: 'USD', FcurrDps: '12.5000' }], Out2: [{ AstkIsuNo: 'T.US', SymCode: 'T', AstkHanglIsuNm: '가짜통신', CrcyCode: 'USD', AstkExecBaseQty: '10.000000', AstkAvrPchsPrc: '20.0000', AstkNowPrc: '25.0000', AstkBuyAmt: '200.0000', AstkEvalAmt: '250.0000', AstkEvalPnlAmt: '50.0000', EvalPnlRat: '25.00' }] },
    }),
    '/api/v1/trading/kr-stock/inquiry/trading-history': () => ({ body: { rsp_cd: '00000', Out: { AcntNm: '홍길동' }, Out1: [] } }),
    '/api/v1/trading/overseas-stock/inquiry/trading-history': () => ({ body: { rsp_cd: '00000', Out: [] } }),
    '/api/v1/trading/overseas-stock/inquiry/trade-history': () => ({ body: { rsp_cd: '00000', Out: [] } }),
  };
});
const at = (p: string, tr?: string) => calls.filter((c) => c.path === p && (!tr || c.headers.tr_cd === tr));

test('공용 숫자·종목코드: 숫자·소수 문자열·접두어·ISIN', () => {
  assert.equal(xNum('264000.00'), 264000);
  assert.equal(xNum(-1234), -1234);
  assert.equal(xNum('1,234'), 1234);
  assert.equal(xNum(''), 0);
  assert.equal(krSymbol('A005930'), '005930');
  assert.equal(krSymbol('KR7005930003'), '005930');
  assert.equal(krSymbol('Q500001'), '500001');
  assert.equal(krSymbol('005930'), '005930');
});

test('LS: 토큰은 form(appkey·appsecretkey·scope=oob)으로 한 번만, 계좌는 CSPAQ12200이 되돌려 준 AcntNo, 공식 예시로 보유·예수금 해석', async () => {
  const accounts = await lsAdapter.listAccounts({ forceRefresh: true });
  assert.deepEqual(accounts.map((a) => a.id), ['12345678901']);
  const p = await lsAdapter.getPortfolio('12345678901', { forceRefresh: true });
  const tok = at('/oauth2/token').filter((c) => c.host.includes('ls-sec'));
  assert.equal(tok.length, 1, '토큰은 한 번');
  assert.equal(tok[0].form?.get('appsecretkey'), 'ls-secret');
  assert.equal(tok[0].form?.get('scope'), 'oob');
  const t0424 = at('/stock/accno', 't0424')[0];
  assert.equal(t0424.headers.authorization, `Bearer tok-${tokenSeq}`);
  assert.equal(t0424.headers.tr_cont, 'N');
  assert.ok('t0424InBlock' in t0424.body, '요청 봉투 <TR>InBlock');
  const kr = p.positions.filter((x) => x.market === 'KR');
  assert.ok(kr.length > 0 && kr.every((x) => /^[0-9A-Z]{6}$/.test(x.symbol) && x.quantity > 0));
  assert.equal(p.totalPurchaseAmountKrw, LS_EX.t0424.t0424OutBlock.mamt);
  const tsla = p.positions.find((x) => x.symbol === 'TSLA');
  assert.ok(tsla, '해외 OutBlock4(배열로 온 블록) — 미국 종목');
  assert.equal(tsla!.quantity, 15);
  assert.equal(tsla!.currency, 'USD');
  assert.ok(Math.abs(tsla!.profitLossRate - 951 / 3300) < 1e-9, '수익률은 평가손익 ÷ 매입금액');
  assert.equal(typeof p.cashBalanceKrw, 'number');
  const stored = await readSecretJson<{ accessToken: string; keyHash: string }>('ls-token.json');
  assert.ok(stored.accessToken && !JSON.stringify(stored).includes('ls-key'), '토큰은 봉투 저장, 앱키 원문 없음');
});

test('LS: t0424는 본문 cts_expcode로 연속조회하고, 같은 값이 다시 오면 멈춘다', async () => {
  const page = (cts: string, code: string) => ({ ...LS_EX.t0424, t0424OutBlock: { ...LS_EX.t0424.t0424OutBlock, cts_expcode: cts }, t0424OutBlock1: [{ ...LS_EX.t0424.t0424OutBlock1[0], expcode: code }] });
  handlers['/stock/accno#t0424'] = (_c, nth) => ({ body: nth === 1 ? page('000660', '005930') : page('000660', '000660') });
  const p = await lsAdapter.getPortfolio('12345678901', { forceRefresh: true });
  const reqs = at('/stock/accno', 't0424');
  assert.equal(reqs.length, 2);
  assert.equal(reqs[1].body.t0424InBlock.cts_expcode, '000660');
  assert.equal(reqs[1].headers.tr_cont, 'Y');
  assert.deepEqual(p.positions.filter((x) => x.market === 'KR').map((x) => x.symbol), ['005930', '000660']);
});

test('LS: 거래내역(CDPCQ04700)은 헤더 tr_cont_key로 연속조회, 적요로 매수·매도, 해외 ISIN은 해외 잔고의 단축코드로', async () => {
  handlers['/stock/accno#CDPCQ04700'] = (_c, nth) =>
    nth === 1
      ? { body: { ...LS_EX.CDPCQ04700, rsp_cd: '00133', CDPCQ04700OutBlock3: [ledgerRow({ TrdNo: 1, SmryNm: '장내매수', IsuNo: 'KR7005930003', IsuNm: '가짜전자', TrdQty: 3, TrdUprc: 70000, TrdAmt: 210000, CmsnAmt: 30 })] }, headers: { tr_cont: 'Y', tr_cont_key: 'K1' } }
      : { body: { ...LS_EX.CDPCQ04700, CDPCQ04700OutBlock3: [ledgerRow({ TrdNo: 2, SmryNm: '해외주식매도', IsuNo: 'US88160R1014', TrdQty: 2, CrcyCode: 'USD', FcurrTrdAmt: '500.0000' }), ledgerRow({ TrdNo: 3, SmryNm: '장내매수취소', IsuNo: 'KR7005930003', TrdQty: 1 })] }, headers: { tr_cont: 'N', tr_cont_key: '' } };
  const trades = await lsAdapter.getTradeHistory!('12345678901', { from: '2026-03-01', to: '2026-03-31' }, { forceRefresh: true });
  const reqs = at('/stock/accno', 'CDPCQ04700');
  assert.equal(reqs.length, 2);
  assert.equal(reqs[1].headers.tr_cont_key, 'K1');
  assert.equal(reqs[0].body.CDPCQ04700InBlock1.QryTp, '3');
  assert.deepEqual(trades.map((t) => [t.symbol, t.side, t.currency, t.price]), [['005930', 'BUY', 'KRW', 70000], ['TSLA', 'SELL', 'USD', 250]]);
  assert.equal(trades[0].id, 'ls-20260310-1');
});

test('LS: rsp_cd가 0으로 시작하지 않으면 메시지를 담아 던지고, 00200(조회내역 없음)은 0건', async () => {
  handlers['/stock/accno#CDPCQ04700'] = () => ({ body: { rsp_cd: '00200', rsp_msg: '조회내역이 없습니다' } });
  assert.deepEqual(await lsAdapter.getTradeHistory!('12345678901', { from: '2026-01-01', to: '2026-01-31' }, { forceRefresh: true }), []);
  handlers['/stock/accno#t0424'] = () => ({ body: { rsp_cd: 'IGW00101', rsp_msg: '계좌 12345678901 오류' } });
  await assert.rejects(lsAdapter.getPortfolio('12345678901', { forceRefresh: true }), (e: unknown) => {
    assert.ok(e instanceof LsApiError);
    assert.match(e.message, /IGW00101/);
    assert.ok(!e.message.includes('12345678901'), '메시지의 계좌번호는 가린다');
    return true;
  });
});

test('LS: 배당 동기화 — 입출금 중 배당 줄(원화)만, 세후 = 정산금액, 달러 기록은 건드리지 않는다', async () => {
  const rows = [
    ledgerRow({ SmryNm: '배당금입금', IsuNo: 'KR7005930003', IsuNm: '가짜전자', MnyDvdAmt: 1000, TrdAmt: 1000, TaxSumAmt: 154, AdjstAmt: 846 }),
    ledgerRow({ SmryNm: '이체입금', TrdAmt: 500000 }),
  ];
  handlers['/stock/accno#CDPCQ04700'] = (c) => {
    const i = c.body.CDPCQ04700InBlock1;
    return { body: { ...LS_EX.CDPCQ04700, CDPCQ04700OutBlock3: inRange(rows, i.QrySrtDt, i.QryEndDt) } };
  };
  const r = await syncLsDividends();
  assert.equal(r.total, 1);
  const recs = listDividends().filter((d) => d.broker === 'ls');
  assert.deepEqual(recs.map((d) => [d.symbol, d.amount, d.tax, d.currency, d.accountId]), [['005930', 846, 154, 'KRW', '12345678901']]);
  assert.equal(at('/stock/accno', 'CDPCQ04700')[0].body.CDPCQ04700InBlock1.QryTp, '1');
});

test('DB: 계좌는 설정의 계좌번호, 봉투 {"In":…}, 국내·해외 보유·예수금 해석(수익률은 평가손익 ÷ 매입금액)', async () => {
  const accounts = await dbAdapter.listAccounts({ forceRefresh: true });
  assert.deepEqual(accounts.map((a) => a.id), ['123-45-678901']);
  const p = await dbAdapter.getPortfolio('123-45-678901', { forceRefresh: true });
  const bal = at('/api/v1/trading/kr-stock/inquiry/balance')[0];
  assert.deepEqual(bal.body, { In: { QryTpCode0: '0' } });
  assert.equal(bal.headers.cont_yn, 'N');
  assert.equal(at('/api/v1/trading/kr-stock/inquiry/acnt-deposit')[0].body.In && Object.keys(at('/api/v1/trading/kr-stock/inquiry/acnt-deposit')[0].body.In).length, 0, '입력 없는 TR도 {"In":{}}');
  const kr = p.positions.find((x) => x.symbol === '005930')!;
  assert.equal(kr.averagePurchasePrice, 100000, '평균단가 = 매입금액 ÷ 수량');
  assert.ok(Math.abs(kr.profitLossRate - 0.1) < 1e-9);
  const us = p.positions.find((x) => x.symbol === 'T')!;
  assert.equal(us.currency, 'USD');
  assert.ok(Math.abs(us.profitLossRate - 0.25) < 1e-9, '해외 EvalPnlRat(퍼센트)를 쓰지 않고 직접 계산');
  assert.equal(p.cashBalanceKrw, 50000);
  assert.equal(p.cashBalanceUsd, 12.5);
});

test('DB: 토큰 무효(IGW00121)면 한 번 재발급, 호출 초과는 재시도, 조회내역 없음(2679)은 0건, 그 밖의 rsp_cd는 던진다', async () => {
  handlers['/api/v1/trading/kr-stock/inquiry/balance'] = (c, nth) =>
    nth === 1 ? { status: 403, body: { rsp_cd: 'IGW00121', rsp_msg: '유효하지 않은 토큰' } } : { body: { rsp_cd: '00000', Out: { TotBuyAmt: 0 }, Out1: [] } };
  await dbAdapter.getPortfolio('123-45-678901', { forceRefresh: true });
  assert.equal(at('/oauth2/token').filter((c) => c.host.includes('dbsec')).length, 2, '처음 + 무효 뒤 재발급');
  handlers['/api/v1/trading/kr-stock/inquiry/trading-history'] = () => ({ body: { rsp_cd: '2679', rsp_msg: '조회내역이 없습니다' } });
  assert.deepEqual(await dbAdapter.getTradeHistory!('123-45-678901', { from: '2026-01-01', to: '2026-01-31' }, { forceRefresh: true }), []);
  handlers['/api/v1/trading/kr-stock/inquiry/balance'] = () => ({ body: { rsp_cd: '3024', rsp_msg: '계좌가 없습니다' } });
  await assert.rejects(dbAdapter.getPortfolio('123-45-678901', { forceRefresh: true }), (e: unknown) => e instanceof DbApiError && /3024/.test(e.message));
});

test('DB: 매매 — 국내는 계좌 거래내역(cont_key 연속조회), 미국은 CAZCQ00200(2 매수·1 매도)', async () => {
  handlers['/api/v1/trading/kr-stock/inquiry/trading-history'] = (_c, nth) =>
    nth === 1
      ? { body: { rsp_cd: '00000', Out1: [ledgerRow({ TrdNo: 7, SmryNm: '장내매수', IsuNo: 'A005930', IsuNm: '가짜전자', TrdQty: 2, TrdUprc: 70000, TrdAmt: 140000 })] }, headers: { cont_yn: 'Y', cont_key: 'C1' } }
      : { body: { rsp_cd: '00000', Out1: [] }, headers: { cont_yn: 'N', cont_key: '' } };
  handlers['/api/v1/trading/overseas-stock/inquiry/trading-history'] = () => ({
    body: { rsp_cd: '00000', Out: [{ OrdDt: '20260311', OrdNo: 9, SymCode: 'T', AstkIsuNo: 'T.US', AstkBnsTpCode: '2', AstkExecQty: '3.000000', AstkExecPrc: '25.0000', AstkExecAmt: '75.0000', AstkExecCmsn: '0.1000', CrcyCode: 'USD' }] },
  });
  const trades = await dbAdapter.getTradeHistory!('123-45-678901', { from: '2026-03-01', to: '2026-03-31' }, { forceRefresh: true });
  const ledger = at('/api/v1/trading/kr-stock/inquiry/trading-history');
  assert.equal(ledger.length, 2);
  assert.equal(ledger[1].headers.cont_key, 'C1');
  assert.equal(ledger[0].body.In.QryTp, '3');
  assert.deepEqual(trades.map((t) => [t.id, t.symbol, t.side, t.currency, t.amount]), [
    ['db-20260310-7', '005930', 'BUY', 'KRW', 140000],
    ['db-ovrs-20260311-9', 'T', 'BUY', 'USD', 75],
  ]);
});

test('DB: 해외 배당은 입금(세전)·세출금(원천세) 두 줄을 같은 날·종목끼리 짝지어 세후로, 국내·해외 모두 동기화', async () => {
  const ovrs = [
    { TrdDt: '20260401', SmryNm: '배당금입금(외화)', SymCode: 'T', AstkIsuNo: 'T.US', CrcyCode: 'USD', FcurrTrdAmt: '10.0000' },
    { TrdDt: '20260401', SmryNm: '배당세출금(외화)', SymCode: 'T', AstkIsuNo: 'T.US', CrcyCode: 'USD', FcurrTrdAmt: '1.5000' },
    { TrdDt: '20260402', SmryNm: '외화입금', CrcyCode: 'USD', FcurrTrdAmt: '100.0000' },
  ];
  assert.deepEqual(classifyDbOverseasDividends(ovrs).map((d) => [d.symbol, d.amount, d.tax, d.paidDate]), [['T', 8.5, 1.5, '2026-04-01']]);
  handlers['/api/v1/trading/overseas-stock/inquiry/trade-history'] = (c) => ({ body: { rsp_cd: '00000', Out: inRange(ovrs, c.body.In.QrySrtDt, c.body.In.QryEndDt) } });
  const kr = [ledgerRow({ SmryNm: '배당금입금', IsuNo: 'A005930', IsuNm: '가짜전자', TrdAmt: 2000, AdjstAmt: 2000, MnyDvdAmt: 2000 })];
  handlers['/api/v1/trading/kr-stock/inquiry/trading-history'] = (c) => ({ body: { rsp_cd: '00000', Out1: inRange(kr, c.body.In.QrySrtDt, c.body.In.QryEndDt) } });
  const r = await syncDbDividends();
  assert.equal(r.total, 2);
  const recs = listDividends().filter((d) => d.broker === 'db').map((d) => [d.symbol, d.currency, d.amount, d.accountId]).sort();
  assert.deepEqual(recs, [['005930', 'KRW', 2000, '123-45-678901'], ['T', 'USD', 8.5, '123-45-678901']]);
});
