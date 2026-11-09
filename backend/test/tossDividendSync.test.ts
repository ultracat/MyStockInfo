import { resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTossTransactions, toHeldShareClass, TAX_REFUND_MEMO } from '../src/brokers/toss/tossDividendSync';
import { classifyKisRights } from '../src/brokers/kis/kisDividendSync';
import type { TossTransaction } from '../src/brokers/toss/tossClient';
import type { KisPeriodRight } from '../src/brokers/kis/kisClient';
import { addDividend, listDividends, replaceSyncedDividends } from '../src/db/dividends';
import { setCredentialFields } from '../src/credentials';
import { isDividendSyncOwned } from '../src/brokers/rowOwnership';
import { importDividendsRecords } from '../src/routes/dividends';
import { cacheStockName } from '../src/db/stockNames';

beforeEach(() => resetDataDir());

// 거래 한 건을 만든다 — 테스트에 필요한 필드만 덮어쓴다(값은 모두 가상).
function tx(over: Partial<TossTransaction>): TossTransaction {
  return {
    transactionType: 'DIVIDEND',
    marketCountry: 'US',
    currency: 'USD',
    symbol: 'AAA',
    assetClass: 'STOCK',
    isinCode: null,
    amount: '1.00',
    tax: '0',
    netAmount: '1.00',
    exchangeRate: null,
    settlementDate: '2026-01-15',
    settled: true,
    transactionTime: '2026-01-15T10:00:00+09:00',
    isCancellation: false,
    ...over,
  };
}

test('토스 분류: 배당은 세후(netAmount)·세금·결제일, 메모 없음', () => {
  const { candidates } = classifyTossTransactions([
    tx({ currency: 'KRW', marketCountry: 'KR', symbol: '000001', amount: '19005', tax: '2920', netAmount: '16085' }),
  ]);
  assert.deepEqual(candidates, [
    { symbol: '000001', currency: 'KRW', amount: 16085, tax: 2920, paidDate: '2026-01-15', kind: 'dividend', memo: null },
  ]);
});

test('토스 분류: 종목 붙은 원화 입금은 국내 ETF 분배금, 달러 입금은 외화세금환급(메모)', () => {
  const { candidates } = classifyTossTransactions([
    tx({ transactionType: 'DEPOSIT', currency: 'KRW', symbol: '100000', netAmount: '160' }),
    tx({ transactionType: 'DEPOSIT', currency: 'USD', symbol: 'BBB', netAmount: '0.01' }),
  ]);
  assert.equal(candidates[0].kind, 'etfDistribution');
  assert.equal(candidates[0].memo, null);
  assert.equal(candidates[1].kind, 'taxRefund');
  assert.equal(candidates[1].memo, TAX_REFUND_MEMO);
});

test('토스 분류: 종목 없는 입금(은행 입금)·미결제·취소·다른 유형은 건너뛴다', () => {
  const r = classifyTossTransactions([
    tx({ transactionType: 'DEPOSIT', currency: 'KRW', symbol: null, netAmount: '1000000' }),
    tx({ settled: false }),
    tx({ isCancellation: true }),
    tx({ transactionType: 'INTEREST' }),
  ]);
  assert.equal(r.candidates.length, 0);
  assert.deepEqual(r.skipped, { unsettled: 1, cancellation: 1, other: 2 });
});

test('toHeldShareClass: API의 보통주 코드를 사용자가 보유·매매한 우선주 코드로 바꾼다', () => {
  assert.equal(toHeldShareClass('123450', new Set(['123455'])), '123455');
  // 보유·매매가 우선 — 배당 기록에 두 코드가 섞여 있어도 매매한 코드를 쓴다(실데이터 사례)
  assert.equal(toHeldShareClass('123450', new Set(['123455']), new Set(['123450', '123455'])), '123455');
  // 보유·매매에 없으면 배당 기록에서 찾는다
  assert.equal(toHeldShareClass('123450', new Set(), new Set(['123455'])), '123455');
  // 보통주·우선주를 둘 다 매매했으면 어느 쪽인지 알 수 없어 그대로 둔다
  assert.equal(toHeldShareClass('123450', new Set(['123450', '123455'])), '123450');
  // 해외 티커·모르는 종목은 그대로
  assert.equal(toHeldShareClass('AAPL', new Set(['AAPL1'])), 'AAPL');
  assert.equal(toHeldShareClass('123450', new Set()), '123450');
});

function right(over: Partial<KisPeriodRight>): KisPeriodRight {
  return {
    rght_type_cd: '32',
    bass_dt: '20260131',
    pdno: '000002',
    shtn_pdno: '000002',
    prdt_name: '가상 ETF',
    last_alct_amt: '1000',
    tax_amt: '0',
    cash_dfrm_dt: '20260203',
    ...over,
  };
}

test('KIS 분류: 세후 = 배정금액(세전) − 세금, 지급일은 현금지급일, 32는 ETF 분배금', () => {
  const { candidates } = classifyKisRights(
    [right({}), right({ rght_type_cd: '03', last_alct_amt: '8340', tax_amt: '1270', cash_dfrm_dt: '20260519' })],
    '2026-11-09'
  );
  assert.deepEqual(candidates[0], { symbol: '000002', name: '가상 ETF', amount: 1000, tax: 0, paidDate: '2026-02-03', kind: 'etfDistribution' });
  assert.equal(candidates[1].amount, 7070);
  assert.equal(candidates[1].tax, 1270);
  assert.equal(candidates[1].kind, 'dividend');
});

test('KIS 분류: 지급 예정(오늘 이후)·현금 배정 없는 권리는 넣지 않는다', () => {
  const r = classifyKisRights(
    [right({ cash_dfrm_dt: '20261127' }), right({ last_alct_amt: '0' }), right({ cash_dfrm_dt: '' })],
    '2026-11-09'
  );
  assert.equal(r.candidates.length, 0);
  assert.equal(r.upcoming, 1);
});

test('replaceSyncedDividends: 그 계좌 기록만 API 내용으로 교체하고, 같은 내용은 id를 이어받는다', () => {
  const kept = addDividend({ broker: 'kis', accountId: '11111111-01', symbol: 'X', name: 'x', currency: 'KRW', amount: 100, paidDate: '2026-01-01', tax: 0 });
  addDividend({ broker: 'kis', accountId: '11111111-01', symbol: 'TYPO', name: 't', currency: 'KRW', amount: 5, paidDate: '2026-01-02' });
  const other = addDividend({ broker: 'kb', accountId: 'K', symbol: 'Y', name: 'y', currency: 'KRW', amount: 7, paidDate: '2026-01-03' });

  const r = replaceSyncedDividends('kis', ({ accountId }) => accountId === '11111111-01', [
    { broker: 'kis', accountId: '11111111-01', symbol: 'X', name: 'x', currency: 'KRW', amount: 100, tax: 0, paidDate: '2026-01-01' },
    { broker: 'kis', accountId: '11111111-01', symbol: 'Z', name: 'z', currency: 'KRW', amount: 50, tax: 10, paidDate: '2026-02-01' },
  ]);
  assert.deepEqual(r, { added: 1, removed: 1, unchanged: 1 });
  const all = listDividends();
  assert.ok(all.some((d) => d.id === kept.id), '같은 내용은 id 유지');
  assert.ok(all.some((d) => d.id === other.id), '다른 증권사 기록은 그대로');
  assert.ok(!all.some((d) => d.symbol === 'TYPO'), 'API에 없는 기록은 지워짐');
  assert.equal(all.find((d) => d.symbol === 'Z')?.tax, 10);

  // 두 번 돌려도 바뀌는 것이 없다
  const again = replaceSyncedDividends('kis', ({ accountId }) => accountId === '11111111-01', [
    { broker: 'kis', accountId: '11111111-01', symbol: 'X', name: 'x', currency: 'KRW', amount: 100, tax: 0, paidDate: '2026-01-01' },
    { broker: 'kis', accountId: '11111111-01', symbol: 'Z', name: 'z', currency: 'KRW', amount: 50, tax: 10, paidDate: '2026-02-01' },
  ]);
  assert.deepEqual(again, { added: 0, removed: 0, unchanged: 2 });
});

test('KIS 동기화 소유는 원화 기록만 — 직접 적은 달러(미국 주식) 배당은 교체·가져오기 대상이 아니다', () => {
  setCredentialFields('kis', { appKey: 'k', appSecret: 's', accountNumber: '11111111', accountProductCode: '01' });
  assert.equal(isDividendSyncOwned({ broker: 'kis', currency: 'KRW' }), true);
  assert.equal(isDividendSyncOwned({ broker: 'kis', currency: 'USD' }), false);

  const usd = addDividend({ broker: 'kis', accountId: '11111111-01', symbol: 'USX', name: 'u', currency: 'USD', amount: 3, paidDate: '2026-01-01' });
  addDividend({ broker: 'kis', accountId: '11111111-01', symbol: 'OLD', name: 'o', currency: 'KRW', amount: 9, paidDate: '2026-01-01' });
  const r = replaceSyncedDividends(
    'kis',
    (rec) => rec.currency !== 'USD' && rec.accountId === '11111111-01',
    [{ broker: 'kis', accountId: '11111111-01', symbol: 'K', name: 'k', currency: 'KRW', amount: 10, tax: 0, paidDate: '2026-02-01' }]
  );
  assert.deepEqual(r, { added: 1, removed: 1, unchanged: 0 });
  const all = listDividends();
  assert.ok(all.some((d) => d.id === usd.id), '달러 기록은 남는다');
  assert.ok(!all.some((d) => d.symbol === 'OLD'), '원화 기록은 API 내용으로 교체');
});

test('가져오기: API 동기화 증권사(키가 있는 토스)의 배당 행은 건너뛰고, 전체 교체에서도 남긴다', async () => {
  setCredentialFields('toss', { clientId: 'test-id', clientSecret: 'test-secret' });
  cacheStockName({ symbol: 'MANUAL', name: '수동 종목', market: 'KR', currency: 'KRW', cachedAt: new Date().toISOString() });
  const synced = addDividend({ broker: 'toss', accountId: '1', symbol: 'SYNC', name: 's', currency: 'USD', amount: 1, paidDate: '2026-01-01' });

  const r = await importDividendsRecords(
    [
      { broker: 'toss', symbol: 'SYNC2', currency: 'USD', amount: 2, paidDate: '2026-01-05' },
      { broker: 'samsung', symbol: 'MANUAL', currency: 'KRW', amount: 300, paidDate: '2026-01-06', tax: '46' },
    ],
    { fullReplace: true }
  );
  assert.equal(r.skipped, 1);
  assert.equal(r.added, 1);
  const all = listDividends();
  assert.ok(all.some((d) => d.id === synced.id), '토스 기록은 시트 전체 교체에서도 남는다');
  assert.ok(!all.some((d) => d.symbol === 'SYNC2'), '토스 행은 가져오지 않는다');
  assert.equal(all.find((d) => d.symbol === 'MANUAL')?.tax, 46);
});
