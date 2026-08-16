import { getCachedStockName, cacheStockName } from './db/stockNames';
import { displayNameOf, fetchTossPrices, fetchTossStockInfo, isTossConfigured } from './brokers/toss/tossClient';
import { fetchKisDomesticPrice, isKisConfigured } from './brokers/kis/kisClient';

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

export interface ResolveStockPricesResult {
  /** Keyed by `symbol.toUpperCase()`. */
  pricesBySymbol: Record<string, number>;
}

const KR_SYMBOL_RE = /^\d{6}$/;

/** Symbol → 현재가 조회 — 보유종목 CSV 가져오기에서 사용자가 안 채운
 *  lastPrice/marketValue/profitLossAmount/profitLossRate를 자동으로 채우는
 *  데 쓴다(routes/holdingsStore.ts). 가격은 시시각각 바뀌는 값이라
 *  `resolveStockNames`와 달리 로컬에 캐시하지 않는다(그 함수의 SQLite
 *  캐시는 종목명처럼 거의 안 바뀌는 값 전용). 조회 실패는 이름 조회와 달리
 *  행을 실패 처리하지 않는다 — 현재가는 있으면 좋은 부가 정보일 뿐이라, 못
 *  가져오면 그냥 0으로 저장한다.
 *
 *  **토스 우선, 미연동이면 한국투자증권으로 대체**(`fetchKisDomesticPrice`) —
 *  다만 KIS의 국내주식현재가 조회는 국내(KR) 6자리 종목코드만 지원한다(해외는
 *  거래소코드가 필요한데 이 앱이 그 정보를 안 갖고 있어서 지원 안 함, 상세는
 *  `kisClient.ts`의 `fetchKisDomesticPrice` 주석 참고) — 그래서 토스가 없고
 *  KIS만 있는 경우, 해외 심볼은 여전히 현재가를 못 채운다(0으로 남음). */
export async function resolveStockPrices(symbols: string[]): Promise<ResolveStockPricesResult> {
  const pricesBySymbol: Record<string, number> = {};
  if (symbols.length === 0) return { pricesBySymbol };

  const upperSymbols = Array.from(new Set(symbols.map((s) => s.toUpperCase())));

  if (isTossConfigured()) {
    for (let i = 0; i < upperSymbols.length; i += 200) {
      const chunk = upperSymbols.slice(i, i + 200);
      try {
        const items = await fetchTossPrices(chunk);
        for (const item of items) {
          pricesBySymbol[item.symbol.toUpperCase()] = item.lastPrice;
        }
      } catch (err) {
        console.error('[stockPriceResolver] 토스 현재가 조회 실패:', err);
      }
    }
    return { pricesBySymbol };
  }

  if (isKisConfigured()) {
    for (const symbol of upperSymbols) {
      if (!KR_SYMBOL_RE.test(symbol)) continue; // 해외 심볼은 KIS로 조회 불가 — 스킵
      try {
        const price = await fetchKisDomesticPrice(symbol);
        if (price !== null) pricesBySymbol[symbol] = price;
      } catch (err) {
        console.error('[stockPriceResolver] KIS 현재가 조회 실패:', err);
      }
    }
  }

  return { pricesBySymbol };
}
