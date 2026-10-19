import type { StockLinkEntry } from './types';

/**
 * 종목별 외부 링크 해석 — 사용자 입력 > 자동 링크 순. 보유종목 표(HoldingsTable)와
 * "종목 링크" 화면(StockLinks.tsx)이 같은 규칙을 쓰도록 여기 한 곳에 둔다.
 *
 * 자동 링크는 토스증권 웹 종목 페이지(`https://www.tossinvest.com/stocks/{코드}/order`)다.
 * - 국내 종목: 코드가 `A` + 6자리 종목코드라 규칙으로 만든다(삼성전자 `A005930`,
 *   ETF `A0008S0`까지 토스 웹 종목정보 API로 확인, 2026-10-19).
 * - 미국 종목: 토스 내부 코드가 규칙으로 안 나온다 — 대개 `US`+상장일+순번
 *   (`US19801212001` = AAPL)이지만, 같은 AMEX라도 ACWV는 `US20111020001`, NVDY는
 *   `AMX0230510001`처럼 제각각이고 공식 Open API에도 이 코드가 없다. 그래서 직접
 *   확인한 종목만 아래 표에 넣고, 나머지는 사용자가 "종목 링크" 화면에서 입력한다.
 */
const TOSS_STOCK_URL = (code: string) => `https://www.tossinvest.com/stocks/${code}/order`;

const KNOWN_TOSS_US_CODES: Record<string, string> = {
  AAPL: 'US19801212001',
  MSFT: 'US19860313001',
  NVDA: 'US19990122001',
  AMZN: 'US19970515001',
  O: 'US19941018001',
  ACWV: 'US20111020001',
  NVDY: 'AMX0230510001',
};

const KR_SYMBOL = /^[0-9A-Z]{6}$/;

/** 규칙/확인된 표로 만들 수 있는 자동 링크 — 없으면 null. 국내 판정은 통화(KRW)와
 *  6자리 코드 모양을 같이 본다(KRW 거래인데 코드 모양이 다르면 만들지 않음). */
export function autoStockLink(symbol: string, currency: string | null | undefined): string | null {
  const s = symbol.toUpperCase();
  if (currency === 'KRW' && KR_SYMBOL.test(s)) return TOSS_STOCK_URL(`A${s}`);
  const usCode = KNOWN_TOSS_US_CODES[s];
  return usCode ? TOSS_STOCK_URL(usCode) : null;
}

export type StockLinkSource = 'manual' | 'auto' | 'none';

/** 실제로 쓸 링크와 그 출처. 사용자가 "링크 없음"(빈 문자열)을 저장했으면 자동
 *  링크도 쓰지 않는다. */
export function resolveStockLink(
  symbol: string,
  currency: string | null | undefined,
  saved: Map<string, StockLinkEntry>
): { url: string | null; source: StockLinkSource } {
  const entry = saved.get(symbol.toUpperCase());
  if (entry) return entry.url ? { url: entry.url, source: 'manual' } : { url: null, source: 'none' };
  const auto = autoStockLink(symbol, currency);
  return auto ? { url: auto, source: 'auto' } : { url: null, source: 'none' };
}

export function stockLinkMap(entries: StockLinkEntry[]): Map<string, StockLinkEntry> {
  return new Map(entries.map((e) => [e.symbol.toUpperCase(), e]));
}
