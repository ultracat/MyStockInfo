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

// ─── 중복 방지 ───────────────────────────────────────────────────────────────
// CSV/Google Sheets 내보내기에 예전엔 `id` 컬럼이 없어서, 내보냈다 다시 가져올
// 때마다 같은 체결 건이 새 randomUUID()로 한 벌씩 더 쌓였다 — 그 뒤 실시간
// 조회(write-through)가 브로커 고유 id로 같은 건을 또 저장해서, 토스 체결 하나가
// 최대 4벌까지 중복된 실사례가 있다(배당금 화면의 연도별 투자금이 실제의 2배로
// 부풀려져 발견, 2026-10-19). 지금은 내보내기에 `id`가 들어가지만, `id` 없는 옛
// 파일을 다시 가져오는 경우까지 막으려고 "같은 거래"를 내용으로도 식별한다.
// 수수료/세금/종목명은 경로마다 채워지는 정도가 달라서 비교에서 뺐다.
function fingerprint(t: {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  executedAt: string;
}): string {
  return [t.broker, t.accountId, t.symbol.toUpperCase(), t.side, t.quantity, t.price, t.executedAt].join('\u0000');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 가져오기가 발급한 id(randomUUID)인가 — 브로커 고유 체결번호(토스 orderId,
 *  KIS odno, KB `날짜-순번`)는 이 형식이 아니다. */
function isImportGeneratedId(id: string): boolean {
  return UUID_RE.test(id);
}

/** id 없이 들어온 가져오기 행에 기존 저장 행의 id를 물려준다 — 내용이 같은 기존
 *  행을 1:1로만 짝짓는다(같은 날 같은 가격·수량으로 실제로 두 번 체결된 경우,
 *  가져온 두 행이 기존 두 행에 각각 대응되도록 한 번 쓴 id는 다시 안 씀). */
function createIdReuser(existing: StoredTrade[]): (row: ImportTradeInput) => string | undefined {
  const pool = new Map<string, string[]>();
  for (const t of existing) {
    const fp = fingerprint(t);
    if (!pool.has(fp)) pool.set(fp, []);
    pool.get(fp)!.push(t.id);
  }
  return (row) => pool.get(fingerprint(row))?.shift();
}

// 기존 저장분엔 name 필드 자체가 없던 레코드가 있다(이 필드가 생기기 전에 저장된
// 행) — JsonStore가 그대로 읽으면 undefined가 되는데, holdings의 memo/dividends의
// accountId와 같은 이유로 여기서 null로 정규화해 프론트가 항상 string | null만
// 다루게 한다.
function normalize(t: StoredTrade): StoredTrade {
  return { ...t, name: t.name ?? null };
}

// 필터 두 번 + normalize 한 번, 총 세 번 배열을 훑는 대신 한 번에 처리한다 —
// trades.json은 누적 히스토리라 다른 저장소보다 훨씬 커지는데("전체" 모드가
// 필터 없이 매번 전체를 받는다), normalize도 name이 이미 있는(지금은 모든
// write 경로가 항상 채우는) 대다수 행에 대해 매번 새 객체를 복제해 쓸모없는
// 할당을 반복했다 — 실제로 바꿔야 하는(undefined인) 행만 새로 만든다.
export function listTrades(filter?: { broker?: BrokerId; accountId?: string }): StoredTrade[] {
  const result: StoredTrade[] = [];
  for (const t of store().read()) {
    if (filter?.broker && t.broker !== filter.broker) continue;
    if (filter?.accountId && t.accountId !== filter.accountId) continue;
    result.push(t.name === undefined ? normalize(t) : t);
  }
  return result;
}

/** 실시간 동기화(routes/trades.ts)용 — 브로커가 내려준 `id` 기준 upsert. 매매내역은
 *  보유종목과 달리 누적 히스토리라(연도별로 반복 조회돼도 같은 체결 건은 같은 id로
 *  다시 온다) 전체 교체가 아니라 upsert가 맞다. */
export function upsertTrades(broker: BrokerId, accountId: string, records: TradeRecord[]): void {
  store().update((current) => {
    // 브로커가 지금 내려준 체결과 내용이 같은데 id만 가져오기가 발급한 UUID인
    // 행은 그 체결의 사본이다 — 위 "중복 방지" 주석 참고.
    const liveFingerprints = new Set(
      records.map((r) => fingerprint({ broker, accountId, ...r }))
    );
    const next = current.filter((t) => !(isImportGeneratedId(t.id) && liveFingerprints.has(fingerprint(t))));
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

/** CSV 가져오기용 — `id`가 있으면 그 id로 upsert. 없으면(수동 입력, `id` 컬럼이
 *  없던 예전 CSV) 내용이 같은 기존 행의 id를 이어받아 덮어쓰고, 그런 행도
 *  없을 때만 새로 발급한다. */
export function upsertFromImport(rows: ImportTradeInput[]): StoredTrade[] {
  const inserted: StoredTrade[] = [];
  store().update((current) => {
    const next = [...current];
    const index = indexByKey(next);
    const reuseId = createIdReuser(current);
    for (const row of rows) {
      const id = row.id || reuseId(row) || randomUUID();
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

/** Google Sheets 가져오기 전용 — `preserve`가 true인 기존 행(API·동기화 계좌,
 *  brokers/rowOwnership.ts)만 남기고 나머지 전부를 rows로 통째로 교체한다(위
 *  upsertFromImport는 id 기준으로 병합/누적하지만, 이건 시트에 없는 수동 계좌
 *  매매내역까지 전부 지운다). Sheets 내보내기가 매번 로컬 전체를 시트에
 *  덮어쓰는 것과 대칭을 이루도록, 가져오기도 시트 내용을 로컬의 유일한 진실로
 *  취급한다(부분 병합이 아님) — 사용자가 명시적으로 요청한 동작. `id` 컬럼이
 *  비어 있는 행(예전에 내보낸 시트, 시트에서 직접 추가한 행)은 upsertFromImport와
 *  같은 방식으로 기존 행의 id를 이어받는다 — 안 그러면 다음 실시간 조회가 같은
 *  체결을 브로커 id로 또 저장해 중복이 생긴다. */
export function replaceAllTrades(rows: ImportTradeInput[], preserve: (t: StoredTrade) => boolean): StoredTrade[] {
  const current = store().read();
  const reuseId = createIdReuser(current);
  const fresh: StoredTrade[] = rows.map((row) => ({
    broker: row.broker,
    accountId: row.accountId,
    id: row.id || reuseId(row) || randomUUID(),
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
  store().write([...current.filter(preserve), ...fresh]);
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

/** 이미 쌓인 중복을 한 번에 정리한다(`POST /api/trades-store/dedupe`). 내용이
 *  같은 행 묶음 안에 브로커 고유 id 행이 있으면 가져오기가 만든 UUID 행을 전부
 *  지운다 — 브로커 id 행이 하나도 없는 묶음(CSV 전용 브로커, 실시간 조회를 아직
 *  안 한 연도)은 진짜 반복 체결과 구분할 수 없어 건드리지 않는다. */
export function removeImportedDuplicates(): { removed: number; ambiguousGroups: number } {
  let removed = 0;
  let ambiguousGroups = 0;
  store().update((current) => {
    const groups = new Map<string, StoredTrade[]>();
    for (const t of current) {
      const fp = fingerprint(t);
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp)!.push(t);
    }
    const drop = new Set<StoredTrade>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const hasBrokerId = group.some((t) => !isImportGeneratedId(t.id));
      if (!hasBrokerId) {
        ambiguousGroups += 1;
        continue;
      }
      for (const t of group) if (isImportGeneratedId(t.id)) drop.add(t);
    }
    removed = drop.size;
    return removed === 0 ? current : current.filter((t) => !drop.has(t));
  });
  return { removed, ambiguousGroups };
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
