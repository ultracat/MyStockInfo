import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId } from '../brokers/types';
import type { HoldingPosition } from '../brokers/types';

export interface StoredHolding {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  profitLossRate: number;
  commission: number | null;
  tax: number | null;
  updatedAt: string;
}

export interface UpsertHoldingInput {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  market?: string | null;
  currency?: string | null;
  quantity: number;
  lastPrice?: number;
  averagePurchasePrice: number;
  purchaseAmount?: number;
  marketValue?: number;
  profitLossAmount?: number;
  profitLossRate?: number;
  commission?: number | null;
  tax?: number | null;
}

function store() {
  return new JsonStore<StoredHolding[]>('holdings.json', getDataDir(), []);
}

export function listHoldings(filter?: { broker?: BrokerId; accountId?: string }): StoredHolding[] {
  return store()
    .read()
    .filter((h) => (filter?.broker ? h.broker === filter.broker : true))
    .filter((h) => (filter?.accountId ? h.accountId === filter.accountId : true));
}

/** 실시간 동기화(routes/holdings.ts)용 — 해당 (broker,accountId)의 기존 행을 전부
 *  지우고 방금 받아온 포지션으로 교체한다. 보유종목은 "현재 상태"의 스냅샷이지
 *  누적 히스토리가 아니므로, 팔아서 사라진 종목이 로컬 DB에 유령처럼 남지 않게
 *  이렇게 전체 교체한다. */
export function replaceSnapshot(broker: BrokerId, accountId: string, positions: HoldingPosition[]): void {
  const now = new Date().toISOString();
  const fresh: StoredHolding[] = positions.map((p) => ({
    broker,
    accountId,
    symbol: p.symbol,
    name: p.name,
    market: p.market,
    currency: p.currency,
    quantity: p.quantity,
    lastPrice: p.lastPrice,
    averagePurchasePrice: p.averagePurchasePrice,
    purchaseAmount: p.purchaseAmount,
    marketValue: p.marketValue,
    profitLossAmount: p.profitLossAmount,
    profitLossRate: p.profitLossRate,
    commission: p.commission,
    tax: p.tax,
    updatedAt: now,
  }));

  store().update((current) => [
    ...current.filter((h) => !(h.broker === broker && h.accountId === accountId)),
    ...fresh,
  ]);
}

/** CSV 가져오기/수동 입력용 — 심볼별 upsert. 실시간 동기화(`replaceSnapshot`)와 달리
 *  같은 (broker,accountId)의 다른 심볼 행을 지우지 않는다 — 사용자가 일부 종목만
 *  CSV로 넣는 경우(예: KB증권처럼 API 연동이 없는 브로커)가 흔해서, 전체 교체하면
 *  이미 입력해둔 다른 종목이 사라진다. */
export function upsertHoldings(rows: UpsertHoldingInput[]): void {
  const now = new Date().toISOString();
  store().update((current) => {
    const next = [...current];
    for (const row of rows) {
      const idx = next.findIndex(
        (h) => h.broker === row.broker && h.accountId === row.accountId && h.symbol === row.symbol
      );
      const entry: StoredHolding = {
        broker: row.broker,
        accountId: row.accountId,
        symbol: row.symbol,
        name: row.name,
        market: row.market ?? null,
        currency: row.currency ?? null,
        quantity: row.quantity,
        lastPrice: row.lastPrice ?? 0,
        averagePurchasePrice: row.averagePurchasePrice,
        purchaseAmount: row.purchaseAmount ?? row.averagePurchasePrice * row.quantity,
        marketValue: row.marketValue ?? 0,
        profitLossAmount: row.profitLossAmount ?? 0,
        profitLossRate: row.profitLossRate ?? 0,
        commission: row.commission ?? null,
        tax: row.tax ?? null,
        updatedAt: now,
      };
      if (idx === -1) next.push(entry);
      else next[idx] = entry;
    }
    return next;
  });
}

export function deleteHolding(broker: BrokerId, accountId: string, symbol: string): boolean {
  let removed = false;
  store().update((current) => {
    const next = current.filter(
      (h) => !(h.broker === broker && h.accountId === accountId && h.symbol === symbol)
    );
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}
