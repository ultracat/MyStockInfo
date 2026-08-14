import { Router } from 'express';
import { deleteHolding, listHoldings, upsertHoldings, type UpsertHoldingInput } from '../db/holdingsStore';
import type { BrokerId } from '../brokers/types';
import { resolveStockNames } from '../stockNameResolver';
import { isTossConfigured } from '../brokers/toss/tossClient';

export const holdingsStoreRouter = Router();

const BROKER_IDS: BrokerId[] = ['toss', 'kis', 'kb'];

holdingsStoreRouter.get('/', (req, res) => {
  const broker = typeof req.query.broker === 'string' ? (req.query.broker as BrokerId) : undefined;
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
  res.json(listHoldings({ broker, accountId }));
});

interface ImportRowShape {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  currency: 'KRW' | 'USD';
  quantity: number;
  averagePurchasePrice: number;
  lastPrice?: number;
  marketValue?: number;
  profitLossAmount?: number;
  profitLossRate?: number;
  commission?: number | null;
  tax?: number | null;
}

function parseImportRowShape(body: unknown): { input: ImportRowShape } | { error: string } {
  const {
    broker,
    accountId,
    symbol,
    currency,
    quantity,
    averagePurchasePrice,
    lastPrice,
    marketValue,
    profitLossAmount,
    profitLossRate,
    commission,
    tax,
  } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof broker !== 'string' ||
    !BROKER_IDS.includes(broker as BrokerId) ||
    typeof accountId !== 'string' ||
    !accountId ||
    typeof symbol !== 'string' ||
    !symbol ||
    (currency !== 'KRW' && currency !== 'USD') ||
    typeof quantity !== 'number' ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    typeof averagePurchasePrice !== 'number' ||
    !Number.isFinite(averagePurchasePrice) ||
    averagePurchasePrice < 0
  ) {
    return {
      error:
        `broker(${BROKER_IDS.join('|')}), accountId, symbol, currency(KRW|USD), ` +
        `quantity(양수), averagePurchasePrice(0 이상)가 필요합니다.`,
    };
  }

  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const numOrNull = (v: unknown): number | null | undefined =>
    v === null || v === '' || v === undefined ? undefined : num(v);

  return {
    input: {
      broker: broker as BrokerId,
      accountId,
      symbol,
      currency,
      quantity,
      averagePurchasePrice,
      lastPrice: num(lastPrice),
      marketValue: num(marketValue),
      profitLossAmount: num(profitLossAmount),
      profitLossRate: num(profitLossRate),
      commission: numOrNull(commission) ?? null,
      tax: numOrNull(tax) ?? null,
    },
  };
}

// CSV 가져오기 — name(종목명)은 CSV에 없다(배당금과 같은 이유: 심볼로 자동조회).
// 형태 검증을 통과한 행들의 고유 심볼을 모아 한 번에 이름을 조회하고, 조회 실패한
// 심볼의 행만 failed로 보고한다.
holdingsStoreRouter.post('/import', async (req, res) => {
  const records = (req.body as { records?: unknown })?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records(배열)가 필요합니다.' });
  }

  const shapeResults = records.map((r, i) => ({ row: i + 1, ...parseImportRowShape(r) }));
  const validRows = shapeResults.filter((r): r is { row: number; input: ImportRowShape } => 'input' in r);
  const failed: Array<{ row: number; error: string }> = shapeResults
    .filter((r): r is { row: number; error: string } => 'error' in r)
    .map(({ row, error }) => ({ row, error }));

  const uniqueSymbols = Array.from(new Set(validRows.map((r) => r.input.symbol)));
  const { namesBySymbol, unresolved } = await resolveStockNames(uniqueSymbols);

  const toUpsert: UpsertHoldingInput[] = [];
  for (const { row, input } of validRows) {
    const key = input.symbol.toUpperCase();
    const name = namesBySymbol[key];
    if (!name) {
      failed.push({
        row,
        error:
          unresolved.has(key) && !isTossConfigured()
            ? `종목명 자동조회 실패: 토스증권 연동이 필요합니다. ('${input.symbol}')`
            : `종목명 자동조회 실패: '${input.symbol}' 종목을 찾을 수 없습니다.`,
      });
      continue;
    }
    toUpsert.push({ ...input, name });
  }

  upsertHoldings(toUpsert);
  failed.sort((a, b) => a.row - b.row);
  res.json({ added: toUpsert.length, failed });
});

holdingsStoreRouter.delete('/:broker/:accountId/:symbol', (req, res) => {
  const { broker, accountId, symbol } = req.params;
  const removed = deleteHolding(broker as BrokerId, accountId, symbol);
  if (!removed) return res.status(404).json({ error: '해당 보유 종목을 찾을 수 없습니다.' });
  res.status(204).end();
});
