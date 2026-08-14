import { getCachedStockName, cacheStockName } from './db/stockNames';
import { displayNameOf, fetchTossStockInfo, isTossConfigured } from './brokers/toss/tossClient';

export interface ResolveStockNamesResult {
  /** Keyed by `symbol.toUpperCase()`. */
  namesBySymbol: Record<string, string>;
  /** `symbol.toUpperCase()` values that couldn't be resolved (not cached, and either
   *  토스 미연동 or the symbol wasn't found via `fetchTossStockInfo`). */
  unresolved: Set<string>;
}

/** Symbol → 종목명 조회 (캐시 우선 + 토스 종목 기본 정보 API, 최대 200개씩 청크) —
 *  배당금/보유종목 CSV 가져오기가 공유하는 로직. `refresh-names`(routes/dividends.ts)와
 *  같은 조합이지만 그쪽은 "이미 저장된 기록의 이름을 다시 채우는" 용도라 실패를 신경 안
 *  써도 되고, 이건 "가져오기 행 하나하나를 성공/실패로 나눠야" 해서 별도 함수로 뺐다. */
export async function resolveStockNames(symbols: string[]): Promise<ResolveStockNamesResult> {
  const namesBySymbol: Record<string, string> = {};
  const unresolved = new Set<string>();
  const toFetch: string[] = [];

  for (const raw of symbols) {
    const key = raw.toUpperCase();
    const cached = getCachedStockName(key);
    if (cached) {
      namesBySymbol[key] = cached.name;
    } else {
      toFetch.push(key);
    }
  }

  if (toFetch.length === 0) return { namesBySymbol, unresolved };

  if (!isTossConfigured()) {
    for (const s of toFetch) unresolved.add(s);
    return { namesBySymbol, unresolved };
  }

  for (let i = 0; i < toFetch.length; i += 200) {
    const chunk = toFetch.slice(i, i + 200);
    const infos = await fetchTossStockInfo(chunk);
    const found = new Set<string>();
    for (const info of infos) {
      const key = info.symbol.toUpperCase();
      const name = displayNameOf(info);
      namesBySymbol[key] = name;
      found.add(key);
      cacheStockName({
        symbol: key,
        name,
        market: info.market ?? null,
        currency: info.currency ?? null,
        cachedAt: new Date().toISOString(),
      });
    }
    for (const s of chunk) {
      if (!found.has(s)) unresolved.add(s);
    }
  }

  return { namesBySymbol, unresolved };
}
