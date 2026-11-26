import { useMemo, useState } from 'react';
import Hint from '../../components/Hint';
import CompareChart, { COMPARE_COLORS, type CompareSeries } from './CompareChart';
import { DAILY_RANGES, benchmarkFor, normalizedSeries, shiftDate, totalReturnSeries, type DailyRangeKey } from '../../calc/watchDetail';
import type { DailyCandle, SymbolDividends, WatchlistEntry } from '../../types';
import { useCompareCandles, type Load } from './useWatchData';
import { Seg, price } from './watchUi';

/**
 * 관심종목 상세의 "수익률 비교"(기준 지수 ETF + 같은 통화 관심종목 최대 2개)와 "배당 포함 수익" — 2026-11-26 WatchDetail.tsx에서 옮겼다(동작 그대로).
 * 비교 기간·고른 종목은 이 부품 상태다(종목이 바뀌면 상세가 새로 만들어져 처음으로).
 */
export function WatchCompareSection({
  entry,
  entries,
  candles,
  candleError,
  divRes,
  today,
}: {
  entry: WatchlistEntry;
  entries: WatchlistEntry[];
  candles: DailyCandle[];
  candleError: string | null;
  divRes: Load<SymbolDividends>;
  today: string;
}) {
  const { symbol, currency } = entry;
  const bench = benchmarkFor(currency);
  const [compareRange, setCompareRange] = useState<DailyRangeKey>('1y');
  const [compareWith, setCompareWith] = useState<string[]>([]);
  const extraCandles = useCompareCandles([bench.symbol, ...compareWith], symbol);
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

  return (
    <>
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
    </>
  );
}
