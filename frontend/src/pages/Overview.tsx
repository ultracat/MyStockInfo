import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { DividendRecord, MonthlySummaryRow, StoredTrade } from '../types';
import { API_BROKER_IDS } from '../brokers';
import DonutChart, { type DonutSlice } from '../components/DonutChart';
import DonutDetailModal from '../components/DonutDetailModal';
import DividendsChart from '../components/DividendsChart';
import MonthlyReturnChart, { type MonthlyReturnRow } from '../components/MonthlyReturnChart';
import MonthlyInvestmentChart, { type MonthlyInvestmentRow } from '../components/MonthlyInvestmentChart';
import { krw } from '../format';

const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
];
const OTHER_COLOR = 'var(--baseline)';
const TOP_N = 5;

interface FlatHolding {
  symbol: string;
  name: string;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  /** 오늘 기준 이 보유종목의 총 매입금액(원화 환산 전, currency 기준) — 월별
   * 투자금 차트가 "오늘 실제 매입원가 ÷ 오늘 수량"으로 평단가를 구할 때 쓴다. */
  purchaseAmount: number;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

function formatKrwValue(v: number) {
  return `${krw.format(Math.round(v))}원`;
}

/**
 * 대시보드 — 전체 브로커/계좌를 한데 합친 요약 화면. 다른 화면들(보유 종목/배당금/
 * 매매내역)은 브로커·계좌 단위로 파고드는 화면이고, 이 화면만 유일하게 "전부 합쳐서"
 * 본다 — 그래서 자동 새로고침 없이 마운트 시 한 번 + 수동 새로고침 버튼만 둔다
 * (브로커마다 계좌 목록 조회 + 계좌마다 보유종목 조회를 병렬로 하므로 호출량이 다른
 * 화면보다 훨씬 많다 — Dashboard.tsx의 "전체 계좌" 모드를 브로커 여러 개로 넓힌 것).
 */
export default function Overview() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<FlatHolding[]>([]);
  const [totalPurchaseKrw, setTotalPurchaseKrw] = useState(0);
  const [totalMarketKrw, setTotalMarketKrw] = useState(0);
  const [unconvertedUsdHoldings, setUnconvertedUsdHoldings] = useState(false);
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [trades, setTrades] = useState<StoredTrade[]>([]);
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const [monthlyClosePrices, setMonthlyClosePrices] = useState<
    Record<string, { month: string; closePrice: number; currency: string }[]>
  >({});
  const [loadingClosePrices, setLoadingClosePrices] = useState(false);
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});
  const [year, setYear] = useState(CURRENT_YEAR);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const effectiveFxRate = manualFxRate ?? liveFxRate;

  // amount(currency 기준)를 KRW로 환산 — USD인데 환율을 못 구했으면 null(호출부가
  // 그 항목을 집계에서 빼고 "환율 미적용" 안내를 띄운다). Dashboard.tsx/Trades.tsx/
  // Dividends.tsx가 이미 쓰는 것과 같은 1:1(KRW)/환율곱(USD) 규칙.
  function toKrw(amount: number, currency: string | null): number | null {
    if (currency === 'USD') return effectiveFxRate ? amount * effectiveFxRate : null;
    return amount;
  }

  // 배당금은 "오늘 환율"이 아니라 그 배당금이 지급된 달("YYYY-MM")의 평균
  // 환율로 환산한다 — 토스/수동 입력은 항상 "지금 이 순간"의 환율 하나뿐이라,
  // 몇 달 전에 받은 배당금까지 오늘 환율로 계산하면 실제로 그때 얼마를
  // 받았는지와 어긋난다(사용자 요청으로 추가). 그 달의 평균을 못 구했으면
  // (한국수출입은행 미연동, 그 달 데이터를 하나도 못 찾음 등) 기존처럼
  // effectiveFxRate로 대체한다 — 아예 안 보여주는 것보다는 근사치라도 보여주는
  // 쪽을 택했다(보유종목/투자금처럼 "그 순간의 정확한 값"이 필수가 아니라
  // 참고용 요약 수치라서 근사도 허용).
  function dividendFxRateFor(month: string): number | null {
    return monthlyAvgFxRates[month]?.rate ?? effectiveFxRate;
  }

  // 종목별 월별 종가 조회(loadMonthlyClosePrices)는 종목 수만큼 토스 API를
  // 호출해서(각 1~2페이지) 보유종목이 많으면 수 초가 걸린다(41개 종목 기준
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

  async function loadAll() {
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
    const [fx, brokers, live] = await Promise.all([
      api.getFxRate().catch(() => ({ usdKrwRate: null })),
      api.listBrokers(),
      // getUsdKrwRate는 토스→한국수출입은행 순으로 시도하고(backend/CLAUDE.md의
      // "환율 조회" 절 참고) 실패해도 예외 없이 {rate:null}을 준다.
      api.getUsdKrwRate().catch(() => ({ rate: null })),
    ]);
    const resolvedLiveFxRate = live.rate ? live.midRate ?? live.rate : null;
    const resolvedFxRate = fx.usdKrwRate ?? resolvedLiveFxRate;

    function toKrwNow(amount: number, currency: string | null): number | null {
      if (currency === 'USD') return resolvedFxRate ? amount * resolvedFxRate : null;
      return amount;
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
                .listAccounts(b.id)
                .then((accounts) => Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id).catch(() => null))))
                .then((portfolios) =>
                  portfolios
                    .filter((p): p is NonNullable<typeof p> => p !== null)
                    .flatMap((p) => p.positions)
                )
            : await api.listHoldingsStore({ broker: b.id });

          for (const r of rows) {
            flat.push({
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
    setManualFxRate(fx.usdKrwRate);
    setLiveFxRate(resolvedLiveFxRate);
    setDividends(divs);
    setTrades(allTrades);
    setLastLoadedAt(new Date());

    const heldSymbols = new Set(flat.filter((h) => h.quantity > 0).map((h) => h.symbol));
    void loadMonthlyClosePrices(heldSymbols, allTrades);
    void loadMonthlyAvgFxRates(divs);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      await loadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  // ---- 1) 전체 계좌 보유종목 비중(도넛) ----
  const holdingSlices = useMemo<DonutSlice[]>(() => {
    const bySymbol = new Map<string, { name: string; valueKrw: number }>();
    for (const h of holdings) {
      // marketValue를 직접 안 갖고 있어(FlatHolding엔 quantity/lastPrice만 남김) —
      // quantity*lastPrice로 재계산한다(평가금액과 사실상 같음, 배당락 등 미세한
      // 차이는 이 요약 화면 목적엔 무시 가능).
      const v = toKrw(h.quantity * h.lastPrice, h.currency);
      if (v === null) continue;
      const existing = bySymbol.get(h.symbol) ?? { name: h.name, valueKrw: 0 };
      existing.valueKrw += v;
      bySymbol.set(h.symbol, existing);
    }
    return topNSlices(bySymbol);
  }, [holdings, effectiveFxRate]);

  // ---- 1-1) 보유종목 비중 도넛의 가운데 숫자를 눌렀을 때 보여줄 종목별 상세 ----
  // holdingSlices는 상위 5종목 + "기타"로 접지만, 여기선 보유 중인 전 종목을
  // 보유수량까지 포함해 그대로 보여준다.
  const [showHoldingDetail, setShowHoldingDetail] = useState(false);
  const holdingDetailRows = useMemo(() => {
    const bySymbol = new Map<string, { name: string; valueKrw: number; quantity: number }>();
    for (const h of holdings) {
      const v = toKrw(h.quantity * h.lastPrice, h.currency);
      if (v === null) continue;
      const existing = bySymbol.get(h.symbol) ?? { name: h.name, valueKrw: 0, quantity: 0 };
      existing.valueKrw += v;
      existing.quantity += h.quantity;
      bySymbol.set(h.symbol, existing);
    }
    return Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, ...v }))
      .filter((e) => e.valueKrw > 0)
      .sort((a, b) => b.valueKrw - a.valueKrw);
  }, [holdings, effectiveFxRate]);

  // ---- 2) 월별 배당금(막대) — 선택한 연도 ----
  const dividendMonthlyRows = useMemo<MonthlySummaryRow[]>(() => {
    const byMonth = new Map<string, { totalKrw: number; totalUsd: number; count: number }>();
    for (const d of dividends) {
      if (!d.paidDate.startsWith(String(year))) continue;
      const month = d.paidDate.slice(0, 7);
      const existing = byMonth.get(month) ?? { totalKrw: 0, totalUsd: 0, count: 0 };
      if (d.currency === 'USD') existing.totalUsd += d.amount;
      else existing.totalKrw += d.amount;
      existing.count += 1;
      byMonth.set(month, existing);
    }
    return Array.from(byMonth.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [dividends, year]);

  // ---- 3) 배당금 비중(도넛) — 선택한 연도, 종목별 ----
  // 배당금은 toKrw(오늘/수동 환율)가 아니라 dividendFxRateFor(그 달 평균 환율,
  // 못 구하면 toKrw와 같은 값으로 대체)로 환산한다.
  const dividendSlices = useMemo<DonutSlice[]>(() => {
    const bySymbol = new Map<string, { name: string; valueKrw: number }>();
    for (const d of dividends) {
      if (!d.paidDate.startsWith(String(year))) continue;
      const rate = d.currency === 'USD' ? dividendFxRateFor(d.paidDate.slice(0, 7)) : null;
      const v = d.currency === 'USD' ? (rate ? d.amount * rate : null) : d.amount;
      if (v === null) continue;
      const existing = bySymbol.get(d.symbol) ?? { name: d.name, valueKrw: 0 };
      existing.valueKrw += v;
      bySymbol.set(d.symbol, existing);
    }
    return topNSlices(bySymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dividends, year, effectiveFxRate, monthlyAvgFxRates]);

  // ---- 3-1) 배당금 비중 도넛의 가운데 숫자를 눌렀을 때 보여줄 종목별 상세 ----
  // dividendSlices는 상위 5종목 + "기타"로 접지만, 여기선 그 해에 배당을 준
  // 전 종목을 배당횟수(건수)까지 포함해 그대로 보여준다.
  const [showDividendDetail, setShowDividendDetail] = useState(false);
  const dividendDetailRows = useMemo(() => {
    const bySymbol = new Map<string, { name: string; valueKrw: number; count: number }>();
    for (const d of dividends) {
      if (!d.paidDate.startsWith(String(year))) continue;
      const rate = d.currency === 'USD' ? dividendFxRateFor(d.paidDate.slice(0, 7)) : null;
      const v = d.currency === 'USD' ? (rate ? d.amount * rate : null) : d.amount;
      if (v === null) continue;
      const existing = bySymbol.get(d.symbol) ?? { name: d.name, valueKrw: 0, count: 0 };
      existing.valueKrw += v;
      existing.count += 1;
      bySymbol.set(d.symbol, existing);
    }
    return Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, ...v }))
      .filter((e) => e.valueKrw > 0)
      .sort((a, b) => b.valueKrw - a.valueKrw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dividends, year, effectiveFxRate, monthlyAvgFxRates]);

  function topNSlices(bySymbol: Map<string, { name: string; valueKrw: number }>): DonutSlice[] {
    const entries = Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, ...v }))
      .filter((e) => e.valueKrw > 0)
      .sort((a, b) => b.valueKrw - a.valueKrw);
    const top = entries.slice(0, TOP_N);
    const rest = entries.slice(TOP_N);
    const slices: DonutSlice[] = top.map((e, i) => ({
      label: `${e.name} (${e.symbol})`,
      value: e.valueKrw,
      color: SERIES_COLORS[i],
    }));
    if (rest.length > 0) {
      slices.push({
        label: `기타 ${rest.length}종목`,
        value: rest.reduce((s, r) => s + r.valueKrw, 0),
        color: OTHER_COLOR,
      });
    }
    return slices;
  }

  // ---- 4) 매월 보유종목 투자금 대비 수익률(diverging 막대, 누적) / 총 투자금·총 수입금(line) ----
  // 지금 보유 중인 종목들만 대상으로, 그 종목들의 매매내역을 시간순으로 훑어
  // "그 달 말 기준 누적 보유수량"만 재구성한다(투자금은 매매내역에서 다시
  // 쌓지 않는다 — 아래 avgCostKrwBySymbol 주석 참고). 그 수량에 오늘 기준
  // 평단가를 곱하면 그 달의 투자금, 오늘 현재가를 곱하면 그 달의 평가금액이다
  // — 한 달짜리 스냅샷이 아니라 "그때 갖고 있던 게 지금 얼마가 됐는지"를 매월
  // 갱신해서 보여주는 누적 추이다. 거래가 없던 달은 직전 수량을 그대로
  // 이어간다(forward-fill). 매매내역은 로컬 저장소(trades-store) 기준이라,
  // 아직 한 번도 실시간 조회/동기화/CSV 가져오기를 안 한 계좌의 과거 매수는 안
  // 잡힐 수 있다(다른 화면의 "전체" 모드와 같은 한계 — write-through 캐시라
  // 완전성보다 훑어보기가 목적).
  const lastPriceBySymbol = useMemo(() => {
    const m = new Map<string, { lastPrice: number; currency: string | null }>();
    for (const h of holdings) {
      if (h.lastPrice > 0 && !m.has(h.symbol)) m.set(h.symbol, { lastPrice: h.lastPrice, currency: h.currency });
    }
    return m;
  }, [holdings]);

  // 오늘 기준 종목별 평단가(원화 환산) — 오늘 실제 매입금액 ÷ 오늘 보유수량.
  // 예전엔 매매내역을 시간순으로 훑으며 "그 달까지 누적 투자금"을 평균원가법
  // (BUY는 더하고 SELL은 그 시점 평단가만큼 빼는 방식)으로 직접 재구성했는데,
  // 계좌마다 매매내역이 다 안 모여있을 수 있어(write-through 캐시 한계) 그
  // 재구성값이 대시보드 상단 "총 매입금액"(보유종목이 실제로 갖고 있는
  // 매입원가 필드 기준)과 어긋나는 경우가 있었다. 지금은 오늘의 평단가(이미
  // 신뢰할 수 있는 값)를 고정해두고, 매달의 투자금은 그 시점 보유수량에 이
  // 평단가를 곱해서 구한다 — 그래서 최근 달(=오늘)의 투자금은 상단 통계와
  // 항상 정확히 일치한다.
  const avgCostKrwBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of holdings) {
      if (h.quantity <= 0 || m.has(h.symbol)) continue;
      const investedKrw = toKrw(h.purchaseAmount, h.currency);
      if (investedKrw !== null) m.set(h.symbol, investedKrw / h.quantity);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, effectiveFxRate]);

  // 종목별 · 월별 실제 종가(토스 일봉 기반, loadAll이 채움) — 그 달에 해당
  // 종목의 종가를 못 구했으면(토스 미연동, 상장 전이라 그 달 봉이 없음 등)
  // 조회가 없고, 아래 monthlyAmountRows가 그 경우 오늘 현재가로 대체한다.
  const closePriceBySymbolMonth = useMemo(() => {
    const m = new Map<string, Map<string, { closePrice: number; currency: string }>>();
    for (const [symbol, rows] of Object.entries(monthlyClosePrices)) {
      const byMonth = new Map<string, { closePrice: number; currency: string }>();
      for (const r of rows) byMonth.set(r.month, { closePrice: r.closePrice, currency: r.currency });
      m.set(symbol, byMonth);
    }
    return m;
  }, [monthlyClosePrices]);

  // MonthlyReturnChart(비율)와 MonthlyInvestmentChart(절대금액) 둘 다 같은
  // 월별 체크포인트(그 달까지 누적 보유수량)에서 파생되므로 여기서 한 번만
  // 계산해서 공유한다. 거래가 없던 달은 직전 수량을 그대로 이어간다
  // (forward-fill).
  const monthlyAmountRows = useMemo<MonthlyInvestmentRow[]>(() => {
    const bySymbol = new Map<string, StoredTrade[]>();
    for (const t of trades) {
      if (!lastPriceBySymbol.has(t.symbol) || !avgCostKrwBySymbol.has(t.symbol)) continue; // 전량 매도했거나 평단가를 못 구하는 종목은 제외
      if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
      bySymbol.get(t.symbol)!.push(t);
    }

    // 종목별로 매매내역을 시간순으로 훑어 "그 달 말 기준" 누적 보유수량
    // 체크포인트만 만든다(투자금은 여기서 재구성하지 않는다 — 위 주석 참고).
    // 같은 달에 거래가 여러 건이면 그 달의 마지막 수량으로 덮어써진다.
    const perSymbolMonthly = new Map<string, Map<string, number>>();
    let earliestMonth: string | null = null;

    for (const [symbol, symTrades] of bySymbol) {
      const sorted = [...symTrades].sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1));
      let qty = 0;
      const checkpoints = new Map<string, number>();
      for (const t of sorted) {
        qty += t.side === 'BUY' ? t.quantity : -Math.min(t.quantity, qty);
        const month = t.executedAt.slice(0, 7);
        checkpoints.set(month, qty);
        if (!earliestMonth || month < earliestMonth) earliestMonth = month;
      }
      perSymbolMonthly.set(symbol, checkpoints);
    }

    if (!earliestMonth) return [];

    const months: string[] = [];
    const cursor = new Date(`${earliestMonth}-01T00:00:00`);
    const end = new Date();
    end.setDate(1);
    while (cursor <= end) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const lastQty = new Map<string, number>();
    const rows: MonthlyInvestmentRow[] = [];
    for (const month of months) {
      let totalInvested = 0;
      let totalCurrent = 0;
      for (const [symbol, checkpoints] of perSymbolMonthly) {
        const cp = checkpoints.get(month);
        if (cp !== undefined) lastQty.set(symbol, cp);
        const qty = lastQty.get(symbol);
        if (!qty || qty <= 0) continue;
        const priceInfo = lastPriceBySymbol.get(symbol)!;
        const avgCostKrw = avgCostKrwBySymbol.get(symbol)!;
        totalInvested += qty * avgCostKrw;
        // 그 달의 실제 종가(토스 일봉)가 있으면 그걸, 없으면 오늘 현재가로
        // 대체한다(closePriceBySymbolMonth 주석 참고) — 최근 달일수록 그 달
        // 종가와 오늘 현재가가 사실상 같아지므로 자연스럽게 이어진다.
        const monthClose = closePriceBySymbolMonth.get(symbol)?.get(month);
        const price = monthClose ?? { closePrice: priceInfo.lastPrice, currency: priceInfo.currency };
        totalCurrent += toKrw(qty * price.closePrice, price.currency) ?? 0;
      }
      if (totalInvested > 0) {
        rows.push({ month, investedKrw: totalInvested, currentKrw: totalCurrent });
      }
    }

    return rows.slice(-12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, lastPriceBySymbol, avgCostKrwBySymbol, closePriceBySymbolMonth, effectiveFxRate]);

  const monthlyReturnRows = useMemo<MonthlyReturnRow[]>(
    () =>
      monthlyAmountRows.map((r) => ({
        month: r.month,
        rate: (r.currentKrw - r.investedKrw) / r.investedKrw,
        amountKrw: r.currentKrw - r.investedKrw,
      })),
    [monthlyAmountRows]
  );

  const totalDividendKrwThisYear = dividendMonthlyRows.reduce((sum, r) => {
    const rate = dividendFxRateFor(r.month);
    return sum + r.totalKrw + (rate ? r.totalUsd * rate : 0);
  }, 0);
  const hasUnconvertedUsdDividend = dividendMonthlyRows.some((r) => r.totalUsd > 0 && !dividendFxRateFor(r.month));

  if (loading) return <p>불러오는 중...</p>;
  if (error)
    return (
      <p className="notice text-critical" style={{ whiteSpace: 'pre-wrap' }}>
        {error}
      </p>
    );

  const totalPl = totalMarketKrw - totalPurchaseKrw;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">대시보드</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastLoadedAt && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {lastLoadedAt.toLocaleTimeString('ko-KR')} 기준
            </span>
          )}
          <button className="ghost" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? '새로고침 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {unconvertedUsdHoldings && (
        <div className="notice">
          USD 보유종목이 있지만 환율을 가져오지 못해 일부 합계에서 제외됩니다. 설정 화면에서 USD/KRW 환율을
          직접 입력하시거나, 토스증권 연동 상태를 확인해주세요.
        </div>
      )}

      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">총 매입금액</div>
          <div className="value">{formatKrwValue(totalPurchaseKrw)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">총 평가금액</div>
          <div className="value">{formatKrwValue(totalMarketKrw)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">총 손익금액</div>
          <div className="value" style={{ color: totalPl >= 0 ? 'var(--good)' : 'var(--critical)' }}>
            {totalPl >= 0 ? '+' : ''}
            {formatKrwValue(totalPl)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">{year}년 총 배당금</div>
          <div className="value">{formatKrwValue(totalDividendKrwThisYear)}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>전체 계좌 보유종목 비중</h3>
        <DonutChart
          slices={holdingSlices}
          centerLabel="총 평가금액"
          centerValue={formatKrwValue(totalMarketKrw)}
          formatValue={formatKrwValue}
          onCenterClick={() => setShowHoldingDetail(true)}
        />
      </div>

      {showHoldingDetail && (
        <DonutDetailModal
          title="전체 계좌 보유종목 상세"
          totalValueKrw={totalMarketKrw}
          rows={holdingDetailRows.map((r) => ({
            symbol: r.symbol,
            name: r.name,
            valueKrw: r.valueKrw,
            meta: `${r.quantity}주`,
          }))}
          formatValue={formatKrwValue}
          onClose={() => setShowHoldingDetail(false)}
        />
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{year}년 월별 배당금</h3>
          <div className="form-row" style={{ margin: 0 }}>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>
        </div>
        {hasUnconvertedUsdDividend && (
          <div className="notice" style={{ marginTop: 12 }}>
            USD 배당금이 있지만 환율을 가져오지 못해 원화 환산에서 제외됩니다.
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <DividendsChart rows={dividendMonthlyRows} fxRate={dividendFxRateFor} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{year}년 배당금 비중</h3>
        <DonutChart
          slices={dividendSlices}
          centerLabel={`${year}년 배당금`}
          centerValue={formatKrwValue(totalDividendKrwThisYear)}
          formatValue={formatKrwValue}
          onCenterClick={() => setShowDividendDetail(true)}
        />
      </div>

      {showDividendDetail && (
        <DonutDetailModal
          title={`${year}년 배당금 상세`}
          totalValueKrw={totalDividendKrwThisYear}
          rows={dividendDetailRows.map((r) => ({
            symbol: r.symbol,
            name: r.name,
            valueKrw: r.valueKrw,
            meta: `배당 ${r.count}건`,
          }))}
          formatValue={formatKrwValue}
          onClose={() => setShowDividendDetail(false)}
        />
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>매월 보유종목 투자금 대비 수익률</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          지금 보유 중인 종목들만 대상으로, 그 달까지 보유했던 수량에 오늘 기준 평단가를 곱한
          투자금이 그 달의 실제 종가(토스 일봉 기준, 못 구하면 오늘 현재가로 대체) 기준으로
          당시 얼마였는지를 매월 누적으로 보여줍니다(최근 12개월). 전량 매도한 종목은
          포함되지 않습니다.
          {loadingClosePrices && ' 실제 월별 종가를 불러오는 중 — 그동안 오늘 현재가로 표시됩니다.'}
        </p>
        <MonthlyReturnChart rows={monthlyReturnRows} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>월별 총 투자금 · 총 수입금</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          지금 보유 중인 종목들만 대상으로, 그 달까지 보유했던 수량에 오늘 기준 평단가를 곱한
          투자금(총 투자금)과 그 수량에 그 달의 실제 종가(토스 일봉 기준, 못 구하면 오늘
          현재가로 대체)를 곱한 평가금액(총 수입금)을 매월 누적으로 보여줍니다(최근 12개월).
          전량 매도한 종목은 포함되지 않습니다.
          {loadingClosePrices && ' 실제 월별 종가를 불러오는 중 — 그동안 오늘 현재가로 표시됩니다.'}
        </p>
        <MonthlyInvestmentChart rows={monthlyAmountRows} />
      </div>
    </div>
  );
}
