// 토스증권 월별 종가(일봉 캔들 → 월말 종가, 디스크 캐시). 공통부는 tossCore.ts.
import { shapeForLog } from '../../logRedact';
import { withCache } from '../responseCache';
import { getCachedCloses, setCachedCloses, type CachedSymbolCloses } from '../../db/monthlyCloseCache';
import type { FetchOpts } from '../types';
import { toNum, tossFetch } from './tossCore';
import type { components } from './tossSpec.gen';
import { isTossConfigured } from './tossAccount';

type RawTossCandlesResponse = components['schemas']['CandlePageResponse'];

interface TossCandle {
  timestamp: string;
  closePrice: number;
  currency: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
}

/**
 * 일봉 한 페이지 조회 (`GET /api/v1/candles`, `MARKET_DATA_CHART` group, 공식
 * 스펙 openapi.tossinvest.com/openapi-docs/latest/openapi.json 확인, checked
 * 2026-08-17) — `/api/v1/prices`처럼 계좌 무관, KR/US 심볼 공통. 한 번에 최대
 * 200봉까지만 주므로(`count`), 여러 달치가 필요하면 `before`(직전 응답의
 * `nextBefore`)로 과거로 페이지네이션한다. `interval`은 `1d`(일봉)만 쓴다 —
 * 월봉 자체는 API에 없어서, 일봉을 모아 이 파일 아래 `fetchTossMonthlyClosePrices`가
 * 달마다 마지막 거래일 종가를 직접 뽑는다.
 */
// 이미 지나간 달의 종가는 다시 바뀌지 않는다(오늘이 속한 달의 봉만 장중에
// 계속 움직임) — 다른 broker 응답처럼 5초짜리 DEFAULT_TTL_MS를 쓰면 대시보드를
// 새로고침할 때마다(또는 여러 종목이 겹칠 때마다) 매번 다시 받아오게 되고,
// 종목 수만큼 호출이 늘어나는 이 엔드포인트 특성상(Overview.tsx가 대시보드
// 진입/새로고침마다 부름) 그 비용이 특히 크다. 몇 시간 단위로 넉넉히 캐싱해도
// "오늘 달의 종가가 몇 시간 묵을 수 있다"는 정도의 오차만 생기고, 그마저도
// 이미 fallback(오늘 현재가)이 있는 값이라 감수할 만하다.
const CANDLE_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4시간

async function fetchTossDailyCandlesPage(
  symbol: string,
  before: string | undefined,
  opts: FetchOpts = {},
  /** 수정주가 여부 — 안 주면 토스 기본(**수정주가**, 2026-11-19 실측: 분배금 많은 국내 ETF는 과거 종가가 분배금만큼 낮게 온다. SPY·삼성전자는 같음).
   *  `false`는 실제 체결 가격(관심종목 상세 — 내 매매가·52주 범위와 맞춰야 해서). */
  adjusted?: boolean
): Promise<{ candles: TossCandle[]; nextBefore: string | null }> {
  const params = new URLSearchParams({ symbol, interval: '1d', count: '200' });
  if (before) params.set('before', before);
  if (adjusted !== undefined) params.set('adjusted', String(adjusted));
  return withCache(
    `toss:candles:${symbol}:${before ?? 'latest'}${adjusted === undefined ? '' : `:adj=${adjusted}`}`,
    CANDLE_CACHE_TTL_MS,
    async () => {
      const raw = await tossFetch<any>(`/api/v1/candles?${params}`, 'MARKET_DATA_CHART');
      const data = (raw?.result ?? raw) as RawTossCandlesResponse;

      if (!data || !Array.isArray(data.candles)) {
        console.error('[toss] Unexpected /api/v1/candles response shape:', shapeForLog(raw));
        throw new Error('토스증권 일봉 조회 응답 형식이 예상과 다릅니다.');
      }

      return {
        candles: data.candles.map((c) => ({
          timestamp: c.timestamp,
          closePrice: toNum(c.closePrice),
          currency: c.currency,
          openPrice: toNum(c.openPrice),
          highPrice: toNum(c.highPrice),
          lowPrice: toNum(c.lowPrice),
          volume: toNum(c.volume),
        })),
        nextBefore: data.nextBefore ?? null,
      };
    },
    opts
  );
}

export interface MonthlyClosePrice {
  /** "YYYY-MM" */
  month: string;
  closePrice: number;
  currency: string;
}

function yearMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - n);
  return yearMonth(d);
}

function toMonthlyList(byMonth: Map<string, { closePrice: number; currency: string }>): MonthlyClosePrice[] {
  return Array.from(byMonth.entries())
    .map(([month, c]) => ({ month, closePrice: c.closePrice, currency: c.currency }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
}

/**
 * 종목 하나의 최근 `months`개월치 "월별 종가"(그 달의 마지막 거래일 종가)를
 * 구한다 — 일봉을 과거로 페이지네이션하며 모은 뒤 달마다 가장 최근(=timestamp가
 * 가장 큰) 봉의 종가를 고른다. 달력상 마지막 날이 아니라 "그 달 마지막 거래일"
 * 기준이라 휴장일/공휴일과 무관하게 항상 값이 나온다. 실패해도(토스 미연동,
 * 상장폐지/오타 등으로 종목을 못 찾음, 네트워크 오류) 예외를 던지지 않고 빈
 * 배열을 준다 — 호출부(Overview.tsx)가 그 종목/그 달은 오늘 현재가로 대체하는
 * fallback을 이미 갖고 있어서, 여기서 막을 이유가 없다.
 *
 * **확정된 달은 디스크에 영구 캐시한다**(`db/monthlyCloseCache.ts`) — 캐시가
 * 요청 범위를 이미 덮고 있으면 최신 일봉 한 페이지(이번 달·지난달 포함, 약
 * 9개월치)만 받아 합친다. "확정"은 지난달보다 이전 달만 친다 — 지난달 마지막
 * 거래일 종가는 한국 시간 1일 새벽(미국장 마감)까지 아직 안 나왔을 수 있어서,
 * 한 달 여유를 둬도 최신 페이지 하나에 항상 들어가므로 추가 비용이 없다.
 */
export async function fetchTossMonthlyClosePrices(
  symbol: string,
  months: number,
  opts: FetchOpts = {}
): Promise<MonthlyClosePrice[]> {
  if (!isTossConfigured()) return [];

  const finalizedBefore = monthsAgo(1); // 이 달 "미만"만 확정으로 취급
  const requiredFrom = monthsAgo(months);
  let cached: CachedSymbolCloses | null = null;
  try {
    cached = getCachedCloses(symbol);
  } catch (err) {
    console.error(`[toss] 월별 종가 캐시 읽기 실패 (${symbol}):`, err);
  }

  const byMonth = new Map<string, { closePrice: number; currency: string; timestamp: string }>();
  const mergePage = (candles: TossCandle[]) => {
    for (const c of candles) {
      const month = c.timestamp.slice(0, 7);
      const existing = byMonth.get(month);
      if (!existing || c.timestamp > existing.timestamp) {
        byMonth.set(month, { closePrice: c.closePrice, currency: c.currency, timestamp: c.timestamp });
      }
    }
  };

  try {
    if (cached && cached.coveredFrom <= requiredFrom) {
      const { candles } = await fetchTossDailyCandlesPage(symbol, undefined, opts);
      mergePage(candles);
      const merged = new Map<string, { closePrice: number; currency: string }>(Object.entries(cached.months));
      for (const [month, c] of byMonth) merged.set(month, c);
      return toMonthlyList(merged);
    }

    let before: string | undefined;
    let reachedStart = false;
    // 하루 평균 거래일 ~21일 기준 200봉 ≈ 9~10개월치라, 대부분 1~2페이지면
    // 충분하다. 상장 시작이 얼마 안 된 종목처럼 nextBefore가 일찍 null이 되는
    // 경우를 대비해 페이지 수 상한은 요청 기간에 맞춰 넉넉히 둔다(최소 5) —
    // 관심종목의 "전체 기간"(months=600)은 상장 초기까지 내려가야 해서 수십
    // 페이지가 필요할 수 있다(AAPL 1980년~ ≈ 60페이지, MARKET_DATA_CHART 20tps라
    // 몇 초). 한 번 끝까지 받으면 coveredFrom='0000-00'으로 캐시돼 이후엔 위
    // 캐시 경로(최신 1페이지)만 탄다.
    const maxPages = Math.min(80, Math.max(5, Math.ceil(months / 9) + 2));
    for (let page = 0; page < maxPages; page++) {
      const { candles, nextBefore } = await fetchTossDailyCandlesPage(symbol, before, opts);
      if (candles.length === 0) {
        reachedStart = page > 0;
        break;
      }
      mergePage(candles);
      if (!nextBefore) {
        reachedStart = true;
        break;
      }
      if (byMonth.size >= months + 2) break;
      before = nextBefore;
    }

    if (byMonth.size > 0) {
      const finalized: CachedSymbolCloses['months'] = { ...(cached?.months ?? {}) };
      for (const [month, c] of byMonth) {
        if (month < finalizedBefore) finalized[month] = { closePrice: c.closePrice, currency: c.currency };
      }
      const earliestFetched = [...byMonth.keys()].sort()[0];
      const coveredFrom = reachedStart ? '0000-00' : earliestFetched;
      try {
        setCachedCloses(symbol, { coveredFrom, months: finalized });
      } catch (err) {
        console.error(`[toss] 월별 종가 캐시 저장 실패 (${symbol}):`, err);
      }
    }

    return toMonthlyList(byMonth);
  } catch (err) {
    console.error(`[toss] 월별 종가 조회 실패 (${symbol}):`, err);
    // 최신 페이지 조회만 실패했으면 확정된 달이라도 돌려준다 — 그 달들은 어차피
    // 다시 안 바뀌는 값이라 프론트의 "오늘 현재가로 대체"보다 정확하다.
    return cached ? toMonthlyList(new Map(Object.entries(cached.months))) : [];
  }
}

/**
 * 직전 거래일 종가 고르기(순수 함수, 테스트 있음) — 관심종목 등락률용(2026-11-18). 토스 현재가 API엔 전일 종가가 없어서 일봉으로 구한다.
 * 일봉 `timestamp`는 그 거래일의 시작 시각이라, 가격 시각보다 **20시간 넘게 앞선** 봉 중 가장 최근 것을 직전 거래일로 본다 —
 * 오늘 봉은 장 시작(국내 9시·미국 프리마켓 포함)부터 가격 시각까지 길어야 16~17시간이고, 어제 봉은 24시간 이상 앞선다.
 * 주말·휴장일엔 가격 시각이 마지막 거래일이라 그 전 거래일이 고른다(그날의 등락). 못 고르면 null.
 */
export function previousCloseFrom(
  candles: Array<{ timestamp: string; closePrice: number }>,
  priceTime: Date
): number | null {
  const limit = priceTime.getTime() - 20 * 60 * 60 * 1000;
  let best: { t: number; close: number } | null = null;
  for (const c of candles) {
    const t = Date.parse(c.timestamp);
    if (!Number.isFinite(t) || t > limit || !(c.closePrice > 0)) continue;
    if (!best || t > best.t) best = { t, close: c.closePrice };
  }
  return best ? best.close : null;
}

/** 직전 거래일 종가 — 최신 일봉 한 페이지(4시간 캐시)를 쓴다. 토스 미연동·실패면 null. */
export async function fetchTossPreviousClose(symbol: string, priceTimeIso: string | null): Promise<number | null> {
  if (!isTossConfigured()) return null;
  try {
    const { candles } = await fetchTossDailyCandlesPage(symbol, undefined);
    return previousCloseFrom(candles, priceTimeIso ? new Date(priceTimeIso) : new Date());
  } catch {
    return null;
  }
}

/** 일봉 한 줄(관심종목 상세 차트, 2026-11-19). `date`는 그 거래일(YYYY-MM-DD). */
export interface DailyCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  currency: string;
}

/**
 * 일봉 `timestamp` → 거래일. 봉 시각은 국내 00:00 KST(= 전날 15:00 UTC), 미국 00:00 ET(= 04~05:00 UTC)라(2026-11-18 실측)
 * 12시간을 더한 UTC 날짜가 두 시장 모두 그 거래일이다(순수 함수, 테스트 있음).
 */
export function candleTradingDate(timestamp: string): string | null {
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 12 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 최근 `days`일(달력 기준)의 일봉 — 한 페이지 200봉(약 9개월)씩 과거로 넘긴다(최대 3페이지 ≈ 2년 반). 페이지마다 4시간 캐시.
 * **실제 가격(`adjusted=false`)** — 토스 기본은 수정주가라 분배금 많은 ETF의 과거 가격이 내 매수가·52주 고저와 어긋났다(2026-11-19).
 * 날짜 오름차순, 종가 0인 봉은 뺀다. 토스 미연동·실패면 예외(호출부가 409/502로 알린다).
 */
export async function fetchTossDailyCandles(symbol: string, days: number): Promise<DailyCandle[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const byDate = new Map<string, DailyCandle>();
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const { candles, nextBefore } = await fetchTossDailyCandlesPage(symbol, before, {}, false);
    let oldest: string | null = null;
    for (const c of candles) {
      const date = candleTradingDate(c.timestamp);
      if (!date || !(c.closePrice > 0)) continue;
      if (!oldest || date < oldest) oldest = date;
      if (date < since) continue;
      byDate.set(date, { date, open: c.openPrice, high: c.highPrice, low: c.lowPrice, close: c.closePrice, volume: c.volume, currency: c.currency });
    }
    if (!nextBefore || !oldest || oldest < since) break;
    before = nextBefore;
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}
