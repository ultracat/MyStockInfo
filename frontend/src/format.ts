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

/** 배당내역 팝업의 종목별 행 meta — 지금 보유 중이 아닌 종목(전량 매도 등)은 수량 정보가 없어 배당 건수만 보여준다. */
export function formatDividendMeta(count: number, quantity: number | undefined): string {
  return quantity ? `배당 ${count}건 · 보유 ${quantity}주` : `배당 ${count}건`;
}
