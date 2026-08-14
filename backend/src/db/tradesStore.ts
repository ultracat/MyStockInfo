import { randomUUID } from 'node:crypto';
import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId, TradeRecord } from '../brokers/types';

export interface StoredTrade {
  broker: BrokerId;
  accountId: string;
  id: string;
  symbol: string;
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

export function listTrades(filter?: { broker?: BrokerId; accountId?: string }): StoredTrade[] {
  return store()
    .read()
    .filter((t) => (filter?.broker ? t.broker === filter.broker : true))
    .filter((t) => (filter?.accountId ? t.accountId === filter.accountId : true));
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
