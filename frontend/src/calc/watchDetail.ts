// 관심종목 상세(2026-11-19) 계산 — 일봉으로 이동평균·기간 수익률·52주 범위·넣은 뒤 수익률·지수 비교,
// 내 매매 표시, "만약 샀다면", 배당수익률. 화면(pages/watchlist/)은 그리기만 한다. 테스트: frontend/test/watchDetail.test.ts.
import type { DailyCandle, StoredTrade, SymbolDividendEvent } from '../types';

/** 날짜 문자열(YYYY-MM-DD)을 `days`일 옮긴다. */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 종가의 단순 이동평균 — 앞쪽 `period - 1`개는 null. */
export function movingAverage(candles: Pick<DailyCandle, 'close'>[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    if (i >= period) sum -= candles[i - period].close;
    out.push(i >= period - 1 ? sum / period : null);
  });
  return out;
}

/** `date` 이전(같은 날 포함) 마지막 봉의 종가 — 그날이 휴장이면 직전 거래일. 범위 앞이면 null. */
export function closeOnOrBefore(candles: DailyCandle[], date: string): number | null {
  let found: number | null = null;
  for (const c of candles) {
    if (c.date > date) break;
    found = c.close;
  }
  return found;
}

/** `date` 이후(같은 날 포함) 첫 봉의 종가 — 추가한 날이 휴장이면 다음 거래일. */
export function closeOnOrAfter(candles: DailyCandle[], date: string): number | null {
  return candles.find((c) => c.date >= date)?.close ?? null;
}

export interface PeriodReturn {
  key: string;
  label: string;
  /** 0.05 = +5%. 그 기간만큼 일봉이 없으면 null. */
  rate: number | null;
}

/** 1주·1개월·3개월·6개월·올해·1년 수익률 — 기준은 그 날짜 이전 마지막 종가, 끝은 `last`(현재가, 없으면 마지막 종가). */
export function periodReturns(candles: DailyCandle[], last: number | null, today: string): PeriodReturn[] {
  const end = last ?? candles[candles.length - 1]?.close ?? null;
  const first = candles[0]?.date;
  const from = (date: string) => {
    if (!end || !first || date < first) return null;
    const base = closeOnOrBefore(candles, date);
    return base ? end / base - 1 : null;
  };
  return [
    { key: '1w', label: '1주', rate: from(shiftDate(today, -7)) },
    { key: '1m', label: '1개월', rate: from(shiftDate(today, -30)) },
    { key: '3m', label: '3개월', rate: from(shiftDate(today, -91)) },
    { key: '6m', label: '6개월', rate: from(shiftDate(today, -182)) },
    // 올해: 작년 마지막 거래일 종가 대비
    { key: 'ytd', label: '올해', rate: from(`${Number(today.slice(0, 4)) - 1}-12-31`) },
    { key: '1y', label: '1년', rate: from(shiftDate(today, -365)) },
  ];
}

export interface Range52w {
  low: number;
  lowDate: string;
  high: number;
  highDate: string;
  /** 0 = 최저, 1 = 최고. 범위가 0이면 0.5. */
  position: number;
}

/** 최근 52주(365일) 일봉의 고가·저가와 지금 가격의 위치. 장중 고저(high/low)를 쓴다(증권사 앱의 52주 최고·최저와 같은 기준). */
export function range52w(candles: DailyCandle[], last: number | null, today: string): Range52w | null {
  const since = shiftDate(today, -365);
  const rows = candles.filter((c) => c.date > since);
  if (!rows.length) return null;
  let hi = rows[0];
  let lo = rows[0];
  for (const c of rows) {
    if ((c.high || c.close) > (hi.high || hi.close)) hi = c;
    if ((c.low || c.close) < (lo.low || lo.close)) lo = c;
  }
  const high = hi.high || hi.close;
  const low = lo.low || lo.close;
  const price = last ?? rows[rows.length - 1].close;
  const span = high - low;
  const position = span > 0 ? Math.min(1, Math.max(0, (price - low) / span)) : 0.5;
  return { low, lowDate: lo.date, high, highDate: hi.date, position };
}

/**
 * 넣은 뒤 수익률 — 추가할 때 저장한 가격(`addedPrice`)이 있으면 그것, 없으면(2026-11-19 전에 넣은 종목) 추가한 날(이후 첫 거래일) 종가.
 * `basis`는 화면 문구용.
 */
export function sinceAdded(
  addedAt: string,
  addedPrice: number | null | undefined,
  candles: DailyCandle[],
  last: number | null
): { rate: number; base: number; basis: 'saved' | 'close' } | null {
  if (!last) return null;
  if (addedPrice && addedPrice > 0) return { rate: last / addedPrice - 1, base: addedPrice, basis: 'saved' };
  const day = addedAt.slice(0, 10);
  if (!candles.length || day < candles[0].date) return null;
  const base = closeOnOrAfter(candles, day);
  return base ? { rate: last / base - 1, base, basis: 'close' } : null;
}

/** 비교 차트 한 줄 — 첫 날 종가를 0%로 둔 누적 수익률(날짜 오름차순). */
export function normalizedSeries(candles: DailyCandle[], from: string): Array<{ date: string; rate: number }> {
  const rows = candles.filter((c) => c.date >= from);
  const base = rows[0]?.close;
  if (!base) return [];
  return rows.map((c) => ({ date: c.date, rate: c.close / base - 1 }));
}

export interface TradeMark {
  date: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

export interface MyTradeSummary {
  marks: TradeMark[];
  buyQty: number;
  sellQty: number;
  /** 가장 최근 매도 — 판 뒤 오른(내린) 비율(현재가 ÷ 판 가격 − 1). */
  lastSell: { date: string; price: number; rateSince: number | null } | null;
  /** 매수 평균가(이동평균 아님 — 모든 매수의 가중평균, 참고용). */
  avgBuyPrice: number | null;
}

/** 내 매매내역(로컬 저장소 전체) 중 이 종목 — 차트 표시와 "판 뒤 몇 %". 통화가 다른 기록은 뺀다. */
export function myTradeSummary(trades: StoredTrade[], symbol: string, currency: string | null, last: number | null): MyTradeSummary {
  const mine = trades
    .filter((t) => t.symbol.toUpperCase() === symbol.toUpperCase() && (!currency || t.currency === currency) && t.quantity > 0)
    .sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1));
  const marks = mine.map((t) => ({ date: t.executedAt.slice(0, 10), side: t.side, quantity: t.quantity, price: t.price }));
  const buys = mine.filter((t) => t.side === 'BUY');
  const sells = mine.filter((t) => t.side === 'SELL');
  const buyQty = buys.reduce((s, t) => s + t.quantity, 0);
  const sell = sells[sells.length - 1];
  return {
    marks,
    buyQty,
    sellQty: sells.reduce((s, t) => s + t.quantity, 0),
    lastSell: sell
      ? { date: sell.executedAt.slice(0, 10), price: sell.price, rateSince: last && sell.price > 0 ? last / sell.price - 1 : null }
      : null,
    avgBuyPrice: buyQty > 0 ? buys.reduce((s, t) => s + t.quantity * t.price, 0) / buyQty : null,
  };
}

export interface WhatIf {
  shares: number;
  /** 실제로 쓰는 금액(원) — 주 단위로 내림. */
  costKrw: number;
  leftoverKrw: number;
  /** 산 뒤 내 전체 평가금액에서 이 종목 비중(0~1). 전체를 모르면 null. */
  weight: number | null;
}

/** 원화 `amountKrw`로 지금 몇 주(정수)를 사고, 내 전체 평가금액(`portfolioKrw`, 원화 환산)에서 비중이 얼마가 되는지. */
export function whatIfBuy(amountKrw: number, priceKrw: number, portfolioKrw: number | null): WhatIf | null {
  if (!(amountKrw > 0) || !(priceKrw > 0)) return null;
  const shares = Math.floor(amountKrw / priceKrw);
  const costKrw = shares * priceKrw;
  const total = portfolioKrw !== null ? portfolioKrw + costKrw : null;
  return { shares, costKrw, leftoverKrw: amountKrw - costKrw, weight: total && total > 0 ? costKrw / total : null };
}

/** 최근 12개월 배당(기준일 기준, 금액 있는 것만)의 주당 합계와 현재가 대비 수익률(세전). 주기는 기준일 간격 중간값으로. */
export function dividendYield(
  history: SymbolDividendEvent[],
  last: number | null,
  today: string
): { perShare12m: number; yield: number | null; count12m: number; cadence: string | null } {
  const since = shiftDate(today, -365);
  const recent = history.filter((e) => e.recordDate > since && e.perShare > 0);
  const perShare12m = recent.reduce((s, e) => s + e.perShare, 0);
  const dated = history.filter((e) => e.perShare > 0).map((e) => e.recordDate);
  let cadence: string | null = null;
  if (dated.length >= 2) {
    const gaps = dated.slice(1).map((d, i) => (Date.parse(d) - Date.parse(dated[i])) / 864e5).sort((a, b) => a - b);
    const mid = gaps[Math.floor(gaps.length / 2)];
    cadence = mid < 10 ? '매주' : mid < 45 ? '매달' : mid < 135 ? '분기' : mid < 270 ? '반기' : '연 1회';
  } else if (dated.length === 1) cadence = '연 1회';
  return { perShare12m, yield: last && perShare12m > 0 ? perShare12m / last : null, count12m: recent.length, cadence };
}

/** 차트 보기 기간 — 일봉에서 화면으로 거를 시작일. */
export const DAILY_RANGES = [
  { key: '1m', label: '1개월', days: 30 },
  { key: '3m', label: '3개월', days: 91 },
  { key: '6m', label: '6개월', days: 182 },
  { key: '1y', label: '1년', days: 365 },
] as const;
export type DailyRangeKey = (typeof DAILY_RANGES)[number]['key'];

/** 비교 기준 지수 ETF — 국내는 KODEX 200(코스피 200), 미국은 SPY(S&P 500). 지수 자체 일봉 API가 없어 ETF로 대신한다. */
export function benchmarkFor(currency: string | null): { symbol: string; name: string } {
  return currency === 'USD' ? { symbol: 'SPY', name: 'S&P 500 (SPY)' } : { symbol: '069500', name: '코스피 200 (KODEX 200)' };
}
