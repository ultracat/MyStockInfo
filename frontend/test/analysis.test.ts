import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetClassOf,
  benchmarkTable,
  closesToReturns,
  correlation,
  costByYear,
  diversification,
  holdingRisk,
  monthlyReturns,
  riskSummary,
} from '../src/calc/analysis';
import { scenarios, simulate, yearsToTarget } from '../src/calc/simulation';
import { yearEndPlan } from '../src/calc/yearEndTax';
import { savingsStatus } from '../src/calc/savings';
import { buildStockIndex, searchStocks } from '../src/calc/stockSearch';
import type { DividendRecord, StoredHolding, StoredTrade, WatchlistEntry } from '../src/types';
import type { FlatHolding } from '../src/calc/overview';

// 2026-11-17 두 번째 묶음(분석·시뮬레이션·절세·적립·검색)의 계산 — 값은 전부 지어낸 것.
const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≈ ${b}`);
let seq = 0;
const trade = (p: Partial<StoredTrade>): StoredTrade =>
  ({ id: `t${++seq}`, broker: 'toss', accountId: '1', symbol: 'A', name: 'A', side: 'BUY', quantity: 1, price: 100, amount: 100, currency: 'KRW', executedAt: '2026-10-05', commission: null, tax: null, ...p }) as StoredTrade;
const rec = (p: Partial<DividendRecord>): DividendRecord =>
  ({ id: `r${++seq}`, broker: 'kis', accountId: '1', symbol: 'A', name: 'A', currency: 'KRW', amount: 100, tax: null, paidDate: '2026-03-10', memo: null, ...p }) as DividendRecord;

// ---- 성과·위험 ----
test('월간 수익률: 투자금 변화를 빼고 전월 평가로 나눈다', () => {
  const r = monthlyReturns([
    { month: '2026-09', investedKrw: 1000, currentKrw: 1000 },
    { month: '2026-10', investedKrw: 1500, currentKrw: 1650 }, // 500 넣고 150 벌었다
    { month: '2026-11', investedKrw: 1500, currentKrw: 1485 },
  ] as never);
  assert.deepEqual(r.map((x) => x.month), ['2026-10', '2026-11']);
  near(r[0].r, 0.15);
  near(r[1].r, -0.1);
});

test('벤치마크 표: 기간이 다 덮이지 않으면 null, 겹친 기간 누적', () => {
  const mine = [
    { month: '2026-09', r: 0.1 },
    { month: '2026-10', r: 0.1 },
    { month: '2026-11', r: -0.1 },
  ];
  const kospi = closesToReturns([
    { month: '2026-08', close: 100 },
    { month: '2026-09', close: 110 },
    { month: '2026-10', close: 110 },
    { month: '2026-11', close: 121 },
  ]);
  const rows = benchmarkTable(mine, { KOSPI: kospi, SPY: kospi.slice(-1) }, 11);
  const three = rows.find((r) => r.months === 3)!;
  near(three.mine, 1.1 * 1.1 * 0.9 - 1);
  near(three.bench.KOSPI, 0.21);
  assert.equal(three.bench.SPY, null); // 1개월치뿐
  assert.equal(rows.find((r) => r.label === '올해')!.mine, null); // 11개월 필요
});

test('위험: 최대 낙폭·변동성·베타, 상관계수', () => {
  const mine = [0.1, -0.2, 0.05, 0.1].map((r, i) => ({ month: `2026-0${i + 1}`, r }));
  const s = riskSummary(mine, mine.map((x) => ({ ...x, r: x.r / 2 })));
  near(s.maxDrawdown, -0.2);
  near(s.betaKospi, 2);
  near(s.correlationKospi, 1);
  assert.equal(s.worst!.r, -0.2);
  assert.ok(s.volatility! > 0);
  near(correlation([1, 2, 3], [3, 2, 1]), -1);
  const closes = {
    X: ['01', '02', '03', '04', '05', '06', '07', '08'].map((m, i) => ({ month: `2026-${m}`, closePrice: 100 + i * (i % 2 ? 5 : -3), currency: 'KRW' })),
  };
  const h = holdingRisk([{ symbol: 'X', name: 'X' }, { symbol: 'Y', name: 'Y' }], closes);
  assert.equal(h.matrix[0][0], 1);
  assert.equal(h.matrix[0][1], null); // Y 자료 없음
  assert.equal(h.rows[0].months, 7);
});

// ---- 분산·비용 ----
test('자산군 짐작: 커버드콜·리츠·채권·현금성·원자재·주식', () => {
  assert.equal(assetClassOf('가짜 200위클리커버드콜'), '커버드콜·옵션');
  assert.equal(assetClassOf('가짜리츠'), '리츠·인프라');
  assert.equal(assetClassOf('iShares 7-10 Year Treasury Bond ETF'), '채권');
  assert.equal(assetClassOf('가짜 KOFR금리액티브'), '현금성');
  assert.equal(assetClassOf('가짜 금현물'), '원자재');
  assert.equal(assetClassOf('가짜전자'), '주식');
});

test('분산: 같은 종목 합쳐 HHI·실질 종목 수·상위 비중', () => {
  const h = (symbol: string, value: number, currency = 'KRW', broker = 'toss'): FlatHolding =>
    ({ broker, accountId: '1', symbol, name: symbol, currency, quantity: 1, lastPrice: value, purchaseAmount: value }) as FlatHolding;
  const d = diversification(
    [h('A', 500), h('A', 250, 'KRW', 'kis'), h('B', 250), h('C', 10, 'USD')],
    (v, c) => (c === 'USD' ? v * 25 : v),
    (b) => b,
    () => '일반계좌'
  );
  assert.equal(d.totalKrw, 1250);
  near(d.hhi, 0.6 ** 2 + 0.2 ** 2 + 0.2 ** 2);
  near(d.top1Pct, 60);
  assert.deepEqual(d.byCurrency.map((x) => x.label), ['원화(국내)', '달러(미국)']);
});

test('비용: 연도별 수수료·세금·배당 원천징수, 비용 정보 없는 거래 수', () => {
  const rows = costByYear(
    [trade({ amount: 10000, commission: 15, tax: 20 }), trade({ amount: 100, currency: 'USD', commission: 1, tax: null, executedAt: '2026-11-01' }), trade({ executedAt: '2025-01-01' })],
    [rec({ tax: 154, paidDate: '2026-03-10' })],
    () => 1000
  );
  const y = rows.find((r) => r.year === '2026')!;
  assert.deepEqual([y.tradedKrw, y.commissionKrw, y.tradeTaxKrw, y.dividendTaxKrw], [110000, 1015, 20, 154]);
  assert.equal(rows.find((r) => r.year === '2025')!.unknownTrades, 1);
  assert.equal(rows[0].year, '2026'); // 최근 연도부터
});

// ---- 시뮬레이션 ----
test('시뮬레이션: 수익률 0이면 넣은 돈 그대로, 재투자 안 하면 배당을 꺼낸다, 목표 도달 연도', () => {
  const base = { startKrw: 1000, monthlyKrw: 100, annualReturnPct: 0, dividendYieldPct: 0, reinvest: true, contributionGrowthPct: 0, inflationPct: 0, years: 2 };
  const r = simulate(base);
  assert.deepEqual(r.map((x) => [x.contributedKrw, x.valueKrw]), [[2200, 2200], [3400, 3400]]);
  const withDiv = simulate({ ...base, annualReturnPct: 4, dividendYieldPct: 4, dividendTaxPct: 0, monthlyKrw: 0, years: 1 });
  near(withDiv[0].valueKrw, 1040, 1);
  const paidOut = simulate({ ...base, annualReturnPct: 4, dividendYieldPct: 4, dividendTaxPct: 0, monthlyKrw: 0, reinvest: false, years: 1 });
  assert.ok(Math.abs(paidOut[0].valueKrw - 1000) <= 1); // 배당만큼 꺼내 가격 상승 0
  assert.ok(paidOut[0].dividendsKrw >= 39 && paidOut[0].dividendsKrw <= 41);
  assert.deepEqual(yearsToTarget(r, 3000, null, 0), { assets: 2, dividend: null });
  const sc = scenarios({ ...base, annualReturnPct: 5 });
  assert.deepEqual(sc.map((s) => s.returnPct), [3, 5, 7]);
  assert.ok(sc[0].rows[1].valueKrw < sc[2].rows[1].valueKrw);
});

// ---- 연말 절세 ----
test('연말 절세: 일반 계좌 해외 보유만, 손실 상계 절세액·남은 공제', () => {
  const h = (symbol: string, pl: number, accountId = 'gen', currency = 'USD') =>
    ({ broker: 'toss', accountId, symbol, name: symbol, currency, profitLossAmount: pl }) as StoredHolding;
  const p = yearEndPlan(4_500_000, [h('L', -1000), h('G', 500), h('ISA', -9999, 'isa'), h('K', -99999, 'gen', 'KRW')], (_b, a) => a === 'gen', 1000);
  assert.equal(p.taxNowKrw, 440_000); // (450만 − 250만) × 22%
  assert.deepEqual(p.losers, [{ symbol: 'L', name: 'L', lossKrw: 1_000_000 }]);
  assert.equal(p.harvestSavingKrw, 220_000); // 순이익 350만 → 세금 22만
  assert.equal(p.taxFreeRoomKrw, 0);
  assert.equal(yearEndPlan(-500_000, [], () => true, 1000).taxFreeRoomKrw, 3_000_000);
});

// ---- 적립식 ----
test('적립식: 달성·부족·누락·진행 중, 연속 달성, 이번 달 남은 금액', () => {
  const plan = { symbol: 'A', name: 'A', monthlyKrw: 100_000, startMonth: '2026-08' };
  const s = savingsStatus(
    [plan],
    [
      trade({ amount: 100_000, executedAt: '2026-08-10' }),
      trade({ amount: 50_000, executedAt: '2026-09-10' }),
      trade({ amount: 60_000, executedAt: '2026-11-03' }),
      trade({ amount: 99_000, executedAt: '2026-10-01', side: 'SELL' }),
    ],
    () => null,
    '2026-11-17'
  )[0];
  assert.deepEqual(s.months.map((m) => m.state), ['met', 'partial', 'missed', 'current']);
  assert.deepEqual([s.plannedKrw, s.boughtKrw, s.streak, s.thisMonthRemainingKrw], [300_000, 150_000, 0, 40_000]);
});

// ---- 검색 ----
test('종목 검색: 코드 일치 우선, 이름 일부, 빈 검색어는 보유·관심만', () => {
  const holding = { broker: 'toss', accountId: '1', symbol: '111110', name: '가짜전자', currency: 'KRW', quantity: 3, marketValue: 300, purchaseAmount: 200 } as StoredHolding;
  const watch = { symbol: 'XYZ', name: 'XYZ Corp', currency: 'USD', market: null, addedAt: '', lastPrice: 1 } as WatchlistEntry;
  const idx = buildStockIndex([holding], [watch], [rec({ symbol: '222220', name: '가짜리츠' })], [trade({ symbol: '111110' })]);
  assert.equal(idx.length, 3);
  assert.equal(idx.find((e) => e.symbol === '111110')!.trades.length, 1);
  assert.deepEqual(searchStocks(idx, '').map((e) => e.symbol), ['111110', 'XYZ']);
  assert.deepEqual(searchStocks(idx, '리츠').map((e) => e.symbol), ['222220']);
  assert.equal(searchStocks(idx, 'xyz')[0].symbol, 'XYZ');
});
