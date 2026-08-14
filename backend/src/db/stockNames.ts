import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/**
 * Local cache of symbol → stock name, so an already-looked-up symbol never
 * hits the broker API again (see routes/stockInfo.ts). Keyed by symbol
 * alone, not by broker — a stock master lookup (Toss's `GET /api/v1/stocks`)
 * isn't account-scoped, so the same symbol means the same stock regardless
 * of which broker's dividend record references it.
 */
export interface StockNameEntry {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  cachedAt: string;
}

function store() {
  return new JsonStore<Record<string, StockNameEntry>>('stockNames.json', getDataDir(), {});
}

export function getCachedStockName(symbol: string): StockNameEntry | null {
  return store().read()[symbol] ?? null;
}

export function cacheStockName(entry: StockNameEntry): void {
  store().update((current) => ({ ...current, [entry.symbol]: entry }));
}
