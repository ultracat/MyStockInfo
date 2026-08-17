import { useState } from 'react';
import { krw, krwCompact } from '../format';

export interface MonthlyInvestmentRow {
  /** "YYYY-MM" */
  month: string;
  /** 그 달 말 기준 누적 매입원가(KRW 환산). */
  investedKrw: number;
  /** 그 달 말 기준 누적 평가금액(보유수량 × 오늘 현재가, KRW 환산). */
  currentKrw: number;
}

const HEIGHT = 180;
const TOP_MARGIN = 24;
const AXIS_SPACE = 24;
const TOOLTIP_HALF_WIDTH = 100;

/**
 * 총 투자금(누적 매입원가) vs 총 수입금(누적 평가금액) 두 선을 같은 축에
 * 겹쳐 그린다 — MonthlyReturnChart와 같은 원본 데이터(월별 체크포인트)를
 * 쓰지만, 여기선 비율이 아니라 두 절대금액 자체를 나란히 보여주는 게
 * 목적이라 diverging 막대가 아니라 두 계열 line chart가 맞다(단일 축,
 * 카테고리컬 색 2개 — color-formula.md의 "값 자체가 좋다/나쁘다를 뜻하면
 * status, 그냥 서로 다른 계열이면 categorical" 규칙).
 */
export default function MonthlyInvestmentChart({ rows }: { rows: MonthlyInvestmentRow[] }) {
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
    hAlign: 'center' | 'left' | 'right';
    vAlign: 'above' | 'below';
  } | null>(null);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>매수 후 보유 중인 종목의 매매내역이 없습니다.</p>;
  }

  const max = Math.max(...rows.map((r) => Math.max(r.investedKrw, r.currentKrw)), 1) * 1.1;
  const colWidth = Math.max(30, Math.min(60, 480 / rows.length));
  const width = rows.length * colWidth;
  const y = (v: number) => TOP_MARGIN + HEIGHT - (v / max) * HEIGHT;
  const x = (i: number) => i * colWidth + colWidth / 2;

  const investedPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.investedKrw)}`).join(' ');
  const currentPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.currentKrw)}`).join(' ');

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--series-1)', marginRight: 6 }} />
          총 투자금(누적 매입원가)
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--series-2)', marginRight: 6 }} />
          총 수입금(현재 평가금액)
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={TOP_MARGIN + HEIGHT + AXIS_SPACE} role="img" aria-label="월별 총 투자금과 총 수입금 추이">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={width}
              y1={TOP_MARGIN + HEIGHT - HEIGHT * f}
              y2={TOP_MARGIN + HEIGHT - HEIGHT * f}
              stroke={f === 0 ? 'var(--baseline)' : 'var(--gridline)'}
              strokeWidth={1}
            />
          ))}
          <path d={investedPath} fill="none" stroke="var(--series-1)" strokeWidth={2} />
          <path d={currentPath} fill="none" stroke="var(--series-2)" strokeWidth={2} />
          {rows.map((row, i) => {
            const colCenterX = x(i);
            let hAlign: 'center' | 'left' | 'right' = 'center';
            if (colCenterX < TOOLTIP_HALF_WIDTH) hAlign = 'left';
            else if (colCenterX > width - TOOLTIP_HALF_WIDTH) hAlign = 'right';
            const anchorY = Math.min(y(row.investedKrw), y(row.currentKrw));
            const vAlign: 'above' | 'below' = anchorY < 60 ? 'below' : 'above';
            return (
              <g key={row.month}>
                <circle cx={colCenterX} cy={y(row.investedKrw)} r={3} fill="var(--series-1)" />
                <circle cx={colCenterX} cy={y(row.currentKrw)} r={3} fill="var(--series-2)" />
                <rect
                  x={i * colWidth}
                  y={0}
                  width={colWidth}
                  height={TOP_MARGIN + HEIGHT + AXIS_SPACE}
                  fill="transparent"
                  onMouseEnter={() =>
                    setHover({
                      index: i,
                      x: hAlign === 'left' ? i * colWidth : hAlign === 'right' ? (i + 1) * colWidth : colCenterX,
                      y: anchorY,
                      hAlign,
                      vAlign,
                    })
                  }
                  onMouseLeave={() => setHover(null)}
                />
                <text
                  x={colCenterX}
                  y={TOP_MARGIN + HEIGHT + AXIS_SPACE - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {row.month.slice(5)}
                </text>
              </g>
            );
          })}
          {hover && (
            <line
              x1={x(hover.index)}
              x2={x(hover.index)}
              y1={TOP_MARGIN}
              y2={TOP_MARGIN + HEIGHT}
              stroke="var(--baseline)"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
          )}
        </svg>
        {hover && (
          <div
            className="tooltip"
            style={{
              left: hover.x,
              top: hover.y,
              transform: `translate(${hover.hAlign === 'left' ? '0' : hover.hAlign === 'right' ? '-100%' : '-50%'}, ${
                hover.vAlign === 'below' ? '14px' : '-110%'
              })`,
            }}
          >
            {rows[hover.index].month}
            <br />
            투자금 {krwCompact.format(rows[hover.index].investedKrw)}원 ({krw.format(Math.round(rows[hover.index].investedKrw))}원)
            <br />
            평가금액 {krwCompact.format(rows[hover.index].currentKrw)}원 ({krw.format(Math.round(rows[hover.index].currentKrw))}원)
          </div>
        )}
      </div>
    </div>
  );
}
