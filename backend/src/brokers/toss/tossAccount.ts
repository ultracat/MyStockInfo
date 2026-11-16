// 토스증권 계좌 — 계좌 목록·보유 종목·거래내역. 공통부는 tossCore.ts.
import { shapeForLog } from '../../logRedact';
import { hasCredential } from '../../credentials';
import { PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';
import { RawTossHoldingsOverviewResponse, TossAccountsResponse, TossHoldingsOverviewResponse, parseHoldingsItem, parsePrice, toNum, tossFetch } from './tossCore';
export function isTossConfigured(): boolean {
  // Existence check only — decrypting (getCredentialFields) isn't needed
  // just to answer "is this set up", and doing it here meant every
  // GET /api/accounts call risked throwing on a decrypt failure.
  return hasCredential('toss');
}

export async function fetchTossAccounts(opts: FetchOpts = {}): Promise<TossAccountsResponse['result']> {
  return withCache(
    'toss:accounts',
    PORTFOLIO_TTL_MS,
    async () => {
      const data = await tossFetch<TossAccountsResponse>('/api/v1/accounts', 'ACCOUNT');
      return data.result;
    },
    opts
  );
}

export async function fetchTossHoldings(
  accountSeq: number,
  opts: FetchOpts = {}
): Promise<TossHoldingsOverviewResponse> {
  return withCache(
    `toss:holdings:${accountSeq}`,
    PORTFOLIO_TTL_MS,
    async () => {
      // Holdings/balance falls under the docs' ASSET group (5 req/s), distinct
      // from ACCOUNT (1 req/s, accounts list only) — conflating the two was
      // the original cause of hitting the 1 req/s limit on first page load.
      const raw = await tossFetch<any>('/api/v1/holdings', 'ASSET', { accountSeq });

      // /api/v1/accounts wraps its payload in { result: ... } — /api/v1/holdings
      // may or may not follow the same envelope depending on the live API, so
      // accept either shape rather than assuming one.
      const overview = raw?.result ?? raw;

      if (!overview || typeof overview !== 'object' || !Array.isArray(overview.items)) {
        console.error('[toss] Unexpected /api/v1/holdings response shape:', shapeForLog(raw));
        throw new Error(
          '토스증권 보유 종목 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했으니 ' +
            '확인 후 backend/src/brokers/toss/tossClient.ts의 TossHoldingsOverviewResponse 매핑을 맞춰주세요.'
        );
      }

      const rawOverview = overview as RawTossHoldingsOverviewResponse;
      return {
        totalPurchaseAmount: parsePrice(rawOverview.totalPurchaseAmount),
        marketValue: {
          amount: parsePrice(rawOverview.marketValue.amount),
          amountAfterCost: parsePrice(rawOverview.marketValue.amountAfterCost),
        },
        profitLoss: {
          amount: parsePrice(rawOverview.profitLoss.amount),
          amountAfterCost: parsePrice(rawOverview.profitLoss.amountAfterCost),
          rate: toNum(rawOverview.profitLoss.rate),
          rateAfterCost: toNum(rawOverview.profitLoss.rateAfterCost),
        },
        dailyProfitLoss: rawOverview.dailyProfitLoss,
        items: rawOverview.items.map(parseHoldingsItem),
      };
    },
    opts
  );
}

/** 거래내역 한 건(`GET /api/v1/transactions`, `TRANSACTION` group, 공식 스펙 v1.2.28
 *  확인 2026-11-09). 금액은 문자열 그대로 둔다 — 쓰는 쪽(tossDividendSync.ts)이 필요한
 *  필드만 숫자로 바꾼다. 거래 고유 ID는 API가 주지 않는다(문서: "주문의 식별자는 제공하지 않습니다"). */
export interface TossTransaction {
  transactionType: string;
  marketCountry: string;
  currency: string;
  symbol: string | null;
  assetClass: string | null;
  isinCode: string | null;
  amount: string | null;
  tax: string;
  netAmount: string | null;
  exchangeRate: string | null;
  /** KST 결제일(YYYY-MM-DD). 배당·입금은 실제로 처리된 날짜 — 토스 앱에 보이는 날짜와 같다. */
  settlementDate: string;
  settled: boolean;
  transactionTime: string | null;
  isCancellation: boolean;
}

/** 거래내역 조회 — `types`(예: `['DIVIDEND','DEPOSIT']`)로 거르고, `from`/`to`(결제일 기준,
 *  inclusive)를 생략하면 전체 기간. 100건씩 커서로 끝까지 받는다. 캐시하지 않는다(동기화 전용). */
export async function fetchTossTransactions(
  accountSeq: number,
  opts: { types: string[]; from?: string; to?: string }
): Promise<TossTransaction[]> {
  const out: TossTransaction[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const params = new URLSearchParams({ transactionTypes: opts.types.join(','), limit: '100' });
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (cursor) params.set('cursor', cursor);

    const raw = await tossFetch<any>(`/api/v1/transactions?${params}`, 'TRANSACTION', { accountSeq });
    const data = raw?.result ?? raw;
    if (!data || !Array.isArray(data.transactions)) {
      console.error('[toss] Unexpected /api/v1/transactions response shape:', shapeForLog(raw));
      throw new Error(
        '토스증권 거래내역 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
      );
    }
    out.push(...(data.transactions as TossTransaction[]));
    if (!data.hasNext || !data.nextCursor) break;
    cursor = data.nextCursor;
  }
  return out;
}
