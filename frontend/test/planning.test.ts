import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarEntries, calendarGrid, monthsFrom, projectionRows, rowsKrw, shiftMonth } from '../src/calc/projection';
import { isaStatuses, pensionStatus, withAccountPlan } from '../src/calc/taxAccounts';
import { rebalance } from '../src/calc/rebalance';
import { flowsFromMonthlyNet, xirr } from '../src/calc/xirr';
import { dividendYields, fxEffect, lookThrough, usdCostBasis } from '../src/calc/insights';
import { buildReport } from '../src/calc/report';
import type { DividendRecord, StoredHolding, StoredTrade, TaxLimits, UpcomingDividend } from '../src/types';
import type { RealizedSale } from '../src/calc/realizedGains';

// 2026-11-17 추가 기능(12개월 예상·달력, ISA·연금 한도, 리밸런싱, XIRR, 환율 효과·ETF 겹침·배당수익률, 보고서)의 계산 — 값은 전부 지어낸 것.

let seq = 0;
const rec = (p: Partial<DividendRecord>): DividendRecord =>
  ({ id: `r${++seq}`, broker: 'kis', accountId: '1', symbol: 'A', name: 'A', currency: 'KRW', amount: 1000, tax: null, paidDate: '2026-11-10', memo: null, ...p }) as DividendRecord;
const up = (p: Partial<UpcomingDividend>): UpcomingDividend =>
  ({ status: 'projected', broker: 'kis', accountId: '1', symbol: 'A', name: 'A', currency: 'KRW', payDate: '2026-12-15', recordDate: null, quantity: 1, perShare: null, grossAmount: 1000, tax: null, source: 'history', ...p }) as UpcomingDividend;
const trade = (p: Partial<StoredTrade>): StoredTrade =>
  ({ id: `t${++seq}`, broker: 'toss', accountId: '1', symbol: 'X', name: 'X', side: 'BUY', quantity: 10, price: 10, amount: 100, currency: 'USD', executedAt: '2026-01-10', commission: null, tax: null, ...p }) as StoredTrade;

// ---- 12개월 예상·달력 ----
test('monthsFrom·shiftMonth: 해를 넘기고 거꾸로도', () => {
  assert.deepEqual(monthsFrom('2026-11-17', 3), ['2026-11', '2026-12', '2027-01']);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
});

test('projectionRows: n칸 모두 채우고, 이번 달 받은 것 + 기간 안 예상(세후)만', () => {
  const r = projectionRows([up({}), up({ payDate: '2028-01-05' })], [rec({}), rec({ paidDate: '2025-11-10' })], '2026-11-17', 12);
  assert.equal(r.received.length, 12);
  assert.deepEqual(r.received[0], { month: '2026-11', totalKrw: 1000, totalUsd: 0, count: 1 });
  assert.deepEqual(r.expected, [{ month: '2026-12', totalKrw: 846, totalUsd: 0, count: 1 }]);
  assert.deepEqual(rowsKrw([{ month: '2026-12', totalKrw: 100, totalUsd: 2, count: 1 }], () => 1000), { krw: 2100, unconvertedUsd: 0 });
  assert.deepEqual(rowsKrw([{ month: '2026-12', totalKrw: 0, totalUsd: 2, count: 1 }], () => null), { krw: 0, unconvertedUsd: 2 });
});

test('달력: 2026-11은 일요일 시작 30일(5주), 날짜별 받은·다가오는 배당', () => {
  const g = calendarGrid('2026-11');
  assert.equal(g.length % 7, 0);
  assert.equal(g[0], '2026-11-01');
  assert.equal(g.filter(Boolean).length, 30);
  const m = calendarEntries([rec({ paidDate: '2026-11-10' })], [up({ payDate: '2026-11-20', tax: 0 }), up({ payDate: null })], '2026-11');
  assert.deepEqual([...m.keys()].sort(), ['2026-11-10', '2026-11-20']);
  assert.equal(m.get('2026-11-20')![0].net, 1000); // 세금 0(ISA 등)이면 세전 그대로
});

// ---- ISA·연금 ----
const LIMITS: TaxLimits = { isaGeneral: 2_000_000, isaSeomin: 4_000_000, isaAnnualContribution: 20_000_000, pensionSavings: 6_000_000, pensionTotal: 9_000_000 };
const sale = (p: Partial<RealizedSale>): RealizedSale =>
  ({ date: '2026-03-01', broker: 'kis', accountId: 'isa', symbol: 'A', name: 'A', quantity: 1, currency: 'KRW', proceedsKrw: 0, costKrw: 0, gainKrw: 1_500_000, ...p }) as RealizedSale;

test('ISA: 가입일부터의 매매 + 배당(세전)이 한도를 넘는 몫 × 9.9%, 평가손익은 따로', () => {
  const holdings = [{ broker: 'kis', accountId: 'isa', currency: 'KRW', profitLossAmount: 300_000 } as StoredHolding];
  const plans = [{ broker: 'kis' as const, accountId: 'isa', isaType: 'GENERAL' as const, openedOn: '2025-01-01', contributions: { '2026': 5_000_000 } }];
  const [s] = isaStatuses(
    [{ broker: 'kis', accountId: 'isa', taxType: 'ISA' }],
    plans,
    LIMITS,
    [sale({}), sale({ date: '2024-06-01', gainKrw: 9_000_000 })], // 가입 전 매도는 빠진다
    [rec({ accountId: 'isa', amount: 800_000, tax: 0 })],
    holdings,
    (d) => d.accountId,
    () => null,
    '2026',
    '2026-11'
  );
  assert.equal(s.netIncomeKrw, 2_300_000);
  assert.equal(s.overKrw, 300_000);
  assert.equal(s.estimatedTaxKrw, 29_700);
  assert.equal(s.unrealizedKrw, 300_000);
  assert.equal(s.contributionThisYear, 5_000_000);
});

test('연금: 연금저축은 600만원까지, IRP 합쳐 900만원까지 공제', () => {
  const accounts = [
    { broker: 'kb', accountId: 'p', taxType: 'PENSION_SAVINGS' as const },
    { broker: 'kb', accountId: 'i', taxType: 'IRP' as const },
  ];
  let plans = withAccountPlan([], { broker: 'kb', accountId: 'p', contributions: { '2026': 7_000_000 } });
  plans = withAccountPlan(plans, { broker: 'kb', accountId: 'i', contributions: { '2026': 2_000_000 } });
  const s = pensionStatus(accounts, plans, LIMITS, '2026');
  assert.equal(s.deductibleKrw, 8_000_000); // 600 + 200
  assert.equal(s.totalRoom, 1_000_000);
  assert.equal(s.savingsRoom, 0);
  assert.equal(s.creditLowIncome, 1_320_000);
  plans = withAccountPlan(plans, { broker: 'kb', accountId: 'i', contributions: { '2026': 5_000_000 } });
  assert.equal(pensionStatus(accounts, plans, LIMITS, '2026').deductibleKrw, 9_000_000);
});

// ---- 리밸런싱 ----
test('리밸런싱: 목표 종목끼리만, 합이 100이 아니면 비례, 매수만 배분은 부족분 비율', () => {
  const h = (symbol: string, value: number, currency = 'KRW', price = 100) => ({ symbol, name: symbol, currency, quantity: value / price, lastPrice: price, marketValue: value });
  const r = rebalance([h('A', 600), h('B', 200), h('C', 200), h('U', 1, 'USD', 1)], [{ symbol: 'A', name: 'A', weight: 25 }, { symbol: 'B', name: 'B', weight: 25 }], null, 400);
  assert.equal(r.baseKrw, 1200); // A+B 800 + 추가 400
  assert.deepEqual(r.unconverted, ['U']);
  const a = r.rows.find((x) => x.symbol === 'A')!;
  const b = r.rows.find((x) => x.symbol === 'B')!;
  assert.equal(a.targetPct, 50);
  assert.equal(a.diffKrw, 0);
  assert.equal(b.diffKrw, 400);
  assert.equal(b.diffShares, 4);
  assert.equal(b.buyOnlyKrw, 400);
  assert.equal(r.rows.find((x) => x.symbol === 'C')!.targetPct, null); // 목표 없음 = 유지
});

// ---- XIRR ----
test('XIRR: 1년 뒤 10% → 0.10, 흐름 한쪽뿐이면 null', () => {
  const r = xirr([{ date: '2025-01-01', amount: -1000 }, { date: '2026-01-01', amount: 1100 }])!;
  assert.ok(Math.abs(r - 0.1) < 1e-4);
  assert.equal(xirr([{ date: '2025-01-01', amount: -1000 }]), null);
  const flows = flowsFromMonthlyNet([{ month: '2025-01', netKrw: 1000 }], 1100, '2026-01-15');
  assert.deepEqual(flows, [{ date: '2025-01-15', amount: -1000 }, { date: '2026-01-15', amount: 1100 }]);
});

// ---- 분석 ----
test('환율 효과: 원화 손익 = 주가 효과 + 환율 효과, 내역으로 수량이 안 맞으면 뺀다', () => {
  const trades = [trade({ executedAt: '2026-01-10', quantity: 10, amount: 100 }), trade({ symbol: 'Y', quantity: 5, amount: 50 })];
  const holdings = [
    { symbol: 'X', name: 'X', currency: 'USD', quantity: 10, lastPrice: 12, purchaseAmount: 100 },
    { symbol: 'Y', name: 'Y', currency: 'USD', quantity: 9, lastPrice: 10, purchaseAmount: 90 },
  ];
  const r = fxEffect(holdings, trades, () => 1300, 1400);
  assert.deepEqual(r.unknown, ['Y']);
  const [x] = r.rows;
  assert.equal(x.purchaseFx, 1300);
  assert.equal(x.priceEffectKrw, 28_000); // (120 − 100) × 1400
  assert.equal(x.fxEffectKrw, 10_000); // 100 × (1400 − 1300)
  assert.equal(x.totalKrw, 120 * 1400 - 100 * 1300);
  const sold = usdCostBasis([...trades, trade({ side: 'SELL', quantity: 5, amount: 60 })], () => 1300).get('X')!;
  assert.deepEqual([sold.qty, sold.costUsd], [5, 50]);
});

test('ETF 겹침: 직접 + ETF 몫 합치기, 상위 밖은 ETF 기타', () => {
  const r = lookThrough(
    [{ symbol: 'S', name: 'S', valueKrw: 100 }, { symbol: 'E', name: 'E', valueKrw: 1000 }],
    { E: [{ symbol: 'S', name: 'S', weight: 30 }, { symbol: 'T', name: 'T', weight: 50 }] }
  );
  const s = r.rows.find((x) => x.symbol === 'S')!;
  assert.deepEqual([s.directKrw, s.viaEtfKrw, s.totalKrw], [100, 300, 400]);
  assert.equal(r.etfOtherKrw, 200);
  assert.equal(r.totalKrw, 1100);
});

test('배당수익률: 최근 12개월(세전)/매입·평가, 전년 대비', () => {
  const rows = dividendYields(
    [{ symbol: 'A', name: 'A', costKrw: 10_000, valueKrw: 20_000 }],
    [rec({ paidDate: '2026-06-01', amount: 846, tax: 154 }), rec({ paidDate: '2025-06-01', amount: 500, tax: 0 }), rec({ symbol: 'Z' })],
    () => null,
    '2026-11-17'
  );
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].trailingKrw, rows[0].priorKrw, rows[0].yoc, rows[0].currentYield, rows[0].growth], [1000, 500, 10, 5, 100]);
});

// ---- 보고서 ----
test('보고서: 기간 안 배당·매매·실현손익(세제혜택 계좌 제외)·순자산 변화', () => {
  const r = buildReport(
    {
      period: '2026',
      dividends: [rec({ paidDate: '2026-03-01' }), rec({ paidDate: '2025-12-31' }), rec({ currency: 'USD', amount: 2, paidDate: '2026-04-01' })],
      trades: [trade({ executedAt: '2026-02-01' }), trade({ side: 'SELL', executedAt: '2026-05-01', currency: 'KRW', amount: 5000 })],
      sales: [sale({ accountId: 'gen', currency: 'USD', gainKrw: 3_000_000 }), sale({})],
      snapshots: [
        { date: '2026-01-02', totalMarketValueKrw: 1000, totalPurchaseAmountKrw: 0, totalProfitLossKrw: 0 },
        { date: '2026-11-17', totalMarketValueKrw: 1500, totalPurchaseAmountKrw: 0, totalProfitLossKrw: 0 },
      ],
      rateFor: () => 1000,
    },
    (_b, a) => a === 'isa'
  );
  assert.equal(r.dividends.totalKrw, 3000);
  assert.equal(r.dividends.count, 2);
  assert.deepEqual([r.trades.buyKrw, r.trades.sellKrw], [100_000, 5000]);
  assert.equal(r.realized.overseasKrw, 3_000_000);
  assert.equal(r.realized.estimatedOverseasTaxKrw, 110_000);
  assert.equal(r.netWorth.changeKrw, 500);
});
