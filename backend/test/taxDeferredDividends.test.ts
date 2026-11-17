import { resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyKisRights } from '../src/brokers/kis/kisDividendSync';
import { classifyLedgerDividends } from '../src/brokers/xingFamily';
import { isTaxDeferredAccount, upsertAccountTaxType } from '../src/db/accountTaxTypes';

// ISA·연금저축·IRP 계좌의 배당은 원천징수가 없다 — KIS 권리현황(CTRGA011R)은 그런 계좌에도 계산상 세금(tax_amt)을 주지만
// 실제 입금은 세전 그대로다(2026-11-17 사용자 ISA 계좌로 확인). 아래 값은 지어낸 것이다(세전 10,000원, 15.4% 세금 1,540원).
// 예전 코드는 계좌 종류와 상관없이 세전 − 세금으로 적어 15.4%씩 적게 잡았다.

beforeEach(() => resetDataDir());

const right = (o: Record<string, string> = {}) =>
  ({ rght_type_cd: '32', bass_dt: '20261113', pdno: '123456', shtn_pdno: '123456', prdt_name: '가짜리츠', last_alct_amt: '10000', tax_amt: '1540', cash_dfrm_dt: '20261117', ...o }) as never;

test('계좌 세금 유형: ISA·연금저축·IRP는 세금 이연, 일반·미등록은 아니다', () => {
  upsertAccountTaxType('kis', '11111111-01', 'ISA');
  upsertAccountTaxType('kis', '22222222-01', 'GENERAL');
  upsertAccountTaxType('ls', '33333333301', 'PENSION_SAVINGS');
  upsertAccountTaxType('db', '123-45-678901', 'IRP');
  assert.equal(isTaxDeferredAccount('kis', '11111111-01'), true);
  assert.equal(isTaxDeferredAccount('kis', '22222222-01'), false);
  assert.equal(isTaxDeferredAccount('kis', '99999999-01'), false, '등록 안 된 계좌는 일반');
  assert.equal(isTaxDeferredAccount('ls', '33333333301'), true);
  assert.equal(isTaxDeferredAccount('db', '123-45-678901'), true);
});

test('KIS: ISA 계좌는 세전 그대로 실수령·세금 0, 일반 계좌는 세전 − 세금', () => {
  const isa = classifyKisRights([right()], '2026-11-17', { taxDeferred: true }).candidates[0];
  assert.deepEqual([isa.amount, isa.tax], [10000, 0]);
  const general = classifyKisRights([right()], '2026-11-17').candidates[0];
  assert.deepEqual([general.amount, general.tax], [8460, 1540]);
});

test('LS·DB 계좌 거래내역: 세금 이연 계좌는 정산금액·세금 칸과 상관없이 세전 그대로', () => {
  const row = { TrdDt: '20261117', SmryNm: '배당금입금', IsuNo: 'A123456', IsuNm: '가짜리츠', MnyDvdAmt: 10000, TrdAmt: 10000, TaxSumAmt: 1540, AdjstAmt: 8460, CrcyCode: 'KRW' };
  assert.deepEqual(classifyLedgerDividends([row], { taxDeferred: true }).map((d) => [d.amount, d.tax]), [[10000, 0]]);
  assert.deepEqual(classifyLedgerDividends([row]).map((d) => [d.amount, d.tax]), [[8460, 1540]]);
});
