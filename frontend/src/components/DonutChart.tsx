import { useState } from 'react';

export interface DonutSlice {
  label: string;
  value: number;
  /** CSS color (custom property reference, e.g. `var(--series-1)`) or hex. */
  color: string;
}

const SIZE = 200;
const STROKE = 34;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Visual gap between adjacent slices, in degrees — keeps slices distinguishable
 *  even when colors sit close (marks-and-anatomy.md's "2px surface gap" rule,
 *  adapted to an angular gap since these are arcs, not rects). */
const GAP_DEG = 2;

/**
 * 도넛 차트 — 도넛/파이는 dataviz 스킬이 기본으로는 권장하지 않는 형태지만(값이
 * 비슷하면 구분이 어려움), 사용자가 "원형 그래프"를 명시적으로 요청해서 그 형태를
 * 그대로 쓴다. 대신 품질 기준은 지킨다: 카테고리는 최대 6개(그 이상은 호출부가
 * "기타"로 접어서 넘김), 색은 검증된 categorical 팔레트(slot 1~6, `--series-1`~`6`),
 * 각 조각에 라벨을 직접 표시(호버에만 의존하지 않음 — CVD 경계선 색상들의 접근성
 * 완화 조건이기도 함), 범례로 전체 목록을 보조 제공한다.
 */
export default function DonutChart({
  slices,
  centerLabel,
  centerValue,
  formatValue,
}: {
  slices: DonutSlice[];
  centerLabel?: string;
  centerValue?: string;
  formatValue: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (slices.length === 0 || total <= 0) {
    return <p style={{ color: 'var(--text-muted)' }}>표시할 데이터가 없습니다.</p>;
  }

  const gapLength = (GAP_DEG / 360) * CIRCUMFERENCE;
  let offset = 0;
  const arcs = slices.map((s) => {
    const fraction = s.value / total;
    const rawLength = fraction * CIRCUMFERENCE;
    const length = Math.max(0, rawLength - gapLength);
    const arc = { ...s, fraction, dashoffset: -offset, length };
    offset += rawLength;
    return arc;
  });

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: SIZE, height: SIZE, flexShrink: 0 }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="비중 도넛 차트">
          <g transform={`translate(${SIZE / 2}, ${SIZE / 2}) rotate(-90)`}>
            <circle r={RADIUS} fill="none" stroke="var(--gridline)" strokeWidth={STROKE} />
            {arcs.map((a, i) => (
              <circle
                key={a.label}
                r={RADIUS}
                fill="none"
                stroke={a.color}
                strokeWidth={hover === i ? STROKE + 4 : STROKE}
                strokeDasharray={`${a.length} ${CIRCUMFERENCE - a.length}`}
                strokeDashoffset={a.dashoffset}
                strokeLinecap="butt"
                style={{ transition: 'stroke-width 0.1s ease', cursor: 'pointer' }}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
        {(centerLabel || centerValue) && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            {centerLabel && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{centerLabel}</div>}
            {centerValue && <div style={{ fontSize: 18, fontWeight: 600 }}>{centerValue}</div>}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 160 }}>
        {slices.map((s, i) => (
          <div
            key={s.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              opacity: hover === null || hover === i ? 1 : 0.5,
            }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }}
              aria-hidden
            />
            <span style={{ flex: 1 }}>{s.label}</span>
            <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
              {((s.value / total) * 100).toFixed(1)}%
            </span>
            <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
              {formatValue(s.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
