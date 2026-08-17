import { getCachedStockName, cacheStockName } from './db/stockNames';
import { displayNameOf, fetchTossPrices, fetchTossStockInfo, isTossConfigured } from './brokers/toss/tossClient';
import { fetchKisDomesticPrice, fetchKisStockName, isKisConfigured } from './brokers/kis/kisClient';
import { fetchKbStockName, isKbConfigured } from './brokers/kb/kbClient';

const KR_SYMBOL_RE = /^\d{6}$/;

export interface ResolveStockNamesResult {
  /** Keyed by `symbol.toUpperCase()`. */
  namesBySymbol: Record<string, string>;
  /** `symbol.toUpperCase()` values that couldn't be resolved by any configured
   *  broker(토스/KIS/KB 전부 실패했거나 아무 것도 연동 안 됨). */
  unresolved: Set<string>;
}

/** Symbol → 종목명 조회 (캐시 우선, **토스 → 한국투자증권 → KB증권 순으로 시도**) —
 *  배당금/보유종목/매매내역 CSV 가져오기와 매매내역 실시간 조회(routes/trades.ts,
 *  Toss는 체결 API 자체에 종목명이 없어서 필요)가 공유하는 로직.
 *  `refresh-names`(routes/dividends.ts)와 같은 조합이지만 그쪽은 "이미 저장된
 *  기록의 이름을 다시 채우는" 용도라 실패를 신경 안 써도 되고, 이건 "가져오기 행
 *  하나하나를 성공/실패로 나눠야" 해서 별도 함수로 뺐다.
 *
 *  **3단계 우선순위**: 1) 토스 종목 기본정보(`fetchTossStockInfo`, 배치 최대 200개) —
 *  국내/해외 다 지원. 2) 남은 심볼 중 국내(KR) 6자리만 KIS 주식기본조회
 *  (`fetchKisStockName`, 건별) — 해외는 KIS로 조회 불가라 스킵. 3) 그래도 남은
 *  국내 심볼만 KB 종목기본정보(`fetchKbStockName`, 건별, 권한 없으면 null) 순으로
 *  시도한다. 각 단계는 "그 브로커가 연동돼 있을 때만" 실행하고, 이전 단계에서 이미
 *  풀린 심볼은 다시 조회하지 않는다 — `resolveStockPrices`의 토스→KIS 2단계
 *  폴백과 같은 패턴을 한 단계 더 늘린 것. KIS/KB로 해결된 항목은 국내 종목이라는
 *  전제로 market/currency를 'KR'/'KRW'로 캐싱한다(토스처럼 API가 직접 알려주지
 *  않으므로). */
export async function resolveStockNames(symbols: string[]): Promise<ResolveStockNamesResult> {
  const namesBySymbol: Record<string, string> = {};
  let toFetch: string[] = [];

  for (const raw of symbols) {
    const key = raw.toUpperCase();
    const cached = getCachedStockName(key);
    if (cached) {
      namesBySymbol[key] = cached.name;
    } else {
      toFetch.push(key);
    }
  }

  // 1) 토스 — 국내/해외 다 지원, 배치 조회.
  if (toFetch.length > 0 && isTossConfigured()) {
    const stillUnresolved: string[] = [];
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
        if (!found.has(s)) stillUnresolved.push(s);
      }
    }
    toFetch = stillUnresolved;
  }

  // 2) 한국투자증권 — 국내 6자리 종목코드만, 건별 조회.
  if (toFetch.length > 0 && isKisConfigured()) {
    const stillUnresolved: string[] = [];
    for (const symbol of toFetch) {
      if (!KR_SYMBOL_RE.test(symbol)) {
        stillUnresolved.push(symbol);
        continue;
      }
      let name: string | null = null;
      try {
        name = await fetchKisStockName(symbol);
      } catch (err) {
        console.error('[stockNameResolver] KIS 종목명 조회 실패:', err);
      }
      if (name) {
        namesBySymbol[symbol] = name;
        cacheStockName({ symbol, name, market: 'KR', currency: 'KRW', cachedAt: new Date().toISOString() });
      } else {
        stillUnresolved.push(symbol);
      }
    }
    toFetch = stillUnresolved;
  }

  // 3) KB증권 — 국내 6자리 종목코드만, 건별 조회(권한 없으면 fetchKbStockName이 null).
  if (toFetch.length > 0 && isKbConfigured()) {
    const stillUnresolved: string[] = [];
    for (const symbol of toFetch) {
      if (!KR_SYMBOL_RE.test(symbol)) {
        stillUnresolved.push(symbol);
        continue;
      }
      const name = await fetchKbStockName(symbol);
      if (name) {
        namesBySymbol[symbol] = name;
        cacheStockName({ symbol, name, market: 'KR', currency: 'KRW', cachedAt: new Date().toISOString() });
      } else {
        stillUnresolved.push(symbol);
      }
    }
    toFetch = stillUnresolved;
  }

  return { namesBySymbol, unresolved: new Set(toFetch) };
}

export interface ResolveStockPricesResult {
  /** Keyed by `symbol.toUpperCase()`. */
  pricesBySymbol: Record<string, number>;
}

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
