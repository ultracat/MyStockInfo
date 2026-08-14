import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { getDataDir } from '../paths';

/**
 * Local cache of symbol → stock name, so an already-looked-up symbol never
 * hits the broker API again (see routes/stockInfo.ts). Keyed by symbol
 * alone, not by broker — a stock master lookup (Toss's `GET /api/v1/stocks`)
 * isn't account-scoped, so the same symbol means the same stock regardless
 * of which broker's dividend record references it.
 *
 * Uses `node:sqlite` (`DatabaseSync`) rather than the JSON-file `JsonStore`
 * every other local table in this app uses — this one's the exception
 * because it started life as flat JSON and was deliberately switched over.
 * `node:sqlite` is still flagged `@experimental` in Node's own type
 * definitions, but it needs no native addon (no `better-sqlite3`) and no
 * runtime flag on the Node/Electron versions this app actually ships on
 * (verified empirically: `ELECTRON_RUN_AS_NODE=1 electron -e
 * "require('node:sqlite')"` against this project's Electron 43.4.0 — bundled
 * Node 24.18.1 — works with zero flags; the same is true of the system
 * `node` used for the standalone dev fallback, v24.17.0) — which matters
 * because a native module here would have undone the packaging work in
 * electron/CLAUDE.md (`asar: true` + `npmRebuild: false` are only safe
 * because this project has zero native dependencies).
 */
export interface StockNameEntry {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  cachedAt: string;
}

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(path.join(getDataDir(), 'stockNames.sqlite'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_names (
      symbol TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      market TEXT,
      currency TEXT,
      cached_at TEXT NOT NULL
    )
  `);
  return db;
}

export function getCachedStockName(symbol: string): StockNameEntry | null {
  const row = getDb().prepare('SELECT symbol, name, market, currency, cached_at FROM stock_names WHERE symbol = ?').get(symbol);
  if (!row) return null;
  return {
    symbol: row.symbol as string,
    name: row.name as string,
    market: (row.market as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    cachedAt: row.cached_at as string,
  };
}

export function cacheStockName(entry: StockNameEntry): void {
  getDb()
    .prepare(
      `INSERT INTO stock_names (symbol, name, market, currency, cached_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         name = excluded.name,
         market = excluded.market,
         currency = excluded.currency,
         cached_at = excluded.cached_at`
    )
    .run(entry.symbol, entry.name, entry.market, entry.currency, entry.cachedAt);
}
