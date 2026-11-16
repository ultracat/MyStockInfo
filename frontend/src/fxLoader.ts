import { api } from './api';
import { pickLiveRate } from './fx';

/** 수동 환율과 실시간 환율을 **동시에** 받는다(예전엔 화면마다 수동 → 실시간 순으로 차례로 기다렸다). 실패는 null — 이 함수는
 *  던지지 않는다. 고르는 규칙은 fx.ts의 effectiveRate. */
export async function loadUsdKrwRates(opts?: { forceRefresh?: boolean }): Promise<{ manual: number | null; live: number | null }> {
  const [fx, live] = await Promise.all([
    api.getFxRate().catch(() => ({ usdKrwRate: null })),
    api.getUsdKrwRate(opts).catch(() => ({ rate: null })),
  ]);
  return { manual: fx.usdKrwRate ?? null, live: pickLiveRate(live) };
}
