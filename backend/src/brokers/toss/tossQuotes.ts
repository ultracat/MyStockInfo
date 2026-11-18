// 토스증권 시세 — 환율·종목 정보·현재가. 공통부는 tossCore.ts.
import { shapeForLog } from '../../logRedact';
import { DEFAULT_TTL_MS, PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';
import type { components } from './tossSpec.gen';
import { RawTossExchangeRateResponse, TossExchangeRateResponse, toNum, tossFetch } from './tossCore';
export async function fetchTossExchangeRate(
  baseCurrency: string,
  quoteCurrency: string,
  opts: FetchOpts = {}
): Promise<TossExchangeRateResponse> {
  return withCache(
    `toss:fx:${baseCurrency}:${quoteCurrency}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const params = new URLSearchParams({ baseCurrency, quoteCurrency });
      const raw = await tossFetch<any>(`/api/v1/exchange-rate?${params}`, 'MARKET_INFO');
      const data = raw?.result ?? raw;

      // rate is a decimal-formatted STRING per the schema ("1380.5"), not a
      // JSON number — checking `typeof data.rate !== 'number'` here always
      // failed against a real response, so this call silently threw on
      // every live use. Dashboard.tsx swallows that failure (live rate is
      // a nice-to-have, falls back to the manual rate), which is why it
      // went unnoticed rather than surfacing as an error.
      if (!data || typeof data !== 'object' || typeof data.rate !== 'string') {
        console.error('[toss] Unexpected /api/v1/exchange-rate response shape:', shapeForLog(raw));
        throw new Error(
          '토스증권 환율 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      const rawRate = data as RawTossExchangeRateResponse;
      return {
        baseCurrency: rawRate.baseCurrency,
        quoteCurrency: rawRate.quoteCurrency,
        rate: toNum(rawRate.rate),
        midRate: rawRate.midRate === null || rawRate.midRate === undefined ? null : toNum(rawRate.midRate),
        basisPoint:
          rawRate.basisPoint === null || rawRate.basisPoint === undefined ? null : toNum(rawRate.basisPoint),
        rateChangeType: rawRate.rateChangeType ?? null,
        validFrom: rawRate.validFrom ?? null,
        validUntil: rawRate.validUntil ?? null,
      };
    },
    opts
  );
}

type RawTossStockInfo = components['schemas']['StockInfo'];

/**
 * 종목 기본 정보 조회 (`GET /api/v1/stocks`, `STOCK` group) — not
 * account-scoped, works for both KR (e.g. "005930") and US (e.g. "AAPL")
 * symbols in the same call, up to 200 comma-separated per request per docs.
 * Used to auto-resolve a dividend record's 종목명 from its 종목코드 (see
 * routes/stockInfo.ts) instead of asking the user to type it.
 */
export async function fetchTossStockInfo(symbols: string[], opts: FetchOpts = {}): Promise<RawTossStockInfo[]> {
  const key = [...symbols].sort().join(',');
  return withCache(
    `toss:stockinfo:${key}`,
    DEFAULT_TTL_MS,
    async () => {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      const raw = await tossFetch<any>(`/api/v1/stocks?${params}`, 'STOCK');
      const data = raw?.result ?? raw;

      if (!Array.isArray(data)) {
        console.error('[toss] Unexpected /api/v1/stocks response shape:', shapeForLog(raw));
        throw new Error(
          '토스증권 종목정보 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      return data as RawTossStockInfo[];
    },
    opts
  );
}

type RawTossPriceItem = components['schemas']['PriceResponse'];

export interface TossPriceItem {
  symbol: string;
  lastPrice: number;
  currency: string;
  /** 이 가격의 시각(ISO) — 명세상 선택 필드. 관심종목 등락률이 "직전 거래일"을 고르는 데 쓴다(tossMonthlyClose.ts `previousCloseFrom`). */
  timestamp: string | null;
}

/**
 * 현재가 조회 (`GET /api/v1/prices`, `MARKET_DATA` group, 공식 스펙
 * openapi.tossinvest.com/openapi-docs/latest/openapi.json 확인, checked
 * 2026-08-17) — `/api/v1/stocks`처럼 계좌와 무관하고 KR/US 심볼을 한 API로
 * 커버하며 최대 200개 콤마 동시조회. `lastPrice`는 다른 토스 금액 필드와
 * 마찬가지로 문자열(`format: decimal`)로 내려와서 여기서 number로 변환해
 * 넘긴다. 보유종목 CSV 가져오기가 사용자가 안 채운 현재가/평가금액/손익을
 * 자동으로 채우는 데 쓴다(routes/holdingsStore.ts).
 */
export async function fetchTossPrices(symbols: string[], opts: FetchOpts = {}): Promise<TossPriceItem[]> {
  const key = [...symbols].sort().join(',');
  return withCache(
    `toss:prices:${key}`,
    DEFAULT_TTL_MS,
    async () => {
      const params = new URLSearchParams({ symbols: symbols.join(',') });
      const raw = await tossFetch<any>(`/api/v1/prices?${params}`, 'MARKET_DATA');
      const data = raw?.result ?? raw;

      if (!Array.isArray(data)) {
        console.error('[toss] Unexpected /api/v1/prices response shape:', shapeForLog(raw));
        throw new Error(
          '토스증권 현재가 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      return (data as RawTossPriceItem[]).map((item) => ({
        symbol: item.symbol,
        lastPrice: toNum(item.lastPrice),
        currency: item.currency,
        timestamp: item.timestamp ?? null,
      }));
    },
    opts
  );
}
