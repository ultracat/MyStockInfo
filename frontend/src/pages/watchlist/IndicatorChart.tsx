import { useState } from 'react';
import { useContainerWidth } from '../../useContainerWidth';

const H = 110;
const TOP = 8;
const AXIS_H = 16;
const Y_AXIS = 64;
const RIGHT = 8;

/**
 * 일봉 차트 아래 보조 지표 한 줄(2026-11-19) — 낙폭(0 아래 영역)·RSI(0~100, 30·70 기준선)·변동성(%) 공용. 가로축은 위 일봉 차트와 같은 날짜·폭이라
 * 위아래로 같은 날이 맞는다(같은 `Y_AXIS`·`RIGHT`). 값은 `fmt`로 글자로 바꾼다.
 */
export default function IndicatorChart({
  dates,
  values,
  fixed,
  refLines = [],
  area = false,
  color = 'var(--series-1)',
  fmt,
  label,
}: {
  dates: string[];
  values: (number | null)[];
  /** 축 범위를 고정(RSI 0~100). 없으면 값에 맞춤(낙폭은 최저~0). */
  fixed?: [number, number];
  refLines?: Array<{ value: number; label: string }>;
  /** 0 기준 영역 채우기(낙폭). */
  area?: boolean;
  color?: string;
  fmt: (v: number) => string;
  label: string;
}) {
  const [ref, boxWidth] = useContainerWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  const have = values.filter((v): v is number => v !== null);
  if (dates.length < 2 || !have.length) return <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>계산할 일봉이 모자랍니다.</p>;
  const width = Math.max(320, boxWidth);
  const plotW = width - Y_AXIS - RIGHT;
  let [min, max] = fixed ?? [Math.min(...have, ...(area ? [0] : [])), Math.max(...have, ...(area ? [0] : []))];
  if (!fixed) {
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 0.01;
    if (!area) min -= pad;
    max += area ? 0 : pad;
    if (area) min -= pad;
  }
  const step = plotW / dates.length;
  const x = (i: number) => Y_AXIS + i * step + step / 2;
  const y = (v: number) => TOP + H - ((v - min) / (max - min || 1)) * H;
  const d = values.reduce<string>((acc, v, i) => (v === null ? acc : `${acc}${acc === '' || values[i - 1] === null ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `), '');
  const first = values.findIndex((v) => v !== null);
  const areaPath = area && first >= 0 ? `${d} L ${x(values.length - 1).toFixed(1)} ${y(0).toFixed(1)} L ${x(first).toFixed(1)} ${y(0).toFixed(1)} Z` : null;
  const ticks = fixed ? [] : [min, max].filter((t) => !refLines.some((r) => Math.abs(r.value - t) < (max - min) * 0.15));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={TOP + H + AXIS_H} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {[...refLines.map((r) => ({ v: r.value, t: r.label, ref: true })), ...ticks.map((t) => ({ v: t, t: fmt(t), ref: false }))].map((r) => (
          <g key={`${r.v}`}>
            <line x1={Y_AXIS} x2={width - RIGHT} y1={y(r.v)} y2={y(r.v)} stroke={r.ref ? 'var(--baseline)' : 'var(--gridline)'} strokeDasharray={r.ref && r.v !== 0 ? '4 3' : undefined} />
            <text x={Y_AXIS - 6} y={y(r.v) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {r.t}
            </text>
          </g>
        ))}
        {areaPath && <path d={areaPath} fill={color} fillOpacity={0.15} />}
        <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
        {hover !== null && values[hover] !== null && <circle cx={x(hover)} cy={y(values[hover]!)} r={3} fill={color} />}
        <rect
          x={Y_AXIS}
          y={0}
          width={plotW}
          height={TOP + H}
          fill="transparent"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            setHover(Math.min(dates.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * dates.length))));
          }}
        />
      </svg>
      {hover !== null && values[hover] !== null && (
        <div className="tooltip" style={{ left: x(hover), top: TOP, transform: x(hover) > width * 0.7 ? 'translate(-105%, 0)' : 'translate(8px, 0)' }}>
          {dates[hover]} · {label} {fmt(values[hover]!)}
        </div>
      )}
    </div>
  );
}
