import { useMemo, useState } from 'react';
import { localToday } from '../../format';
import { usePlanner } from '../../usePlanner';
import PriceChart from '../../components/PriceChart';
import KisStockInsights from '../../components/KisStockInsights';
import { WatchTargetEditor } from '../../components/WatchTargetEditor';
import DailyPriceChart, { MA_LINES } from './DailyPriceChart';
import IndicatorChart from './IndicatorChart';
import {
  DAILY_RANGES,
  bollinger,
  drawdownSeries,
  monthlyReturnGrid,
  rollingVolatility,
  rsi,
  dividendYield,
  movingAverage,
  myTradeSummary,
  periodReturns,
  range52w,
  shiftDate,
  sinceAdded,
  type DailyRangeKey,
} from '../../calc/watchDetail';
import type { WatchlistEntry } from '../../types';
import { useMonthlyCloses, useWatchData } from './useWatchData';
import { WatchCompareSection } from './WatchCompareSection';
import { MonthlyReturnGrid, OverseasInfoSection, WatchDividendsSection, WatchTradesSection } from './WatchSections';
import { WatchMemo, WhatIfSection } from './WatchActions';
import { Seg, pct, price, rateClass } from './watchUi';

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

/**
 * 관심종목 상세(2026-11-19 확장) — 요약(현재가·52주 범위·넣은 뒤 수익률·배당수익률), 기간 수익률, 일봉 차트(이동평균·목표가·내 매매·거래량)
 * 또는 월별 종가(전체 기간), 지수·다른 관심종목과 수익률 비교, 배당 이력·다음 배당, 내 매매 기록, "만약 샀다면", 미국 종목 정보, 메모.
 * 일봉·비교는 토스, 배당·미국 종목 정보는 한국투자증권 키가 있어야 한다 — 없으면 그 칸만 안내로 바꾼다.
 *
 * 2026-11-26 나눴다(동작 그대로): 받기는 `useWatchData.ts`, 비교·배당 포함 수익은 `WatchCompareSection`, 월별 등락률·배당·내 매매·미국 종목
 * 정보는 `WatchSections`, "만약 지금 산다면"·메모는 `WatchActions`. 여기엔 요약·시세 차트(보기 상태)와 배치만 둔다.
 */
export default function WatchDetail({ entry, entries, onEntryChange }: { entry: WatchlistEntry; entries: WatchlistEntry[]; onEntryChange: (e: WatchlistEntry) => void }) {
  const { symbol, currency } = entry;
  const usd = currency === 'USD';
  const today = localToday();
  const { planner } = usePlanner();
  const target = planner?.watchTargets.find((t) => t.symbol === symbol);

  const { candlesRes, candles, last, tradesRes, divRes, overseasRes } = useWatchData(entry);

  const [chartMode, setChartMode] = useState<'daily' | 'monthly'>('daily');
  const [range, setRange] = useState<DailyRangeKey>('6m');
  const [maOn, setMaOn] = useState<Record<number, boolean>>({ 20: true, 60: true, 120: false });
  const [monthlyPeriod, setMonthlyPeriod] = useState('RECENT');

  // 종목이 바뀌면 화면(Watchlist.tsx)이 key로 이 부품을 새로 만든다 — 보기 상태가 처음으로 돌아간다.

  // 월별 종가(상장 이후 전체)는 그 보기를 고를 때만 받는다(처음 보는 종목은 몇 초)
  const monthly = useMonthlyCloses(symbol, chartMode === 'monthly');

  const rangeDays = DAILY_RANGES.find((r) => r.key === range)!.days;
  const from = shiftDate(today, -rangeDays);
  // 기간 안 첫 봉 — 하나도 없으면(일봉이 전부 기간 앞이거나 비었음) 빈 범위로 둔다. 예전엔 findIndex의 -1을 Math.max(0, -1) = 0으로
  // 받아 전체 이력을 그렸다(2026-11-26). 빈 범위면 차트 자리에 "기간 내 데이터 없음".
  const firstInRange = candles.findIndex((c) => c.date >= from);
  const startIdx = firstInRange === -1 ? candles.length : firstInRange;
  const shown = useMemo(() => candles.slice(startIdx), [candles, startIdx]);
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
  }, [indicator, candles, startIdx, shown]);
  const maxDd = useMemo(() => drawdownSeries(shown).maxDrawdown, [shown]);
  const grid = useMemo(() => monthlyReturnGrid(candles), [candles]);

  const returns = useMemo(() => periodReturns(candles, last, today), [candles, last, today]);
  const r52 = useMemo(() => range52w(candles, last, today), [candles, last, today]);
  const added = useMemo(() => sinceAdded(entry.addedAt, entry.addedPrice, candles, last), [entry.addedAt, entry.addedPrice, candles, last]);

  // ---- 내 매매
  const mine = useMemo(() => myTradeSummary(tradesRes.state === 'ok' ? tradesRes.value : [], symbol, currency, last), [tradesRes, symbol, currency, last]);

  // ---- 배당
  const divYield = useMemo(() => (divRes.state === 'ok' ? dividendYield(divRes.value.history, last, today) : null), [divRes, last, today]);

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
        ) : shown.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>기간 내 데이터 없음</p>
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

      <WatchCompareSection entry={entry} entries={entries} candles={candles} candleError={candleError} divRes={divRes} today={today} />

      {/* 월별 등락률 */}
      {!candleError && grid.length > 0 && <MonthlyReturnGrid grid={grid} />}

      {/* 배당 */}
      <WatchDividendsSection divRes={divRes} currency={currency} />

      {/* 내 매매 */}
      <WatchTradesSection loading={tradesRes.state === 'loading'} mine={mine} currency={currency} />

      {/* 만약 샀다면 */}
      <WhatIfSection last={last} currency={currency} />

      {/* 미국 종목 정보 */}
      {usd && <OverseasInfoSection overseasRes={overseasRes} />}
      {!usd && <KisStockInsights symbol={symbol} />}

      {/* 메모 */}
      <WatchMemo entry={entry} onEntryChange={onEntryChange} />
    </div>
  );
}
