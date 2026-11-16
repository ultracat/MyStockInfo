// USD/KRW 환율 규칙 — 순수 함수만(테스트: frontend/test/fx.test.ts). 화면이 각자 같은 규칙을 반복 구현하던 것을 모으는 중이다
// (2026-11-16 — 배당금·매매내역·실현손익은 fxLoader.ts의 loadUsdKrwRates로 옮겼고, 대시보드·개요·종목별 수익은 다른 데이터와
// 한 흐름에서 받아 아직 각자 구현 — frontend/CLAUDE.md "환율" 항목).
//
// 규칙: **설정의 수동 환율이 있으면 그것, 없으면 실시간**. 실시간은 백엔드가 토스→한국수출입은행 순으로 시도해 주고
// 못 받으면 `{rate:null}` — 이때 화면은 "환율 미적용"으로 합산을 생략한다(틀린 숫자를 보여 주지 않으려고).

export interface LiveRateResponse {
  rate: number | null;
  midRate?: number | null;
}

/** 실시간 응답 → 쓸 값. 토스는 매수·매도 사이의 중간값(midRate)을 함께 주므로 있으면 그것을 쓴다. */
export function pickLiveRate(live: LiveRateResponse | null | undefined): number | null {
  if (!live || !live.rate) return null;
  return live.midRate ?? live.rate;
}

/** 수동 환율이 있으면 우선. 0·음수·NaN은 없는 것으로 본다. */
export function effectiveRate(manual: number | null | undefined, live: number | null | undefined): number | null {
  const ok = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (ok(manual)) return manual;
  if (ok(live)) return live;
  return null;
}

/** 원화 환산 — 원화는 그대로, 달러는 환율이 없으면 null(합산 생략). */
export function toKrw(amount: number, currency: string | null | undefined, rate: number | null): number | null {
  if (currency === 'USD') return rate ? amount * rate : null;
  return amount;
}

/** 지급월("YYYY-MM") 평균 환율 — 그 달을 못 구했으면 대체 환율(오늘/수동). */
export function monthlyRateOr(
  monthly: Record<string, { rate: number } | null | undefined>,
  month: string,
  fallback: number | null
): number | null {
  return monthly[month]?.rate ?? fallback;
}
