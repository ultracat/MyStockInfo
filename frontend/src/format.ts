// Shared Intl formatters. `Intl.NumberFormat` construction does locale-data
// lookup and isn't free — these must stay module-level singletons, never
// instantiated inside a render body or a function called per table row
// (found doing exactly that in HoldingsTable.tsx/Dashboard.tsx, up to a few
// hundred redundant constructions per render on a full portfolio).

export const krw = new Intl.NumberFormat('ko-KR');

/** Matches HoldingsTable's original per-unit price/amount precision. */
export const krw2dp = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });

export const krwCompact = new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

export const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** 주당 배당처럼 센트 아래 자릿수가 있는 달러 값(예: $0.2715). */
export const usd4dp = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

export const usdCompact =new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 수량 — 소수 수량(해외 소수점 매매)은 6자리까지, 천 단위 쉼표. */
export const qtyFmt = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 6 });

/** 포지션 통화 그대로의 금액 — 원화는 "1,234.5원", 달러는 "$58.00"(예전엔 "58 USD"로 화면마다 달랐다, 2026-11-18). */
export function formatMoneyIn(value: number, currency: string | null): string {
  if (currency === 'USD') return usdFmt.format(value);
  if (currency && currency !== 'KRW') return `${krw2dp.format(value)} ${currency}`;
  return `${krw2dp.format(value)}원`;
}

export function formatKrw(value: number) {
  return `${krw.format(Math.round(value))}원`;
}

/** "1,234원" — 원 단위 반올림(여러 화면이 각자 복사해 두던 것을 모음, 2026-11-17). */
export function formatKrwValue(v: number): string {
  return `${krw.format(Math.round(v))}원`;
}

/** "+1,234원" / "-1,234원" — 손익 표시용. */
export function formatSignedKrw(v: number): string {
  return `${v >= 0 ? '+' : ''}${krw.format(Math.round(v))}원`;
}

/** 기준 금액 대비 비율 — "+12.34%"(`signed`면 양수에 +). 기준이 0 이하이면 null(비율 없음). */
export function ratioOf(amount: number, base: number): number | null {
  return base > 0 ? amount / base : null;
}
export function formatRatePct(rate: number | null, signed = true): string {
  if (rate === null || !Number.isFinite(rate)) return '-';
  return `${signed && rate >= 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`;
}

/** 배당내역 팝업의 종목별 행 meta — 지금 보유 중이 아닌 종목(전량 매도 등)은 수량 정보가 없어 배당 건수만 보여준다. */
export function formatDividendMeta(count: number, quantity: number | undefined): string {
  return quantity ? `배당 ${count}건 · 보유 ${quantity}주` : `배당 ${count}건`;
}

/** 오늘(이 PC 날짜) YYYY-MM-DD — toISOString은 UTC라 한국 오전 9시 전엔 어제가 된다. */
export function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
