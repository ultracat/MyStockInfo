import { useState } from 'react';
import { useContainerWidth } from '../../useContainerWidth';
import type { SymbolDividendEvent } from '../../types';

const H = 120;
const TOP = 16;
const AXIS_H = 18;

/**
 * 주당 배당금 막대(2026-11-19) — 지난 배당은 진한 막대, 다음 배당(발표·추정)은 같은 색 흐린 막대(배당금 화면 DividendsChart와 같은 규칙: 같은 측정값의
 * 미확정분이라 새 색을 쓰지 않는다). 금액 미정(0)은 뺀다. 막대가 넓으면 위에 금액.
 */
export default function DividendBars({
  history,
  upcoming,
  fmt,
}: {
  history: SymbolDividendEvent[];
  upcoming: SymbolDividendEvent[];
  fmt: (v: number) => string;
}) {
  const [ref, boxWidth] = useContainerWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  const bars = [
    ...history.filter((e) => e.perShare > 0).map((e) => ({ ...e, future: false })),
    ...upcoming.filter((e) => e.perShare > 0).map((e) => ({ ...e, future: true })),
  ];
  if (bars.length < 2) return null;
  const width = Math.max(320, boxWidth);
  const slot = width / bars.length;
  const bw = Math.min(40, slot * 0.7);
  const max = Math.max(...bars.map((b) => b.perShare));
  const showValues = slot >= 44;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 8));
  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 8 }}>
      <svg width={width} height={TOP + H + AXIS_H} role="img" aria-label="주당 배당금 추이" onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={width} y1={TOP + H} y2={TOP + H} stroke="var(--baseline)" />
        {bars.map((b, i) => {
          const h = (b.perShare / max) * H;
          const cx = i * slot + slot / 2;
          return (
            <g key={`${b.recordDate}:${i}`} onMouseEnter={() => setHover(i)}>
              <rect x={i * slot} y={0} width={slot} height={TOP + H + AXIS_H} fill="transparent" />
              <rect x={cx - bw / 2} y={TOP + H - h} width={bw} height={h} rx={2} fill="var(--series-1)" fillOpacity={b.future ? 0.35 : 1} />
              {showValues && (
                <text x={cx} y={TOP + H - h - 4} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                  {fmt(b.perShare)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={Math.min(width - 16, Math.max(16, cx))} y={TOP + H + AXIS_H - 4} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                  {b.recordDate.slice(2, 7).replace('-', '.')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: hover * slot + slot / 2, top: 0 }}>
          기준일 {bars[hover].recordDate} · 주당 {fmt(bars[hover].perShare)}
          {bars[hover].future ? ' (다음 배당 — 발표·추정)' : bars[hover].payDate ? ` · 지급 ${bars[hover].payDate}` : ''}
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>진한 막대 = 지난 배당 · 흐린 막대 = 다음 배당(발표·추정) · 주당 세전</div>
    </div>
  );
}
