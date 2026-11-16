import { useState } from 'react';
import type { MonthlySummaryRow } from '../types';
import { krw, krwCompact, usdFmt as usd } from '../format';

const HEIGHT = 180;
const BAR_GAP = 6;
const LABEL_SPACE = 18; // room above the tallest bar for its value label
/** 예상 막대가 있는 달은 숫자가 두 줄이라 위 여백을 이만큼 더 둔다. */
const LABEL_LINE = 12;
const AXIS_SPACE = 24; // room below the baseline for month labels
/** 예상(지급 전) 막대 — 받은 배당과 같은 색을 흐리게. */
const EXPECTED_OPACITY = 0.35;

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
  rows: actualRows,
  expectedRows = [],
  fxRate,
  onBarClick,
}: {
  rows: MonthlySummaryRow[];
  /** 아직 지급 전인 예상 배당(세후로 맞춘 값) — 받은 배당 막대 위에 같은 색을 흐리게 얹는다. 그 달에 받은 배당이 없으면
   *  흐린 막대만 생긴다. 없으면(대시보드 등) 예전 그래프 그대로. */
  expectedRows?: MonthlySummaryRow[];
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

  // 받은 배당과 예상 배당의 달을 합친 축 — 예상만 있는 달(이번 달에 아직 받은 게 없는 경우 등)도 막대가 생긴다.
  const EMPTY = (month: string): MonthlySummaryRow => ({ month, totalKrw: 0, totalUsd: 0, count: 0 });
  const actualByMonth = new Map(actualRows.map((r) => [r.month, r]));
  const expectedByMonth = new Map(expectedRows.map((r) => [r.month, r]));
  const months = [...new Set([...actualByMonth.keys(), ...expectedByMonth.keys()])].sort();
  const rows = months.map((m) => actualByMonth.get(m) ?? EMPTY(m));
  const expectedFor = (month: string) => expectedByMonth.get(month) ?? EMPTY(month);
  const hasExpected = expectedRows.length > 0;

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>배당 기록이 없습니다.</p>;
  }

  const rateFor = typeof fxRate === 'function' ? fxRate : () => fxRate;
  const hasUnconvertedUsd = [...rows, ...expectedRows].some((r) => r.totalUsd > 0 && !rateFor(r.month));
  const valueKrw = (r: MonthlySummaryRow) => {
    const rate = rateFor(r.month);
    return r.totalKrw + (rate ? r.totalUsd * rate : 0);
  };

  const total = rows.reduce((sum, r) => sum + valueKrw(r), 0);
  const expectedTotal = expectedRows.reduce((sum, r) => sum + valueKrw(r), 0);
  const max = Math.max(...rows.map((r) => valueKrw(r) + valueKrw(expectedFor(r.month))), 1);
  const barWidth = Math.max(18, Math.min(48, 480 / rows.length - BAR_GAP));
  const width = rows.length * (barWidth + BAR_GAP);
  const active = hoverIndex !== null ? rows[hoverIndex] : null;
  const activeExpected = active ? expectedFor(active.month) : null;
  const hasStacked = rows.some((r) => r.count > 0 && expectedFor(r.month).count > 0);
  const labelSpace = LABEL_SPACE + (hasStacked ? LABEL_LINE : 0);
  /** 위쪽 두 모서리만 4px 둥근 막대(아래는 기준선/아래 칸에 붙음). */
  const barPath = (x: number, top: number, bottom: number) => {
    const r = Math.min(4, (bottom - top) / 2);
    return `M ${x} ${bottom} L ${x} ${top + r} Q ${x} ${top} ${x + r} ${top} L ${x + barWidth - r} ${top} Q ${x + barWidth} ${top} ${x + barWidth} ${top + r} L ${x + barWidth} ${bottom} Z`;
  };

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
        총 배당금 합계 <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(total))}원</strong>
        {expectedTotal > 0 && (
          <>
            {' '}
            · 예상(지급 전) <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(expectedTotal))}원</strong>
            {' '}· 예상 포함 <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(total + expectedTotal))}원</strong>
          </>
        )}
        {hasUnconvertedUsd && ' (달러 배당금은 환율 미적용 — 설정에서 환율을 등록해주세요)'}
      </div>
      {hasExpected && (
        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 14, rowGap: 2, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          <span style={{ whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--series-1)', marginRight: 4 }} />
            받은 배당
          </span>
          <span style={{ whiteSpace: 'nowrap' }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--series-1)', opacity: EXPECTED_OPACITY, marginRight: 4 }} />
            예상 (지급 전, 세후 추정)
          </span>
          {hasStacked && <span style={{ color: 'var(--text-muted)' }}>숫자: 진한 막대 위 = 받은 배당, 맨 위(흐린 글씨) = 예상 포함</span>}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <svg
          width={width}
          height={labelSpace + HEIGHT + AXIS_SPACE}
          role="img"
          aria-label="월별 배당금 막대 그래프"
        >
          <g transform={`translate(0, ${labelSpace})`}>
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
              const actualV = valueKrw(row);
              const expectedV = valueKrw(expectedFor(row.month));
              const v = actualV + expectedV;
              const scale = (HEIGHT - 8) / max;
              const actualH = actualV > 0 ? Math.max(2, actualV * scale) : 0;
              const expectedH = expectedV > 0 ? Math.max(2, expectedV * scale) : 0;
              // 받은 배당 위에 예상을 얹을 때는 둘 사이에 2px 틈(배경색)을 둔다 — 같은 색이라 경계를 보이게.
              const gap = actualH && expectedH ? 2 : 0;
              const x = i * (barWidth + BAR_GAP);
              const actualTop = HEIGHT - actualH;
              const y = actualTop - gap - expectedH;
              const clickable = onBarClick && row.count > 0;
              // 어떤 막대에 마우스가 올라가 있으면 나머지는 살짝 흐리게 해서
              // "지금 아래 패널에 표시 중인 막대가 이것"임을 알려준다(DonutChart의
              // 호버 딤아웃과 같은 패턴).
              const dimmed = hoverIndex !== null && hoverIndex !== i;
              return (
                <g key={row.month} style={{ opacity: dimmed ? 0.5 : 1, transition: 'opacity 0.1s ease' }}>
                  {actualH > 0 && (
                    <path
                      d={expectedH ? `M ${x} ${HEIGHT} L ${x} ${actualTop} L ${x + barWidth} ${actualTop} L ${x + barWidth} ${HEIGHT} Z` : barPath(x, actualTop, HEIGHT)}
                      fill="var(--series-1)"
                    />
                  )}
                  {expectedH > 0 && (
                    <path d={barPath(x, y, actualTop - gap)} fill="var(--series-1)" opacity={EXPECTED_OPACITY} />
                  )}
                  {/* 호버·클릭 영역 — 막대 칸 전체(얇은 막대도 잡히게) */}
                  <rect
                    x={x}
                    y={0}
                    width={barWidth}
                    height={HEIGHT}
                    fill="transparent"
                    style={clickable ? { cursor: 'pointer' } : undefined}
                    onMouseEnter={() => setHoverIndex(i)}
                    onMouseLeave={() => setHoverIndex(null)}
                    onClick={() => clickable && onBarClick?.(row.month)}
                  />
                  {/* 막대 위 숫자 — 받은 배당은 **진한 막대 바로 위**(예상이 얹힌 달은 흐린 막대 안쪽에 겹친다 — 배경색 테두리로
                      읽히게), 예상 포함 합계는 흐린 막대 위에 흐린 글씨. 흐린 막대가 낮아 두 숫자가 겹치면 합계를 한 줄 위로 올린다.
                      받은 배당만 있거나 예상만 있는 달은 한 줄. */}
                  {(() => {
                    const cx = x + barWidth / 2;
                    if (!(expectedH > 0 && actualH > 0)) {
                      return (
                        <text x={cx} y={y - 5} textAnchor="middle" fontSize={10} fill={actualH > 0 ? 'var(--text-secondary)' : 'var(--text-muted)'}>
                          {krwCompact.format(actualH > 0 ? actualV : v)}
                        </text>
                      );
                    }
                    const actualY = actualTop - 5;
                    const totalY = Math.min(y - 5, actualY - LABEL_LINE);
                    return (
                      <>
                        <text x={cx} y={totalY} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
                          {krwCompact.format(v)}
                        </text>
                        <text
                          x={cx}
                          y={actualY}
                          textAnchor="middle"
                          fontSize={10}
                          fill="var(--text-secondary)"
                          stroke="var(--surface-1)"
                          strokeWidth={3}
                          strokeLinejoin="round"
                          paintOrder="stroke"
                        >
                          {krwCompact.format(actualV)}
                        </text>
                      </>
                    );
                  })()}
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
            {active.count > 0 ? `받은 배당 ${krw.format(Math.round(valueKrw(active)))}원 (${active.count}건)` : '받은 배당 없음'}
            {active.totalUsd > 0 && (
              <span style={{ color: 'var(--text-muted)' }}>
                {' '}
                — 원화 {krw.format(active.totalKrw)}원 + 달러 {usd.format(active.totalUsd)}
              </span>
            )}
            {activeExpected && activeExpected.count > 0 && (
              <span>
                {' · '}예상(지급 전) {krw.format(Math.round(valueKrw(activeExpected)))}원 ({activeExpected.count}건
                {activeExpected.totalUsd > 0 && `, 달러 ${usd.format(activeExpected.totalUsd)} 포함`})
                {' · '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  예상 포함 {krw.format(Math.round(valueKrw(active) + valueKrw(activeExpected)))}원
                </strong>
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
