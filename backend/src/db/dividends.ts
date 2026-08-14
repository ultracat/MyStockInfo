import { randomUUID } from 'node:crypto';
import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId } from '../brokers/types';

export type DividendCurrency = 'KRW' | 'USD';

export interface DividendRecord {
  id: string;
  broker: BrokerId;
  symbol: string;
  name: string;
  currency: DividendCurrency;
  /** Dividend amount in `currency` (no cross-currency conversion here — the
   *  frontend converts USD rows to KRW for combined totals using the same
   *  live/manual FX rate Dashboard.tsx uses). */
  amount: number;
  /** Payment date, YYYY-MM-DD. */
  paidDate: string;
  memo: string | null;
}

export interface NewDividendInput {
  broker: BrokerId;
  symbol: string;
  name: string;
  currency: DividendCurrency;
  amount: number;
  paidDate: string;
  memo?: string | null;
}

function store() {
  return new JsonStore<DividendRecord[]>('dividends.json', getDataDir(), []);
}

export function listDividends(): DividendRecord[] {
  return store()
    .read()
    .sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1));
}

export function addDividend(input: NewDividendInput): DividendRecord {
  const record: DividendRecord = {
    id: randomUUID(),
    broker: input.broker,
    symbol: input.symbol,
    name: input.name,
    currency: input.currency,
    amount: input.amount,
    paidDate: input.paidDate,
    memo: input.memo ?? null,
  };
  store().update((current) => [...current, record]);
  return record;
}

export function deleteDividend(id: string): boolean {
  let removed = false;
  store().update((current) => {
    const next = current.filter((r) => r.id !== id);
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}

/** Overwrites `name` on every record whose `symbol` is a key in `namesBySymbol` — used by
 *  routes/dividends.ts's 이름 갱신 to bulk-replace manually-typed names with API-resolved ones. */
export function updateDividendNames(namesBySymbol: Record<string, string>): number {
  let updated = 0;
  store().update((current) =>
    current.map((r) => {
      const resolved = namesBySymbol[r.symbol];
      if (resolved === undefined || resolved === r.name) return r;
      updated += 1;
      return { ...r, name: resolved };
    })
  );
  return updated;
}
