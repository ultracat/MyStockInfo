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
 *
 * fxRate accepts either a single flat rate (old behavior) or a per-month
 * resolver — Dividends.tsx/Overview.tsx pass a resolver so each row (a
 * calendar month) converts at *that* month's average rate instead of one
 * rate applied to every bar, since a dividend's KRW value should reflect
 * the rate around when it was actually paid, not today's.
 */
export default function DividendsChart({
  rows,
  fxRate,
  onBarClick,
}: {
  rows: MonthlySummaryRow[];
  fxRate: number | null | ((month: string) => number | null);
  /** 있으면 막대가 클릭 가능해지고, 그 달("YYYY-MM")을 인자로 호출된다(호출부가
   *  그 달 상세 배당 내역 팝업 등을 열 때 씀). */
  onBarClick?: (month: string) => void;
}) {
  // 예전엔 마우스를 올린 막대 위에 떠다니는 말풍선(.tooltip, position:absolute)으로
  // 상세를 보여줬는데, 카드 폭이 좁거나 막대가 가장자리에 있으면 화면/카드 밖으로
  // 잘려서 안 보이는 경우가 있었다("계속 안 보이는 경우가 있다" 피드백) — 아무리
  // 좌우/상하 위치를 보정해도 떠다니는 요소라 근본적으로 클리핑 위험이 남는다.
  // 그래서 위치 계산이 필요 없는 방식으로 바꿨다: 차트 아래 항상 같은 자리에 고정된
  // 영역을 하나 두고, 마우스를 올린 막대의 상세를 거기에 표시한다.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>배당 기록이 없습니다.</p>;
  }

  const rateFor = typeof fxRate === 'function' ? fxRate : () => fxRate;
  const hasUnconvertedUsd = rows.some((r) => r.totalUsd > 0 && !rateFor(r.month));
  const valueKrw = (r: MonthlySummaryRow) => {
    const rate = rateFor(r.month);
    return r.totalKrw + (rate ? r.totalUsd * rate : 0);
  };

  const total = rows.reduce((sum, r) => sum + valueKrw(r), 0);
  const max = Math.max(...rows.map(valueKrw), 1);
  const barWidth = Math.max(18, Math.min(48, 480 / rows.length - BAR_GAP));
  const width = rows.length * (barWidth + BAR_GAP);
  const active = hoverIndex !== null ? rows[hoverIndex] : null;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        총 배당금 합계 <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(total))}원</strong>
        {hasUnconvertedUsd && ' (달러 배당금은 환율 미적용 — 설정에서 환율을 등록해주세요)'}
      </div>
      <div style={{ overflowX: 'auto' }}>
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
              // 어떤 막대에 마우스가 올라가 있으면 나머지는 살짝 흐리게 해서
              // "지금 아래 패널에 표시 중인 막대가 이것"임을 알려준다(DonutChart의
              // 호버 딤아웃과 같은 패턴).
              const dimmed = hoverIndex !== null && hoverIndex !== i;
              return (
                <g key={row.month} style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 0.1s ease' }}>
                  <path
                    d={`M ${x} ${HEIGHT} L ${x} ${y + 4} Q ${x} ${y} ${x + 4} ${y} L ${x + barWidth - 4} ${y} Q ${x + barWidth} ${y} ${x + barWidth} ${y + 4} L ${x + barWidth} ${HEIGHT} Z`}
                    fill="var(--series-1)"
                    style={onBarClick ? { cursor: 'pointer' } : undefined}
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex(null)}
                    onClick={() => onBarClick?.(row.month)}
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
      </div>
      <div className="chart-detail-panel">
        {active ? (
          <>
            <strong style={{ color: 'var(--text-primary)' }}>{active.month}</strong>
            {': '}
            {krw.format(Math.round(valueKrw(active)))}원 ({active.count}건)
            {active.totalUsd > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}
                — 원화 {krw.format(active.totalKrw)}원 + 달러 {usd.format(active.totalUsd)}
              </span>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>
            막대에 마우스를 올리면 그 달의 배당금 상세가 여기 표시됩니다
            {onBarClick && ' (클릭하면 종목별 내역을 볼 수 있습니다)'}.
          </span>
        )}
      </div>
    </div>
  );
}
