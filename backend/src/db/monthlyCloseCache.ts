import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/**
 * 종목별 "이미 확정된 달"의 월별 종가 영구 캐시(`monthly-close-cache.json`) —
 * `tossClient.ts`의 `fetchTossMonthlyClosePrices` 전용. 지나간 달의 마지막
 * 거래일 종가는 다시 바뀌지 않으므로(fx/eximbankCache.ts의 과거 날짜 환율과 같은
 * 논리) 한 번 받아두면 앱을 재시작해도 과거 페이지를 다시 페이지네이션하지 않고
 * 최신 일봉 한 페이지만 받으면 된다 — 메모리 캐시(CANDLE_CACHE_TTL_MS)만 있을 땐
 * 재시작할 때마다 종목 수 × 1~2페이지를 처음부터 다시 받았다.
 *
 * `coveredFrom`은 "이 달부터 최근 확정 달까지는 빠짐없이 조회해봤다"는 표시다 —
 * 상장한 지 얼마 안 된 종목처럼 더 과거 데이터가 아예 없는 경우(토스가
 * `nextBefore: null`을 줌)는 `'0000-00'`으로 기록해 "그 이전엔 데이터가 없다"는
 * 것까지 캐시한다(안 그러면 그런 종목은 영원히 캐시 미스가 된다).
 */
export interface CachedSymbolCloses {
  coveredFrom: string;
  months: Record<string, { closePrice: number; currency: string }>;
}

type MonthlyCloseCacheFile = Record<string, CachedSymbolCloses>;

function store() {
  return new JsonStore<MonthlyCloseCacheFile>('monthly-close-cache.json', getDataDir(), {});
}

export function getCachedCloses(symbol: string): CachedSymbolCloses | null {
  return store().read()[symbol] ?? null;
}

export function setCachedCloses(symbol: string, entry: CachedSymbolCloses): void {
  store().update((current) => ({ ...current, [symbol]: entry }));
}
