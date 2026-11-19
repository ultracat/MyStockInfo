import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { krw, krw2dp, qtyFmt, usdFmt, localToday } from '../../format';
import { effectiveRate, toKrw } from '../../fx';
import { loadUsdKrwRates } from '../../fxLoader';
import { loadAllHoldings } from '../../allHoldings';
import { usePlanner } from '../../usePlanner';
import Hint from '../../components/Hint';
import PriceChart, { type PricePoint } from '../../components/PriceChart';
import KisStockInsights from '../../components/KisStockInsights';
import { WatchTargetEditor } from '../../components/WatchTargetEditor';
import DailyPriceChart, { MA_LINES } from './DailyPriceChart';
import IndicatorChart from './IndicatorChart';
import DividendBars from './DividendBars';
import CompareChart, { COMPARE_COLORS, type CompareSeries } from './CompareChart';
import {
  DAILY_RANGES,
  bollinger,
  drawdownSeries,
  monthlyReturnGrid,
  rollingVolatility,
  rsi,
  totalReturnSeries,
  benchmarkFor,
  dividendYield,
  movingAverage,
  myTradeSummary,
  normalizedSeries,
  periodReturns,
  range52w,
  shiftDate,
  sinceAdded,
  whatIfBuy,
  type DailyRangeKey,
  type WhatIf,
} from '../../calc/watchDetail';
import type { DailyCandle, OverseasStockDetail, StoredTrade, SymbolDividends, WatchlistEntry } from '../../types';

const price = (v: number, currency: string | null) => (currency === 'USD' ? usdFmt.format(v) : `${krw2dp.format(v)}원`);
/** 달러 시가총액 — 조 달러(T)·십억 달러(B). */
const usdCap = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(1)}B`);
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
const rateClass = (v: number | null | undefined) => (v == null ? undefined : v >= 0 ? 'text-good' : 'text-critical');

const BANDS_HELP =
  '볼린저 밴드 — 20일 이동평균 위아래로 최근 20일 가격 변동 폭(표준편차)의 2배만큼 띠를 그린 것입니다. 가격은 대개 이 띠 안에서 움직여서, ' +
  '띠 위쪽에 닿으면 평소보다 많이 오른 상태, 아래쪽에 닿으면 많이 내린 상태로 봅니다. 띠가 좁아지면 움직임이 잦아든 것이고, 넓어지면 크게 흔들리는 중입니다.';
const AVG_HELP =
  '내 평균 매수가 — 매매내역에 있는 이 종목 매수의 평균 단가(수량 가중)입니다. 지금 가격이 이 선보다 위면 평균적으로 이익, 아래면 손해 구간입니다. ' +
  '판 기록은 빼지 않은 단순 평균이라 보유 종목 화면의 평균가와 다를 수 있습니다.';
const INDICATOR_HELP = {
  drawdown:
    '고점 대비 하락 — 보기 기간 안에서 그때까지의 최고 종가보다 몇 % 아래에 있는지입니다. 0%면 신고점, -20%면 최고점보다 20% 내려온 상태입니다. ' +
    '얼마나 깊이 빠졌다가 얼마나 빨리 회복하는 종목인지 볼 수 있습니다.',
  rsi:
    'RSI(상대강도지수, 14일) — 최근 14거래일 동안 오른 폭과 내린 폭을 비교해 0~100으로 나타낸 값입니다. 오른 날의 힘이 셀수록 100에 가깝습니다. ' +
    '보통 70 위면 짧은 기간에 많이 올라 "과열", 30 아래면 많이 내려 "침체"로 봅니다. 추세가 강하면 오래 머물 수 있어 참고용입니다.',
  vol:
    '변동성 — 최근 20거래일 하루 등락률이 얼마나 들쭉날쭉한지(표준편차)를 1년 기준으로 바꾼 값입니다. 30%면 1년에 대략 ±30% 안팎으로 움직일 만큼 흔들린다는 뜻입니다. ' +
    '높을수록 위험(그리고 기회)이 큽니다.',
} as const;

/** 이동평균선 이름에 마우스를 올리면 보이는 설명. */
function maHelp(period: number): string {
  const span = period === 20 ? '약 한 달' : period === 60 ? '약 석 달' : '약 반년';
  return (
    `${period}일 이동평균선 — 최근 ${period}거래일(${span}) 종가의 평균을 날마다 이은 선입니다. ` +
    '하루하루의 오르내림을 걸러 흐름(추세)을 보여 줍니다. 가격이 선 위에 있으면 최근 평균보다 비싸게, 아래면 싸게 거래되는 중입니다. ' +
    (period === 20
      ? '짧은 흐름이라 가격 변화에 빨리 따라갑니다. 20일선이 60일선을 아래에서 위로 뚫으면 "골든크로스", 위에서 아래로 내려가면 "데드크로스"라고 부릅니다.'
      : period === 60
        ? '중간 흐름이라 천천히 움직입니다.'
        : '긴 흐름이라 가장 느리게 움직입니다.') +
    ' 지난 가격의 평균이라 항상 한발 늦게 따라옵니다(실제 거래 가격 기준).'
  );
}

/** 일봉을 받는 기간 — 1년 보기 + 120일 이동평균 + 1년 수익률이 다 되게(약 2년, 토스 3페이지 안). */
const CANDLE_DAYS = 800;

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: ReadonlyArray<{ key: T; label: string }>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 받기 결과 — 불러오는 중(null) / 실패 문구 / 값. */
type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; value: T };

function useLoad<T>(key: string | null, fn: () => Promise<T>): Load<T> {
  const [res, setRes] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    setRes({ state: 'loading' });
    fn()
      .then((value) => !cancelled && setRes({ state: 'ok', value }))
      .catch((e: Error) => !cancelled && setRes({ state: 'error', message: e.message }));
    return () => {
      cancelled = true;
    };
    // fn은 key가 같으면 같은 요청이다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return res;
}

/**
 * 관심종목 상세(2026-11-19 확장) — 요약(현재가·52주 범위·넣은 뒤 수익률·배당수익률), 기간 수익률, 일봉 차트(이동평균·목표가·내 매매·거래량)
 * 또는 월별 종가(전체 기간), 지수·다른 관심종목과 수익률 비교, 배당 이력·다음 배당, 내 매매 기록, "만약 샀다면", 미국 종목 정보, 메모.
 * 일봉·비교는 토스, 배당·미국 종목 정보는 한국투자증권 키가 있어야 한다 — 없으면 그 칸만 안내로 바꾼다.
 */
export default function WatchDetail({ entry, entries, onEntryChange }: { entry: WatchlistEntry; entries: WatchlistEntry[]; onEntryChange: (e: WatchlistEntry) => void }) {
  const { symbol, currency } = entry;
  const usd = currency === 'USD';
  const today = localToday();
  const { planner } = usePlanner();
  const target = planner?.watchTargets.find((t) => t.symbol === symbol);

  const candlesRes = useLoad<DailyCandle[]>(symbol, () => api.getDailyCandles(symbol, CANDLE_DAYS).then((r) => r.candles));
  const candles = useMemo(() => (candlesRes.state === 'ok' ? candlesRes.value : []), [candlesRes]);
  const last = entry.lastPrice ?? candles[candles.length - 1]?.close ?? null;

  const [chartMode, setChartMode] = useState<'daily' | 'monthly'>('daily');
  const [range, setRange] = useState<DailyRangeKey>('6m');
  const [maOn, setMaOn] = useState<Record<number, boolean>>({ 20: true, 60: true, 120: false });
  const [monthly, setMonthly] = useState<PricePoint[] | null>(null);
  const [monthlyPeriod, setMonthlyPeriod] = useState('RECENT');

  // 종목이 바뀌면 화면(Watchlist.tsx)이 key로 이 부품을 새로 만든다 — 보기 상태가 처음으로 돌아간다.

  // 월별 종가(상장 이후 전체)는 그 보기를 고를 때만 받는다(처음 보는 종목은 몇 초)
  useEffect(() => {
    if (chartMode !== 'monthly' || monthly !== null) return;
    let cancelled = false;
    api
      .getMonthlyClosePrices([symbol], 'all')
      .then((r) => !cancelled && setMonthly(r[symbol] ?? []))
      .catch(() => !cancelled && setMonthly([]));
    return () => {
      cancelled = true;
    };
  }, [chartMode, monthly, symbol]);

  const rangeDays = DAILY_RANGES.find((r) => r.key === range)!.days;
  const from = shiftDate(today, -rangeDays);
  const startIdx = Math.max(0, candles.findIndex((c) => c.date >= from));
  const shown = candles.slice(startIdx);
  const maLines = useMemo(
    () => MA_LINES.filter((m) => maOn[m.period]).map((m) => ({ ...m, values: movingAverage(candles, m.period).slice(startIdx) })),
    [candles, maOn, startIdx]
  );
  // 봉/선, 볼린저 밴드, 내 평균 매수가, 보조 지표(낙폭·RSI·변동성) — 지표는 자르기 전 전체 일봉으로 계산해 첫날부터 값이 있게
  const [priceMode, setPriceMode] = useState<'line' | 'candle'>('line');
  const [showBands, setShowBands] = useState(false);
  const [showAvgBuy, setShowAvgBuy] = useState(true);
  const [indicator, setIndicator] = useState<'drawdown' | 'rsi' | 'vol'>('drawdown');
  const bands = useMemo(() => {
    if (!showBands) return null;
    const b = bollinger(candles);
    return { upper: b.upper.slice(startIdx), lower: b.lower.slice(startIdx) };
  }, [candles, showBands, startIdx]);
  const indicatorValues = useMemo(() => {
    if (indicator === 'drawdown') return drawdownSeries(shown).points.map((p) => p.value);
    if (indicator === 'rsi') return rsi(candles).slice(startIdx);
    return rollingVolatility(candles).slice(startIdx);
    // shown은 candles·startIdx에서 나온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicator, candles, startIdx]);
  const maxDd = useMemo(() => drawdownSeries(shown).maxDrawdown, [shown]);
  const grid = useMemo(() => monthlyReturnGrid(candles), [candles]);

  const returns = useMemo(() => periodReturns(candles, last, today), [candles, last, today]);
  const r52 = useMemo(() => range52w(candles, last, today), [candles, last, today]);
  const added = useMemo(() => sinceAdded(entry.addedAt, entry.addedPrice, candles, last), [entry.addedAt, entry.addedPrice, candles, last]);

  // ---- 내 매매
  const tradesRes = useLoad<StoredTrade[]>(symbol, () => api.listTradesStore());
  const mine = useMemo(() => myTradeSummary(tradesRes.state === 'ok' ? tradesRes.value : [], symbol, currency, last), [tradesRes, symbol, currency, last]);

  // ---- 배당
  const divRes = useLoad<SymbolDividends>(`${symbol}:${currency}`, () => api.getSymbolDividends(symbol, usd ? 'USD' : 'KRW'));
  const divYield = useMemo(() => (divRes.state === 'ok' ? dividendYield(divRes.value.history, last, today) : null), [divRes, last, today]);

  // ---- 미국 종목 정보
  const overseasRes = useLoad<OverseasStockDetail>(usd ? symbol : null, () => api.getOverseasStockDetail(symbol));

  // ---- 비교: 기준 지수 ETF + 고른 관심종목(최대 2개)
  const bench = benchmarkFor(currency);
  const [compareRange, setCompareRange] = useState<DailyRangeKey>('1y');
  const [compareWith, setCompareWith] = useState<string[]>([]);
  const [extraCandles, setExtraCandles] = useState<Record<string, DailyCandle[] | 'error'>>({});
  useEffect(() => {
    const need = [bench.symbol, ...compareWith].filter((s) => s !== symbol && !(s in extraCandles));
    if (!need.length) return;
    for (const s of need)
      api
        .getDailyCandles(s, 400)
        .then((r) => setExtraCandles((m) => ({ ...m, [s]: r.candles })))
        .catch(() => setExtraCandles((m) => ({ ...m, [s]: 'error' })));
  }, [bench.symbol, compareWith, symbol, extraCandles]);
  const compareFrom = shiftDate(today, -DAILY_RANGES.find((r) => r.key === compareRange)!.days);
  const compareSeries = useMemo<CompareSeries[]>(() => {
    const out: CompareSeries[] = [{ key: symbol, label: entry.name, color: COMPARE_COLORS[0], points: normalizedSeries(candles, compareFrom) }];
    const b = extraCandles[bench.symbol];
    if (Array.isArray(b) && bench.symbol !== symbol) out.push({ key: bench.symbol, label: bench.name, color: COMPARE_COLORS[1], points: normalizedSeries(b, compareFrom), dashed: true });
    compareWith.forEach((s, i) => {
      const c = extraCandles[s];
      const name = entries.find((e) => e.symbol === s)?.name ?? s;
      if (Array.isArray(c)) out.push({ key: s, label: name, color: COMPARE_COLORS[2 + i], points: normalizedSeries(c, compareFrom) });
    });
    return out.filter((s) => s.points.length > 1);
  }, [symbol, entry.name, candles, compareFrom, extraCandles, bench, compareWith, entries]);
  const totalRet = useMemo(
    () => totalReturnSeries(candles, divRes.state === 'ok' ? divRes.value.history : [], compareFrom),
    [candles, divRes, compareFrom]
  );
  const compareCandidates = entries.filter((e) => e.symbol !== symbol && e.currency === currency);

  // ---- 만약 샀다면
  const [amount, setAmount] = useState('');
  const [whatIf, setWhatIf] = useState<{ result: WhatIf | null; note: string | null } | null>(null);
  const [whatIfBusy, setWhatIfBusy] = useState(false);
  const runWhatIf = async () => {
    const amt = Number(amount.replace(/,/g, ''));
    if (!(amt > 0) || !last) return setWhatIf({ result: null, note: '금액을 0보다 크게 입력하세요.' });
    setWhatIfBusy(true);
    try {
      const rates = await loadUsdKrwRates();
      const fx = effectiveRate(rates.manual, rates.live);
      const priceKrw = toKrw(last, currency, fx);
      if (priceKrw === null) return setWhatIf({ result: null, note: '환율을 구하지 못해 달러 가격을 원화로 바꿀 수 없습니다.' });
      const all = await loadAllHoldings().catch(() => null);
      let total: number | null = null;
      if (all) {
        total = 0;
        for (const l of all.lines) {
          const v = toKrw(l.marketValue, l.currency, all.fxRate);
          if (v === null) {
            total = null;
            break;
          }
          total += v;
        }
      }
      const failed = all?.failedBrokers.length ? ' 일부 증권사 보유를 불러오지 못해 비중은 그만큼 크게 나옵니다.' : '';
      setWhatIf({ result: whatIfBuy(amt, priceKrw, total), note: (total === null ? '내 전체 평가금액을 구하지 못해 비중은 빼고 보여 줍니다.' : '') + failed || null });
    } finally {
      setWhatIfBusy(false);
    }
  };

  // ---- 메모
  const [memo, setMemo] = useState(entry.memo ?? '');
  const [memoMsg, setMemoMsg] = useState<string | null>(null);
  useEffect(() => {
    setMemo(entry.memo ?? '');
    setMemoMsg(null);
  }, [symbol, entry.memo]);
  const saveMemo = async () => {
    try {
      onEntryChange({ ...entry, ...(await api.setWatchlistMemo(symbol, memo.trim() || null)) });
      setMemoMsg('저장했습니다.');
    } catch (e) {
      setMemoMsg((e as Error).message);
    }
  };

  const monthlyYears = useMemo(() => [...new Set((monthly ?? []).map((p) => p.month.slice(0, 4)))].sort().reverse(), [monthly]);
  const monthlyShown = useMemo(() => {
    const pts = monthly ?? [];
    if (monthlyPeriod === 'ALL') return pts;
    if (monthlyPeriod === 'RECENT') return pts.slice(-12);
    return pts.filter((p) => p.month.startsWith(monthlyPeriod));
  }, [monthly, monthlyPeriod]);

  const candleError = candlesRes.state === 'error' ? candlesRes.message : null;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        {entry.name} <span style={{ color: 'var(--text-muted)' }}>({symbol})</span>{' '}
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-muted)' }}>
          {entry.market ?? ''} {currency ?? ''}
        </span>
      </h3>

      {/* 요약 */}
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">현재가</div>
          <div className="value">{last !== null ? price(last, currency) : '-'}</div>
          {entry.changeRate != null && <div className={rateClass(entry.changeRate)} style={{ fontSize: 12 }}>전일 대비 {pct(entry.changeRate)}</div>}
        </div>
        <div className="stat-tile">
          <div className="label">52주 범위</div>
          {r52 ? (
            <>
              <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--gridline)', margin: '10px 0 6px' }} aria-label={`52주 범위에서 ${Math.round(r52.position * 100)}% 위치`}>
                <div style={{ position: 'absolute', left: `calc(${r52.position * 100}% - 5px)`, top: -3, width: 10, height: 12, borderRadius: 3, background: 'var(--series-1)' }} />
              </div>
              <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span title={r52.lowDate}>최저 {price(r52.low, currency)}</span>
                <span title={r52.highDate}>최고 {price(r52.high, currency)}</span>
              </div>
            </>
          ) : (
            <div className="value">-</div>
          )}
        </div>
        <div className="stat-tile">
          <div className="label">넣은 뒤 수익률</div>
          <div className={`value ${rateClass(added?.rate) ?? ''}`}>{added ? pct(added.rate) : '-'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {entry.addedAt.slice(0, 10)} {added ? `· ${added.basis === 'saved' ? '추가할 때' : '그날 종가'} ${price(added.base, currency)}` : ''}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">배당수익률 (최근 12개월, 세전)</div>
          <div className="value">{divYield?.yield != null ? `${(divYield.yield * 100).toFixed(2)}%` : '-'}</div>
          {divYield && divYield.perShare12m > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              주당 {price(divYield.perShare12m, currency)} · {divYield.cadence}
            </div>
          )}
        </div>
      </div>

      {/* 기간 수익률 */}
      {candles.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, margin: '4px 0 12px' }}>
          {returns.map((r) => (
            <span key={r.key}>
              <span style={{ color: 'var(--text-muted)' }}>{r.label}</span> <b className={rateClass(r.rate)}>{r.rate === null ? '-' : pct(r.rate)}</b>
            </span>
          ))}
        </div>
      )}

      <WatchTargetEditor symbol={symbol} currency={currency} />

      {/* 차트 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '12px 0 8px' }}>
        <h4 style={{ margin: 0 }}>시세</h4>
        <Seg label="차트 종류" value={chartMode} onChange={setChartMode} options={[{ key: 'daily', label: '일봉' }, { key: 'monthly', label: '월별 종가' }]} />
        {chartMode === 'daily' ? (
          <>
            <Seg label="일봉 기간" value={range} onChange={setRange} options={DAILY_RANGES} />
            <Seg label="차트 모양" value={priceMode} onChange={setPriceMode} options={[{ key: 'line', label: '선' }, { key: 'candle', label: '봉' }]} />
            {MA_LINES.map((m) => (
              <label key={m.period} style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={!!maOn[m.period]} onChange={(e) => setMaOn((s) => ({ ...s, [m.period]: e.target.checked }))} />
                <svg width={14} height={6} aria-hidden>
                  <line x1={0} x2={14} y1={3} y2={3} stroke={m.color} strokeWidth={2} />
                </svg>
                <span className="name-tip name-tip-below help-tip" data-full={maHelp(m.period)} tabIndex={0} aria-label={maHelp(m.period)}>
                  {m.period}일
                </span>
              </label>
            ))}
            <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={showBands} onChange={(e) => setShowBands(e.target.checked)} />
              <span className="name-tip name-tip-below help-tip" data-full={BANDS_HELP} tabIndex={0} aria-label={BANDS_HELP}>
                볼린저 밴드
              </span>
            </label>
            {mine.avgBuyPrice !== null && (
              <label style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={showAvgBuy} onChange={(e) => setShowAvgBuy(e.target.checked)} />
                <svg width={14} height={6} aria-hidden>
                  <line x1={0} x2={14} y1={3} y2={3} stroke="var(--series-5)" strokeWidth={2} />
                </svg>
                <span className="name-tip name-tip-below help-tip" data-full={AVG_HELP} tabIndex={0} aria-label={AVG_HELP}>
                  내 평균 매수가
                </span>
              </label>
            )}
          </>
        ) : (
          <select value={monthlyPeriod} aria-label="월별 종가 기간" onChange={(e) => setMonthlyPeriod(e.target.value)} disabled={!monthly?.length}>
            <option value="RECENT">최근 12개월</option>
            <option value="ALL">전체 기간</option>
            {monthlyYears.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        )}
      </div>
      {chartMode === 'daily' ? (
        candlesRes.state === 'loading' ? (
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        ) : candleError ? (
          <p style={{ color: 'var(--text-muted)' }}>{candleError}</p>
        ) : (
          <>
            <DailyPriceChart
              candles={shown}
              ma={maLines}
              currency={currency ?? 'KRW'}
              targets={{ above: target?.above ?? null, below: target?.below ?? null }}
              marks={mine.marks}
              mode={priceMode}
              bands={bands}
              avgBuy={showAvgBuy ? mine.avgBuyPrice : null}
            />
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              <span style={{ color: 'var(--series-1)' }}>▲</span> 내 매수 · <span style={{ color: 'var(--series-2)' }}>▼</span> 내 매도 · 점선은 목표가 · 아래 막대는 거래량
              {priceMode === 'candle' && ' · 봉: 초록 = 시가보다 오름, 빨강 = 내림(가는 선은 고가·저가)'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '12px 0 4px' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>보조 지표</span>
              <Seg
                label="보조 지표"
                value={indicator}
                onChange={setIndicator}
                options={[
                  { key: 'drawdown', label: '고점 대비 하락' },
                  { key: 'rsi', label: 'RSI' },
                  { key: 'vol', label: '변동성' },
                ]}
              />
              <span className="name-tip name-tip-below help-tip" data-full={INDICATOR_HELP[indicator]} tabIndex={0} aria-label={INDICATOR_HELP[indicator]} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                이게 뭔가요?
              </span>
              {indicator === 'drawdown' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>이 기간 최대 {(maxDd * 100).toFixed(1)}%</span>}
            </div>
            {indicator === 'drawdown' ? (
              <IndicatorChart dates={shown.map((c) => c.date)} values={indicatorValues} area color="var(--critical)" refLines={[{ value: 0, label: '0%' }]} fmt={(v) => `${(v * 100).toFixed(1)}%`} label="고점 대비" />
            ) : indicator === 'rsi' ? (
              <IndicatorChart
                dates={shown.map((c) => c.date)}
                values={indicatorValues}
                fixed={[0, 100]}
                refLines={[
                  { value: 70, label: '70 과열' },
                  { value: 30, label: '30 침체' },
                ]}
                fmt={(v) => v.toFixed(0)}
                label="RSI(14)"
              />
            ) : (
              <IndicatorChart dates={shown.map((c) => c.date)} values={indicatorValues} fmt={(v) => `${(v * 100).toFixed(0)}%`} label="변동성(20일, 연환산)" />
            )}
          </>
        )
      ) : monthly === null ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중... (처음 보는 종목은 상장 이후 전체 시세를 받느라 몇 초 걸릴 수 있습니다)</p>
      ) : (
        <PriceChart points={monthlyShown} />
      )}

      {/* 비교 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '20px 0 8px' }}>
        <h4 style={{ margin: 0 }}>수익률 비교</h4>
        <Seg label="비교 기간" value={compareRange} onChange={setCompareRange} options={DAILY_RANGES} />
        {compareCandidates.length > 0 && (
          <span style={{ fontSize: 12, display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            {compareCandidates.map((e) => {
              const on = compareWith.includes(e.symbol);
              return (
                <label key={e.symbol} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!on && compareWith.length >= 2}
                    onChange={(ev) => setCompareWith((s) => (ev.target.checked ? [...s, e.symbol] : s.filter((x) => x !== e.symbol)))}
                  />
                  {e.name}
                </label>
              );
            })}
          </span>
        )}
      </div>
      {candleError ? (
        <p style={{ color: 'var(--text-muted)' }}>{candleError}</p>
      ) : (
        <>
          <Hint>
            고른 기간 첫 거래일을 0%로 둔 누적 수익률입니다(배당 제외). 기준 지수는 지수 자체 일봉이 없어 국내는 KODEX 200, 미국은 SPY로 대신합니다.
            다른 관심종목은 같은 통화 종목에서 두 개까지 고릅니다.
          </Hint>
          <CompareChart series={compareSeries} />
        </>
      )}

      {/* 배당 포함 수익 */}
      {!candleError && divRes.state === 'ok' && totalRet.price.length > 1 && (
        <>
          <h4 style={{ margin: '20px 0 8px' }}>배당 포함 수익</h4>
          <Hint>
            비교 기간({DAILY_RANGES.find((r) => r.key === compareRange)!.label}) 첫날에 한 주를 샀다면 — 가격만의 수익과, 그동안 받은 배당(주당 세전 {price(totalRet.dividendSum, currency)}, 재투자 없이 현금)을
            더한 수익입니다. 수정주가 대신 실제 거래 가격에 배당 기록을 더해 계산합니다. 배당은 기준일 다음 거래일부터 받은 것으로 칩니다.
          </Hint>
          <CompareChart
            series={[
              { key: 'total', label: '배당 포함', color: COMPARE_COLORS[0], points: totalRet.total },
              { key: 'price', label: '가격만', color: COMPARE_COLORS[1], points: totalRet.price, dashed: true },
            ]}
          />
        </>
      )}

      {/* 월별 등락률 */}
      {!candleError && grid.length > 0 && (
        <>
          <h4 style={{ margin: '20px 0 8px' }}>월별 등락률</h4>
          <div className="table-scroll">
            <table style={{ fontSize: 12, textAlign: 'center' }}>
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i} style={{ textAlign: 'center' }}>
                      {i + 1}월
                    </th>
                  ))}
                  <th style={{ textAlign: 'center' }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.year}>
                    <th style={{ textAlign: 'left' }}>{row.year}</th>
                    {[...row.months, row.total].map((v, i) => (
                      <td
                        key={i}
                        style={{
                          background: v == null ? undefined : `color-mix(in srgb, var(${v >= 0 ? '--good' : '--critical'}) ${Math.round(Math.min(1, Math.abs(v) / 0.15) * 35)}%, transparent)`,
                          fontWeight: i === 12 ? 600 : undefined,
                        }}
                      >
                        {v == null ? '' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            % · 그 달 마지막 종가 ÷ 전달 마지막 종가(배당 제외, 실제 거래 가격) · 색이 진할수록 크게 움직인 달 · 합계는 그해 받은 달들을 이어 곱한 값
          </p>
        </>
      )}

      {/* 배당 */}
      <h4 style={{ margin: '20px 0 8px' }}>배당</h4>
      {divRes.state === 'loading' ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
      ) : divRes.state === 'error' ? (
        <p style={{ color: 'var(--text-muted)' }}>{divRes.message}</p>
      ) : divRes.value.history.length === 0 && divRes.value.upcoming.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>최근 1년여 동안 배당 기록이 없습니다.</p>
      ) : (
        <>
        <DividendBars history={divRes.value.history} upcoming={divRes.value.upcoming} fmt={(v) => price(v, currency)} />
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>지난 배당 (기준일 · 주당 세전)</div>
            <div className="table-scroll">
              <table>
                <tbody>
                  {[...divRes.value.history].reverse().slice(0, 8).map((e) => (
                    <tr key={e.recordDate}>
                      <td>{e.recordDate}</td>
                      <td>{e.perShare > 0 ? price(e.perShare, currency) : '금액 미정'}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{e.payDate ? `지급 ${e.payDate}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>다음 배당 (발표·추정, 지급일 · 주당 세전)</div>
            {divRes.value.upcoming.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>예정이나 추정할 수 있는 배당이 없습니다.</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <tbody>
                    {divRes.value.upcoming.slice(0, 6).map((e) => (
                      <tr key={e.recordDate}>
                        <td>{e.payDate ?? e.recordDate}</td>
                        <td>{price(e.perShare, currency)}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.status === 'estimated' ? '발표' : '추정'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </>
      )}

      {/* 내 매매 */}
      <h4 style={{ margin: '20px 0 8px' }}>내 매매 기록</h4>
      {tradesRes.state === 'loading' ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
      ) : mine.marks.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>매매내역에 이 종목 기록이 없습니다.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            매수 {qtyFmt.format(mine.buyQty)}주{mine.avgBuyPrice !== null && ` (평균 ${price(mine.avgBuyPrice, currency)})`} · 매도 {qtyFmt.format(mine.sellQty)}주
            {mine.lastSell && (
              <>
                {' '}
                · 마지막 매도 {mine.lastSell.date} {price(mine.lastSell.price, currency)}
                {mine.lastSell.rateSince !== null && (
                  <>
                    {' '}
                    → 판 뒤 <b className={rateClass(mine.lastSell.rateSince)}>{pct(mine.lastSell.rateSince)}</b>
                  </>
                )}
              </>
            )}
          </p>
          <div className="table-scroll">
            <table>
              <tbody>
                {[...mine.marks].reverse().slice(0, 5).map((m, i) => (
                  <tr key={i}>
                    <td>{m.date}</td>
                    <td>{m.side === 'BUY' ? '매수' : '매도'}</td>
                    <td>{qtyFmt.format(m.quantity)}주</td>
                    <td>{price(m.price, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 만약 샀다면 */}
      <h4 style={{ margin: '20px 0 8px' }}>만약 지금 산다면</h4>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="watch-whatif" style={{ fontSize: 13 }}>
          금액(원)
        </label>
        <input id="watch-whatif" inputMode="numeric" value={amount} placeholder="예: 1000000" onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} />
        <button type="button" className="ghost" disabled={whatIfBusy || !amount.trim()} onClick={() => void runWhatIf()}>
          {whatIfBusy ? '계산 중...' : '계산'}
        </button>
      </div>
      {whatIf && (
        <p style={{ fontSize: 13, margin: '6px 0 0' }}>
          {whatIf.result && (
            <>
              지금 가격으로 <b>{qtyFmt.format(whatIf.result.shares)}주</b>({krw.format(Math.round(whatIf.result.costKrw))}원, 남는 돈 {krw.format(Math.round(whatIf.result.leftoverKrw))}원)
              {whatIf.result.weight !== null && (
                <>
                  {' '}
                  · 산 뒤 내 전체 평가금액에서 <b>{(whatIf.result.weight * 100).toFixed(1)}%</b>
                </>
              )}
              {usd && ' · 달러 가격은 지금 환율로 바꿨습니다(수수료·환전 비용 제외)'}
            </>
          )}
          {whatIf.note && <span style={{ color: 'var(--text-muted)' }}> {whatIf.note}</span>}
        </p>
      )}

      {/* 미국 종목 정보 */}
      {usd && (
        <>
          <h4 style={{ margin: '20px 0 8px' }}>종목 정보 (한국투자증권)</h4>
          {overseasRes.state === 'loading' ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : overseasRes.state === 'error' ? (
            <p style={{ color: 'var(--text-muted)' }}>{overseasRes.message}</p>
          ) : (
            <div className="summary-row">
              {(
                [
                  ['PER', overseasRes.value.per?.toFixed(2)],
                  ['PBR', overseasRes.value.pbr?.toFixed(2)],
                  ['EPS', overseasRes.value.eps != null ? usdFmt.format(overseasRes.value.eps) : null],
                  ['BPS', overseasRes.value.bps != null ? usdFmt.format(overseasRes.value.bps) : null],
                  ['시가총액', overseasRes.value.marketCap ? usdCap(overseasRes.value.marketCap) : null],
                  ['52주 최고 · 최저', overseasRes.value.high52 != null && overseasRes.value.low52 != null ? `${usdFmt.format(overseasRes.value.high52)} · ${usdFmt.format(overseasRes.value.low52)}` : null],
                ] as const
              ).map(([label, v]) => (
                <div className="stat-tile" key={label}>
                  <div className="label">{label}</div>
                  <div className="value" style={{ fontSize: 15 }}>
                    {v ?? '-'}
                  </div>
                </div>
              ))}
            </div>
          )}
          {overseasRes.state === 'ok' && (overseasRes.value.sector || overseasRes.value.etpType) && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              업종 {overseasRes.value.sector ?? overseasRes.value.etpType} · 52주 최고·최저는 한국투자증권 값이라 위 요약(일봉 실제 가격)과 다를 수 있습니다
            </p>
          )}
        </>
      )}
      {!usd && <KisStockInsights symbol={symbol} />}

      {/* 메모 */}
      <h4 style={{ margin: '20px 0 8px' }}>메모</h4>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="관심을 둔 이유, 사려는 가격·조건 등"
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit' }}
        aria-label="관심종목 메모"
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button type="button" className="ghost" disabled={memo.trim() === (entry.memo ?? '')} onClick={() => void saveMemo()}>
          메모 저장
        </button>
        {memoMsg && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{memoMsg}</span>}
      </div>
    </div>
  );
}
