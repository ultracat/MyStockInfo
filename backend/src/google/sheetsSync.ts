import { listHoldings } from '../db/holdingsStore';
import { listTrades } from '../db/tradesStore';
import { listDividends } from '../db/dividends';
import { importHoldingsRecords } from '../routes/holdingsStore';
import { importTradesRecords } from '../routes/tradesStore';
import { importDividendsRecords } from '../routes/dividends';
import { getAdapter } from '../brokers/registry';
import * as store from './store';
import * as sheetsApi from './sheetsApi';
import {
  DIVIDENDS_SHEET_HEADER,
  HOLDINGS_SHEET_HEADER,
  SHEET_TAB_TITLES,
  TRADES_SHEET_HEADER,
  type SheetDataType,
} from './sheetSchemas';

/** 토스증권만 내부 accountId(Toss Open API가 요구하는 accountSeq, 예: "1")와
 *  사람이 알아보는 실제 계좌번호(accountNo, 예: "15801017634")가 다르다 — KIS/KB/
 *  삼성은 accountId 자체가 이미 실제 계좌번호다. Toss Open API 호출(getPortfolio/
 *  getTradeHistory)이 accountSeq를 그대로 요구하므로 Local DB의 accountId는
 *  건드리지 않고, 구글시트에 내보낼 때만 표시용으로 accountNo로 바꿔치기한다. */
async function buildTossAccountNumberMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const adapter = getAdapter('toss');
    if (!adapter.isConfigured()) return map;
    const accounts = await adapter.listAccounts();
    for (const a of accounts) {
      if (a.accountNumber) map.set(a.id, a.accountNumber);
    }
  } catch {
    // 조회 실패해도 내보내기 전체를 막지 않는다 — accountSeq를 그대로 보여준다.
  }
  return map;
}

function reverseMap(m: Map<string, string>): Map<string, string> {
  const r = new Map<string, string>();
  for (const [k, v] of m) r.set(v, k);
  return r;
}

const SPREADSHEET_TITLE = 'MyStock';

async function ensureTabsExist(spreadsheetId: string): Promise<void> {
  // 기존 스프레드시트를 재사용하는데 탭이 하나라도 빠져 있으면(과거 버전이
  // 만든 파일, 사용자가 실수로 탭을 지운 경우 등) 채워 넣는다.
  await Promise.all(Object.values(SHEET_TAB_TITLES).map((title) => sheetsApi.ensureTab(spreadsheetId, title)));
}

async function ensureSpreadsheet(): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const state = store.getState();
  if (state.spreadsheetId && state.spreadsheetUrl) {
    const exists = await sheetsApi.spreadsheetExists(state.spreadsheetId);
    if (exists) {
      await ensureTabsExist(state.spreadsheetId);
      return { spreadsheetId: state.spreadsheetId, spreadsheetUrl: state.spreadsheetUrl };
    }
  }

  // 저장된 spreadsheetId가 없거나 더는 유효하지 않다 — 새로 만들기 전에 이름이
  // 정확히 일치하는 기존 파일이 Drive에 있는지 먼저 찾는다(drive.readonly 범위가
  // 없는 옛 refresh_token이면 조용히 null이 와서 아래 createSpreadsheet로
  // 자연스럽게 넘어간다, sheetsApi.findSpreadsheetByName 주석 참고).
  const found = await sheetsApi.findSpreadsheetByName(SPREADSHEET_TITLE);
  if (found) {
    await ensureTabsExist(found.spreadsheetId);
    store.setSpreadsheetInfo(found.spreadsheetId, found.spreadsheetUrl);
    return found;
  }

  const created = await sheetsApi.createSpreadsheet(SPREADSHEET_TITLE, Object.values(SHEET_TAB_TITLES));
  store.setSpreadsheetInfo(created.spreadsheetId, created.spreadsheetUrl);
  return created;
}

const numStr = (n: number): string => String(n);
const numOrEmpty = (n: number | null): string => (n === null ? '' : String(n));

function displayAccountId(broker: string, accountId: string, tossMap: Map<string, string>): string {
  return broker === 'toss' ? (tossMap.get(accountId) ?? accountId) : accountId;
}

function holdingsToRows(tossMap: Map<string, string>): string[][] {
  return listHoldings().map((h) => [
    h.broker,
    displayAccountId(h.broker, h.accountId, tossMap),
    h.symbol,
    numStr(h.quantity),
    numStr(h.averagePurchasePrice),
    numStr(h.lastPrice),
    numStr(h.purchaseAmount),
    numStr(h.marketValue),
    numStr(h.profitLossAmount),
    numStr(h.profitLossRate),
    numOrEmpty(h.commission),
    numOrEmpty(h.tax),
    h.currency ?? '',
    h.market ?? '',
    h.memo ?? '',
  ]);
}

function tradesToRows(tossMap: Map<string, string>): string[][] {
  return listTrades().map((t) => [
    t.broker,
    displayAccountId(t.broker, t.accountId, tossMap),
    t.symbol,
    t.name ?? '',
    t.side,
    numStr(t.quantity),
    numStr(t.price),
    numStr(t.amount),
    t.currency,
    t.executedAt,
    numOrEmpty(t.commission),
    numOrEmpty(t.tax),
  ]);
}

function dividendsToRows(tossMap: Map<string, string>): string[][] {
  return listDividends().map((d) => [
    d.broker,
    d.accountId ? displayAccountId(d.broker, d.accountId, tossMap) : '',
    d.symbol,
    d.currency,
    numStr(d.amount),
    d.paidDate,
    d.memo ?? '',
  ]);
}

const HEADERS: Record<SheetDataType, string[]> = {
  holdings: HOLDINGS_SHEET_HEADER,
  trades: TRADES_SHEET_HEADER,
  dividends: DIVIDENDS_SHEET_HEADER,
};

const ROW_BUILDERS: Record<SheetDataType, (tossMap: Map<string, string>) => string[][]> = {
  holdings: holdingsToRows,
  trades: tradesToRows,
  dividends: dividendsToRows,
};

export async function exportDataType(dataType: SheetDataType): Promise<{ spreadsheetUrl: string; rowCount: number }> {
  const { spreadsheetId, spreadsheetUrl } = await ensureSpreadsheet();
  const tossMap = await buildTossAccountNumberMap();
  const rows = ROW_BUILDERS[dataType](tossMap);
  const values = [HEADERS[dataType], ...rows];
  // 범위를 탭 이름만으로 주면 Sheets API가 "그 탭 전체"로 해석해 A1부터 쓴다.
  await sheetsApi.writeValues(spreadsheetId, SHEET_TAB_TITLES[dataType], values);
  return { spreadsheetUrl, rowCount: rows.length };
}

/** 시트의 헤더 행(맨 위)을 기준으로 컬럼을 찾아 객체 배열로 바꾼다 — CSV
 *  가져오기(frontend/src/csv.ts + 각 페이지의 onImportFile)가 헤더 이름으로
 *  컬럼을 찾는 것과 같은 방식이라, 사용자가 시트에서 컬럼 순서를 바꿔도 그대로
 *  동작한다. */
function cellsToRecords(header: string[], rawRows: string[][]): Record<string, string>[] {
  if (rawRows.length === 0) return [];
  const [sheetHeader, ...dataRows] = rawRows;
  const colIndex = (name: string) => sheetHeader.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const indices = header.map((h) => colIndex(h));

  return dataRows
    .filter((r) => r.some((v) => (v ?? '').trim() !== ''))
    .map((r) => {
      const rec: Record<string, string> = {};
      header.forEach((h, i) => {
        const idx = indices[i];
        rec[h] = idx === -1 ? '' : (r[idx] ?? '');
      });
      return rec;
    });
}

const numOrUndefined = (v: string): number | undefined => {
  const t = v.trim();
  return t === '' ? undefined : Number(t);
};
const numOrNull = (v: string): number | null => {
  const t = v.trim();
  return t === '' ? null : Number(t);
};

/** 내보내기 때 토스 accountId를 실제 계좌번호로 바꿔치기(displayAccountId)한
 *  것의 역변환 — 시트에서 다시 가져올 때 실제 계좌번호를 Toss Open API가 요구하는
 *  accountSeq로 되돌려야 다음 라이브 동기화가 그대로 이어진다. 시트에 이미
 *  accountSeq("1")가 그대로 남아 있어도(과거 내보내기 결과, 수동 입력 등) 역맵에
 *  없으면 원래 값을 그대로 쓴다. */
function internalAccountId(broker: string, accountId: string, tossReverseMap: Map<string, string>): string {
  return broker === 'toss' ? (tossReverseMap.get(accountId) ?? accountId) : accountId;
}

function holdingsRowToInput(rec: Record<string, string>, tossReverseMap: Map<string, string>): Record<string, unknown> {
  const broker = (rec.broker ?? '').trim().toLowerCase();
  return {
    broker,
    accountId: internalAccountId(broker, (rec.accountId ?? '').trim(), tossReverseMap),
    symbol: (rec.symbol ?? '').trim(),
    quantity: Number((rec.quantity ?? '').trim()),
    averagePurchasePrice: Number((rec.averagePurchasePrice ?? '').trim()),
    lastPrice: numOrUndefined(rec.lastPrice ?? ''),
    purchaseAmount: numOrUndefined(rec.purchaseAmount ?? ''),
    marketValue: numOrUndefined(rec.marketValue ?? ''),
    // profitLossAmount/profitLossRate는 안 보낸다 — routes/holdingsStore.ts가
    // 이 두 필드를 항상 marketValue-purchaseAmount로 재계산하고 override를
    // 안 받으므로(위 참고), 시트에 사용자가 뭘 적어놨든 여기서 굳이 옮길 필요가
    // 없다.
    commission: numOrNull(rec.commission ?? ''),
    tax: numOrNull(rec.tax ?? ''),
    currency: (rec.currency ?? '').trim(),
    market: rec.market?.trim() || null,
    memo: rec.memo?.trim() || null,
  };
}

function tradesRowToInput(rec: Record<string, string>, tossReverseMap: Map<string, string>): Record<string, unknown> {
  const broker = (rec.broker ?? '').trim().toLowerCase();
  return {
    broker,
    accountId: internalAccountId(broker, (rec.accountId ?? '').trim(), tossReverseMap),
    symbol: (rec.symbol ?? '').trim(),
    name: rec.name?.trim() || undefined,
    side: (rec.side ?? '').trim().toUpperCase(),
    quantity: Number((rec.quantity ?? '').trim()),
    price: Number((rec.price ?? '').trim()),
    amount: Number((rec.amount ?? '').trim()),
    currency: (rec.currency ?? '').trim(),
    executedAt: (rec.executedAt ?? '').trim(),
    commission: numOrNull(rec.commission ?? ''),
    tax: numOrNull(rec.tax ?? ''),
  };
}

function dividendsRowToInput(rec: Record<string, string>, tossReverseMap: Map<string, string>): Record<string, unknown> {
  const broker = (rec.broker ?? '').trim().toLowerCase();
  const rawAccountId = rec.accountId?.trim() || undefined;
  return {
    broker,
    accountId: rawAccountId ? internalAccountId(broker, rawAccountId, tossReverseMap) : undefined,
    symbol: (rec.symbol ?? '').trim(),
    currency: (rec.currency ?? '').trim(),
    amount: Number((rec.amount ?? '').trim()),
    paidDate: (rec.paidDate ?? '').trim(),
    memo: rec.memo?.trim() || undefined,
  };
}

const ROW_MAPPERS: Record<
  SheetDataType,
  (rec: Record<string, string>, tossReverseMap: Map<string, string>) => Record<string, unknown>
> = {
  holdings: holdingsRowToInput,
  trades: tradesRowToInput,
  dividends: dividendsRowToInput,
};

const IMPORTERS: Record<
  SheetDataType,
  (
    records: unknown[],
    options?: { fullReplace?: boolean }
  ) => Promise<{ added: number; failed: { row: number; error: string }[] }>
> = {
  holdings: importHoldingsRecords,
  trades: importTradesRecords,
  dividends: importDividendsRecords,
};

// 시트 내용을 로컬의 유일한 진실로 취급한다(부분 병합/누적이 아니라 전체
// 교체) — export가 매번 로컬 전체를 시트에 덮어쓰는 것과 대칭을 이루도록,
// import도 시트에 없는 기존 로컬 데이터를 지운다(fullReplace: true, 각 db
// 함수의 replaceAllXxx 참고). CSV 가져오기의 기존 부분 병합/추가 동작과는
// 의도적으로 다르다 — 사용자가 명시적으로 요청한 동작.
export async function importDataType(
  dataType: SheetDataType
): Promise<{ added: number; failed: { row: number; error: string }[] }> {
  const { spreadsheetId } = await ensureSpreadsheet();
  const [rawRows, tossReverseMap] = await Promise.all([
    sheetsApi.readValues(spreadsheetId, SHEET_TAB_TITLES[dataType]),
    buildTossAccountNumberMap().then(reverseMap),
  ]);
  const records = cellsToRecords(HEADERS[dataType], rawRows).map((rec) => ROW_MAPPERS[dataType](rec, tossReverseMap));
  // 시트가 비어 있으면(헤더도 없는 완전히 빈 탭 — 아직 한 번도 내보내지 않은
  // 경우 등) 실수로 로컬 데이터를 전부 지우지 않도록 건드리지 않는다.
  if (records.length === 0) return { added: 0, failed: [] };
  return IMPORTERS[dataType](records, { fullReplace: true });
}
