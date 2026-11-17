import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDrift, describeResponse, observeResponses, noteResponse } from '../src/brokers/responseShape';
import { tossPathTemplate } from '../src/brokers/toss/tossCore';

// 증권사 공통 응답 모양(brokers/responseShape.ts) — 본문 모양이 증권사마다 달라도(중첩·최상위 요약·봉투) 블록이 맞게 나뉘고,
// 값은 어디에도 남지 않는지. 실제 응답 기록은 각 실서버 점검의 `-- --record`가 한다.

const noValues = (shape: unknown, values: string[]) => {
  const text = JSON.stringify(shape);
  for (const v of values) assert.ok(!text.includes(v), `값(${v})이 남으면 안 된다`);
};

test('토스: result 아래 중첩 객체·배열을 경로 블록으로 나눈다', () => {
  const body = {
    result: {
      totalPurchaseAmount: { krw: '6500000', usd: '1553' },
      items: [{ symbol: '005930', quantity: '100', marketValue: { amount: '7200000' } }],
    },
  };
  const s = describeResponse(body, 'toss');
  assert.deepEqual(Object.keys(s).sort(), ['result', 'result.items', 'result.items.marketValue', 'result.totalPurchaseAmount']);
  assert.equal(s['result'].fields.items, 'array');
  assert.deepEqual(s['result.items'].fields, { symbol: 'number', quantity: 'number', marketValue: 'object' });
  noValues(s, ['6500000', '005930', '7200000']);
});

test('NH·키움·KB: 봉투는 빼고, 최상위 요약은 $ 블록, 목록·Record1은 따로', () => {
  const nh = describeResponse({ rsp_cd: '00000', rsp_msg: '조회 완료', Output_0: { dca: 1000 }, Output_1: [] }, 'nh');
  assert.deepEqual(Object.keys(nh).sort(), ['Output_0', 'Output_1']);
  assert.equal(nh.Output_1.seenRows, false);
  assert.deepEqual(nh.Output_0.fields, { dca: 'number' });

  const kw = describeResponse({ return_code: 0, return_msg: '정상', tot_pur_amt: '000000017598258', acnt_evlt_remn_indv_tot: [{ stk_cd: 'A005930' }] }, 'kiwoom');
  assert.deepEqual(kw.$.fields, { tot_pur_amt: 'number' });
  assert.deepEqual(kw.acnt_evlt_remn_indv_tot.fields, { stk_cd: 'text' });

  const kb = describeResponse({ dataHeader: { ipAddr: '127.0.0.1' }, dataBody: { tl_data_cnt: '1', Record1: [{ is_cd: '005930', hld_q: '3' }] } }, 'kb');
  assert.deepEqual(Object.keys(kb).sort(), ['dataBody', 'dataBody.Record1', 'dataHeader']);
  assert.deepEqual(kb['dataBody.Record1'].fields, { is_cd: 'number', hld_q: 'number' });
  noValues([nh, kw, kb], ['17598258', 'A005930', '127.0.0.1', '조회 완료']);
});

test('응답 변화 감지(공통): 기록된 필드가 빠지면 경고, 새 필드만이면 조용히', () => {
  const expected = { 'result.items': ['symbol', 'quantity'] };
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(' '));
  try {
    assert.deepEqual(checkDrift('toss', 'X', { result: { items: [{ symbol: 'A', quantity: '1', extra: '' }] } }, expected), []);
    const msgs = checkDrift('toss', 'X', { result: { items: [{ symbol: 'A', qty: '1' }] } }, expected);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0], /result\.items: 빠짐 quantity \/ 새로 생김 qty/);
    assert.equal(warned.length, 1);
  } finally {
    console.warn = orig;
  }
});

test('관찰자: noteResponse가 증권사·키와 함께 본문을 넘기고, 해제하면 더 안 받는다', () => {
  const seen: string[] = [];
  const off = observeResponses((b, key) => void seen.push(`${b}:${key}`));
  noteResponse('nh', '/krstock/inquiry/v1/balance', { Output_0: {} });
  off();
  noteResponse('nh', '/krstock/inquiry/v1/balance', { Output_0: {} });
  assert.deepEqual(seen, ['nh:/krstock/inquiry/v1/balance']);
});

test('토스 경로 이름: 쿼리를 떼고 종목·섹터 경로 변수를 {…}로', () => {
  assert.equal(tossPathTemplate('/api/v1/holdings'), '/api/v1/holdings');
  assert.equal(tossPathTemplate('/api/v1/prices?symbols=AAPL'), '/api/v1/prices');
  assert.equal(tossPathTemplate('/api/v1/stocks/AAPL/warnings'), '/api/v1/stocks/{symbol}/warnings');
  assert.equal(tossPathTemplate('/api/v1/sectors/S1/etfs?marketCountry=KR'), '/api/v1/sectors/{sectorId}/etfs');
  assert.equal(tossPathTemplate('/api/v1/market-calendar/KR'), '/api/v1/market-calendar/KR');
});
