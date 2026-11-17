import { resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAX_LIMITS, getPlanner, PlannerValidationError, updatePlanner } from '../src/db/planner';
import { maybeBackgroundDividendSync, notifyDividends, setNotifier } from '../src/alerts';
import type { DividendRecord } from '../src/db/dividends';

// 계획·목표 저장소(db/planner.ts)와 알림(alerts.ts) — 값은 지어낸 것.
beforeEach(() => resetDataDir());

test('planner: 기본값, 보낸 필드만 바뀌고 나머지는 그대로', () => {
  const p = getPlanner();
  assert.deepEqual(p.taxLimits, DEFAULT_TAX_LIMITS);
  assert.deepEqual(p.alerts, { targetPrice: true, dividendReceived: true, warnings: true });
  updatePlanner({ dividendGoalMonthlyKrw: 500000 });
  updatePlanner({ targets: [{ symbol: 'schd', name: 'SCHD', weight: 40 }] });
  const q = getPlanner();
  assert.equal(q.dividendGoalMonthlyKrw, 500000);
  assert.deepEqual(q.targets, [{ symbol: 'SCHD', name: 'SCHD', weight: 40 }]);
  updatePlanner({ alerts: { warnings: false } });
  assert.deepEqual(getPlanner().alerts, { targetPrice: true, dividendReceived: true, warnings: false });
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
