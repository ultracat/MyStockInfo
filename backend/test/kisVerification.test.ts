import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { checkKisDrift, describeKisResponse, mergeKisShapes, valueKind } from '../src/brokers/kis/kisResponseShape';
import { KIS_LIVE_FIELDS } from '../src/brokers/kis/kisSpec.gen';

// KIS API 검증 묶음(scripts/kis-verify.cjs, backend/CLAUDE.md "KIS API 검증 묶음")의 순수 부분 — 응답 모양 추출(값을 남기지 않음),
// 기록과의 차이 경고, 공식 예제 파일 해석. 실제 응답 기록·최신 예제 비교는 `npm run kis:record`·`kis:verify`(네트워크)가 한다.

const requireCjs = createRequire(__filename);
const { parseKisExample } = requireCjs(path.join(__dirname, '..', '..', 'scripts', 'lib', 'kis-catalog.cjs'));
const { diffCatalogs } = requireCjs(path.join(__dirname, '..', '..', 'scripts', 'kis-verify.cjs'));

test('응답 모양: 값은 버리고 블록별 필드 이름과 형태만 — 봉투(rt_cd·msg·연속조회 키)는 블록이 아니다', () => {
  const shape = describeKisResponse({
    rt_cd: '0',
    msg_cd: 'MCA00000',
    msg1: '정상처리 되었습니다.',
    ctx_area_fk100: '12345678^01^',
    output1: [
      { pdno: '005930', hldg_qty: '10', loan_dt: '' },
      { pdno: '000660', hldg_qty: '3', loan_dt: '' },
    ],
    output2: [{ dnca_tot_amt: '1234567' }],
    output3: [],
  });
  assert.deepEqual(Object.keys(shape).sort(), ['output1', 'output2', 'output3']);
  assert.deepEqual(shape.output1, { kind: 'array', seenRows: true, fields: { pdno: 'number', hldg_qty: 'number', loan_dt: 'empty' } });
  assert.equal(shape.output3.seenRows, false);
  const text = JSON.stringify(shape);
  for (const value of ['005930', '1234567', '12345678', '정상처리']) assert.ok(!text.includes(value), `값(${value})이 남으면 안 된다`);
});

test('값 형태: 빈 값 < 숫자 < 글자 — 합칠 때 더 일반적인 쪽으로', () => {
  assert.equal(valueKind(''), 'empty');
  assert.equal(valueKind('-00012.50'), 'number');
  assert.equal(valueKind('2026/11/17'), 'text');
  const merged = mergeKisShapes(
    { output: { kind: 'array', seenRows: false, fields: {} } },
    { output: { kind: 'array', seenRows: true, fields: { a: 'empty', b: 'number' } } }
  );
  const again = mergeKisShapes(merged, { output: { kind: 'array', seenRows: true, fields: { a: 'text', c: 'number' } } });
  assert.deepEqual(again.output, { kind: 'array', seenRows: true, fields: { a: 'text', b: 'number', c: 'number' } });
});

test('응답 변화 감지: 기록에 있던 필드가 빠지면 한 번만 경고하고, 새 필드만 생긴 건 경고하지 않는다', () => {
  const expected = (KIS_LIVE_FIELDS as Record<string, Record<string, readonly string[]>>).TTTC8434R?.output1;
  assert.ok(expected && expected.length > 5, '국내 잔고 output1 실측 기록이 있어야 한다(kis:record)');
  const fullRow = Object.fromEntries(expected.map((f) => [f, '1']));
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.join(' '));
  try {
    assert.deepEqual(checkKisDrift('TTTC8434R', { rt_cd: '0', output1: [{ ...fullRow, new_field: 'x' }] }), [], '새 필드만 → 문제 없음');
    const { hldg_qty: _dropped, ...withoutQty } = fullRow;
    const first = checkKisDrift('TTTC8434R', { rt_cd: '0', output1: [withoutQty] });
    checkKisDrift('TTTC8434R', { rt_cd: '0', output1: [withoutQty] });
    assert.equal(first.length, 1);
    assert.match(first[0], /output1: 빠짐 hldg_qty/);
    assert.equal(warned.length, 1, '같은 차이는 프로세스당 한 번만 경고');
    assert.ok(!warned[0].includes('"1"'), '경고에 값이 없다');
    assert.deepEqual(checkKisDrift('TTTC8434R', { rt_cd: '0', output1: [] }), [], '줄이 없으면 비교하지 않는다');
    assert.deepEqual(checkKisDrift('UNKNOWN1', { output: [{ a: '1' }] }), [], '기록이 없는 TR은 비교하지 않는다');
  } finally {
    console.warn = orig;
  }
});

test('공식 예제 해석: 머리 주석·주소·TR(실전·모의)·요청 파라미터·필수·블록·응답 필드', () => {
  const src = `
# [국내주식] 주문/계좌 > 주식잔고조회[v1_국내주식-006]
API_URL = "/uapi/domestic-stock/v1/trading/inquire-balance"
def inquire_balance(env_dv, cano, acnt_prdt_cd, inqr_dvsn, FK100=""):
    """
    Args:
        cano (str): [필수] 종합계좌번호
        inqr_dvsn (str): [필수] 조회구분
        FK100 (str): 연속조회검색조건100
    """
    if env_dv == "real":
        tr_id = "TTTC8434R"
    elif env_dv == "demo":
        tr_id = "VTTC8434R"
    params = {
        "CANO": cano,
        "INQR_DVSN": inqr_dvsn,
        "CTX_AREA_FK100": FK100
    }
    res = ka._url_fetch(API_URL, tr_id, tr_cont, params)
    current_data1 = pd.DataFrame(res.getBody().output1)
    current_data2 = pd.DataFrame([res.getBody().output2])
`;
  const chk = `COLUMN_MAPPING = {\n    'pdno': '상품번호',\n    "hldg_qty": "보유수량",\n}\n`;
  const api = parseKisExample(src, chk);
  assert.equal(api.title, '[국내주식] 주문/계좌 > 주식잔고조회[v1_국내주식-006]');
  assert.equal(api.url, '/uapi/domestic-stock/v1/trading/inquire-balance');
  assert.equal(api.method, 'GET');
  assert.deepEqual(api.trIds, ['TTTC8434R', 'VTTC8434R']);
  assert.deepEqual(api.params, ['CANO', 'CTX_AREA_FK100', 'INQR_DVSN']);
  assert.deepEqual(api.requiredParams, ['CANO', 'INQR_DVSN']);
  assert.deepEqual(api.blocks, ['output1', 'output2']);
  assert.deepEqual(api.fields, { pdno: '상품번호', hldg_qty: '보유수량' });
});

test('자동 업데이트: 쓰는 TR의 바뀐 점(주소·파라미터·필드·사라짐)과 나머지 API 추가·삭제·변경을 나눠 센다', () => {
  const api = (o: Record<string, unknown> = {}) => ({
    title: 't', url: '/a', method: 'GET', trIds: ['TR1'], params: ['A'], requiredParams: [], blocks: ['output'], fields: { f1: '필드1', f2: '필드2' }, ...o,
  });
  const before = {
    'x/used': api(),
    'x/gone': api({ trIds: ['TR2'] }),
    'x/other': api({ trIds: ['OT1'] }),
    'x/removed': api({ trIds: ['OT2'] }),
  };
  const after = {
    'x/used': api({ url: '/b', params: ['A', 'B'], fields: { f1: '필드1', f3: '필드3' } }),
    'x/other': api({ trIds: ['OT1'], fields: { f9: '' } }),
    'x/new': api({ trIds: ['OT3'] }),
  };
  const d = diffCatalogs(before, after, ['TR1', 'TR2']);
  assert.deepEqual(d.used.map((u: { tr: string }) => u.tr), ['TR1', 'TR2']);
  const tr1 = d.used[0].lines.join(' | ');
  assert.match(tr1, /주소: `\/a` → `\/b`/);
  assert.match(tr1, /params: 추가 `B`/);
  assert.match(tr1, /응답 필드: 빠짐 `f2` · 추가 `f3`/);
  assert.match(d.used[1].lines[0], /사라짐/);
  assert.deepEqual(d.other, { added: ['x/new'], removed: ['x/removed'], changed: ['x/other'] });
  assert.deepEqual(diffCatalogs(before, before, ['TR1']).used, [], '같으면 바뀐 게 없다');
});
