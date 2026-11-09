import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mapNhDomesticPosition,
  mapNhDomesticTrades,
  mapNhOverseasPosition,
  mapNhOverseasTrades,
  nhDomesticSymbol,
  nhNum,
  nhTradeSide,
} from '../src/brokers/nh/nhMappers';
import { hasNextPage, rowsOf } from '../src/brokers/nh/nhClient';

// 가짜 응답은 www.nhplug.com/openapi-docs 명세(2026-11-06)의 필드명 그대로다 — 값은 지어낸 것.

test('NH 숫자: number·문자열(쉼표·앞자리 0·공백)·빈 값을 모두 읽는다', () => {
  assert.equal(nhNum(1234.5), 1234.5);
  assert.equal(nhNum('0001,234.50'), 1234.5);
  assert.equal(nhNum(' -12 '), -12);
  assert.equal(nhNum(''), 0);
  assert.equal(nhNum(null), 0);
  assert.equal(nhDomesticSymbol('A005930'), '005930');
  assert.equal(nhDomesticSymbol('0080G0'), '0080G0');
});

test('NH 국내 잔고: 매입금액 = 평가금액 − 평가손익, 수익률은 소수 비율', () => {
  const p = mapNhDomesticPosition({
    iem_cd: '005930', iem_nm: '가짜전자', itg_bnc_qty: 10, phs_pr: 50000, now_pr: 60000,
    eal_amt: 600000, eal_pls_amt: 100000, pft_rt: 20,
  });
  assert.equal(p.purchaseAmount, 500000);
  assert.equal(p.profitLossRate, 0.2);
  assert.equal(p.currency, 'KRW');
});

test('NH 해외 잔고: 외화 필드로 USD 보유를 만든다', () => {
  const p = mapNhOverseasPosition({
    iem_cd: 'aapl', iem_nm: '가짜', cns_bse_bnc_qty: 3, fc_avg_phs_pr: 100, fc_sec_end_pr: 120,
    fc_abk_amt: 300, fc_eal_amt: 360, fc_eal_pls_amt: 60, eal_pft_rt: 20,
  });
  assert.deepEqual([p.symbol, p.currency, p.purchaseAmount, p.marketValue, p.profitLossRate], ['AAPL', 'USD', 300, 360, 0.2]);
});

test('NH 적요로 매수/매도 판별 — 둘 다 없거나 둘 다 있으면 버린다', () => {
  assert.equal(nhTradeSide('장내매수'), 'BUY');
  assert.equal(nhTradeSide('코스닥매도'), 'SELL');
  assert.equal(nhTradeSide('대체입고'), null);
  assert.equal(nhTradeSide('매수매도정정'), null);
});

test('NH 국내 매매: 같은 날·종목·방향은 순번으로 id를 나누고, 외화·수량 0·매매 아님은 뺀다', () => {
  const base = { trd_dt: '20260105', iem_cd: 'A005930', iem_nm: '가짜전자', cur_cd: 'KRW', trd_uit_pr: 100, trd_amt: 1000 };
  const t = mapNhDomesticTrades([
    { ...base, sps_cd_krl_anm: '장내매수', trd_qty: 10, trd_orn_fee: 15, tax_sum: 0 },
    { ...base, sps_cd_krl_anm: '장내매수', trd_qty: 5 },
    { ...base, sps_cd_krl_anm: '장내매도', trd_qty: 5, tax_sum: 30 },
    { ...base, sps_cd_krl_anm: '대체입고', trd_qty: 5 },
    { ...base, sps_cd_krl_anm: '해외매수', trd_qty: 1, cur_cd: 'USD' },
    { ...base, sps_cd_krl_anm: '장내매수', trd_qty: 0 },
  ]);
  assert.deepEqual(t.map((x) => x.id), ['nh-2026-01-05-005930-BUY-1', 'nh-2026-01-05-005930-BUY-2', 'nh-2026-01-05-005930-SELL-1']);
  assert.equal(t[0].commission, 15);
  assert.equal(t[0].tax, null);
  assert.equal(t[2].tax, 30);
});

test('NH 해외 매매: 거래일련번호로 id, 달러가 아닌 통화는 뺀다', () => {
  const t = mapNhOverseasTrades(
    [
      { trd_dt: '20260105', trd_sno: 3, iem_cd: 'AAPL', trd_qty: 2, trd_uit_pr: 150, fc_trd_amt: 300, cur_cd_nm: 'USD' },
      { trd_dt: '20260105', trd_sno: 4, iem_cd: '7203', trd_qty: 100, trd_uit_pr: 2000, fc_trd_amt: 200000, cur_cd_nm: '일본엔' },
    ],
    'BUY'
  );
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].id, t[0].currency, t[0].amount], ['nh-ovrs-20260105-3', 'USD', 300]);
});

test('NH 연속조회 판정: 헤더 cts_flag, 플래그 없으면 응답코드, cts 없으면 끝', () => {
  assert.equal(hasNextPage({ cts: 'K1', ctsFlag: 'Y' }), true);
  assert.equal(hasNextPage({ cts: 'K1', ctsFlag: 'N' }), false);
  assert.equal(hasNextPage({ cts: null, ctsFlag: 'Y' }), false);
  assert.equal(hasNextPage({ cts: 'K1', ctsFlag: null, rspCd: '00165' }), true);
  assert.equal(hasNextPage({ cts: 'K1', ctsFlag: null, rspCd: '00000' }), false);
});

test('NH 응답 블록: 객체·배열·없음 모두 배열로', () => {
  assert.deepEqual(rowsOf({ Output_0: { a: 1 } }, 'Output_0'), [{ a: 1 }]);
  assert.deepEqual(rowsOf({ Output_1: [{ a: 1 }, null] }, 'Output_1'), [{ a: 1 }]);
  assert.deepEqual(rowsOf({}, 'Output_1'), []);
});
