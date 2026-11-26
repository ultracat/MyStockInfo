import { krw2dp, usdFmt } from '../../format';

// 관심종목 상세(WatchDetail.tsx와 그 카드들)가 같이 쓰는 표시 함수·작은 부품 — 2026-11-26 WatchDetail.tsx를 나누며 옮겼다(동작 그대로).

export const price = (v: number, currency: string | null) => (currency === 'USD' ? usdFmt.format(v) : `${krw2dp.format(v)}원`);
/** 달러 시가총액 — 조 달러(T)·십억 달러(B). */
export const usdCap = (v: number) => (v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : `$${(v / 1e9).toFixed(1)}B`);
export const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`;
export const rateClass = (v: number | null | undefined) => (v == null ? undefined : v >= 0 ? 'text-good' : 'text-critical');

export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key} className={value === o.key ? 'on' : ''} onClick={() => onChange(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
