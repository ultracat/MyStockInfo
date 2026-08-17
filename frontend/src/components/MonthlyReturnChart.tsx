import { useState } from 'react';
import { krw } from '../format';

export interface MonthlyReturnRow {
  /** "YYYY-MM" */
  month: string;
  /** 0.1 = +10%. */
  rate: number;
  /** KRW-converted 평가금액 - 매입금액, 부호 있음. */
  amountKrw: number;
}

const HEIGHT = 140; // half above baseline, half below
const BAR_GAP = 6;
const AXIS_SPACE = 22;

/**
 * 월별 손익률 diverging 막대 — 값의 의미(코호트 vs 누적 등)는 호출부가 정하고,
 * 이 컴포넌트는 `{month, rate, amountKrw}` 배열만 그린다(Overview.tsx의 "매월
 * 보유종목 투자금 대비 수익률" 카드가 씀 — 누적 투자금 대비 수익률 추이).
 * 기준선(0%) 위/아래로 막대가 자라는 diverging 막대라 status 색(good/critical)을
 * 쓴다 — 이 값 자체가 "좋다/나쁘다"를 뜻하는 손익이라 카테고리 색이 아니라 상태
 * 색이 맞다(color-formula.md의 "series가 곧 good/bad를 뜻하면 status를 입는다" 규칙).
 */
export default function MonthlyReturnChart({ rows }: { rows: MonthlyReturnRow[] }) {
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>매수 후 보유 중인 종목의 매매내역이 없습니다.</p>;
  }

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.rate)), 0.01);
  const barWidth = Math.max(18, Math.min(48, 480 / rows.length - BAR_GAP));
  const width = rows.length * (barWidth + BAR_GAP);
  const mid = HEIGHT;
  const totalHeight = HEIGHT * 2 + AXIS_SPACE;

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={width} height={totalHeight} role="img" aria-label="월별 매수 코호트 수익률">
        <line x1={0} x2={width} y1={mid} y2={mid} stroke="var(--baseline)" strokeWidth={1} />
        {rows.map((row, i) => {
          const barHeight = Math.max(2, (Math.abs(row.rate) / maxAbs) * (HEIGHT - 12));
          const x = i * (barWidth + BAR_GAP);
          const positive = row.rate >= 0;
          const y = positive ? mid - barHeight : mid;
          const color = positive ? 'var(--good)' : 'var(--critical)';
          const labelY = positive ? y - 6 : y + barHeight + 14;
          return (
            <g key={row.month}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={3}
                fill={color}
                onMouseEnter={() => setHover({ index: i, x: x + barWidth / 2, y: positive ? y : y + barHeight })}
                onMouseLeave={() => setHover(null)}
              />
              <text x={x + barWidth / 2} y={labelY} textAnchor="middle" fontSize={10} fill="var(--text-secondary)">
                {(row.rate * 100).toFixed(1)}%
              </text>
              <text
                x={x + barWidth / 2}
                y={totalHeight - 6}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {row.month.slice(5)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          {rows[hover.index].month}: {(rows[hover.index].rate * 100).toFixed(2)}% (
          {rows[hover.index].amountKrw >= 0 ? '+' : ''}
          {krw.format(Math.round(rows[hover.index].amountKrw))}원)
        </div>
      )}
    </div>
  );
}
