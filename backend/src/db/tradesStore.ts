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
    for (const r of records) {
      const idx = next.findIndex((t) => t.broker === broker && t.accountId === accountId && t.id === r.id);
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
      if (idx === -1) next.push(entry);
      else next[idx] = entry;
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
    for (const row of rows) {
      const id = row.id || randomUUID();
      const idx = next.findIndex((t) => t.broker === row.broker && t.accountId === row.accountId && t.id === id);
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
      if (idx === -1) next.push(entry);
      else next[idx] = entry;
      inserted.push(entry);
    }
    return next;
  });
  return inserted;
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
