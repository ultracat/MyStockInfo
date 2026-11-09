import {
  fetchTossIndicatorDailyCandles,
  fetchTossMarketCalendar,
  fetchTossSectorEtfs,
  fetchTossSectorStocks,
  fetchTossSectors,
  fetchTossStockWarnings,
  isTossConfigured,
} from './brokers/toss/tossClient';
import { fetchKisEtfComponents, isKisConfigured } from './brokers/kis/kisClient';
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
  /** 보통주 심볼 → 속한 대분류 섹터 이름들(한 종목이 여러 섹터일 수 있다). */
  bySymbol: Record<string, string[]>;
}

/** ETF 심볼 → 토스가 분류한 대분류 섹터 이름들(중·소분류에 들어간 ETF는 대분류로 올렸다). 따로 저장·백그라운드 생성. */
interface EtfSectorCache {
  date: string;
  etfBySymbol: Record<string, string[]>;
}

const sectorStore = () => new JsonStore<SectorCache | null>('toss-sector-cache.json', getDataDir(), null);
const etfSectorStore = () => new JsonStore<EtfSectorCache | null>('toss-sector-etf-cache.json', getDataDir(), null);
let sectorBuild: Promise<SectorCache> | null = null;
let etfSectorBuild: Promise<EtfSectorCache> | null = null;

function addTo(map: Record<string, string[]>, sym: string, name: string) {
  const list = (map[sym] ??= []);
  if (!list.includes(name)) list.push(name);
}

/** 대분류(depth 0) 섹터마다 국내·미국 구성 주식(하위 섹터 포함)으로 "종목 → 대분류" 표 — 약 80회 호출. 호출은 한꺼번에
 *  던지고 페이싱은 SECTOR 리미터(5tps)에 맡긴다(하나씩 await하면 지연 때문에 한도의 절반도 못 쓴다 — 실측). */
async function buildSectorMap(): Promise<SectorCache> {
  const sectors = await fetchTossSectors();
  const jobs = sectors
    .filter((s) => s.depth === 0)
    .flatMap((sector) => (['KR', 'US'] as const).map((c) => ({ sector, c })));
  const results = await Promise.all(jobs.map(({ sector, c }) => fetchTossSectorStocks(sector.sectorId, c).catch(() => [])));
  const bySymbol: Record<string, string[]> = {};
  results.forEach((symbols, k) => symbols.forEach((sym) => addTo(bySymbol, sym, jobs[k].sector.name)));
  const cache = { date: todayKst(), bySymbol };
  sectorStore().write(cache);
  return cache;
}

/** **모든 섹터**(대 39·중 158·소 103, 2026-11-09 실측) × 국내·미국의 관련 ETF로 "ETF → 대분류" 표 — ETF API가 하위 섹터를
 *  포함하지 않아 전부 돌아야 해서 약 600회(5tps에 2분 남짓). 화면을 막지 않게 백그라운드로 만든다. */
async function buildEtfSectorMap(): Promise<EtfSectorCache> {
  const sectors = await fetchTossSectors();
  const byId = new Map(sectors.map((s) => [s.sectorId, s]));
  const topNameOf = (id: string): string | null => {
    let cur = byId.get(id);
    for (let guard = 0; cur && cur.depth > 0 && guard < 5; guard++) cur = cur.parentSectorId ? byId.get(cur.parentSectorId) : undefined;
    return cur && cur.depth === 0 ? cur.name : null;
  };
  const jobs = sectors
    .map((s) => ({ s, top: topNameOf(s.sectorId) }))
    .filter((x): x is { s: (typeof sectors)[number]; top: string } => x.top !== null)
    .flatMap((x) => (['KR', 'US'] as const).map((c) => ({ ...x, c })));
  const results = await Promise.all(jobs.map(({ s, c }) => fetchTossSectorEtfs(s.sectorId, c).catch(() => [])));
  const etfBySymbol: Record<string, string[]> = {};
  results.forEach((symbols, k) => symbols.forEach((sym) => addTo(etfBySymbol, sym, jobs[k].top)));
  const cache = { date: todayKst(), etfBySymbol };
  etfSectorStore().write(cache);
  return cache;
}

export type SectorSource = 'stock' | 'preferred' | 'etf-components' | 'etf-sector';

/** 종목 하나의 섹터 배분 — weight 합은 1. `sector: null`은 분류 못 한 몫(ETF의 상위 30종목 밖·채권·현금 등). */
export interface SectorWeight {
  sector: string | null;
  weight: number;
}

const evenSplit = (sectors: string[]): SectorWeight[] => sectors.map((s) => ({ sector: s, weight: 1 / sectors.length }));

/** 국내 ETF 구성종목(한국투자증권, 비중 상위 30개)을 종목 섹터 표로 쪼갠다. 구성종목이 없거나 하나도 분류되지 않으면
 *  null(→ 토스 ETF 분류로 넘어감). 표에 없는 구성종목과 상위 30개 밖 나머지 비중은 `sector: null`. */
export function lookThroughEtf(
  components: Array<{ symbol: string; weightPct: number }>,
  stockSectors: (symbol: string) => string[] | undefined
): SectorWeight[] | null {
  const acc = new Map<string | null, number>();
  let mapped = 0;
  let total = 0;
  for (const c of components) {
    const w = c.weightPct / 100;
    if (!(w > 0)) continue;
    total += w;
    const sectors = stockSectors(c.symbol);
    if (!sectors || sectors.length === 0) {
      acc.set(null, (acc.get(null) ?? 0) + w);
      continue;
    }
    mapped += w;
    for (const s of sectors) acc.set(s, (acc.get(s) ?? 0) + w / sectors.length);
  }
  if (mapped <= 0) return null;
  // 비중 합이 100%를 넘게 오면(반올림·레버리지 등) 그 합으로 정규화한다.
  const denom = Math.max(1, total);
  const out = [...acc.entries()].map(([sector, w]) => ({ sector, weight: w / denom }));
  const rest = 1 - out.reduce((s, x) => s + x.weight, 0);
  if (rest > 1e-6) {
    const unk = out.find((x) => x.sector === null);
    if (unk) unk.weight += rest;
    else out.push({ sector: null, weight: rest });
  }
  return out;
}

/** 국내 6자리 코드는 앞 5자리가 같으면 같은 회사의 보통주/우선주다(우선주는 섹터 표에 없어서 보통주 섹터를 쓴다). */
function commonShareOf(symbol: string): string | null {
  return /^\d{5}[1-9]$/.test(symbol) ? `${symbol.slice(0, 5)}0` : null;
}

export async function getSectorsFor(symbols: string[]): Promise<{
  bySymbol: Record<string, string[]>;
  weights: Record<string, SectorWeight[]>;
  sources: Record<string, SectorSource>;
  date: string | null;
  /** 토스 ETF 분류표를 아직(오늘 것으로) 만드는 중 — 화면이 잠시 뒤 다시 부른다. */
  etfPending: boolean;
}> {
  if (!isTossConfigured()) return { bySymbol: {}, weights: {}, sources: {}, date: null, etfPending: false };

  let cache = sectorStore().read();
  if (!cache || cache.date !== todayKst()) {
    sectorBuild ??= buildSectorMap().finally(() => {
      sectorBuild = null;
    });
    try {
      cache = await sectorBuild;
    } catch {
      // 새로 못 만들면 어제 표라도 쓴다(섹터는 거의 안 바뀐다).
      if (!cache) return { bySymbol: {}, weights: {}, sources: {}, date: null, etfPending: false };
    }
  }
  // ETF 분류표: 오늘 것이 없으면 백그라운드로 만들기 시작하고, 있던 표(어제 것이라도)로 먼저 답한다. **종목 표를 다 받은
  // 뒤에** 시작한다 — 같은 SECTOR 리미터를 쓰므로 먼저 시작하면 ETF 600건 뒤에 종목 80건이 줄 서서 첫 화면이 2분 넘게
  // 걸렸다(실측).
  const etfCache = etfSectorStore().read();
  const etfFresh = !!etfCache && etfCache.date === todayKst();
  if (!etfFresh && !etfSectorBuild) {
    etfSectorBuild = buildEtfSectorMap()
      .catch((err) => {
        console.warn('[sectors] ETF 섹터 분류표 생성 실패:', (err as Error).message);
        return etfCache ?? { date: '', etfBySymbol: {} };
      })
      .finally(() => {
        etfSectorBuild = null;
      });
  }

  const stockMap = cache.bySymbol;
  const etfMap = etfCache?.etfBySymbol ?? {};
  const kis = isKisConfigured();
  const bySymbol: Record<string, string[]> = {};
  const weights: Record<string, SectorWeight[]> = {};
  const sources: Record<string, SectorSource> = {};

  for (const s of [...new Set(symbols)]) {
    if (stockMap[s]) {
      bySymbol[s] = stockMap[s];
      weights[s] = evenSplit(stockMap[s]);
      sources[s] = 'stock';
      continue;
    }
    const common = commonShareOf(s);
    if (common && stockMap[common]) {
      weights[s] = evenSplit(stockMap[common]);
      sources[s] = 'preferred';
      continue;
    }
    // 국내 ETF → 구성종목으로 쪼개기(한국투자증권 키가 있을 때). 주식 코드면 구성종목이 0개로 와서 건너뛴다.
    if (kis && /^[0-9A-Z]{6}$/.test(s)) {
      const comp = await fetchKisEtfComponents(s).catch(() => null);
      const look = comp
        ? lookThroughEtf(
            comp.components.map((c) => ({ symbol: c.stck_shrn_iscd, weightPct: Number(c.etf_cnfg_issu_rlim) })),
            (sym) => stockMap[sym] ?? (commonShareOf(sym) ? stockMap[commonShareOf(sym)!] : undefined)
          )
        : null;
      if (look) {
        weights[s] = look;
        sources[s] = 'etf-components';
        continue;
      }
    }
    if (etfMap[s]) {
      weights[s] = evenSplit(etfMap[s]);
      sources[s] = 'etf-sector';
    }
  }
  return { bySymbol, weights, sources, date: cache.date, etfPending: !etfFresh };
}
