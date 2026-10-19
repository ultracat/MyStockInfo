import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';

/** 종목별 외부 링크(예: 토스증권 웹의 그 종목 페이지) — 사용자가 "종목 링크"
 *  화면(frontend `pages/StockLinks.tsx`)에서 직접 입력한 값만 저장한다. 국내
 *  종목처럼 규칙으로 만들 수 있는 링크는 저장하지 않고 프론트가 그때그때 계산한다
 *  (`frontend/src/stockLinks.ts`) — 그래서 새로 산 국내 종목에도 자동으로 붙는다.
 *
 *  `url`이 빈 문자열이면 "링크 없음"을 명시적으로 고른 것이다(자동 링크도 끈다).
 *  엔트리를 지우면 자동 링크(있으면)로 돌아간다. 심볼 하나로만 식별한다(브로커/
 *  계좌 무관 — 관심종목과 같은 전제). */
export interface StockLinkEntry {
  symbol: string;
  url: string;
  updatedAt: string;
}

function store() {
  return new JsonStore<StockLinkEntry[]>('stock-links.json', getDataDir(), []);
}

export function listStockLinks(): StockLinkEntry[] {
  return store().read();
}

export function upsertStockLink(symbol: string, url: string): StockLinkEntry {
  const key = symbol.toUpperCase();
  const entry: StockLinkEntry = { symbol: key, url, updatedAt: new Date().toISOString() };
  store().update((current) => [...current.filter((e) => e.symbol !== key), entry]);
  return entry;
}

export function deleteStockLink(symbol: string): void {
  const key = symbol.toUpperCase();
  store().update((current) => current.filter((e) => e.symbol !== key));
}
