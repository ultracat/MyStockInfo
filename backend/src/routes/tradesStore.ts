import { Router } from 'express';
import {
  deleteTrade,
  listTrades,
  removeImportedDuplicates,
  replaceAllTrades,
  updateTradeNames,
  upsertFromImport,
  type ImportTradeInput,
} from '../db/tradesStore';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';
import { resolveStockNames } from '../stockNameResolver';

export const tradesStoreRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

tradesStoreRouter.get('/', (req, res) => {
  const broker = typeof req.query.broker === 'string' ? (req.query.broker as BrokerId) : undefined;
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
  res.json(listTrades({ broker, accountId }));
});

// 이미 로컬에 저장된 매매내역 중 이름이 빈 행만 골라 채운다(dividends.ts의
// refresh-names와 같은 패턴이지만, 그쪽은 토스 전용에 전부 덮어쓰는 반면 이건
// 토스→KIS→KB 3단계 폴백을 쓰고 이미 있는 이름은 안 건드린다 —
// `updateTradeNames` 참고). name 필드가 생기기 전에 저장된 행(당시엔 write-through가
// 이름을 버렸음)이나, 그때는 연동이 없어서 못 채웠던 행을 위한 일괄 백필용 —
// 토스/KIS/KB 어느 것도 연동 안 돼 있으면(resolveStockNames가 아무것도 못 찾음)
// 그냥 0건 갱신으로 끝난다(에러 아님).
tradesStoreRouter.post('/refresh-names', async (_req, res) => {
  const records = listTrades();
  const uniqueSymbols = Array.from(new Set(records.filter((t) => !t.name).map((t) => t.symbol)));
  if (uniqueSymbols.length === 0) {
    return res.json({ updated: 0, resolved: 0, failed: [] });
  }

  const { namesBySymbol, unresolved } = await resolveStockNames(uniqueSymbols);
  const updated = updateTradeNames(namesBySymbol);
  res.json({ updated, resolved: Object.keys(namesBySymbol).length, failed: Array.from(unresolved) });
});

// 예전 CSV/Sheets 가져오기가 만든 중복 매매내역을 한 번에 정리한다 —
// db/tradesStore.ts의 removeImportedDuplicates 참고.
tradesStoreRouter.post('/dedupe', (_req, res) => {
  res.json(removeImportedDuplicates());
});

function parseImportRowShape(body: unknown): { input: ImportTradeInput } | { error: string } {
  const { broker, accountId, id, symbol, name, side, quantity, price, amount, currency, commission, tax, executedAt } =
    (body ?? {}) as Record<string, unknown>;

  if (
    typeof broker !== 'string' ||
    !BROKER_IDS.includes(broker as BrokerId) ||
    typeof accountId !== 'string' ||
    !accountId ||
    typeof symbol !== 'string' ||
    !symbol ||
    (side !== 'BUY' && side !== 'SELL') ||
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    typeof price !== 'number' ||
    !Number.isFinite(price) ||
    price < 0 ||
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof currency !== 'string' ||
    !currency ||
    typeof executedAt !== 'string' ||
    !DATE_RE.test(executedAt)
  ) {
    return {
      error:
        `broker(${BROKER_IDS.join('|')}), accountId, symbol, side(BUY|SELL), quantity(양수), ` +
        `price(0 이상), amount(0 이상), currency, executedAt(YYYY-MM-DD)가 필요합니다.`,
    };
  }

  const numOrNull = (v: unknown): number | null | undefined =>
    v === null || v === '' || v === undefined ? undefined : typeof v === 'number' && Number.isFinite(v) ? v : undefined;

  return {
    input: {
      broker: broker as BrokerId,
      accountId,
      id: typeof id === 'string' && id ? id : undefined,
      symbol,
      name: typeof name === 'string' && name.trim() ? name.trim() : null,
      side,
      quantity,
      price,
      amount,
      currency,
      commission: numOrNull(commission) ?? null,
      tax: numOrNull(tax) ?? null,
      executedAt,
    },
  };
}

// CSV 가져오기 — id는 선택 컬럼이다(내보내기엔 들어 있음). 없으면 내용이 같은
// 기존 행의 id를 이어받고, 그것도 없으면 서버가 새로 발급한다(db/tradesStore.ts). name(종목명)은 선택 컬럼 — API 연동이 있으면(토스/KIS/KB 중 하나라도)
// stockNameResolver.ts로 자동조회해서 채우고, CSV에 값이 있으면 그 값을 그대로
// 쓴다(override, 연동이 전혀 없는 경우의 유일한 채움 경로). 보유종목/배당금 CSV와
// 달리 이름 조회 실패를 행 실패로 처리하지 않는다 — 매매내역은 화면이 이미
// 심볼로 폴백 표시하므로, 이름을 못 채워도 가져오기 자체를 막을 이유가 없다.
//
// google/sheetsSync.ts도 Sheets에서 읽은 행을 이 함수에 그대로 넘겨 재사용한다
// (검증/자동조회 로직을 두 곳에 중복시키지 않기 위해 라우트 핸들러에서 분리) —
// options.fullReplace가 true면(Sheets 가져오기 전용) 시트에 없는 다른 매매내역까지
// 포함해 저장소 전체를 시트 내용으로 통째로 교체한다(CSV 가져오기는 계속 기본
// 동작인 id 기준 upsert/누적 — false).
export async function importTradesRecords(
  records: unknown[],
  options?: { fullReplace?: boolean }
): Promise<{ added: number; failed: { row: number; error: string }[] }> {
  const shapeResults = records.map((r, i) => ({ row: i + 1, ...parseImportRowShape(r) }));
  const validRows = shapeResults.filter((r): r is { row: number; input: ImportTradeInput } => 'input' in r);
  const failed: Array<{ row: number; error: string }> = shapeResults
    .filter((r): r is { row: number; error: string } => 'error' in r)
    .map(({ row, error }) => ({ row, error }));
  failed.sort((a, b) => a.row - b.row);

  const needsResolve = Array.from(new Set(validRows.filter((r) => !r.input.name).map((r) => r.input.symbol)));
  const namesBySymbol: Record<string, string> =
    needsResolve.length > 0 ? (await resolveStockNames(needsResolve)).namesBySymbol : {};
  const toInsert = validRows.map((r) => ({
    ...r.input,
    name: r.input.name ?? namesBySymbol[r.input.symbol.toUpperCase()] ?? null,
  }));

  if (options?.fullReplace) {
    // 시트에 행이 있었는데 형태 검증에서 전부 실패했으면(예: 헤더가 깨짐) 기존
    // 데이터를 지우지 않는다 — 시트가 진짜로 비어 있으면 records.length가 0이라
    // 이 조건에 안 걸린다.
    if (toInsert.length === 0 && records.length > 0) {
      return { added: 0, failed };
    }
    const replaced = replaceAllTrades(toInsert);
    return { added: replaced.length, failed };
  }

  const inserted = upsertFromImport(toInsert);
  return { added: inserted.length, failed };
}

tradesStoreRouter.post('/import', async (req, res) => {
  const records = (req.body as { records?: unknown })?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records(배열)가 필요합니다.' });
  }
  res.json(await importTradesRecords(records));
});

tradesStoreRouter.delete('/:broker/:accountId/:id', (req, res) => {
  const { broker, accountId, id } = req.params;
  const removed = deleteTrade(broker as BrokerId, accountId, id);
  if (!removed) return res.status(404).json({ error: '해당 매매내역을 찾을 수 없습니다.' });
  res.status(204).end();
});
