import { useMemo, useState } from 'react';
import { useContainerWidth } from '../../useContainerWidth';

/** 비교선 색 — 이 종목은 슬롯 1, 기준 지수는 회색 기준선(`--text-muted`), 다른 관심종목은 슬롯 2·3. */
export const COMPARE_COLORS = ['var(--series-1)', 'var(--text-muted)', 'var(--series-2)', 'var(--series-3)'];

export interface CompareSeries {
  key: string;
  label: string;
  color: string;
  points: Array<{ date: string; rate: number }>;
  dashed?: boolean;
}

const H = 180;
const TOP = 10;
const AXIS_H = 18;
const Y_AXIS = 48;
const RIGHT = 8;
const pct = (v: number) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

/**
 * 같은 기간 수익률 비교(2026-11-19) — 첫 날을 0%로 둔 누적 수익률 선. 날짜 축은 모든 계열의 날짜를 합친 것이라
 * 국내·미국 휴장일이 달라도 선이 어긋나지 않는다(없는 날은 선을 이어 그린다). 범례는 항상 보인다(호버에만 기대지 않음).
 */
export default function CompareChart({ series }: { series: CompareSeries[] }) {
  const [ref, boxWidth] = useContainerWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  const dates = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.date)))].sort(), [series]);
  const lookup = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.date, p.rate]))), [series]);
  if (dates.length < 2) return <p style={{ color: 'var(--text-muted)' }}>비교할 일봉이 없습니다.</p>;

  const width = Math.max(320, boxWidth);
  const plotW = width - Y_AXIS - RIGHT;
  const all = series.flatMap((s) => s.points.map((p) => p.rate));
  let min = Math.min(0, ...all);
  let max = Math.max(0, ...all);
  const pad = (max - min) * 0.08 || 0.01;
  min -= pad;
  max += pad;
  const idx = new Map(dates.map((d, i) => [d, i]));
  const x = (i: number) => Y_AXIS + (i / (dates.length - 1)) * plotW;
  const y = (v: number) => TOP + H - ((v - min) / (max - min)) * H;
  // 0%와 너무 가까운 끝 눈금은 뺀다(글자가 겹친다)
  const ticks = [min + pad, 0, max - pad].filter((v, i, a) => a.indexOf(v) === i && (v === 0 || Math.abs(v) > (max - min) * 0.12));
  const labelEvery = Math.max(1, Math.ceil(dates.length / 6));

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, marginBottom: 4 }}>
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width={16} height={8} aria-hidden>
                <line x1={0} x2={16} y1={4} y2={4} stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '4 2' : undefined} />
              </svg>
              {s.label} {last && <b>{pct(last.rate)}</b>}
            </span>
          );
        })}
      </div>
      <div ref={ref} style={{ position: 'relative' }}>
        <svg width={width} height={TOP + H + AXIS_H} role="img" aria-label="같은 기간 수익률 비교" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={Y_AXIS} x2={width - RIGHT} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--baseline)' : 'var(--gridline)'} />
              <text x={Y_AXIS - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                {pct(t)}
              </text>
            </g>
          ))}
          {series.map((s) => (
            <path
              key={s.key}
              d={s.points.map((p, i) => `${i ? 'L' : 'M'} ${x(idx.get(p.date)!).toFixed(1)} ${y(p.rate).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={s.key === series[0].key ? 2 : 1.5}
              strokeDasharray={s.dashed ? '4 2' : undefined}
            />
          ))}
          {dates.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d} x={x(i)} y={TOP + H + AXIS_H - 4} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                {d.slice(2).replace(/-/g, '.')}
              </text>
            ) : null
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={TOP + H} stroke="var(--text-muted)" />}
          <rect
            x={Y_AXIS}
            y={0}
            width={plotW}
            height={TOP + H}
            fill="transparent"
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              setHover(Math.min(dates.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width) * (dates.length - 1)))));
            }}
          />
        </svg>
        {hover !== null && (
          <div className="tooltip" style={{ left: x(hover), top: TOP, transform: x(hover) > width * 0.7 ? 'translate(-105%, 0)' : 'translate(8px, 0)' }}>
            <div>
              <b>{dates[hover]}</b>
            </div>
            {series.map((s, k) => {
              const v = lookup[k].get(dates[hover]);
              return v === undefined ? null : (
                <div key={s.key}>
                  {s.label} {pct(v)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
