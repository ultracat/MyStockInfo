import { api } from '../../api';
import { effectiveRate, toKrw as fxToKrw } from '../../fx';
import { holdingsFailureMessage, loadAllHoldings, resetAllHoldingsCache } from '../../allHoldings';
import { localToday } from '../../format';
import type { AccountLabel, DividendRecord, SnapshotRecord, StoredTrade } from '../../types';
import type { FlatHolding, IndexCloses, MonthlyCloses } from '../../calc/overview';

/**
 * 대시보드 데이터의 **공용 저장소**(2026-11-17) — 전 증권사·전 계좌 보유종목, 배당, 매매내역, 환율, 순자산 기록, 월별 종가, 배당 지급월
 * 평균 환율, 지수 월말 종가, 계좌 별칭. 대시보드(Overview.tsx)와 분석(Analysis.tsx)이 같은 데이터를 쓰는데 예전엔 화면마다
 * `useOverviewData`가 따로 전부 받았다(분석을 처음 열면 대시보드가 받은 걸 처음부터 또 받음). 이제 이 모듈이 한 벌만 들고 있고
 * 화면은 `useSyncExternalStore`로 구독한다(useOverviewData.ts).
 *
 * 규칙:
 * - `reload()`는 진행 중인 받기가 있으면 그걸 같이 기다린다(두 화면이 동시에 다시 보여도 한 번만). `maxAgeMs` 안에 받았으면 다시 안 받는다.
 * - `forceRefresh`(새로고침 버튼)는 백엔드 30초 캐시를 건너뛴다 — 진행 중인 일반 받기가 있으면 끝난 뒤 한 번 더 받는다.
 * - 월별 종가·월평균 환율은 화면을 막지 않게 뒤에서 채운다(늦게 온 옛 응답은 버림 — 요청 번호). 순자산 기록은 받을 때마다 오늘 날짜로 덮어쓴다.
 * - 실패해도 이전 값을 지운 채 비우지 않는다(`error`만 채움).
 */
export interface OverviewState {
  /** 한 번도 다 받지 못했으면 true(첫 화면 "불러오는 중"). */
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  lastLoadedAt: Date | null;
  holdings: FlatHolding[];
  totalPurchaseKrw: number;
  totalMarketKrw: number;
  unconvertedUsdHoldings: boolean;
  dividends: DividendRecord[];
  trades: StoredTrade[];
  accountLabels: AccountLabel[];
  netWorthSnapshots: SnapshotRecord[];
  manualFxRate: number | null;
  liveFxRate: number | null;
  monthlyClosePrices: MonthlyCloses;
  loadingClosePrices: boolean;
  monthlyAvgFxRates: Record<string, { rate: number; sampleCount: number } | null>;
  indexCloses: IndexCloses;
}

const INITIAL: OverviewState = {
  loading: true,
  refreshing: false,
  error: null,
  lastLoadedAt: null,
  holdings: [],
  totalPurchaseKrw: 0,
  totalMarketKrw: 0,
  unconvertedUsdHoldings: false,
  dividends: [],
  trades: [],
  accountLabels: [],
  netWorthSnapshots: [],
  manualFxRate: null,
  liveFxRate: null,
  monthlyClosePrices: {},
  loadingClosePrices: false,
  monthlyAvgFxRates: {},
  indexCloses: {},
};

let state: OverviewState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<OverviewState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getOverviewState(): OverviewState {
  return state;
}

export function subscribeOverview(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** 테스트용 — 저장소를 처음 상태로. */
export function resetOverviewStore(): void {
  state = INITIAL;
  inflight = null;
  resetAllHoldingsCache();
  closeRequestId = 0;
  fxRequestId = 0;
  listeners.forEach((l) => l());
}

// ---- 뒤에서 채우는 것(화면을 막지 않음) ----------------------------------------------------------------------------------

let closeRequestId = 0;
async function loadMonthlyClosePrices(heldSymbols: Set<string>, allTrades: StoredTrade[]) {
  const requestId = ++closeRequestId;
  const tradedSymbols = [...new Set(allTrades.map((t) => t.symbol))].filter((s) => heldSymbols.has(s));
  if (tradedSymbols.length === 0) {
    if (requestId === closeRequestId) set({ monthlyClosePrices: {}, loadingClosePrices: false });
    return;
  }
  set({ loadingClosePrices: true });
  const closePrices = await api.getMonthlyClosePrices(tradedSymbols).catch(() => ({}));
  if (requestId === closeRequestId) set({ monthlyClosePrices: closePrices, loadingClosePrices: false });
}

let fxRequestId = 0;
async function loadMonthlyAvgFxRates(divs: DividendRecord[]) {
  const requestId = ++fxRequestId;
  const months = [...new Set(divs.filter((d) => d.currency === 'USD').map((d) => d.paidDate.slice(0, 7)))];
  if (months.length === 0) {
    if (requestId === fxRequestId) set({ monthlyAvgFxRates: {} });
    return;
  }
  const rates = await api.getMonthlyAvgUsdKrwRates(months).catch(() => ({}));
  if (requestId === fxRequestId) set({ monthlyAvgFxRates: rates });
}

// ---- 한 번 받기 -----------------------------------------------------------------------------------------------------------

async function fetchAll(opts: { forceRefresh?: boolean; skipCache?: boolean }): Promise<void> {
  // 보유·환율은 리밸런싱·보고서와 같은 `loadAllHoldings`(allHoldings.ts — 진행 중 공유, 30초 재사용, 새로고침이면 건너뜀) 한 경로로(2026-11-18).
  // 환율을 같이 받아 합계에 바로 쓴다(렌더 시점 state를 읽으면 첫 진입에 달러가 "환율 미적용"으로 빠졌다 — 예전 버그).
  const [all, divs, allTrades, labels] = await Promise.all([
    loadAllHoldings(opts),
    api.listDividends(),
    api.listTradesStore(),
    api.listAccountLabels().catch(() => state.accountLabels),
  ]);
  const manualRate = all.manualFxRate;
  const resolvedLiveFxRate = all.liveFxRate;
  const resolvedFxRate = effectiveRate(manualRate, resolvedLiveFxRate);
  const toKrwNow = (amount: number, currency: string | null) => fxToKrw(amount, currency, resolvedFxRate);

  const flat: FlatHolding[] = [];
  let purchaseKrw = 0;
  let marketKrw = 0;
  let unconverted = false;
  for (const r of all.lines) {
    flat.push({
      broker: r.broker,
      accountId: r.accountId,
      symbol: r.symbol,
      name: r.name,
      currency: r.currency,
      quantity: r.quantity,
      lastPrice: r.lastPrice,
      purchaseAmount: r.purchaseAmount,
    });
    const pv = toKrwNow(r.purchaseAmount, r.currency);
    const mv = toKrwNow(r.marketValue, r.currency);
    if (pv === null || mv === null) {
      unconverted = true;
      continue;
    }
    purchaseKrw += pv;
    marketKrw += mv;
  }
  // 증권사나 계좌 하나가 실패해도 나머지는 보여 주고 알린다. 합계가 줄어든 값이라 그날 순자산 기록은 남기지 않는다.
  const partialError = holdingsFailureMessage(all);

  set({
    holdings: flat,
    totalPurchaseKrw: purchaseKrw,
    totalMarketKrw: marketKrw,
    unconvertedUsdHoldings: unconverted,
    manualFxRate: manualRate,
    liveFxRate: resolvedLiveFxRate,
    dividends: divs,
    trades: allTrades,
    accountLabels: labels,
    lastLoadedAt: new Date(),
    error: partialError,
  });

  const heldSymbols = new Set(flat.filter((h) => h.quantity > 0).map((h) => h.symbol));
  void loadMonthlyClosePrices(heldSymbols, allTrades);
  void loadMonthlyAvgFxRates(divs);
  // 지수 월말 종가(백엔드 4시간 캐시) — 실패하면 이전 값
  void api
    .getIndexMonthly(13)
    .then((r) => set({ indexCloses: r }))
    .catch(() => {});
  // 순자산 기록 — 오늘 날짜로 덮어쓴다(서버 upsert). 실패해도 이력 조회는 따로 한다.
  void (async () => {
    try {
      if (partialError) throw new Error('일부 증권사·계좌 실패 — 기록 건너뜀');
      // 환율이 없어 달러 보유가 합계에서 빠졌으면(unconverted) 그 값도 줄어든 합계다 — 순자산 기록을 남기지 않는다.
      if (unconverted) throw new Error('환율 없음 — 기록 건너뜀');
      await api.capturePortfolioSnapshot({
        date: localToday(),
        totalMarketValueKrw: marketKrw,
        totalPurchaseAmountKrw: purchaseKrw,
        totalProfitLossKrw: marketKrw - purchaseKrw,
      });
    } catch {
      // 기존 이력은 그대로 보여 준다
    }
    try {
      set({ netWorthSnapshots: await api.listPortfolioSnapshots() });
    } catch {
      // 카드가 "기록 없음"으로 남을 뿐
    }
  })();
}

let inflight: { promise: Promise<void>; force: boolean } | null = null;

/**
 * 받기 — 진행 중이면 같이 기다리고, `maxAgeMs` 안에 받은 적이 있으면 건너뛴다. 실패는 `error`에 담고 던지지 않는다.
 * `forceRefresh`면 진행 중인 일반 받기가 끝난 뒤 캐시를 건너뛰고 한 번 더 받는다.
 */
export async function reloadOverview(opts: { forceRefresh?: boolean; maxAgeMs?: number } = {}): Promise<void> {
  const force = !!opts.forceRefresh;
  if (inflight) {
    if (!force || inflight.force) return inflight.promise;
    await inflight.promise.catch(() => {});
  }
  if (!force && opts.maxAgeMs !== undefined && state.lastLoadedAt && Date.now() - state.lastLoadedAt.getTime() < opts.maxAgeMs) return;
  const promise = (async () => {
    set({ refreshing: !state.loading });
    try {
      // 나이 제한 없이 부른 받기(데이터가 바뀐 뒤 등)는 보유 30초 재사용도 건너뛴다
      await fetchAll({ forceRefresh: force, skipCache: opts.maxAgeMs === undefined });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false, refreshing: false });
      inflight = null;
    }
  })();
  inflight = { promise, force };
  return promise;
}
