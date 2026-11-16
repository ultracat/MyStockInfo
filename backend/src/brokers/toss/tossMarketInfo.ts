// 토스증권 시장 정보(계좌 무관, 토큰만 필요) — 장 달력·매수 유의사항·지수 일봉·섹터. 공통부는 tossCore.ts.
import { withCache } from '../responseCache';
import { tossFetch } from './tossCore';
// ---- 시장 정보(계좌 무관, 토큰만 필요) — 공식 스펙 v1.2.28 확인 2026-11-09. 응답은 문자열 그대로 두고
//      쓰는 쪽(src/marketInsights.ts)이 필요한 것만 숫자로 바꾼다.

/** 장 운영 정보(`GET /api/v1/market-calendar/{KR|US}`, `MARKET_INFO`) — 전일/당일/익일 3영업일, 세션별
 *  시작·종료 시각(KST ISO). 휴장 세션은 null. KR은 `integrated`(KRX+NXT 통합) 아래에 세션이 있다. */
export async function fetchTossMarketCalendar(country: 'KR' | 'US'): Promise<Record<string, unknown>> {
  return withCache(`toss:calendar:${country}`, 10 * 60_000, async () => {
    const raw = await tossFetch<any>(`/api/v1/market-calendar/${country}`, 'MARKET_INFO');
    return (raw?.result ?? raw) as Record<string, unknown>;
  });
}

export interface TossStockWarning {
  warningType: string;
  exchange: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** 매수 유의사항(`GET /api/v1/stocks/{symbol}/warnings`, `STOCK`) — 정리매매·단기과열·투자경고·투자위험·VI 등.
 *  종목당 한 번씩 불러야 해서 30분 캐시한다. */
export async function fetchTossStockWarnings(symbol: string): Promise<TossStockWarning[]> {
  return withCache(`toss:warnings:${symbol}`, 30 * 60_000, async () => {
    const raw = await tossFetch<any>(`/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`, 'STOCK');
    const list = raw?.result ?? raw;
    return Array.isArray(list) ? (list as TossStockWarning[]) : [];
  });
}

export interface TossIndicatorCandle {
  timestamp: string;
  closePrice: string;
}

/** 시장 지표 일봉(`GET /api/v1/market-indicators/{symbol}/candles`, `MARKET_INDICATOR_CHART`) — 지원 심볼은
 *  KOSPI·KOSDAQ·KR_BOND_* 8종뿐(미국 지수 없음). 최신순, 한 번에 최대 200봉, `nextBefore`로 과거 페이지. */
export async function fetchTossIndicatorDailyCandles(symbol: string, pages: number): Promise<TossIndicatorCandle[]> {
  return withCache(`toss:indicator-candles:${symbol}:${pages}`, 4 * 3600_000, async () => {
    const out: TossIndicatorCandle[] = [];
    let before: string | null = null;
    for (let page = 0; page < pages; page++) {
      const params = new URLSearchParams({ interval: '1d', count: '200' });
      if (before) params.set('before', before);
      const raw = await tossFetch<any>(`/api/v1/market-indicators/${encodeURIComponent(symbol)}/candles?${params}`, 'MARKET_INDICATOR_CHART');
      const data = raw?.result ?? raw;
      const candles = Array.isArray(data?.candles) ? (data.candles as TossIndicatorCandle[]) : [];
      out.push(...candles);
      before = data?.nextBefore ?? null;
      if (!before || candles.length === 0) break;
    }
    return out;
  });
}

export interface TossSector {
  sectorId: string;
  name: string;
  depth: number;
  parentSectorId: string | null;
}

/** 섹터 목록(`GET /api/v1/sectors`, `SECTOR`) — 토스 자체 산업 분류, 대(0)·중(1)·소(2)분류 계층. */
export async function fetchTossSectors(): Promise<TossSector[]> {
  const raw = await tossFetch<any>('/api/v1/sectors', 'SECTOR');
  const data = raw?.result ?? raw;
  return Array.isArray(data?.sectors) ? (data.sectors as TossSector[]) : [];
}

/** 섹터 구성 주식(`GET /api/v1/sectors/{sectorId}/stocks`, `SECTOR`) — 하위 섹터 포함, **보통주만**(ETF 없음). */
export async function fetchTossSectorStocks(sectorId: string, marketCountry: 'KR' | 'US'): Promise<string[]> {
  const raw = await tossFetch<any>(
    `/api/v1/sectors/${encodeURIComponent(sectorId)}/stocks?marketCountry=${marketCountry}`,
    'SECTOR'
  );
  const data = raw?.result ?? raw;
  return Array.isArray(data?.stocks) ? (data.stocks as Array<{ symbol: string }>).map((s) => s.symbol) : [];
}

/** 섹터 관련 ETF(`GET /api/v1/sectors/{sectorId}/etfs`, `SECTOR`) — 그 섹터로 분류된 ETF. **하위 섹터 미포함**이라
 *  대분류만 부르면 중·소분류에 들어간 ETF를 놓친다(공식 스펙 v1.2.28). */
export async function fetchTossSectorEtfs(sectorId: string, marketCountry: 'KR' | 'US'): Promise<string[]> {
  const raw = await tossFetch<any>(
    `/api/v1/sectors/${encodeURIComponent(sectorId)}/etfs?marketCountry=${marketCountry}`,
    'SECTOR'
  );
  const data = raw?.result ?? raw;
  return Array.isArray(data?.etfs) ? (data.etfs as Array<{ symbol: string }>).map((s) => s.symbol) : [];
}

/** `from`/`to` are inclusive YYYY-MM-DD (`orderedAt`-based, per docs). */
