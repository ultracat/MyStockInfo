// 토스증권 주문 내역·매수 가능 금액. 공통부는 tossCore.ts.
import { shapeForLog } from '../../logRedact';
import { DEFAULT_TTL_MS, PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';
import { RawTossOrdersResponse, TossOrder, parseOrder, toNum, tossFetch } from './tossCore';
export async function fetchTossOrders(
  accountSeq: number,
  from: string,
  to: string,
  opts: FetchOpts = {}
): Promise<TossOrder[]> {
  return withCache(
    `toss:orders:${accountSeq}:${from}:${to}`,
    DEFAULT_TTL_MS,
    async () => {
      const orders: TossOrder[] = [];
      let cursor: string | undefined;

      // status=CLOSED covers FILLED/CANCELED/REJECTED/... — filtered down to
      // actually-filled quantity by the caller (kis and toss both report
      // execution.filledQuantity/tot_ccld_qty separately from the requested
      // order quantity, since a CLOSED order can be a cancel with 0 fills).
      for (let page = 0; page < 50; page++) {
        const params = new URLSearchParams({ status: 'CLOSED', from, to, limit: '100' });
        if (cursor) params.set('cursor', cursor);

        const raw = await tossFetch<any>(`/api/v1/orders?${params}`, 'ORDER_HISTORY', { accountSeq });
        const data = (raw?.result ?? raw) as RawTossOrdersResponse;

        if (!data || !Array.isArray(data.orders)) {
          console.error('[toss] Unexpected /api/v1/orders response shape:', shapeForLog(raw));
          throw new Error(
            '토스증권 매매내역 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
          );
        }

        orders.push(...data.orders.map(parseOrder));
        if (!data.hasNext || !data.nextCursor) break;
        cursor = data.nextCursor;
      }

      return orders;
    },
    opts
  );
}

/**
 * 매수 가능 금액 조회 (`GET /api/v1/buying-power`, `ORDER_INFO` group, 공식
 * OpenAPI 스펙 확인 2026-08-19) — 계좌에 "예수금" 자체를 돌려주는 엔드포인트가
 * 없어서 이걸로 대체한다. 문서상 "미수거래를 제외한 현금 기반 매수 가능 금액
 * (미수 미발생 기준)"이라 일반적인 현금 계좌에선 예수금과 거의 같지만, 매도
 * 후 T+2 미정산분이 있는 시점엔 정확한 "지금 당장의 예수금"과 살짝 다를 수
 * 있다(엄밀히 다른 개념) — 화면에 이 근사를 안내한다.
 */
export async function fetchTossBuyingPower(
  accountSeq: number,
  currency: 'KRW' | 'USD',
  opts: FetchOpts = {}
): Promise<number> {
  return withCache(
    `toss:buying-power:${accountSeq}:${currency}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const params = new URLSearchParams({ currency });
      const raw = await tossFetch<any>(`/api/v1/buying-power?${params}`, 'ORDER_INFO', { accountSeq });
      const data = raw?.result ?? raw;

      if (!data || typeof data !== 'object' || typeof data.cashBuyingPower !== 'string') {
        console.error('[toss] Unexpected /api/v1/buying-power response shape:', shapeForLog(raw));
        throw new Error(
          '토스증권 매수 가능 금액(예수금) 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
        );
      }

      return toNum(data.cashBuyingPower);
    },
    opts
  );
}
