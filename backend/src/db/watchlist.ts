import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/** 보유하지 않은 종목을 가격만 추적하려고 등록해두는 목록 — 계좌/브로커
 *  개념이 없다(`accountLabels.ts`의 `(broker, accountId)` 키와 달리 심볼 하나로만
 *  식별). `name`/`market`/`currency`는 등록 시점에 `resolveStockNames`로 한 번
 *  자동조회해 같이 저장해둔다(매번 다시 조회하지 않음 — 거의 안 바뀌는 값이라
 *  종목명 캐시(`db/stockNames.ts`)와 같은 전제). 현재가는 저장하지 않는다 —
 *  시시각각 바뀌는 값이라 `routes/watchlist.ts`가 조회마다 `resolveStockPrices`로
 *  라이브로 채운다(보유종목 CSV의 lastPrice 자동조회와 같은 원칙).
 */
export interface WatchlistEntry {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  addedAt: string;
  /** 추가할 때의 현재가(2026-11-19 — "넣은 뒤 수익률"). 그 전에 넣은 종목은 없다(화면이 추가한 날 종가로 대신한다). */
  addedPrice?: number | null;
  /** 관심을 둔 이유·사려는 조건 같은 메모(2026-11-19). */
  memo?: string | null;
}

function store() {
  return new JsonStore<WatchlistEntry[]>('watchlist.json', getDataDir(), []);
}

export function listWatchlist(): WatchlistEntry[] {
  return store().read();
}

/** 같은 심볼이 이미 있으면 덮어쓴다(upsert) — 자동조회 결과가 바뀌었을 수 있는
 *  경우(예: 처음엔 이름 조회에 실패해 수동으로 넣었다가 다시 추가) 에러 없이
 *  최신 값으로 갱신되게 한다. */
export function upsertWatchlistEntry(entry: Omit<WatchlistEntry, 'addedAt' | 'memo'>): WatchlistEntry {
  const existing = store()
    .read()
    .find((w) => w.symbol.toUpperCase() === entry.symbol.toUpperCase());
  // 다시 추가해도 처음 넣은 날·그때 가격·메모는 그대로 둔다.
  const full: WatchlistEntry = {
    ...entry,
    addedAt: existing?.addedAt ?? new Date().toISOString(),
    addedPrice: existing ? (existing.addedPrice ?? null) : (entry.addedPrice ?? null),
    memo: existing?.memo ?? null,
  };
  store().update((current) => {
    const idx = current.findIndex((w) => w.symbol.toUpperCase() === entry.symbol.toUpperCase());
    if (idx === -1) return [...current, full];
    const next = [...current];
    next[idx] = full;
    return next;
  });
  return full;
}

export function removeWatchlistEntry(symbol: string): boolean {
  let removed = false;
  store().update((current) => {
    const next = current.filter((w) => w.symbol.toUpperCase() !== symbol.toUpperCase());
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}

/** 메모를 바꾼다(빈 값이면 지움). 없는 종목이면 null. */
export function setWatchlistMemo(symbol: string, memo: string | null): WatchlistEntry | null {
  let updated: WatchlistEntry | null = null;
  store().update((current) =>
    current.map((w) => {
      if (w.symbol.toUpperCase() !== symbol.toUpperCase()) return w;
      updated = { ...w, memo: memo && memo.trim() ? memo.trim() : null };
      return updated;
    })
  );
  return updated;
}
