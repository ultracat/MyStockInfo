import { useState } from 'react';
import type { MonthlySummaryRow } from '../types';
import { krw, krwCompact, usdFmt as usd } from '../format';

const HEIGHT = 180;
const BAR_GAP = 6;
const LABEL_SPACE = 18; // room above the tallest bar for its value label
const AXIS_SPACE = 24; // room below the baseline for month labels

/**
 * fxRate converts each row's USD-denominated dividends to KRW so bar height,
 * the per-bar label, and the total all reflect one blended KRW figure — same
 * approach as Dashboard.tsx's portfolio-weight conversion. Rows with USD
 * dividends but no fxRate available show a "환율 미적용" caveat instead of
 * silently under-counting them.
 */
export default function DividendsChart({ rows, fxRate }: { rows: MonthlySummaryRow[]; fxRate: number | null }) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>배당 기록이 없습니다.</p>;
  }

  const hasUnconvertedUsd = !fxRate && rows.some((r) => r.totalUsd > 0);
  const valueKrw = (r: MonthlySummaryRow) => r.totalKrw + (fxRate ? r.totalUsd * fxRate : 0);

  const total = rows.reduce((sum, r) => sum + valueKrw(r), 0);
  const max = Math.max(...rows.map(valueKrw), 1);
  const barWidth = Math.max(18, Math.min(48, 480 / rows.length - BAR_GAP));
  const width = rows.length * (barWidth + BAR_GAP);

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        총 배당금 합계 <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(total))}원</strong>
        {hasUnconvertedUsd && ' (달러 배당금은 환율 미적용 — 설정에서 환율을 등록해주세요)'}
      </div>
      <div style={{ position: 'relative' }}>
        <svg
          width={width}
          height={LABEL_SPACE + HEIGHT + AXIS_SPACE}
          role="img"
          aria-label="월별 배당금 막대 그래프"
        >
          <g transform={`translate(0, ${LABEL_SPACE})`}>
            {[0.25, 0.5, 0.75, 1].map((f) => (
              <line
                key={f}
                x1={0}
                x2={width}
                y1={HEIGHT - HEIGHT * f}
                y2={HEIGHT - HEIGHT * f}
                stroke="var(--gridline)"
                strokeWidth={1}
              />
            ))}
            <line x1={0} x2={width} y1={HEIGHT} y2={HEIGHT} stroke="var(--baseline)" strokeWidth={1} />

            {rows.map((row, i) => {
              const v = valueKrw(row);
              const barHeight = Math.max(2, (v / max) * (HEIGHT - 8));
              const x = i * (barWidth + BAR_GAP);
              const y = HEIGHT - barHeight;
              return (
                <g key={row.month}>
                  <path
                    d={`M ${x} ${HEIGHT} L ${x} ${y + 4} Q ${x} ${y} ${x + 4} ${y} L ${x + barWidth - 4} ${y} Q ${x + barWidth} ${y} ${x + barWidth} ${y + 4} L ${x + barWidth} ${HEIGHT} Z`}
                    fill="var(--series-1)"
                    onMouseEnter={() => setHover({ index: i, x: x + barWidth / 2, y: y + LABEL_SPACE })}
                    onMouseLeave={() => setHover(null)}
                  />
                  <text
                    x={x + barWidth / 2}
                    y={y - 5}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--text-secondary)"
                  >
                    {krwCompact.format(v)}
                  </text>
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT + 16}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--text-muted)"
                  >
                    {row.month.slice(5)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
            {rows[hover.index].month}: {krw.format(Math.round(valueKrw(rows[hover.index])))}원 (
            {rows[hover.index].count}건)
            {rows[hover.index].totalUsd > 0 && (
              <>
                <br />
                원화 {krw.format(rows[hover.index].totalKrw)}원 + 달러 {usd.format(rows[hover.index].totalUsd)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
