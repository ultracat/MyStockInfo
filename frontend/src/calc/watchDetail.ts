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

// ---- 보조 그래프(2026-11-19 두 번째 묶음) — 전부 실제 거래 가격(실주가) 기준 ----------------------------------------

/** 고점 대비 하락률 — 보기 기간 첫날부터의 최고 종가 대비(0 또는 음수). `maxDrawdown`은 그 기간 가장 깊었던 값. */
export function drawdownSeries(candles: Pick<DailyCandle, 'date' | 'close'>[]): { points: Array<{ date: string; value: number }>; maxDrawdown: number } {
  let peak = 0;
  let worst = 0;
  const points = candles.map((c) => {
    peak = Math.max(peak, c.close);
    const value = peak > 0 ? c.close / peak - 1 : 0;
    worst = Math.min(worst, value);
    return { date: c.date, value };
  });
  return { points, maxDrawdown: worst };
}

/**
 * 가격만의 수익률과 배당 포함 수익률 — 첫날 종가를 기준으로, 기준일이 기간 안에 든 배당(주당, 세전)을 **재투자하지 않고** 현금으로 더한다
 * ((종가 + 누적 배당) ÷ 첫날 종가 − 1). 수정주가를 쓰지 않고 "실제로 번 돈"을 보이려는 것(사용자 결정 2026-11-19 — 실주가 기준).
 * 배당은 기준일 다음 거래일(배당락)부터 받은 것으로 친다.
 */
export function totalReturnSeries(
  candles: DailyCandle[],
  dividends: SymbolDividendEvent[],
  from: string
): { price: Array<{ date: string; rate: number }>; total: Array<{ date: string; rate: number }>; dividendSum: number } {
  const rows = candles.filter((c) => c.date >= from);
  const base = rows[0]?.close;
  if (!base) return { price: [], total: [], dividendSum: 0 };
  const divs = dividends.filter((d) => d.perShare > 0 && d.recordDate >= rows[0].date).sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1));
  let k = 0;
  let cum = 0;
  const price: Array<{ date: string; rate: number }> = [];
  const total: Array<{ date: string; rate: number }> = [];
  for (const c of rows) {
    while (k < divs.length && divs[k].recordDate < c.date) cum += divs[k++].perShare;
    price.push({ date: c.date, rate: c.close / base - 1 });
    total.push({ date: c.date, rate: (c.close + cum) / base - 1 });
  }
  return { price, total, dividendSum: cum };
}

/** 월별 등락률 표(연 × 월) — 그 달 마지막 종가 ÷ 전달 마지막 종가 − 1. 일봉이 모자란 첫 달은 null. 최근 연도가 위. */
export function monthlyReturnGrid(candles: Pick<DailyCandle, 'date' | 'close'>[]): Array<{ year: string; months: (number | null)[]; total: number | null }> {
  const lastByMonth = new Map<string, number>();
  for (const c of candles) lastByMonth.set(c.date.slice(0, 7), c.close);
  const months = [...lastByMonth.keys()].sort();
  const rate = new Map<string, number>();
  months.forEach((m, i) => {
    if (i > 0) rate.set(m, lastByMonth.get(m)! / lastByMonth.get(months[i - 1])! - 1);
  });
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort().reverse();
  return years.map((year) => {
    const row = Array.from({ length: 12 }, (_, i) => rate.get(`${year}-${String(i + 1).padStart(2, '0')}`) ?? null);
    const have = row.filter((v): v is number => v !== null);
    return { year, months: row, total: have.length ? have.reduce((p, v) => p * (1 + v), 1) - 1 : null };
  });
}

/** 볼린저 밴드 — 20일 평균 ± 표준편차 × 2(모집단 표준편차, 흔한 기준). 앞쪽은 null. 누적합 창이라 O(n)(2026-11-19 성능 리뷰). */
export function bollinger(candles: Pick<DailyCandle, 'close'>[], period = 20, k = 2): { upper: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  let sum = 0;
  let sumSq = 0;
  candles.forEach((c, i) => {
    sum += c.close;
    sumSq += c.close * c.close;
    if (i >= period) {
      const old = candles[i - period].close;
      sum -= old;
      sumSq -= old * old;
    }
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      return;
    }
    const mean = sum / period;
    const sd = Math.sqrt(Math.max(0, sumSq / period - mean * mean)); // 부동소수 오차로 아주 작은 음수가 될 수 있다
    upper.push(mean + k * sd);
    lower.push(mean - k * sd);
  });
  return { upper, lower };
}

/** RSI(14, 와일더 평활) — 0~100. 앞쪽 `period`개는 null. 오르기만 했으면 100. */
export function rsi(candles: Pick<DailyCandle, 'close'>[], period = 14): (number | null)[] {
  const out: (number | null)[] = candles.map(() => null);
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close;
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const val = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + Math.max(0, d)) / period;
    loss = (loss * (period - 1) + Math.max(0, -d)) / period;
    out[i] = val();
  }
  return out;
}

/** 변동성 — 최근 `period`거래일 일간 수익률의 표준편차(표본)를 연율화(× √252). 0.3 = 연 30%. 앞쪽은 null. 누적합 창이라 O(n). */
export function rollingVolatility(candles: Pick<DailyCandle, 'close'>[], period = 20): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out.push(null);
      continue;
    }
    const r = candles[i].close / candles[i - 1].close - 1;
    sum += r;
    sumSq += r * r;
    if (i > period) {
      const old = candles[i - period].close / candles[i - period - 1].close - 1;
      sum -= old;
      sumSq -= old * old;
    }
    if (i < period) {
      out.push(null);
      continue;
    }
    const mean = sum / period;
    const variance = Math.max(0, (sumSq - period * mean * mean) / (period - 1));
    out.push(Math.sqrt(variance) * Math.sqrt(252));
  }
  return out;
}
