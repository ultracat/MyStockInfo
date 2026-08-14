import { Router } from 'express';
import { deleteTrade, listTrades, upsertFromImport, type ImportTradeInput } from '../db/tradesStore';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';

export const tradesStoreRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

tradesStoreRouter.get('/', (req, res) => {
  const broker = typeof req.query.broker === 'string' ? (req.query.broker as BrokerId) : undefined;
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined;
  res.json(listTrades({ broker, accountId }));
});

function parseImportRowShape(body: unknown): { input: ImportTradeInput } | { error: string } {
  const { broker, accountId, id, symbol, side, quantity, price, amount, currency, commission, tax, executedAt } =
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

// CSV 가져오기 — name/id 둘 다 CSV에 없다. name은 TradeRecord가 원래도 선택적이고
// 화면이 이미 심볼로 폴백 표시하므로 자동조회 자체가 불필요(배당금/보유종목과
// 다른 점). id는 브로커 고유 체결번호라 CSV 입력행엔 없고, 없으면 서버가 새로 발급.
tradesStoreRouter.post('/import', (req, res) => {
  const records = (req.body as { records?: unknown })?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records(배열)가 필요합니다.' });
  }

  const shapeResults = records.map((r, i) => ({ row: i + 1, ...parseImportRowShape(r) }));
  const validRows = shapeResults.filter((r): r is { row: number; input: ImportTradeInput } => 'input' in r);
  const failed: Array<{ row: number; error: string }> = shapeResults
    .filter((r): r is { row: number; error: string } => 'error' in r)
    .map(({ row, error }) => ({ row, error }));

  const inserted = upsertFromImport(validRows.map((r) => r.input));
  failed.sort((a, b) => a.row - b.row);
  res.json({ added: inserted.length, failed });
});

tradesStoreRouter.delete('/:broker/:accountId/:id', (req, res) => {
  const { broker, accountId, id } = req.params;
  const removed = deleteTrade(broker as BrokerId, accountId, id);
  if (!removed) return res.status(404).json({ error: '해당 매매내역을 찾을 수 없습니다.' });
  res.status(204).end();
});
