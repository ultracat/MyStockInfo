import { randomUUID } from 'node:crypto';
import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId, TradeRecord } from '../brokers/types';

export interface StoredTrade {
  broker: BrokerId;
  accountId: string;
  id: string;
  symbol: string;
  /** KIS/KB는 체결 내역 API가 종목명을 같이 내려줘서 write-through로 바로
   *  채워진다. 토스는 체결 API에 종목명이 없어 routes/trades.ts가
   *  stockNameResolver.ts로 별도 조회해 채운다. CSV 가져오기는 name 컬럼이
   *  있으면 그 값을, 없으면 같은 조회로 채운다 — routes/tradesStore.ts 참고. */
  name: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  commission: number | null;
  tax: number | null;
  executedAt: string;
}

export interface ImportTradeInput {
  broker: BrokerId;
  accountId: string;
  id?: string;
  symbol: string;
  name?: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  commission?: number | null;
  tax?: number | null;
  executedAt: string;
}

function store() {
  return new JsonStore<StoredTrade[]>('trades.json', getDataDir(), []);
}

// upsert 대상 행을 찾을 때 레코드마다 전체를 findIndex로 훑으면 O(저장 건수 ×
// 새 건수)라, 매매내역이 쌓일수록 연도별 재조회/CSV 가져오기가 눈에 띄게
// 느려진다 — (broker, accountId, id) → 배열 인덱스 맵을 한 번만 만들어 쓴다.
function tradeKey(broker: BrokerId, accountId: string, id: string): string {
  return `${broker}\u0000${accountId}\u0000${id}`;
}

function indexByKey(trades: StoredTrade[]): Map<string, number> {
  const index = new Map<string, number>();
  trades.forEach((t, i) => index.set(tradeKey(t.broker, t.accountId, t.id), i));
  return index;
}

function upsertInto(next: StoredTrade[], index: Map<string, number>, entry: StoredTrade): void {
  const key = tradeKey(entry.broker, entry.accountId, entry.id);
  const idx = index.get(key);
  if (idx === undefined) {
    index.set(key, next.length);
    next.push(entry);
  } else {
    next[idx] = entry;
  }
}

// 기존 저장분엔 name 필드 자체가 없던 레코드가 있다(이 필드가 생기기 전에 저장된
// 행) — JsonStore가 그대로 읽으면 undefined가 되는데, holdings의 memo/dividends의
// accountId와 같은 이유로 여기서 null로 정규화해 프론트가 항상 string | null만
// 다루게 한다.
function normalize(t: StoredTrade): StoredTrade {
  return { ...t, name: t.name ?? null };
}

export function listTrades(filter?: { broker?: BrokerId; accountId?: string }): StoredTrade[] {
  return store()
    .read()
    .filter((t) => (filter?.broker ? t.broker === filter.broker : true))
    .filter((t) => (filter?.accountId ? t.accountId === filter.accountId : true))
    .map(normalize);
}

/** 실시간 동기화(routes/trades.ts)용 — 브로커가 내려준 `id` 기준 upsert. 매매내역은
 *  보유종목과 달리 누적 히스토리라(연도별로 반복 조회돼도 같은 체결 건은 같은 id로
 *  다시 온다) 전체 교체가 아니라 upsert가 맞다. */
export function upsertTrades(broker: BrokerId, accountId: string, records: TradeRecord[]): void {
  store().update((current) => {
    const next = [...current];
    const index = indexByKey(next);
    for (const r of records) {
      const entry: StoredTrade = {
        broker,
        accountId,
        id: r.id,
        symbol: r.symbol,
        name: r.name ?? null,
        side: r.side,
        quantity: r.quantity,
        price: r.price,
        amount: r.amount,
        currency: r.currency,
        commission: r.commission,
        tax: r.tax,
        executedAt: r.executedAt,
      };
      upsertInto(next, index, entry);
    }
    return next;
  });
}

/** CSV 가져오기용 — `id`가 없는 행(수동/CSV로 넣는 행, 브로커 고유 체결번호가 없음)은
 *  새로 발급한다. `id`가 있으면 upsert. */
export function upsertFromImport(rows: ImportTradeInput[]): StoredTrade[] {
  const inserted: StoredTrade[] = [];
  store().update((current) => {
    const next = [...current];
    const index = indexByKey(next);
    for (const row of rows) {
      const id = row.id || randomUUID();
      const entry: StoredTrade = {
        broker: row.broker,
        accountId: row.accountId,
        id,
        symbol: row.symbol,
        name: row.name ?? null,
        side: row.side,
        quantity: row.quantity,
        price: row.price,
        amount: row.amount,
        currency: row.currency,
        commission: row.commission ?? null,
        tax: row.tax ?? null,
        executedAt: row.executedAt,
      };
      upsertInto(next, index, entry);
      inserted.push(entry);
    }
    return next;
  });
  return inserted;
}

/** Google Sheets 가져오기 전용 — 브로커/계좌 구분 없이 저장소 전체를 통째로
 *  교체한다(위 upsertFromImport는 id 기준으로 병합/누적하지만, 이건 시트에 없는
 *  기존 매매내역까지 전부 지운다). Sheets 내보내기가 매번 로컬 전체를 시트에
 *  덮어쓰는 것과 대칭을 이루도록, 가져오기도 시트 내용을 로컬의 유일한 진실로
 *  취급한다(부분 병합이 아님) — 사용자가 명시적으로 요청한 동작. 시트엔 id
 *  컬럼이 없어(TRADES_SHEET_HEADER 참고) 매번 새 id를 발급한다. */
export function replaceAllTrades(rows: ImportTradeInput[]): StoredTrade[] {
  const fresh: StoredTrade[] = rows.map((row) => ({
    broker: row.broker,
    accountId: row.accountId,
    id: row.id || randomUUID(),
    symbol: row.symbol,
    name: row.name ?? null,
    side: row.side,
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    currency: row.currency,
    commission: row.commission ?? null,
    tax: row.tax ?? null,
    executedAt: row.executedAt,
  }));
  store().write(fresh);
  return fresh;
}

/** 이미 저장된 매매내역 중 이름이 비어 있는 행만 채운다(`routes/tradesStore.ts`의
 *  `POST /refresh-names`) — name 필드가 생기기 전에 저장됐던 행(그래서 항상
 *  null)이나, 그때는 API 연동이 없어서 못 채웠던 행을 위한 일괄 백필용. 이미
 *  이름이 있는 행(CSV로 직접 입력한 이름 포함)은 덮어쓰지 않는다 — dividends의
 *  `updateDividendNames`(오타 정리 목적으로 전부 덮어씀)와 다른 점. */
export function updateTradeNames(namesBySymbol: Record<string, string>): number {
  let updated = 0;
  store().update((current) =>
    current.map((t) => {
      if (t.name) return t;
      const resolved = namesBySymbol[t.symbol.toUpperCase()];
      if (!resolved) return t;
      updated += 1;
      return { ...t, name: resolved };
    })
  );
  return updated;
}

export function deleteTrade(broker: BrokerId, accountId: string, id: string): boolean {
  let removed = false;
  store().update((current) => {
    const next = current.filter((t) => !(t.broker === broker && t.accountId === accountId && t.id === id));
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}
