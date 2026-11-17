import { resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAX_LIMITS, getPlanner, PlannerValidationError, updatePlanner } from '../src/db/planner';
import { maybeBackgroundDividendSync, maybeWeeklySummary, notifyDividends, setNotifier, weeklySummaryText } from '../src/alerts';
import type { DividendRecord } from '../src/db/dividends';

// 계획·목표 저장소(db/planner.ts)와 알림(alerts.ts) — 값은 지어낸 것.
beforeEach(() => resetDataDir());

test('planner: 기본값, 보낸 필드만 바뀌고 나머지는 그대로', () => {
  const p = getPlanner();
  assert.deepEqual(p.taxLimits, DEFAULT_TAX_LIMITS);
  assert.deepEqual(p.alerts, { targetPrice: true, dividendReceived: true, warnings: true, weeklySummary: true });
  assert.equal(p.simulation, null);
  assert.deepEqual(p.savingsPlans, []);
  updatePlanner({ dividendGoalMonthlyKrw: 500000 });
  updatePlanner({ targets: [{ symbol: 'schd', name: 'SCHD', weight: 40 }] });
  const q = getPlanner();
  assert.equal(q.dividendGoalMonthlyKrw, 500000);
  assert.deepEqual(q.targets, [{ symbol: 'SCHD', name: 'SCHD', weight: 40 }]);
  updatePlanner({ alerts: { warnings: false } });
  assert.deepEqual(getPlanner().alerts, { targetPrice: true, dividendReceived: true, warnings: false, weeklySummary: true });
  updatePlanner({ taxLimits: { isaGeneral: 5_000_000 } });
  assert.equal(getPlanner().taxLimits.isaGeneral, 5_000_000);
  assert.equal(getPlanner().taxLimits.pensionTotal, DEFAULT_TAX_LIMITS.pensionTotal);
});

test('planner: 잘못된 값은 거절하고 저장하지 않는다', () => {
  assert.throws(() => updatePlanner({ targets: [{ symbol: 'A', weight: 120 }] }), PlannerValidationError);
  assert.throws(() => updatePlanner({ targets: [{ symbol: 'A', weight: 10 }, { symbol: 'a', weight: 10 }] }), PlannerValidationError);
  assert.throws(() => updatePlanner({ taxAccounts: [{ broker: 'nope', accountId: '1', contributions: {} }] }), PlannerValidationError);
  assert.throws(() => updatePlanner({ taxAccounts: [{ broker: 'kis', accountId: '1', openedOn: '2026/01/01', contributions: {} }] }), PlannerValidationError);
  assert.throws(() => updatePlanner({ dividendGoalMonthlyKrw: -1 }), PlannerValidationError);
  assert.deepEqual(getPlanner().targets, []);
  // 목표가가 둘 다 비면 그 종목은 지운다
  updatePlanner({ watchTargets: [{ symbol: 'AAA', above: 10, below: null }, { symbol: 'BBB', above: null, below: null }] });
  assert.deepEqual(getPlanner().watchTargets, [{ symbol: 'AAA', above: 10, below: null }]);
});

const div = (p: Partial<DividendRecord>): DividendRecord =>
  ({ id: 'x', broker: 'kis', accountId: '1', symbol: '123456', name: '가짜리츠', currency: 'KRW', amount: 10000, tax: 0, paidDate: '2026-11-17', memo: null, ...p }) as DividendRecord;

test('배당 알림: 최근 7일 지급분만, 4건 이상이면 한 번에, 끄면 안 알림', () => {
  const got: string[] = [];
  setNotifier((title, body) => void got.push(`${title}|${body}`));
  assert.equal(notifyDividends([div({}), div({ paidDate: '2026-10-01' })], '2026-11-17'), 1);
  assert.match(got[0], /배당 입금 — 가짜리츠\|10,000원/);
  got.length = 0;
  notifyDividends([div({}), div({}), div({}), div({ currency: 'USD', amount: 1.5 })], '2026-11-17');
  assert.deepEqual(got, ['배당 입금 4건|30,000원 · $1.50 (세후)']);
  updatePlanner({ alerts: { dividendReceived: false } });
  assert.equal(notifyDividends([div({})], '2026-11-17'), 0);
});

test('백그라운드 배당 동기화: 한국 시간 9~21시, 4시간 간격', async () => {
  const at = (iso: string) => Date.parse(iso);
  assert.equal(await maybeBackgroundDividendSync(at('2026-11-17T13:00:00Z')), false); // KST 22시
  assert.equal(await maybeBackgroundDividendSync(at('2026-11-17T01:00:00Z')), true); // KST 10시 — 연동 증권사가 없어 빈 동기화
  assert.equal(await maybeBackgroundDividendSync(at('2026-11-17T03:00:00Z')), false); // 2시간 뒤
  assert.equal(await maybeBackgroundDividendSync(at('2026-11-17T05:30:00Z')), true); // 4시간 반 뒤
});

test('planner: 시뮬레이션·적립 계획 저장과 검증', () => {
  const sim = { startKrw: null, monthlyKrw: 1000000, annualReturnPct: 6, dividendYieldPct: 3, reinvest: true, contributionGrowthPct: 0, inflationPct: 2.5, years: 20, targetAssetsKrw: null, targetMonthlyDividendKrw: 1000000 };
  updatePlanner({ simulation: sim });
  assert.deepEqual(getPlanner().simulation, sim);
  assert.throws(() => updatePlanner({ simulation: { ...sim, years: 100 } }), PlannerValidationError);
  assert.throws(() => updatePlanner({ simulation: { ...sim, annualReturnPct: 'x' } }), PlannerValidationError);
  updatePlanner({ savingsPlans: [{ symbol: 'aaa', name: 'AAA', monthlyKrw: 300000, startMonth: '2026-01' }] });
  assert.deepEqual(getPlanner().savingsPlans, [{ symbol: 'AAA', name: 'AAA', monthlyKrw: 300000, startMonth: '2026-01' }]);
  assert.throws(() => updatePlanner({ savingsPlans: [{ symbol: 'A', monthlyKrw: 1, startMonth: '2026-1' }] }), PlannerValidationError);
  updatePlanner({ simulation: null });
  assert.equal(getPlanner().simulation, null);
});

test('주간 요약 문구: 자산 변화·받은 배당·다음 주 예정·적립 남음', () => {
  const text = weeklySummaryText({
    today: '2026-11-20',
    snapshots: [
      { date: '2026-11-12', totalMarketValueKrw: 1000000, totalPurchaseAmountKrw: 0, totalProfitLossKrw: 0 },
      { date: '2026-11-13', totalMarketValueKrw: 1100000, totalPurchaseAmountKrw: 0, totalProfitLossKrw: 0 },
      { date: '2026-11-20', totalMarketValueKrw: 1050000, totalPurchaseAmountKrw: 0, totalProfitLossKrw: 0 },
    ],
    dividends: [div({ paidDate: '2026-11-17' }), div({ paidDate: '2026-11-01' }), div({ paidDate: '2026-11-18', currency: 'USD', amount: 2 })],
    upcoming: [{ payDate: '2026-11-25', grossAmount: 5000, currency: 'KRW' }, { payDate: '2026-12-25', grossAmount: 1, currency: 'KRW' }],
    savingsPlans: [{ symbol: 'A', name: '가짜A', monthlyKrw: 100000, startMonth: '2026-01' }, { symbol: 'B', name: '가짜B', monthlyKrw: 100000, startMonth: '2026-01' }],
    boughtThisMonthKrw: { B: 100000 },
  });
  assert.equal(text, '자산 -50,000원(11-13→11-20) · 배당 2건 10,000원·$2.00 · 다음 주 배당 예정 1건 5,000원(세전) · 이번 달 적립 남음: 가짜A');
  assert.equal(
    weeklySummaryText({ today: '2026-11-20', snapshots: [], dividends: [], upcoming: [], savingsPlans: [], boughtThisMonthKrw: {} }),
    '이번 주는 기록된 변화가 없습니다.'
  );
});

test('주간 요약: 금요일 18시(KST) 이후 하루 한 번, 끄면 안 보냄', async () => {
  const got: string[] = [];
  setNotifier((title) => void got.push(title));
  assert.equal(await maybeWeeklySummary(Date.parse('2026-11-20T08:00:00Z')), false); // 금 17시
  assert.equal(await maybeWeeklySummary(Date.parse('2026-11-20T09:30:00Z')), true); // 금 18시 30분
  assert.equal(await maybeWeeklySummary(Date.parse('2026-11-20T11:00:00Z')), false); // 같은 날 두 번째
  assert.equal(await maybeWeeklySummary(Date.parse('2026-11-21T09:30:00Z')), false); // 토요일
  assert.deepEqual(got, ['이번 주 요약']);
  updatePlanner({ alerts: { weeklySummary: false } });
  assert.equal(await maybeWeeklySummary(Date.parse('2026-11-27T09:30:00Z')), false);
});
