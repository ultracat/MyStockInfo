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
   *  심볼이 한 계좌에 여러 행으로 존재할 때 화면에 구분해 보여주기 위한 자유 텍스트. */
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

/** CSV 가져오기 전용 — 가져온 CSV에 등장한 (broker,accountId) 조합마다, 그 계좌의
 *  기존 저장 행을 전부 지우고 이번 CSV로 받은 행으로 통째로 교체한다(실시간
 *  동기화 `replaceSnapshot`과 같은 "덮어쓰기" 방식 — CSV를 다시 가져오면 이전에
 *  넣어둔 행이 계속 누적되는 게 아니라 이번 CSV 내용이 곧 그 계좌의 전체가 된다).
 *  CSV에 등장하지 않은 다른 (broker,accountId)는 건드리지 않는다 — 계좌 하나만
 *  다시 가져와도 다른 계좌 데이터가 사라지지 않게.
 *
 *  같은 심볼이 CSV에 여러 번 나와도(예: IRP 계좌의 "개인납입액"/"회사납입액") 행별로
 *  식별해 병합하지 않고 CSV에 있는 그대로 각각 별도 행이 된다 — memo는 화면에
 *  구분 표시하기 위한 자유 텍스트일 뿐, 더 이상 행 식별에 쓰이지 않는다. */
export function replaceHoldingsFromImport(rows: UpsertHoldingInput[]): void {
  const now = new Date().toISOString();
  const touchedAccounts = new Set(rows.map((r) => `${r.broker}:${r.accountId}`));
  const fresh: StoredHolding[] = rows.map((row) => ({
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
    memo: row.memo?.trim() || null,
    updatedAt: now,
  }));

  store().update((current) => [
    ...current.filter((h) => !touchedAccounts.has(`${h.broker}:${h.accountId}`)),
    ...fresh,
  ]);
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
