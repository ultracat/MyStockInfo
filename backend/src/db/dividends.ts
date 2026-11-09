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
  /** 원천징수 세금(`currency` 기준). **`amount`는 세후 실수령액**이고 세전은 `amount + tax`다
   *  (2026-11-09 사용자 결정 — 모든 화면의 배당 합계는 세후). 모르면 null(직접 입력 기록 대부분).
   *  토스 미국 배당은 현지 원천징수 후 금액이 와서 tax가 0이다(토스가 현지 세금을 알려주지 않음). */
  tax: number | null;
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
  tax?: number | null;
}

function store() {
  return new JsonStore<DividendRecord[]>('dividends.json', getDataDir(), []);
}

// accountId 필드가 생기기 전에 저장된 기존 기록은 이 필드가 아예 없다(JSON에
// 키 자체가 없음) — 읽을 때 항상 null로 정규화해서, 이 모듈 밖의 코드는
// `string | null`만 다루면 되게 한다(undefined 케이스를 안 신경 써도 됨).
function normalize(r: DividendRecord): DividendRecord {
  return { ...r, accountId: r.accountId ?? null, tax: r.tax ?? null };
}

export function listDividends(): DividendRecord[] {
  return store()
    .read()
    .map((r) => (r.accountId === undefined ? normalize(r) : r))
    .sort((a, b) => (a.paidDate < b.paidDate ? 1 : -1));
}

function toRecord(input: NewDividendInput): DividendRecord {
  return {
    id: randomUUID(),
    broker: input.broker,
    accountId: input.accountId ?? null,
    symbol: input.symbol,
    name: input.name,
    currency: input.currency,
    amount: input.amount,
    paidDate: input.paidDate,
    memo: input.memo ?? null,
    tax: input.tax ?? null,
  };
}

export function addDividend(input: NewDividendInput): DividendRecord {
  const record = toRecord(input);
  store().update((current) => [...current, record]);
  return record;
}

/** CSV 가져오기(부분 추가, `replaceAllDividends`와 달리 기존 기록을 안 지움)용
 *  배치 추가 — `addDividend`를 행마다 반복 호출하면 그때마다 전체 JSON 파일을
 *  다시 읽고 써서, 몇백 건짜리 CSV를 가져올 때 파일이 커질수록 매 행이 점점
 *  느려진다(O(n²)). 한 번의 read-modify-write로 끝낸다. */
export function addDividends(inputs: NewDividendInput[]): DividendRecord[] {
  const records = inputs.map(toRecord);
  store().update((current) => [...current, ...records]);
  return records;
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
        tax: input.tax ?? null,
      };
      return updated;
    })
  );
  return updated;
}

/** Google Sheets 가져오기 전용 — 기존 배당 기록을 전부 지우고 rows로 다시
 *  채운다(addDividend를 행마다 반복 호출하는 CSV 가져오기는 항상 추가만 되는
 *  반면, 이건 시트에 없는 기존 기록까지 지운다). Sheets 내보내기가 매번 로컬
 *  전체를 시트에 덮어쓰는 것과 대칭을 이루도록, 가져오기도 시트 내용을 로컬의
 *  유일한 진실로 취급한다(부분 병합이 아님) — 사용자가 명시적으로 요청한 동작. */
export function replaceAllDividends(
  rows: NewDividendInput[],
  /** 이 조건에 맞는 기존 기록은 지우지 않고 남긴다 — API 동기화 계좌(토스·한국투자증권)의 배당은
   *  시트가 아니라 API가 원천이라서(brokers/rowOwnership.ts의 `isDividendSyncOwned`). */
  preserve: (r: DividendRecord) => boolean = () => false
): DividendRecord[] {
  const kept = listDividends().filter(preserve);
  const fresh: DividendRecord[] = rows.map((input) => ({
    id: randomUUID(),
    broker: input.broker,
    accountId: input.accountId ?? null,
    symbol: input.symbol,
    name: input.name,
    currency: input.currency,
    amount: input.amount,
    paidDate: input.paidDate,
    memo: input.memo ?? null,
    tax: input.tax ?? null,
  }));
  store().write([...kept, ...fresh]);
  return fresh;
}

function syncKey(r: { symbol: string; currency: string; paidDate: string; amount: number; tax?: number | null }): string {
  return `${r.symbol.toUpperCase()}|${r.currency}|${r.paidDate}|${Math.round(r.amount * 100)}|${Math.round((r.tax ?? 0) * 100)}`;
}

export interface SyncReplaceResult {
  added: number;
  removed: number;
  unchanged: number;
}

/** API 동기화 계좌의 배당 기록을 API 결과로 **통째로 교체**한다(토스·한국투자증권 — API가 유일한 원천).
 *  `inScope`에 맞는 그 브로커의 기존 기록을 전부 rows로 바꾸고, 다른 기록은 건드리지 않는다.
 *  내용(종목·통화·날짜·세후·세금)이 같은 기존 기록의 id는 이어받아 화면의 행이 흔들리지 않게 한다. */
export function replaceSyncedDividends(
  broker: BrokerId,
  /** 이번 동기화가 교체할 기존 기록 — 범위 밖 기록(다른 계좌, KIS의 달러 기록 등)은 그대로 남는다. */
  inScope: (record: { accountId: string | null; currency: string }) => boolean,
  rows: NewDividendInput[]
): SyncReplaceResult {
  const result: SyncReplaceResult = { added: 0, removed: 0, unchanged: 0 };
  store().update((current) => {
    const all = current.map(normalize);
    const scoped = all.filter((r) => r.broker === broker && inScope(r));
    const others = all.filter((r) => !(r.broker === broker && inScope(r)));
    const pool = new Map<string, DividendRecord[]>();
    for (const r of scoped) pool.set(syncKey(r), [...(pool.get(syncKey(r)) ?? []), r]);
    const next: DividendRecord[] = rows.map((input) => {
      const candidates = pool.get(syncKey(input));
      const prev = candidates?.shift();
      const record = { ...toRecord(input), id: prev?.id ?? randomUUID() };
      if (!prev) result.added++;
      else if (prev.name === record.name && prev.memo === record.memo && prev.accountId === record.accountId) result.unchanged++;
      return record;
    });
    result.removed = scoped.length - (rows.length - result.added);
    return [...others, ...next];
  });
  return result;
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
