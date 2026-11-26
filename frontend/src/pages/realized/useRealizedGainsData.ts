import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { effectiveRate, monthlyRateOr } from '../../fx';
import { loadUsdKrwRates } from '../../fxLoader';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../../pageActivity';
import { usePlanner } from '../../usePlanner';
import type { AccountLabel, AccountTaxTypeEntry, DividendRecord, StoredHolding, StoredTrade } from '../../types';

/**
 * 실현손익 화면이 받는 데이터 전부(2026-11-26 RealizedGains.tsx에서 뺐다) — 매매내역·배당·계좌 별칭·세금 유형·보유 종목·planner,
 * 수동/실시간 환율과 달러 거래·배당이 걸친 달의 월평균 환율. 다시 보일 때는 화면을 비우지 않고 뒤에서 다시 받는다(실패하면 이전 값).
 */
export function useRealizedGainsData() {
  const [allTrades, setAllTrades] = useState<StoredTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = effectiveRate(manualFxRate, liveFxRate);
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});

  const [allDividends, setAllDividends] = useState<DividendRecord[]>([]);
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  const [taxTypes, setTaxTypes] = useState<AccountTaxTypeEntry[]>([]);
  const [holdings, setHoldings] = useState<StoredHolding[]>([]);
  const plannerState = usePlanner();

  useEffect(() => {
    void (async () => {
      try {
        setAllTrades(await api.listTradesStore());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    api
      .listDividends()
      .then(setAllDividends)
      .catch(() => {});
    api
      .listAccountLabels()
      .then(setAccountLabels)
      .catch(() => {});
    api
      .listAccountTaxTypes()
      .then(setTaxTypes)
      .catch(() => {});
    api
      .listHoldingsStore()
      .then(setHoldings)
      .catch(() => {});
  }, []);

  // 메뉴를 옮겼다 돌아오면 지금 화면을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx) — 실패하면 이전 값 유지.
  useResumeRefresh(() => {
    api.listTradesStore().then(setAllTrades).catch(() => {});
    api.listDividends().then(setAllDividends).catch(() => {});
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
    api.listAccountTaxTypes().then(setTaxTypes).catch(() => {});
    api.listHoldingsStore().then(setHoldings).catch(() => {});
    plannerState.reload();
  }, RESUME_REFRESH_MS);

  // Dividends.tsx와 같은 패턴 — 수동/실시간 환율을 합쳐 effectiveFxRate로 쓴다
  // (월평균을 못 구한 달의 최종 폴백).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 수동·실시간을 동시에 받는다(fxLoader.ts) — 실패해도 던지지 않고 null. 규칙은 fx.ts의 effectiveRate.
      const { manual, live } = await loadUsdKrwRates();
      if (cancelled) return;
      setManualFxRate(manual);
      if (live !== null) setLiveFxRate(live);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 달러 거래/배당이 걸쳐 있는 달들의 평균 환율을 한 번에 조회한다(Dividends.tsx와
  // 동일한 effect 패턴) — 백엔드가 달마다 강하게 캐싱해서 반복 호출이 비싸지 않다.
  useEffect(() => {
    let cancelled = false;
    const months = [
      ...new Set([
        ...allTrades.filter((t) => t.currency === 'USD').map((t) => t.executedAt.slice(0, 7)),
        ...allDividends.filter((d) => d.currency === 'USD').map((d) => d.paidDate.slice(0, 7)),
      ]),
    ];
    if (months.length === 0) {
      setMonthlyAvgFxRates({});
      return;
    }
    api
      .getMonthlyAvgUsdKrwRates(months)
      .then((rates) => {
        if (!cancelled) setMonthlyAvgFxRates(rates);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allTrades, allDividends]);

  const monthlyRateFor = useCallback(
    (month: string): number | null => monthlyRateOr(monthlyAvgFxRates, month, effectiveFxRate),
    [monthlyAvgFxRates, effectiveFxRate]
  );

  return {
    allTrades,
    loading,
    error,
    effectiveFxRate,
    monthlyRateFor,
    allDividends,
    accountLabels,
    taxTypes,
    holdings,
    plannerState,
  };
}
