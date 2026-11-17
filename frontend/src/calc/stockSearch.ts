// 빠른 종목 검색(⌘K) — 보유·관심·배당·매매에 나온 종목을 한 목록으로 모으고 찾는다. 순수 함수, 테스트 frontend/test/analysis.test.ts.
import type { DividendRecord, StoredHolding, StoredTrade, WatchlistEntry } from '../types';

export interface StockIndexEntry {
  symbol: string;
  name: string;
  currency: string | null;
  held: StoredHolding[];
  watch: WatchlistEntry | null;
  dividends: DividendRecord[];
  trades: StoredTrade[];
}

export function buildStockIndex(holdings: StoredHolding[], watchlist: WatchlistEntry[], dividends: DividendRecord[], trades: StoredTrade[]): StockIndexEntry[] {
  const map = new Map<string, StockIndexEntry>();
  const entry = (symbol: string, name: string | null, currency: string | null) => {
    let e = map.get(symbol);
    if (!e) map.set(symbol, (e = { symbol, name: name || symbol, currency, held: [], watch: null, dividends: [], trades: [] }));
    if ((!e.name || e.name === symbol) && name) e.name = name;
    if (!e.currency && currency) e.currency = currency;
    return e;
  };
  for (const h of holdings) if (h.quantity > 0) entry(h.symbol, h.name, h.currency).held.push(h);
  for (const w of watchlist) entry(w.symbol, w.name, w.currency).watch = w;
  for (const d of dividends) entry(d.symbol, d.name, d.currency).dividends.push(d);
  for (const t of trades) entry(t.symbol, t.name ?? null, t.currency).trades.push(t);
  return [...map.values()];
}

/** 점수: 코드 완전 일치 > 코드 앞부분 > 이름 앞부분 > 이름·코드 포함. 같으면 보유 > 관심 > 나머지, 그다음 이름. 빈 검색어면 보유·관심만. */
export function searchStocks(index: StockIndexEntry[], query: string, limit = 12): StockIndexEntry[] {
  const q = query.trim().toUpperCase().replace(/\s+/g, '');
  const rank = (e: StockIndexEntry) => (e.held.length ? 0 : e.watch ? 1 : 2);
  const scored = index
    .map((e) => {
      if (!q) return { e, s: rank(e) < 2 ? 10 : -1 };
      const sym = e.symbol.toUpperCase();
      const name = e.name.toUpperCase().replace(/\s+/g, '');
      const s = sym === q ? 100 : sym.startsWith(q) ? 80 : name.startsWith(q) ? 60 : name.includes(q) || sym.includes(q) ? 40 : -1;
      return { e, s };
    })
    .filter((x) => x.s >= 0);
  scored.sort((a, b) => b.s - a.s || rank(a.e) - rank(b.e) || a.e.name.localeCompare(b.e.name, 'ko'));
  return scored.slice(0, limit).map((x) => x.e);
}
