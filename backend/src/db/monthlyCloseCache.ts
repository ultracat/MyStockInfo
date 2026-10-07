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

// 아직 디스크에 안 쓴 새 캐시 항목 — fx/eximbankCache.ts와 같은 이유로 둔다.
// `routes/marketInfo.ts`의 `/monthly-close-prices`는 보유 종목 전체(수십 개)를
// `Promise.all`로 한꺼번에 조회하는데, 콜드 캐시라 종목마다 setCachedCloses가
// 불리면 그때마다 파일 전체(종목 수에 비례해 계속 커짐)를 다시 stringify+쓰기
// 했다 — 메모리에 모았다가 잠깐 뒤 한 번에 쓴다. 쓰기 전에 프로세스가 죽어도
// 잃는 건 "다음 조회 때 그 종목의 그 페이지를 한 번 더 받는다"뿐이다.
const pending = new Map<string, CachedSymbolCloses>();
let flushTimer: NodeJS.Timeout | null = null;
const FLUSH_DELAY_MS = 500;

function flush(): void {
  flushTimer = null;
  if (pending.size === 0) return;
  const entries = Object.fromEntries(pending);
  pending.clear();
  try {
    store().update((current) => ({ ...current, ...entries }));
  } catch (err) {
    console.error('[monthly-close-cache] 디스크 캐시 저장 실패:', err);
  }
}

export function getCachedCloses(symbol: string): CachedSymbolCloses | null {
  if (pending.has(symbol)) return pending.get(symbol)!;
  return store().read()[symbol] ?? null;
}

export function setCachedCloses(symbol: string, entry: CachedSymbolCloses): void {
  pending.set(symbol, entry);
  if (!flushTimer) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
    // 대기 중인 flush 하나 때문에 프로세스 종료가 늦어지지 않게.
    flushTimer.unref();
  }
}
