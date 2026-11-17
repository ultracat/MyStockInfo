import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { effectiveRate, toKrw as fxToKrw } from '../../fx';
import { RESUME_REFRESH_MS, useResumeRefresh, useWhenActive } from '../../pageActivity';
import { getOverviewState, reloadOverview, subscribeOverview } from './overviewStore';

/** 이보다 최근에 (어느 화면에서든) 받았으면 다시 받지 않는다 — 앱 전체의 "다시 보일 때 갱신" 간격(30초)과 같게. 대시보드를 본 직후 분석을
 *  열면 받은 데이터를 그대로 쓴다(5초로 뒀더니 대시보드를 몇십 초 보고 분석을 열 때마다 전부 다시 받았다 — 실측). */
const SHARED_FRESH_MS = RESUME_REFRESH_MS;

/**
 * 대시보드 데이터 — 실제 데이터와 받기는 공용 저장소 `overviewStore.ts`(대시보드·분석이 한 벌을 같이 쓴다, 2026-11-17).
 * 이 훅은 구독 + 화면별 "다시 보일 때 갱신"(pageActivity) + 환율 함수만 만든다. 돌려주는 모양은 예전과 같다.
 * 계산은 calc/overview.ts, 화면은 overview/*Cards.tsx.
 */
export function useOverviewData() {
  const s = useSyncExternalStore(subscribeOverview, getOverviewState);

  // 처음 마운트 — 다른 화면이 방금 받았으면 그 값을 그대로 쓴다(진행 중이면 같이 기다림)
  useEffect(() => {
    void reloadOverview({ maxAgeMs: SHARED_FRESH_MS });
  }, []);

  // 메뉴를 옮겼다 돌아오면 지금 화면을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx). 다른 화면이 방금 받았으면 건너뛴다.
  // 숨겨진 동안 데이터가 바뀌었으면(매매·배당 수정 등) 방금 받았어도 다시 받는다.
  const markRefreshed = useResumeRefresh(
    ({ dataChanged }) => reloadOverview(dataChanged ? {} : { maxAgeMs: SHARED_FRESH_MS }),
    RESUME_REFRESH_MS
  );
  const whenActive = useWhenActive();

  // 새로고침 버튼 — 백엔드 30초 캐시를 건너뛴다(responseCache.ts PORTFOLIO_TTL_MS)
  const handleRefresh = useCallback(async () => {
    await reloadOverview({ forceRefresh: true });
    markRefreshed();
  }, [markRefreshed]);

  const effectiveFxRate = effectiveRate(s.manualFxRate, s.liveFxRate);
  // KRW 1:1, USD는 환율이 있을 때만(없으면 null — 호출부가 집계에서 빼고 "환율 미적용"). 아래 useMemo들이 의존성으로 쓰므로 useCallback.
  const toKrw = useCallback(
    (amount: number, currency: string | null): number | null => fxToKrw(amount, currency, effectiveFxRate),
    [effectiveFxRate]
  );
  // 배당금은 지급된 달의 평균 환율로(없으면 오늘/수동 환율) — 몇 달 전 배당을 오늘 환율로 계산하면 실제 받은 금액과 어긋난다.
  const dividendFxRateFor = useCallback(
    (month: string): number | null => s.monthlyAvgFxRates[month]?.rate ?? effectiveFxRate,
    [s.monthlyAvgFxRates, effectiveFxRate]
  );

  return {
    loading: s.loading,
    error: s.error,
    refreshing: s.refreshing,
    lastLoadedAt: s.lastLoadedAt,
    handleRefresh,
    whenActive,
    holdings: s.holdings,
    totalPurchaseKrw: s.totalPurchaseKrw,
    totalMarketKrw: s.totalMarketKrw,
    unconvertedUsdHoldings: s.unconvertedUsdHoldings,
    dividends: s.dividends,
    accountLabels: s.accountLabels,
    trades: s.trades,
    netWorthSnapshots: s.netWorthSnapshots,
    monthlyClosePrices: s.monthlyClosePrices,
    loadingClosePrices: s.loadingClosePrices,
    indexCloses: s.indexCloses,
    toKrw,
    dividendFxRateFor,
  };
}
