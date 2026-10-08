import { useState } from 'react';
import { krw, usdFmt } from '../format';

export interface PricePoint {
  month: string;
  closePrice: number;
  currency: string;
}

const HEIGHT = 140;
const TOP_MARGIN = 16;
const AXIS_SPACE = 20;

function formatPrice(v: number, currency: string): string {
  return currency === 'USD' ? usdFmt.format(v) : `${krw.format(Math.round(v))}원`;
}

/** 관심종목 상세 보기(Watchlist.tsx)의 월별 종가 단일 시리즈 line chart —
 *  `MonthlyInvestmentChart`/`NetWorthChart`와 같은 그리기 방식이지만 계열이
 *  하나뿐이라(비교 대상이 없음) 그만큼 더 단순하다. 데이터는 토스 일봉 기반
 *  `GET /market-info/monthly-close-prices`(backend/CLAUDE.md의 "월별 종가 조회"
 *  절 참고) — 토스 미연동이거나 그 종목을 못 찾으면 빈 배열이 온다. */
export default function PriceChart({ points }: { points: PricePoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (points.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)' }}>
        월별 종가를 가져오지 못했습니다 — 토스증권 미연동이거나 이 종목의 시세를 찾을 수
        없습니다.
      </p>
    );
  }

  const prices = points.map((p) => p.closePrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const colWidth = Math.max(30, Math.min(60, 480 / points.length));
  const width = points.length * colWidth;
  const y = (v: number) => TOP_MARGIN + HEIGHT - ((v - min) / range) * HEIGHT;
  const x = (i: number) => i * colWidth + colWidth / 2;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.closePrice)}`).join(' ');

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ overflowX: 'auto' }}>
        <svg width={width} height={TOP_MARGIN + HEIGHT + AXIS_SPACE} role="img" aria-label="월별 종가 추이">
          <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} />
          {points.map((p, i) => (
            <g key={p.month}>
              <circle cx={x(i)} cy={y(p.closePrice)} r={3} fill="var(--series-1)" />
              <rect
                x={i * colWidth}
                y={0}
                width={colWidth}
                height={TOP_MARGIN + HEIGHT + AXIS_SPACE}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
              <text
                x={x(i)}
                y={TOP_MARGIN + HEIGHT + AXIS_SPACE - 4}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {p.month.slice(5)}
              </text>
            </g>
          ))}
        </svg>
        {hoverIndex !== null && (
          <div
            className="tooltip"
            style={{
              left: x(hoverIndex),
              top: y(points[hoverIndex].closePrice),
              transform: 'translate(-50%, -110%)',
            }}
          >
            {points[hoverIndex].month}
            <br />
            {formatPrice(points[hoverIndex].closePrice, points[hoverIndex].currency)}
          </div>
        )}
      </div>
    </div>
  );
}
