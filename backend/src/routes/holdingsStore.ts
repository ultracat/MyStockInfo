import { Router } from 'express';
import { deleteHolding, listHoldings, replaceHoldingsFromImport, type UpsertHoldingInput } from '../db/holdingsStore';
import { resolveStockNames, resolveStockPrices } from '../stockNameResolver';
import { isTossConfigured } from '../brokers/toss/tossClient';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';

export const holdingsStoreRouter = Router();

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
  market?: string | null;
  lastPrice?: number;
  purchaseAmount?: number;
  marketValue?: number;
  profitLossAmount?: number;
  profitLossRate?: number;
  commission?: number | null;
  tax?: number | null;
  memo?: string | null;
}

// 국내(KR) 심볼은 6자리다 — CSV에 "5930"처럼 앞자리 0이 빠진 채로 입력되면
// 이름/현재가 자동조회(토스 API)가 못 찾는다. market이 KR이고 숫자만 6자리
// 이하면 0으로 채워 6자리로 맞춘다. 해외 심볼(예: AAPL)이나 market이 KR이
// 아닌 행은 그대로 둔다.
function normalizeSymbol(symbol: string, market: string | null | undefined): string {
  if (market === 'KR' && /^\d{1,6}$/.test(symbol)) {
    return symbol.padStart(6, '0');
  }
  return symbol;
}

function parseImportRowShape(body: unknown): { input: ImportRowShape } | { error: string } {
  const {
    broker,
    accountId,
    symbol,
    currency,
    quantity,
    averagePurchasePrice,
    market,
    lastPrice,
    purchaseAmount,
    marketValue,
    profitLossAmount,
    profitLossRate,
    commission,
    tax,
    memo,
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
  const marketValueNorm = typeof market === 'string' && market ? market : null;

  return {
    input: {
      broker: broker as BrokerId,
      accountId,
      symbol: normalizeSymbol(symbol, marketValueNorm),
      currency,
      quantity,
      averagePurchasePrice,
      market: marketValueNorm,
      lastPrice: num(lastPrice),
      purchaseAmount: num(purchaseAmount),
      marketValue: num(marketValue),
      profitLossAmount: num(profitLossAmount),
      profitLossRate: num(profitLossRate),
      commission: numOrNull(commission) ?? null,
      tax: numOrNull(tax) ?? null,
      memo: typeof memo === 'string' && memo.trim() ? memo.trim() : null,
    },
  };
}

// CSV 가져오기 — name(종목명)은 CSV에 없다(배당금과 같은 이유: 심볼로 자동조회).
// lastPrice/marketValue/profitLossAmount/profitLossRate도 CSV에 안 넣으면(값을
// 아예 안 보내면) 토스 현재가 조회로 자동 계산한다 — broker/accountId/symbol/
// quantity/averagePurchasePrice/currency/market만 채우는 최소 CSV를 지원하려는
// 목적. 명시적으로 값을 넣은 행은 그 값을 그대로 쓴다(override). 이름 조회
// 실패는 행을 실패 처리하지만, 현재가 조회 실패는 그냥 0으로 남긴다 — 이름은
// 화면 표시에 필수지만 현재가는 부가 정보라 없다고 가져오기 자체를 막을
// 이유가 없다. 가져오기는 "덮어쓰기"다 — replaceHoldingsFromImport 참고: CSV에
// 등장한 (broker,accountId)마다 기존 저장 행을 전부 지우고 이번 CSV로 교체한다.
// 같은 CSV를 여러 번 가져와도 계속 누적되지 않는다.
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
  const [{ namesBySymbol, unresolved }, { pricesBySymbol }] = await Promise.all([
    resolveStockNames(uniqueSymbols),
    resolveStockPrices(uniqueSymbols),
  ]);

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

    const purchaseAmount = input.purchaseAmount ?? input.averagePurchasePrice * input.quantity;
    const resolvedPrice = pricesBySymbol[key];
    const lastPrice = input.lastPrice ?? resolvedPrice ?? 0;
    const marketValue = input.marketValue ?? (resolvedPrice !== undefined ? input.quantity * resolvedPrice : 0);
    const profitLossAmount = input.profitLossAmount ?? marketValue - purchaseAmount;
    const profitLossRate =
      input.profitLossRate ?? (purchaseAmount > 0 ? profitLossAmount / purchaseAmount : 0);

    toUpsert.push({ ...input, name, purchaseAmount, lastPrice, marketValue, profitLossAmount, profitLossRate });
  }

  replaceHoldingsFromImport(toUpsert);
  failed.sort((a, b) => a.row - b.row);
  res.json({ added: toUpsert.length, failed });
});

holdingsStoreRouter.delete('/:broker/:accountId/:symbol', (req, res) => {
  const { broker, accountId, symbol } = req.params;
  const removed = deleteHolding(broker as BrokerId, accountId, symbol);
  if (!removed) return res.status(404).json({ error: '해당 보유 종목을 찾을 수 없습니다.' });
  res.status(204).end();
});
