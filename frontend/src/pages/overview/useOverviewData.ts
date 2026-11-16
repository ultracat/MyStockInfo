import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { effectiveRate, toKrw as fxToKrw } from '../../fx';
import { loadUsdKrwRates } from '../../fxLoader';
import { RESUME_REFRESH_MS, useResumeRefresh, useWhenActive } from '../../pageActivity';
import type { AccountLabel, DividendRecord, SnapshotRecord, StoredTrade } from '../../types';
import { API_BROKER_IDS } from '../../brokers';
import type { FlatHolding, IndexCloses, MonthlyCloses } from '../../calc/overview';

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 대시보드 데이터 — 전 증권사·전 계좌 보유종목, 배당, 매매내역, 환율, 순자산 기록, 월별 종가, 배당 지급월 평균 환율,
 * 지수 월말 종가. Overview.tsx에서 2026-11-17 뺐다(동작 그대로). 계산은 calc/overview.ts, 화면은 overview/*Cards.tsx.
 */
export function useOverviewData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<FlatHolding[]>([]);
  const [totalPurchaseKrw, setTotalPurchaseKrw] = useState(0);
  const [totalMarketKrw, setTotalMarketKrw] = useState(0);
  const [unconvertedUsdHoldings, setUnconvertedUsdHoldings] = useState(false);
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  // 월별 배당 내역 팝업의 "계좌별" 보기에서 계좌 이름을 보여주는 데만 쓴다(관리는
  // Settings.tsx, 여기선 읽기만).
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  const [trades, setTrades] = useState<StoredTrade[]>([]);
  const [netWorthSnapshots, setNetWorthSnapshots] = useState<SnapshotRecord[]>([]);
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const [monthlyClosePrices, setMonthlyClosePrices] = useState<
    MonthlyCloses
  >({});
  const [loadingClosePrices, setLoadingClosePrices] = useState(false);
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const effectiveFxRate = effectiveRate(manualFxRate, liveFxRate);

  // amount(currency 기준)를 KRW로 환산 — USD인데 환율을 못 구했으면 null(호출부가
  // 그 항목을 집계에서 빼고 "환율 미적용" 안내를 띄운다). Dashboard.tsx/Trades.tsx/
  // Dividends.tsx가 이미 쓰는 것과 같은 1:1(KRW)/환율곱(USD) 규칙.
  // 아래 useMemo들이 의존성으로 쓰므로 useCallback — 환율이 바뀌면 함수도 바뀌어 다시 계산된다(fx.ts의 toKrw).
  const toKrw = useCallback(
    (amount: number, currency: string | null): number | null => fxToKrw(amount, currency, effectiveFxRate),
    [effectiveFxRate]
  );

  // 배당금은 "오늘 환율"이 아니라 그 배당금이 지급된 달("YYYY-MM")의 평균
  // 환율로 환산한다 — 토스/수동 입력은 항상 "지금 이 순간"의 환율 하나뿐이라,
  // 몇 달 전에 받은 배당금까지 오늘 환율로 계산하면 실제로 그때 얼마를
  // 받았는지와 어긋난다(사용자 요청으로 추가). 그 달의 평균을 못 구했으면
  // (한국수출입은행 미연동, 그 달 데이터를 하나도 못 찾음 등) 기존처럼
  // effectiveFxRate로 대체한다 — 아예 안 보여주는 것보다는 근사치라도 보여주는
  // 쪽을 택했다(보유종목/투자금처럼 "그 순간의 정확한 값"이 필수가 아니라
  // 참고용 요약 수치라서 근사도 허용).
  // 아래 계산(useMemo)들이 의존성으로 쓰므로 useCallback.
  const dividendFxRateFor = useCallback(
    (month: string): number | null => monthlyAvgFxRates[month]?.rate ?? effectiveFxRate,
    [monthlyAvgFxRates, effectiveFxRate]
  );

  // 종목별 월별 종가 조회(loadMonthlyClosePrices)는 종목 수만큼 토스 API를
  // 호출해서(각 1~2페이지) 보유종목이 많으면 수 초가 걸린다(보유 종목 수십 개 기준
  // 실측 약 4초, backend/CLAUDE.md의 "월별 종가 조회" 절 참고) — 이걸
  // loadAll() 안에서 기다리면 "대시보드 진입 시 몇 초간 빈 화면"이 되는 원인이
  // 된다. `monthlyAmountRows`가 이미 종가를 못 구한 종목/달은 오늘 현재가로
  // 대체하는 fallback을 갖고 있어서, 이 조회를 loadAll()과 분리해 화면이 이미
  // (오늘 현재가 기준으로) 뜬 뒤 백그라운드로 이어가고 끝나면 그 두 카드만
  // 조용히 더 정확한 값으로 갱신한다.
  const monthlyCloseRequestId = useRef(0);

  async function loadMonthlyClosePrices(heldSymbols: Set<string>, allTrades: StoredTrade[]) {
    const requestId = ++monthlyCloseRequestId.current;
    const tradedSymbols = [...new Set(allTrades.map((t) => t.symbol))].filter((s) => heldSymbols.has(s));
    if (tradedSymbols.length === 0) {
      if (requestId === monthlyCloseRequestId.current) setMonthlyClosePrices({});
      return;
    }
    setLoadingClosePrices(true);
    const closePrices = await api.getMonthlyClosePrices(tradedSymbols).catch(() => ({}));
    // 그 사이 새로고침이 다시 눌려 더 최신 요청이 나갔다면, 늦게 도착한 이
    // 응답으로 덮어쓰지 않는다.
    if (requestId === monthlyCloseRequestId.current) {
      setMonthlyClosePrices(closePrices);
      setLoadingClosePrices(false);
    }
  }

  // 배당금 달마다 월평균 환율을 조회한다(dividendFxRateFor 참고) — 종목별
  // 종가 조회와 같은 이유로 loadAll()을 안 막는다: 달 수만큼 한국수출입은행
  // 영업일 조회가 필요해서(달 하나당 최대 20여 회, 백엔드가 병렬로 처리하긴
  // 하지만) 배당 이력이 긴 계정은 여기도 지연이 생길 수 있다. 응답이 올 때까지
  // dividendFxRateFor가 오늘/수동 환율로 대체하므로 화면은 즉시 뜬다.
  const monthlyAvgFxRequestId = useRef(0);

  async function loadMonthlyAvgFxRates(divs: DividendRecord[]) {
    const requestId = ++monthlyAvgFxRequestId.current;
    const months = [...new Set(divs.filter((d) => d.currency === 'USD').map((d) => d.paidDate.slice(0, 7)))];
    if (months.length === 0) {
      if (requestId === monthlyAvgFxRequestId.current) setMonthlyAvgFxRates({});
      return;
    }
    const rates = await api.getMonthlyAvgUsdKrwRates(months).catch(() => ({}));
    if (requestId === monthlyAvgFxRequestId.current) setMonthlyAvgFxRates(rates);
  }

  // forceRefresh: 새로고침 버튼 전용 — 백엔드가 보유종목/계좌/환율을 30초 캐시하므로
  // (backend/src/brokers/responseCache.ts의 PORTFOLIO_TTL_MS) 그걸 건너뛰고 새로 받는다.
  async function loadAll(opts: { forceRefresh?: boolean } = {}) {
    setError(null);

    // FX rate는 아래 보유종목 합계 계산에 바로 쓰이므로 브로커/보유종목 조회보다
    // 먼저 끝내야 한다 — 예전엔 이 fetch가 보유종목 루프 "뒤"에 있었는데,
    // 그 루프 안의 toKrw()는 컴포넌트 렌더 시점의 state(manualFxRate/liveFxRate)를
    // 읽는 클로저라 첫 마운트 시엔 항상 null이었다(state가 아직 이 fetch로
    // 채워지기 전이라). 그래서 최초 진입 땐 매번 USD 보유종목이 전부
    // "환율 미적용"으로 빠졌다가, 새로고침(re-render 이후 재호출)에서야 이미
    // 채워진 state로 정상 계산됐다. 여기서는 state가 아니라 지금 막 받아온
    // 값을 로컬 변수로 바로 써서 이 레이스를 없앤다. getUsdKrwRate는 fx/brokers
    // 결과에 의존하지 않으므로 셋 다 병렬로 시작한다(예전엔 fx/brokers를 먼저
    // 기다린 다음에야 getUsdKrwRate를 불렀는데, 서로 독립적이라 직렬화할
    // 이유가 없었다).
    // 환율(수동·실시간, fxLoader.ts — 던지지 않음)과 증권사 목록을 동시에 받는다.
    const [{ manual: manualRate, live: resolvedLiveFxRate }, brokers] = await Promise.all([
      loadUsdKrwRates(opts),
      api.listBrokers(),
    ]);
    const resolvedFxRate = effectiveRate(manualRate, resolvedLiveFxRate);

    function toKrwNow(amount: number, currency: string | null): number | null {
      return fxToKrw(amount, currency, resolvedFxRate);
    }

    const configured = brokers.filter((b) => b.configured);

    const flat: FlatHolding[] = [];
    let purchaseKrw = 0;
    let marketKrw = 0;
    let unconverted = false;

    // 배당금/매매내역은 보유종목 결과와 무관하므로 그 Promise.all과 동시에
    // 시작한다(예전엔 보유종목 루프가 끝난 "뒤"에야 불렀는데, 서로 독립적인
    // 호출을 직렬화할 이유가 없었다) — heldSymbols는 holdings 루프가 끝난
    // 뒤에만 계산할 수 있어서, allTrades 자체는 여기서 먼저 받아두고
    // loadMonthlyClosePrices 호출 시점에 가서야 그 교집합을 구한다.
    const [, divs, allTrades] = await Promise.all([
      Promise.all(
        configured.map(async (b) => {
          const rows = API_BROKER_IDS.includes(b.id)
            ? await api
                .listAccounts(b.id, opts)
                .then((accounts) =>
                  Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id, opts).catch(() => null)))
                )
                .then((portfolios) =>
                  portfolios
                    .filter((p): p is NonNullable<typeof p> => p !== null)
                    // 계좌별 보기용으로 어느 계좌의 포지션인지 남긴다(HoldingPosition
                    // 자체엔 accountId가 없음).
                    .flatMap((p) => p.positions.map((pos) => ({ ...pos, accountId: p.accountId })))
                )
            : await api.listHoldingsStore({ broker: b.id });

          for (const r of rows) {
            flat.push({
              broker: b.id,
              accountId: r.accountId ?? '',
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
        })
      ),
      api.listDividends(),
      api.listTradesStore(),
    ]);

    setHoldings(flat);
    setTotalPurchaseKrw(purchaseKrw);
    setTotalMarketKrw(marketKrw);
    setUnconvertedUsdHoldings(unconverted);
    setManualFxRate(manualRate);
    setLiveFxRate(resolvedLiveFxRate);
    setDividends(divs);
    setTrades(allTrades);
    setLastLoadedAt(new Date());

    const heldSymbols = new Set(flat.filter((h) => h.quantity > 0).map((h) => h.symbol));
    void loadMonthlyClosePrices(heldSymbols, allTrades);
    void loadMonthlyAvgFxRates(divs);

    // 하루 한 번(이 화면에 들어올 때마다, 서버가 같은 날짜면 upsert로 덮어써서
    // 중복이 안 쌓인다) 지금 막 계산한 합계를 그대로 기록해둔다 — "순자산 추이"
    // 카드가 쓰는 실제 데이터. loadAll()을 안 막도록(화면에 영향 없음) void로
    // 분리한다. 기록이 실패해도 이미 쌓여 있는 이력은 그대로 보여줘야 하므로
    // 목록 조회는 기록 성공/실패와 무관하게 항상 시도한다.
    void (async () => {
      try {
        await api.capturePortfolioSnapshot({
          date: todayDate(),
          totalMarketValueKrw: marketKrw,
          totalPurchaseAmountKrw: purchaseKrw,
          totalProfitLossKrw: marketKrw - purchaseKrw,
        });
      } catch {
        // 오늘 기록이 실패해도 아래에서 기존 이력은 그대로 보여준다.
      }
      try {
        setNetWorthSnapshots(await api.listPortfolioSnapshots());
      } catch {
        // 조용히 무시 — 카드가 "기록 없음" 상태로 남을 뿐, 화면 전체엔 영향 없음.
      }
    })();
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        await loadAll();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll({ forceRefresh: true });
      markRefreshed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  // 메뉴를 옮겼다 돌아오면 지금 화면을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx) — 실패해도 이전 값을 유지한다.
  const markRefreshed = useResumeRefresh(async () => {
    setRefreshing(true);
    try {
      await loadAll();
      setAccountLabels(await api.listAccountLabels());
    } catch {
      // 이전 화면 유지
    } finally {
      setRefreshing(false);
    }
  }, RESUME_REFRESH_MS);
  const whenActive = useWhenActive();

  // 월별 배당 내역 팝업의 "계좌별" 보기·배당 포함 손익에서 계좌 이름/번호를 쓴다(관리는 Settings.tsx, 여기선 읽기만).
  useEffect(() => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
  }, []);

  // 지수와 비교(토스 시장 지표: 코스피·코스닥 월말 종가).
  const [indexCloses, setIndexCloses] = useState<IndexCloses>({});
  useEffect(() => {
    let cancelled = false;
    api
      .getIndexMonthly(13)
      .then((r) => !cancelled && setIndexCloses(r))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    loading,
    error,
    refreshing,
    lastLoadedAt,
    handleRefresh,
    whenActive,
    holdings,
    totalPurchaseKrw,
    totalMarketKrw,
    unconvertedUsdHoldings,
    dividends,
    accountLabels,
    trades,
    netWorthSnapshots,
    monthlyClosePrices,
    loadingClosePrices,
    indexCloses,
    toKrw,
    dividendFxRateFor,
  };
}
