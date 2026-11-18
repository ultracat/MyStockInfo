import { useState } from 'react';
import { krw, krwCompact } from '../format';
import type { SnapshotRecord } from '../types';
import { useContainerWidth } from '../useContainerWidth';

const HEIGHT = 180;
const TOP_MARGIN = 24;
const AXIS_SPACE = 24;
const TOOLTIP_HALF_WIDTH = 100;
/** 왼쪽 세로축 눈금 글자 자리 */
const Y_AXIS = 52;

/**
 * `MonthlyInvestmentChart`와 같은 2-series line chart(투자금 vs 평가금액,
 * 같은 색 배정 `--series-1`/`--series-2`)지만, 입력이 "그 달 체크포인트"가
 * 아니라 하루 한 번 실제로 기록된 스냅샷이라는 점만 다르다 — 재구성 없이
 * 기록된 값을 그대로 그린다(`Overview.tsx`의 "순자산 추이" 카드 전용).
 */
export default function NetWorthChart({ rows }: { rows: SnapshotRecord[] }) {
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
    hAlign: 'center' | 'left' | 'right';
    vAlign: 'above' | 'below';
  } | null>(null);
  const [boxRef, boxWidth] = useContainerWidth();

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>아직 기록된 스냅샷이 없습니다 — 다음에 앱을 열면 오늘부터 쌓입니다.</p>;
  }

  // 2026-11-18 UX 점검: ① 0원부터 그려 두 선이 거의 평평했다 → 기록 범위(최저~최고)에 여백을 두고 그리고 왼쪽에 금액 눈금을 단다
  // (0부터가 아니라는 걸 눈금이 알려 준다). ② 폭이 480px 기준이라 날짜 라벨이 겹쳤다 → 카드 폭에 맞추고 라벨은 겹치지 않게 건너뛴다.
  const values = rows.flatMap((r) => [r.totalPurchaseAmountKrw, r.totalMarketValueKrw]);
  const vMin = Math.min(...values);
  const vMax = Math.max(...values, 1);
  const pad = Math.max((vMax - vMin) * 0.15, vMax * 0.01);
  const lo = Math.max(0, vMin - pad);
  const hi = vMax + pad;
  const plotWidth = Math.max(120, boxWidth - Y_AXIS);
  const colWidth = Math.max(4, Math.min(60, plotWidth / rows.length));
  const width = Y_AXIS + rows.length * colWidth;
  const y = (v: number) => TOP_MARGIN + HEIGHT - ((v - lo) / (hi - lo)) * HEIGHT;
  const x = (i: number) => Y_AXIS + i * colWidth + colWidth / 2;
  const labelEvery = Math.max(1, Math.ceil(44 / colWidth));
  const showDots = colWidth >= 10;

  const investedPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.totalPurchaseAmountKrw)}`).join(' ');
  const currentPath = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.totalMarketValueKrw)}`).join(' ');

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
        <span>
          <span
            style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--series-1)', marginRight: 6 }}
          />
          총 투자금
        </span>
        <span>
          <span
            style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--series-2)', marginRight: 6 }}
          />
          총 평가금액
        </span>
      </div>
      <div ref={boxRef} style={{ overflowX: 'auto' }}>
        <svg width={width} height={TOP_MARGIN + HEIGHT + AXIS_SPACE} role="img" aria-label="일별 총 투자금과 총 평가금액 추이">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={Y_AXIS}
                x2={width}
                y1={TOP_MARGIN + HEIGHT - HEIGHT * f}
                y2={TOP_MARGIN + HEIGHT - HEIGHT * f}
                stroke={f === 0 ? 'var(--baseline)' : 'var(--gridline)'}
                strokeWidth={1}
              />
              <text x={Y_AXIS - 6} y={TOP_MARGIN + HEIGHT - HEIGHT * f + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                {krwCompact.format(lo + (hi - lo) * f)}
              </text>
            </g>
          ))}
          <path d={investedPath} fill="none" stroke="var(--series-1)" strokeWidth={2} />
          <path d={currentPath} fill="none" stroke="var(--series-2)" strokeWidth={2} />
          {rows.map((row, i) => {
            const colCenterX = x(i);
            let hAlign: 'center' | 'left' | 'right' = 'center';
            if (colCenterX - Y_AXIS < TOOLTIP_HALF_WIDTH) hAlign = 'left';
            else if (colCenterX > width - TOOLTIP_HALF_WIDTH) hAlign = 'right';
            const anchorY = Math.min(y(row.totalPurchaseAmountKrw), y(row.totalMarketValueKrw));
            const vAlign: 'above' | 'below' = anchorY < 60 ? 'below' : 'above';
            return (
              <g key={row.date}>
                {(showDots || hover?.index === i) && (
                  <>
                    <circle cx={colCenterX} cy={y(row.totalPurchaseAmountKrw)} r={3} fill="var(--series-1)" />
                    <circle cx={colCenterX} cy={y(row.totalMarketValueKrw)} r={3} fill="var(--series-2)" />
                  </>
                )}
                <rect
                  x={Y_AXIS + i * colWidth}
                  y={0}
                  width={colWidth}
                  height={TOP_MARGIN + HEIGHT + AXIS_SPACE}
                  fill="transparent"
                  onMouseEnter={() =>
                    setHover({
                      index: i,
                      x: hAlign === 'left' ? Y_AXIS + i * colWidth : hAlign === 'right' ? Y_AXIS + (i + 1) * colWidth : colCenterX,
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
                  {i % labelEvery === 0 ? row.date.slice(5) : ''}
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
            {rows[hover.index].date}
            <br />
            투자금 {krwCompact.format(rows[hover.index].totalPurchaseAmountKrw)}원 (
            {krw.format(Math.round(rows[hover.index].totalPurchaseAmountKrw))}원)
            <br />
            평가금액 {krwCompact.format(rows[hover.index].totalMarketValueKrw)}원 (
            {krw.format(Math.round(rows[hover.index].totalMarketValueKrw))}원)
          </div>
        )}
      </div>
    </div>
  );
}
