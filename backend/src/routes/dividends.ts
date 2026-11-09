import { Router } from 'express';
import {
  addDividend,
  addDividends,
  deleteDividend,
  listDividends,
  replaceAllDividends,
  updateDividend,
  updateDividendNames,
  type NewDividendInput,
} from '../db/dividends';
import { cacheStockName } from '../db/stockNames';
import { displayNameOf, fetchTossStockInfo, isTossConfigured } from '../brokers/toss/tossClient';
import { handleBrokerApiError } from '../brokers/errors';
import { resolveStockNames } from '../stockNameResolver';
import { syncTossDividends } from '../brokers/toss/tossDividendSync';
import { syncKisDividends } from '../brokers/kis/kisDividendSync';
import { isKisConfigured } from '../brokers/kis/kisClient';
import type { DividendSyncResult } from '../brokers/dividendSyncTypes';
import { getUpcomingDividends } from '../upcomingDividends';
import type { ImportResult } from './importResult';
import { BROKER_IDS } from '../brokers/knownBrokers';
import { isDividendSyncOwned } from '../brokers/rowOwnership';
import type { BrokerId } from '../brokers/types';

export const dividendsRouter = Router();

// 단건 추가(POST /)용 검증 — 종목명 자동조회는 프론트가 이미 하고 그 결과를 같이
// 보내므로 name을 그대로 요구한다. CSV 가져오기(POST /import)는 name 없이 심볼만
// 받고 서버가 자동조회한다 — 아래 `parseImportRowShape` 참고.

/** 세금(선택) — 0 이상의 숫자만 받고, 빈 값·잘못된 값은 "모름"(null). CSV에서는 문자열로 온다. */
function parseTax(tax: unknown): number | null {
  const n = typeof tax === 'number' ? tax : typeof tax === 'string' && tax.trim() ? Number(tax) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseDividendInput(body: unknown): { input: NewDividendInput } | { error: string } {
  const { broker, accountId, symbol, name, currency, amount, paidDate, memo, tax } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof broker !== 'string' ||
    !BROKER_IDS.includes(broker as BrokerId) ||
    typeof symbol !== 'string' ||
    !symbol ||
    typeof name !== 'string' ||
    !name ||
    (currency !== 'KRW' && currency !== 'USD') ||
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    typeof paidDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)
  ) {
    return {
      error: `broker(${BROKER_IDS.join('|')}), symbol, name, currency(KRW|USD), amount(양수), paidDate(YYYY-MM-DD)가 필요합니다.`,
    };
  }

  return {
    input: {
      broker: broker as BrokerId,
      accountId: typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null,
      symbol,
      name,
      currency,
      amount,
      paidDate,
      memo: typeof memo === 'string' && memo ? memo : null,
      tax: parseTax(tax),
    },
  };
}

type ImportRowShape = Omit<NewDividendInput, 'name'>;

function parseImportRowShape(body: unknown): { input: ImportRowShape } | { error: string } {
  const { broker, accountId, symbol, currency, amount, paidDate, memo, tax } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof broker !== 'string' ||
    !BROKER_IDS.includes(broker as BrokerId) ||
    typeof symbol !== 'string' ||
    !symbol ||
    (currency !== 'KRW' && currency !== 'USD') ||
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    typeof paidDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)
  ) {
    return {
      error: `broker(${BROKER_IDS.join('|')}), symbol, currency(KRW|USD), amount(양수), paidDate(YYYY-MM-DD)가 필요합니다.`,
    };
  }

  return {
    input: {
      broker: broker as BrokerId,
      accountId: typeof accountId === 'string' && accountId.trim() ? accountId.trim() : null,
      symbol,
      currency,
      amount,
      paidDate,
      memo: typeof memo === 'string' && memo ? memo : null,
      tax: parseTax(tax),
    },
  };
}

dividendsRouter.get('/', (_req, res) => {
  res.json(listDividends());
});

// 기존 배당 기록의 종목명을 전부 API로 얻어온 이름으로 갱신한다(수동 입력 당시
// 오타/제각각 표기였던 것들 정리 목적). 토스 종목 기본 정보 조회는 최대 200개
// 심볼을 콤마로 묶어 한 번에 조회할 수 있어서(공식 문서), 기록이 몇 백 건이어도
// 실제 API 호출은 (고유 심볼 수 / 200)번뿐이다.
dividendsRouter.post('/refresh-names', async (_req, res) => {
  if (!isTossConfigured()) {
    return res.status(409).json({ error: '종목명 갱신은 토스증권 연동이 필요합니다.' });
  }

  const records = listDividends();
  const uniqueSymbols = Array.from(new Set(records.map((r) => r.symbol)));
  if (uniqueSymbols.length === 0) {
    return res.json({ updated: 0, resolved: 0, failed: [] });
  }

  try {
    const namesBySymbol: Record<string, string> = {};
    const resolvedSymbols = new Set<string>();

    for (let i = 0; i < uniqueSymbols.length; i += 200) {
      const chunk = uniqueSymbols.slice(i, i + 200);
      const infos = await fetchTossStockInfo(chunk);
      for (const info of infos) {
        const name = displayNameOf(info);
        namesBySymbol[info.symbol] = name;
        resolvedSymbols.add(info.symbol);
        cacheStockName({
          symbol: info.symbol,
          name,
          market: info.market ?? null,
          currency: info.currency ?? null,
          cachedAt: new Date().toISOString(),
        });
      }
    }

    const updated = updateDividendNames(namesBySymbol);
    const failed = uniqueSymbols.filter((s) => !resolvedSymbols.has(s));
    res.json({ updated, resolved: resolvedSymbols.size, failed });
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

const SYNC_OWNED_ERROR = '토스증권·한국투자증권 배당은 API 동기화로만 관리됩니다(직접 추가·수정·삭제 불가).';

dividendsRouter.post('/', (req, res) => {
  const parsed = parseDividendInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  if (isDividendSyncOwned(parsed.input.broker)) return res.status(409).json({ error: SYNC_OWNED_ERROR });

  const record = addDividend(parsed.input);
  res.status(201).json(record);
});

// 배당금 화면의 인라인 수정 — 단건 추가와 같은 검증(parseDividendInput)을 그대로
// 쓴다(부분 patch가 아니라 폼 전체를 다시 검증해 통째로 교체).
dividendsRouter.put('/:id', (req, res) => {
  const parsed = parseDividendInput(req.body);
  if ('error' in parsed) return res.status(400).json({ error: parsed.error });
  const existing = listDividends().find((d) => d.id === req.params.id);
  if (isDividendSyncOwned(parsed.input.broker) || (existing && isDividendSyncOwned(existing.broker))) {
    return res.status(409).json({ error: SYNC_OWNED_ERROR });
  }

  const record = updateDividend(req.params.id, parsed.input);
  if (!record) return res.status(404).json({ error: '해당 배당 기록을 찾을 수 없습니다.' });
  res.json(record);
});

// CSV 내보내기/가져오기(전체 또는 증권사별)의 "가져오기" 쪽 — 프론트가 CSV를
// 파싱해 레코드 배열로 보내면 여기서 한 번에 검증/저장한다. 행 하나가 잘못돼도
// 전체를 막지 않고(수동 입력 CSV라 오타 가능성이 높음) 행별로 성공/실패를
// 나눠 보고한다 — 그래야 몇백 건짜리 파일에서 실패한 몇 건만 골라 고칠 수 있다.
// name은 CSV에 없다(종목명은 자동조회 대상이라 사용자가 직접 입력할 필요가
// 없음) — 형태 검증을 통과한 행들의 고유 심볼을 모아 한 번에 자동조회하고,
// 조회 실패한 심볼의 행만 failed로 보고한다.
//
// google/sheetsSync.ts도 Sheets에서 읽은 행을 이 함수에 그대로 넘겨 재사용한다
// (검증/자동조회 로직을 두 곳에 중복시키지 않기 위해 라우트 핸들러에서 분리) —
// options.fullReplace가 true면(Sheets 가져오기 전용) 시트에 없는 다른 배당 기록까지
// 포함해 저장소 전체를 시트 내용으로 통째로 교체한다(CSV 가져오기는 계속 기본
// 동작인 순수 추가 — false). API 동기화 계좌(토스·한국투자증권, rowOwnership.ts의
// `isDividendSyncOwned`)의 행은 건너뛰고(`skipped`), 전체 교체에서도 그 기록은 남긴다 — 그 계좌 배당은
// 동기화(brokers/*/…DividendSync.ts)가 API 내용으로 통째로 교체한다.
export async function importDividendsRecords(
  records: unknown[],
  options?: { fullReplace?: boolean }
): Promise<ImportResult> {
  const shapeResults = records.map((r, i) => ({ row: i + 1, ...parseImportRowShape(r) }));
  const validRows = shapeResults.filter(
    (r): r is { row: number; input: ImportRowShape } => 'input' in r
  );
  const failed: Array<{ row: number; error: string }> = shapeResults
    .filter((r): r is { row: number; error: string } => 'error' in r)
    .map(({ row, error }) => ({ row, error }));

  // API 동기화 계좌(토스·한국투자증권)의 배당은 API가 원천이라 가져오기가 쓰지 않는다(이름 조회 전에 거름).
  const importable = validRows.filter((r) => !isDividendSyncOwned(r.input.broker));
  const skipped = validRows.length - importable.length;

  const uniqueSymbols = Array.from(new Set(importable.map((r) => r.input.symbol)));
  const { namesBySymbol, unresolved } = await resolveStockNames(uniqueSymbols);

  const resolved: NewDividendInput[] = [];
  for (const { row, input } of importable) {
    const key = input.symbol.toUpperCase();
    const name = namesBySymbol[key];
    if (!name) {
      failed.push({
        row,
        error: unresolved.has(key) && !isTossConfigured()
          ? `종목명 자동조회 실패: 토스증권 연동이 필요합니다. ('${input.symbol}')`
          : `종목명 자동조회 실패: '${input.symbol}' 종목을 찾을 수 없습니다.`,
      });
      continue;
    }
    resolved.push({ ...input, name });
  }

  failed.sort((a, b) => a.row - b.row);

  if (options?.fullReplace) {
    // 전체 교체라 한 행이라도 실패하면(예: 종목명 조회 일부 실패) 아무것도 안
    // 바꾼다 — 일부만 반영하면 실패한 기록이 경고 없이 로컬에서 지워진다.
    if (failed.length > 0) return { added: 0, failed, skipped, aborted: true };
    const replaced = replaceAllDividends(resolved, (r) => isDividendSyncOwned(r.broker));
    return { added: replaced.length, failed, skipped };
  }

  addDividends(resolved);
  return { added: resolved.length, failed, skipped };
}

// 배당 동기화 — API로 배당을 받을 수 있는 증권사(토스·한국투자증권, 키가 있을 때만)마다 그 계좌의 배당 기록을
// **API 내용으로 통째로 교체**한다(brokers/toss/tossDividendSync.ts, brokers/kis/kisDividendSync.ts).
// 증권사별로 따로 돌아서 한쪽이 실패해도 다른 쪽은 반영된다. 배당금 화면이 열릴 때 프론트가 자동으로 부른다.
// 다가오는 배당(확정: KIS 계좌 지급 예정 / 예상: 국내 예탁원 일정·해외 권리 × 보유 수량) — src/upcomingDividends.ts.
// 한국투자증권 키가 없으면 available:false.
dividendsRouter.get('/upcoming', async (_req, res) => {
  try {
    res.json(await getUpcomingDividends());
  } catch (err) {
    handleBrokerApiError(err, res);
  }
});

dividendsRouter.post('/sync', async (_req, res) => {
  const jobs: Array<{ broker: BrokerId; run: () => Promise<DividendSyncResult> }> = [];
  if (isTossConfigured()) jobs.push({ broker: 'toss', run: syncTossDividends });
  if (isKisConfigured()) jobs.push({ broker: 'kis', run: syncKisDividends });
  const settled = await Promise.allSettled(jobs.map((j) => j.run()));
  const results: DividendSyncResult[] = [];
  const errors: Array<{ broker: BrokerId; error: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') results.push(s.value);
    else errors.push({ broker: jobs[i].broker, error: (s.reason as Error)?.message ?? String(s.reason) });
  });
  res.json({ results, errors });
});

dividendsRouter.post('/import', async (req, res) => {
  const records = (req.body as { records?: unknown })?.records;
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records(배열)가 필요합니다.' });
  }
  res.json(await importDividendsRecords(records));
});

dividendsRouter.delete('/:id', (req, res) => {
  const existing = listDividends().find((d) => d.id === req.params.id);
  if (existing && isDividendSyncOwned(existing.broker)) return res.status(409).json({ error: SYNC_OWNED_ERROR });
  const removed = deleteDividend(req.params.id);
  if (!removed) return res.status(404).json({ error: '해당 배당 기록을 찾을 수 없습니다.' });
  res.status(204).end();
});
