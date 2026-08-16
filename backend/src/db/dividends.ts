import { randomUUID } from 'node:crypto';
import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId } from '../brokers/types';

export type DividendCurrency = 'KRW' | 'USD';

export interface DividendRecord {
  id: string;
  broker: BrokerId;
  /** 브로커 안에서 계좌를 구분하기 위한 선택 필드(예: KB증권 한 곳에 종합위탁/
   *  연금저축/IRP 계좌가 각각 따로 있는 경우) — 계좌 구분이 필요 없으면 null.
   *  라이브 브로커 API의 accountId 개념과는 무관하게, 사용자가 CSV/수동 입력에
   *  적어넣은 자유 문자열이다(holdings-store/trades-store의 accountId와 같은
   *  문자열을 쓰면 그쪽 화면들과도 같은 계좌로 매칭됨). */
  accountId: string | null;
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
  accountId?: string | null;
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

// accountId 필드가 생기기 전에 저장된 기존 기록은 이 필드가 아예 없다(JSON에
// 키 자체가 없음) — 읽을 때 항상 null로 정규화해서, 이 모듈 밖의 코드는
// `string | null`만 다루면 되게 한다(undefined 케이스를 안 신경 써도 됨).
function normalize(r: DividendRecord): DividendRecord {
  return { ...r, accountId: r.accountId ?? null };
}

export function listDividends(): DividendRecord[] {
  return store()
    .read()
    .map(normalize)
    .sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1));
}

export function addDividend(input: NewDividendInput): DividendRecord {
  const record: DividendRecord = {
    id: randomUUID(),
    broker: input.broker,
    accountId: input.accountId ?? null,
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

/** 배당 기록 화면의 인라인 수정용 — id를 뺀 모든 필드를 통째로 교체한다(부분
 *  patch가 아니라 폼 전체 재검증 후 덮어쓰기, 단건 추가와 같은 검증 통과 전제). */
export function updateDividend(id: string, input: NewDividendInput): DividendRecord | null {
  let updated: DividendRecord | null = null;
  store().update((current) =>
    current.map((r) => {
      if (r.id !== id) return r;
      updated = {
        id: r.id,
        broker: input.broker,
        accountId: input.accountId ?? null,
        symbol: input.symbol,
        name: input.name,
        currency: input.currency,
        amount: input.amount,
        paidDate: input.paidDate,
        memo: input.memo ?? null,
      };
      return updated;
    })
  );
  return updated;
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
