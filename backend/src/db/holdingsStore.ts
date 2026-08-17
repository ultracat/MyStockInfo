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
  /** CSV 가져오기에서만 쓰인다(예: IRP 계좌의 "개인납입액"/"회사납입액") — 같은
   *  심볼이 한 계좌에 여러 행으로 존재할 때 구분하는 자유 텍스트. `upsertHoldings`가
   *  이 값까지 포함해 행을 식별하므로, memo가 다르면 같은 심볼이어도 별도 행으로 쌓인다. */
  memo: string | null;
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
  memo?: string | null;
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
    memo: p.memo ?? null,
    updatedAt: now,
  }));

  store().update((current) => [
    ...current.filter((h) => !(h.broker === broker && h.accountId === accountId)),
    ...fresh,
  ]);
}

/** CSV 가져오기/수동 입력용 — (심볼, memo)별 upsert. 실시간 동기화(`replaceSnapshot`)와
 *  달리 같은 (broker,accountId)의 다른 행을 지우지 않는다 — 사용자가 일부 종목만
 *  CSV로 넣는 경우(예: KB증권처럼 API 연동이 없는 브로커)가 흔해서, 전체 교체하면
 *  이미 입력해둔 다른 종목이 사라진다.
 *
 *  memo까지 식별자에 포함하는 이유: IRP 계좌처럼 같은 종목을 "개인납입액"/
 *  "회사납입액"으로 나눠 관리하는 경우, 심볼만으로 식별하면 두 번째 행이 첫 번째
 *  행을 덮어써 하나가 사라진다. memo가 다르면(또는 한쪽만 있으면) 별도 행으로 쌓고,
 *  memo까지 같은 완전한 중복 행만 갱신(upsert) 대상으로 본다. */
export function upsertHoldings(rows: UpsertHoldingInput[]): void {
  const now = new Date().toISOString();
  store().update((current) => {
    const next = [...current];
    for (const row of rows) {
      const memo = row.memo?.trim() || null;
      const idx = next.findIndex(
        (h) =>
          h.broker === row.broker && h.accountId === row.accountId && h.symbol === row.symbol && h.memo === memo
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
        memo,
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
