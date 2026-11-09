import {
  fetchTossIndicatorDailyCandles,
  fetchTossMarketCalendar,
  fetchTossSectorStocks,
  fetchTossSectors,
  fetchTossStockWarnings,
  isTossConfigured,
} from './brokers/toss/tossClient';
import { JsonStore } from './jsonStore';
import { getDataDir } from './paths';

// 토스 시장 정보(계좌 무관)로 만드는 보조 기능 — 장 운영 상태, 보유 종목 경고, 지수 월말 종가, 섹터 분류.
// 전부 토스 API 키만 있으면 되고, **어느 증권사 보유 종목에든** 적용된다(종목 코드 기준).
// 토스 미연동이면 각 함수가 빈 결과를 돌려주고, 화면은 이 기능 없이 예전처럼 동작한다.

// ---------------------------------------------------------------- 장 운영 상태

export type MarketSession = 'day' | 'pre' | 'regular' | 'after' | 'closed';

export interface MarketStatus {
  /** 지금 열려 있는 세션(없으면 closed). */
  session: MarketSession;
  /** 오늘(그 시장 기준 영업일 날짜)이 휴장인가 — 모든 세션이 null. */
  holidayToday: boolean;
  /** 다음 영업일(YYYY-MM-DD, 그 시장 기준). */
  nextBusinessDay: string | null;
}

type SessionWindow = { startTime: string; endTime: string } | null | undefined;

/** 세션 목록 중 `now`가 [start, end)에 드는 것을 찾는다. 미국 세션은 KST로 자정을 넘긴다(정규장 23:30~06:00). */
export function sessionAt(sessions: Array<[MarketSession, SessionWindow]>, now: number): MarketSession {
  for (const [name, w] of sessions) {
    if (!w) continue;
    const start = Date.parse(w.startTime);
    const end = Date.parse(w.endTime);
    if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now < end) return name;
  }
  return 'closed';
}

function daySessions(country: 'KR' | 'US', day: any): Array<[MarketSession, SessionWindow]> {
  if (!day) return [];
  if (country === 'KR') {
    const s = day.integrated;
    return s ? [['pre', s.preMarket], ['regular', s.regularMarket], ['after', s.afterMarket]] : [];
  }
  return [['day', day.dayMarket], ['pre', day.preMarket], ['regular', day.regularMarket], ['after', day.afterMarket]];
}

/** 캘린더 응답(전일/당일/익일) → 지금 상태. 미국 애프터마켓처럼 전일 세션이 오늘 아침까지 이어지는 경우가 있어
 *  세 날짜의 세션을 모두 본다. */
export function marketStatusFrom(country: 'KR' | 'US', cal: any, now: number): MarketStatus {
  const sessions = [
    ...daySessions(country, cal?.previousBusinessDay),
    ...daySessions(country, cal?.today),
    ...daySessions(country, cal?.nextBusinessDay),
  ];
  const today = daySessions(country, cal?.today);
  return {
    session: sessionAt(sessions, now),
    holidayToday: today.length === 0 || today.every(([, w]) => !w),
    nextBusinessDay: cal?.nextBusinessDay?.date ?? null,
  };
}

export async function getMarketStatus(): Promise<{ kr: MarketStatus | null; us: MarketStatus | null }> {
  if (!isTossConfigured()) return { kr: null, us: null };
  const now = Date.now();
  const [kr, us] = await Promise.all(
    (['KR', 'US'] as const).map((c) =>
      fetchTossMarketCalendar(c)
        .then((cal) => marketStatusFrom(c, cal, now))
        .catch(() => null)
    )
  );
  return { kr, us };
}

// ---------------------------------------------------------------- 보유 종목 경고

const WARNING_LABELS: Record<string, string> = {
  LIQUIDATION_TRADING: '정리매매',
  OVERHEATED: '단기과열',
  INVESTMENT_WARNING: '투자경고',
  INVESTMENT_RISK: '투자위험',
  VI_STATIC_AND_DYNAMIC: 'VI 발동',
  VI_STATIC: 'VI 발동',
  VI_DYNAMIC: 'VI 발동',
  STOCK_WARRANTS: '신주인수권',
};

export interface ActiveWarning {
  type: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
}

/** 오늘(KST) 기준 활성인 경고만 — `startDate <= 오늘 <= endDate`(endDate null = 진행 중). 문서대로 모르는
 *  유형도 버리지 않고 코드 그대로 라벨로 쓴다. */
export function activeWarnings(
  list: Array<{ warningType: string; startDate: string | null; endDate: string | null }>,
  today: string
): ActiveWarning[] {
  const out: ActiveWarning[] = [];
  for (const w of list) {
    if (w.startDate && w.startDate > today) continue;
    if (w.endDate && w.endDate < today) continue;
    out.push({ type: w.warningType, label: WARNING_LABELS[w.warningType] ?? w.warningType, startDate: w.startDate, endDate: w.endDate });
  }
  return out;
}

const SYMBOL_RE = /^[A-Za-z0-9.-]{1,20}$/;

export function todayKst(now = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/** 여러 종목의 활성 경고 — 경고가 있는 종목만 키로 넣는다. 종목 하나의 실패가 나머지를 막지 않는다. */
export async function getActiveWarnings(symbols: string[]): Promise<Record<string, ActiveWarning[]>> {
  if (!isTossConfigured()) return {};
  const today = todayKst();
  const out: Record<string, ActiveWarning[]> = {};
  const unique = [...new Set(symbols.filter((s) => SYMBOL_RE.test(s)))];
  await Promise.all(
    unique.map(async (s) => {
      const list = await fetchTossStockWarnings(s).catch(() => []);
      const active = activeWarnings(list, today);
      if (active.length > 0) out[s] = active;
    })
  );
  return out;
}

// ---------------------------------------------------------------- 지수 월말 종가

export const INDEX_SYMBOLS = ['KOSPI', 'KOSDAQ'] as const;

/** 일봉(최신순) → 달마다 마지막 거래일 종가(오래된 달부터). */
export function monthEndCloses(candles: Array<{ timestamp: string; closePrice: string }>): Array<{ month: string; close: number }> {
  const byMonth = new Map<string, { ts: string; close: number }>();
  for (const c of candles) {
    const close = Number(c.closePrice);
    if (!Number.isFinite(close)) continue;
    const month = c.timestamp.slice(0, 7);
    const prev = byMonth.get(month);
    if (!prev || c.timestamp > prev.ts) byMonth.set(month, { ts: c.timestamp, close });
  }
  return [...byMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, v]) => ({ month, close: v.close }));
}

/** 지수별 월말 종가 — months개월(+기준이 될 직전 달)을 덮도록 일봉 페이지 수를 정한다(200봉 ≈ 9개월). */
export async function getIndexMonthlyCloses(months: number): Promise<Record<string, Array<{ month: string; close: number }>>> {
  if (!isTossConfigured()) return {};
  const pages = Math.min(10, Math.ceil(((months + 1) * 21) / 200) + 1);
  const out: Record<string, Array<{ month: string; close: number }>> = {};
  for (const s of INDEX_SYMBOLS) {
    const candles = await fetchTossIndicatorDailyCandles(s, pages).catch(() => []);
    out[s] = monthEndCloses(candles).slice(-(months + 1));
  }
  return out;
}

// ---------------------------------------------------------------- 섹터 분류

interface SectorCache {
  /** KST 날짜 — 하루 한 번만 다시 만든다(토스 문서 권장: 섹터는 자주 바뀌지 않음). */
  date: string;
  /** 종목 심볼 → 속한 대분류 섹터 이름들(한 종목이 여러 섹터일 수 있다). */
  bySymbol: Record<string, string[]>;
}

const sectorStore = () => new JsonStore<SectorCache | null>('toss-sector-cache.json', getDataDir(), null);
let sectorBuild: Promise<SectorCache> | null = null;

/** 대분류(depth 0) 섹터마다 국내·미국 구성 주식을 받아 "종목 → 대분류" 표를 만든다(대분류 약 40개 × 2시장 ≈ 80회
 *  호출, 5tps라 수십 초). 디스크에 하루 캐시하고, 만드는 중 동시 호출은 하나로 합친다. 구성 주식은 **보통주만**이라
 *  ETF·우선주는 표에 없다(화면이 "ETF·기타"로 묶는다). */
async function buildSectorMap(): Promise<SectorCache> {
  const sectors = await fetchTossSectors();
  const top = sectors.filter((s) => s.depth === 0);
  const bySymbol: Record<string, string[]> = {};
  for (const sector of top) {
    for (const country of ['KR', 'US'] as const) {
      const symbols = await fetchTossSectorStocks(sector.sectorId, country).catch(() => []);
      for (const sym of symbols) {
        const list = (bySymbol[sym] ??= []);
        if (!list.includes(sector.name)) list.push(sector.name);
      }
    }
  }
  const cache = { date: todayKst(), bySymbol };
  sectorStore().write(cache);
  return cache;
}

export async function getSectorsFor(symbols: string[]): Promise<{ bySymbol: Record<string, string[]>; date: string | null }> {
  if (!isTossConfigured()) return { bySymbol: {}, date: null };
  let cache = sectorStore().read();
  if (!cache || cache.date !== todayKst()) {
    sectorBuild ??= buildSectorMap().finally(() => {
      sectorBuild = null;
    });
    try {
      cache = await sectorBuild;
    } catch {
      // 새로 못 만들면 어제 표라도 쓴다(섹터는 거의 안 바뀐다).
      if (!cache) return { bySymbol: {}, date: null };
    }
  }
  const out: Record<string, string[]> = {};
  for (const s of symbols) if (cache.bySymbol[s]) out[s] = cache.bySymbol[s];
  return { bySymbol: out, date: cache.date };
}
