import { fetchTossExchangeRate, isTossConfigured } from './brokers/toss/tossClient';
import { fetchEximbankUsdKrwRate, isEximbankConfigured } from './fx/eximbankClient';
import type { ExchangeRate } from './brokers/types';

export interface ResolvedExchangeRate extends ExchangeRate {
  source: 'toss' | 'eximbank';
}

/**
 * USD/KRW 환율 조회 — 토스 → 한국수출입은행 순으로 시도한다(종목명 조회의
 * 토스→KIS→KB 3단계 폴백과 같은 방향, `stockNameResolver.ts`의
 * `resolveStockNames` 참고). 토스 환율 API(`/api/v1/exchange-rate`)가
 * 가끔씩 실패하는 문제(레이트리밋, 일시 장애 등) 때문에 만들었다 — 토스가
 * 미연동이거나 이번 호출이 실패하면 수출입은행으로 대체하고, 둘 다
 * 실패하면(또는 수출입은행 인증키도 없으면) null을 돌려준다. 프론트는 null이면
 * 설정에 저장된 수동 환율로 마지막 폴백한다(기존 동작 그대로 — `manualFxRate
 * ?? liveFxRate` 패턴, `Dashboard.tsx`/`Trades.tsx`/`Dividends.tsx`/
 * `Overview.tsx` 참고).
 */
export async function resolveUsdKrwRate(opts?: { forceRefresh?: boolean }): Promise<ResolvedExchangeRate | null> {
  if (isTossConfigured()) {
    try {
      const data = await fetchTossExchangeRate('USD', 'KRW', opts);
      return {
        baseCurrency: data.baseCurrency,
        quoteCurrency: data.quoteCurrency,
        rate: data.rate,
        midRate: data.midRate ?? null,
        asOf: data.validFrom ?? null,
        source: 'toss',
      };
    } catch (err) {
      console.error('[exchangeRateResolver] 토스 환율 조회 실패, 수출입은행으로 대체합니다:', err);
    }
  }

  if (isEximbankConfigured()) {
    const result = await fetchEximbankUsdKrwRate();
    if (result) {
      return {
        baseCurrency: 'USD',
        quoteCurrency: 'KRW',
        rate: result.rate,
        midRate: result.rate,
        asOf: result.asOf,
        source: 'eximbank',
      };
    }
  }

  return null;
}
