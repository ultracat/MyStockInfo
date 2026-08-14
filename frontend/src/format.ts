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

export const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatKrw(value: number) {
  return `${krw.format(Math.round(value))}원`;
}
