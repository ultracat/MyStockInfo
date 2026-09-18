import { Router } from 'express';
import {
  deleteHolding,
  listHoldings,
  replaceAllHoldings,
  replaceHoldingsFromImport,
  type UpsertHoldingInput,
} from '../db/holdingsStore';
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
      commission: numOrNull(commission) ?? null,
      tax: numOrNull(tax) ?? null,
      memo: typeof memo === 'string' && memo.trim() ? memo.trim() : null,
    },
  };
}

// CSV 가져오기 — name(종목명)은 CSV에 없다(배당금과 같은 이유: 심볼로 자동조회).
// lastPrice/marketValue/profitLossAmount/profitLossRate 넷 다 사용자가 CSV/시트에
// 뭘 적어놨든 서버가 항상 다시 계산해서 덮어쓴다 — broker/accountId/symbol/
// quantity/averagePurchasePrice/currency/market만 채운 최소 CSV도 지원하려는
// 목적이자, 화면에 보이는 평가금액/손익이 항상 실제 시세 기준이게 하려는 목적
// 둘 다다. **lastPrice/marketValue는 API(토스→KIS) 시세 조회가 성공하면 그
// 값을 우선한다** — CSV/시트의 값은 API로 그 종목을 못 찾을 때만(해외 종목,
// 토스 미연동 등) 쓰이는 폴백이다. 예전엔 반대로(CSV 값 우선, API는 값이 없을
// 때만) 짜여 있었는데, "평가금액이 항상 접근 가능한 API로 자동 계산돼야 한다"는
// 요청으로 뒤집었다. **profitLossAmount/profitLossRate는 폴백조차 없다** —
// marketValue-purchaseAmount의 순수 산술 결과라 항상 그 둘로부터 다시 계산한다
// (CSV/시트에 값이 있어도 무조건 무시). 이름 조회 실패는 행을 실패
// 처리하지만, 현재가 조회 실패는 그냥 0으로 남긴다 — 이름은 화면 표시에
// 필수지만 현재가는 부가 정보라 없다고 가져오기 자체를 막을 이유가 없다.
// 가져오기는 "덮어쓰기"다 — replaceHoldingsFromImport 참고: CSV에 등장한
// (broker,accountId)마다 기존 저장 행을 전부 지우고 이번 CSV로 교체한다.
// 같은 CSV를 여러 번 가져와도 계속 누적되지 않는다.
//
// google/sheetsSync.ts도 Sheets에서 읽은 행을 이 함수에 그대로 넘겨 재사용한다
// (검증/자동조회 로직을 두 곳에 중복시키지 않기 위해 라우트 핸들러에서 분리) —
// options.fullReplace가 true면(Sheets 가져오기 전용) 시트에 없는 다른 계좌까지
// 포함해 저장소 전체를 시트 내용으로 통째로 교체한다(CSV 가져오기는 계속 기본
// 동작인 부분 병합 — false).
export async function importHoldingsRecords(
  records: unknown[],
  options?: { fullReplace?: boolean }
): Promise<{ added: number; failed: { row: number; error: string }[] }> {
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
    // lastPrice/marketValue는 API(토스→KIS)로 시세를 조회할 수 있으면 그 값을
    // 항상 우선한다 — CSV/시트에 사용자가 다른 값을 적어놨어도 무시한다. 예전엔
    // 반대로(사용자 입력 우선, API는 값이 없을 때만 보충) 짜여 있었는데, "평가금액/
    // 손익금액/손익률은 항상 접근 가능한 API로 자동 계산돼야 한다"는 요청으로
    // 우선순위를 뒤집었다 — 사용자가 시트에 오래된/잘못된 값(placeholder 0 포함)을
    // 남겨둬도 API가 그 종목 시세를 조회할 수 있는 한 항상 최신값으로 덮어써야
    // 한다. API로 못 찾을 때만(해외 종목이라 KIS가 안 되는 경우, 토스 미연동 등)
    // 사용자가 적어둔 값으로 폴백하고, 그마저 없으면 0이다.
    const lastPrice = resolvedPrice ?? input.lastPrice ?? 0;
    const marketValue = resolvedPrice !== undefined ? input.quantity * resolvedPrice : (input.marketValue ?? 0);
    // profitLossAmount/profitLossRate는 marketValue-purchaseAmount로부터 100%
    // 계산되는 값이라 독립적인 override를 절대 허용하지 않는다 — 손익은 항상
    // 그 둘의 산술 결과여야 한다. CSV/Google Sheets에 값이 들어 있어도(과거엔
    // 여기도 override였음) 무시하고 항상 다시 계산한다 — 안 그러면 사용자가
    // 시트에 placeholder로 0을 적어 넣은 새 행이 실제 marketValue/purchaseAmount가
    // 채워진 뒤에도 영원히 0으로 고정되는 버그가 생긴다(실사용자 리포트로 발견,
    // 2026-09-18).
    const profitLossAmount = marketValue - purchaseAmount;
    const profitLossRate = purchaseAmount > 0 ? profitLossAmount / purchaseAmount : 0;

    toUpsert.push({ ...input, name, purchaseAmount, lastPrice, marketValue, profitLossAmount, profitLossRate });
  }

  failed.sort((a, b) => a.row - b.row);

  if (options?.fullReplace) {
    // 시트에 행이 있었는데 전부 실패해서 하나도 못 옮겼으면, "사용자가 의도적으로
    // 비웠다"가 아니라 조회 실패 같은 문제일 가능성이 커서 기존 데이터를 지우지
    // 않는다(시트가 진짜로 비어 있으면 records.length가 0이라 이 조건에 안 걸림).
    if (toUpsert.length === 0 && records.length > 0) {
      return { added: 0, failed };
    }
    replaceAllHoldings(toUpsert);
    return { added: toUpsert.length, failed };
  }

  replaceHoldingsFromImport(toUpsert);
  return { added: toUpsert.length, failed };
}

holdingsStoreRouter.post('/import', async (req, res) => {
  const records = (req.body as { records?: unknown })?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records(배열)가 필요합니다.' });
  }
  res.json(await importHoldingsRecords(records));
});

holdingsStoreRouter.delete('/:broker/:accountId/:symbol', (req, res) => {
  const { broker, accountId, symbol } = req.params;
  const removed = deleteHolding(broker as BrokerId, accountId, symbol);
  if (!removed) return res.status(404).json({ error: '해당 보유 종목을 찾을 수 없습니다.' });
  res.status(204).end();
});
