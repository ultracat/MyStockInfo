import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import type { PricePoint } from '../../components/PriceChart';
import type { DailyCandle, OverseasStockDetail, StoredTrade, SymbolDividends, WatchlistEntry } from '../../types';

// 관심종목 상세의 데이터 받기 — 2026-11-26 WatchDetail.tsx에서 옮겼다(동작 그대로). 화면 본체엔 보기 상태·배치만 남긴다
// (frontend/CLAUDE.md "큰 화면 파일 분할"). 종목이 바뀌면 Watchlist.tsx가 key로 상세를 새로 만들어 여기 상태도 처음부터다.

/** 일봉을 받는 기간 — 1년 보기 + 120일 이동평균 + 1년 수익률이 다 되게(약 2년, 토스 3페이지 안). */
const CANDLE_DAYS = 800;

/** 받기 결과 — 불러오는 중(null) / 실패 문구 / 값. */
export type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; value: T };

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
 * 일봉(토스)·내 매매(로컬)·배당 이력(한국투자증권)·미국 종목 정보(한국투자증권, 달러 종목만). `last`는 관심종목 현재가, 없으면 마지막 종가.
 */
export function useWatchData(entry: WatchlistEntry) {
  const { symbol, currency } = entry;
  const usd = currency === 'USD';
  const candlesRes = useLoad<DailyCandle[]>(symbol, () => api.getDailyCandles(symbol, CANDLE_DAYS).then((r) => r.candles));
  const candles = useMemo(() => (candlesRes.state === 'ok' ? candlesRes.value : []), [candlesRes]);
  const last = entry.lastPrice ?? candles[candles.length - 1]?.close ?? null;
  const tradesRes = useLoad<StoredTrade[]>(symbol, () => api.listTradesStore());
  const divRes = useLoad<SymbolDividends>(`${symbol}:${currency}`, () => api.getSymbolDividends(symbol, usd ? 'USD' : 'KRW'));
  const overseasRes = useLoad<OverseasStockDetail>(usd ? symbol : null, () => api.getOverseasStockDetail(symbol));
  return { candlesRes, candles, last, tradesRes, divRes, overseasRes };
}

/** 월별 종가(상장 이후 전체) — 그 보기를 고를 때(`enabled`)만 받는다(처음 보는 종목은 몇 초). 받기 전엔 null. */
export function useMonthlyCloses(symbol: string, enabled: boolean): PricePoint[] | null {
  const [monthly, setMonthly] = useState<PricePoint[] | null>(null);
  useEffect(() => {
    if (!enabled || monthly !== null) return;
    let cancelled = false;
    api
      .getMonthlyClosePrices([symbol], 'all')
      .then((r) => !cancelled && setMonthly(r[symbol] ?? []))
      .catch(() => !cancelled && setMonthly([]));
    return () => {
      cancelled = true;
    };
  }, [enabled, monthly, symbol]);
  return monthly;
}

/** 수익률 비교용 다른 종목 일봉(최근 400일) — `self`(지금 종목)는 받지 않는다. 실패한 종목은 'error'. */
export function useCompareCandles(symbols: string[], self: string): Record<string, DailyCandle[] | 'error'> {
  const [extraCandles, setExtraCandles] = useState<Record<string, DailyCandle[] | 'error'>>({});
  // 이미 요청한 종목 — 응답이 올 때마다 effect가 다시 돌아도 진행 중인 요청을 또 보내지 않게(2026-11-19 성능 리뷰)
  const requested = useRef(new Set<string>());
  const key = symbols.join(',');
  useEffect(() => {
    for (const s of key.split(',')) {
      if (!s || s === self || requested.current.has(s)) continue;
      requested.current.add(s);
      api
        .getDailyCandles(s, 400)
        .then((r) => setExtraCandles((m) => ({ ...m, [s]: r.candles })))
        .catch(() => setExtraCandles((m) => ({ ...m, [s]: 'error' })));
    }
  }, [key, self]);
  return extraCandles;
}
