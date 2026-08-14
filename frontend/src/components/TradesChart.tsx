import { useState } from 'react';

export interface MonthlyTradeSummary {
  month: string; // YYYY-MM
  buyKrw: number;
  buyUsd: number;
  sellKrw: number;
  sellUsd: number;
}

const PANEL_HEIGHT = 150;
const GROUP_WIDTH = 48;
const BAR_GAP = 2; // between 매수/매도 bars within a month group
const GROUP_GAP = 10; // between month groups
const BAR_WIDTH = (GROUP_WIDTH - BAR_GAP) / 2;
// 막대가 패널 최댓값에 거의 닿을 만큼 길어져도(y가 8에 가까워져도) 그 위의
// 금액 라벨이 잘리지 않도록 넉넉히 잡은 여백 — 8px짜리 여백으로 시작했다가
// 막대가 큰 달에서 라벨(과 호버 툴팁)이 위로 잘려 보이지 않는 문제가 있어서
// DividendsChart(18px)보다도 더 키웠다.
const LABEL_SPACE = 24;
const AXIS_SPACE = 24;

const krw = new Intl.NumberFormat('ko-KR');
const krwCompact = new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

interface HoverInfo {
  x: number;
  y: number;
  text: string;
}

interface PanelProps {
  title: string;
  rows: MonthlyTradeSummary[];
  buyOf: (r: MonthlyTradeSummary) => number;
  sellOf: (r: MonthlyTradeSummary) => number;
  formatCompact: (v: number) => string;
  formatFull: (v: number) => string;
}

/** Hover state (and its tooltip) lives per-panel, in the panel's own
 *  `position: relative` wrapper — hover.x/y are SVG-local coordinates, so a
 *  tooltip shared across stacked panels would need each panel's vertical
 *  offset added back in. Keeping it local sidesteps that entirely. */
function Panel({ title, rows, buyOf, sellOf, formatCompact, formatFull }: PanelProps) {
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const totalBuy = rows.reduce((sum, r) => sum + buyOf(r), 0);
  const totalSell = rows.reduce((sum, r) => sum + sellOf(r), 0);
  const max = Math.max(...rows.map((r) => Math.max(buyOf(r), sellOf(r))), 1);
  const width = rows.length * GROUP_WIDTH + (rows.length - 1) * GROUP_GAP;

  function bar(x: number, y: number, w: number, color: string, value: number) {
    if (value <= 0) return null;
    return (
      <g>
        <path
          d={`M ${x} ${PANEL_HEIGHT} L ${x} ${y + 4} Q ${x} ${y} ${x + 4} ${y} L ${x + w - 4} ${y} Q ${x + w} ${y} ${x + w} ${y + 4} L ${x + w} ${PANEL_HEIGHT} Z`}
          fill={color}
          onMouseEnter={() => setHover({ x: x + w / 2, y: y + LABEL_SPACE, text: formatFull(value) })}
          onMouseLeave={() => setHover(null)}
        />
        <text x={x + w / 2} y={y - 4} textAnchor="middle" fontSize={9} fill="var(--text-secondary)">
          {formatCompact(value)}
        </text>
      </g>
    );
  }

  return (
    <div style={{ marginBottom: 12, position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 6, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span
            style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--series-1)', display: 'inline-block' }}
          />
          매수 <strong style={{ color: 'var(--text-primary)' }}>{formatFull(totalBuy)}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          <span
            style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--series-2)', display: 'inline-block' }}
          />
          매도 <strong style={{ color: 'var(--text-primary)' }}>{formatFull(totalSell)}</strong>
        </div>
      </div>
      <svg
        width={width}
        height={LABEL_SPACE + PANEL_HEIGHT + AXIS_SPACE}
        role="img"
        aria-label={`${title} 월별 매수/매도 금액 막대 그래프`}
      >
        <g transform={`translate(0, ${LABEL_SPACE})`}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line
              key={f}
              x1={0}
              x2={width}
              y1={PANEL_HEIGHT - PANEL_HEIGHT * f}
              y2={PANEL_HEIGHT - PANEL_HEIGHT * f}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
          ))}
          <line x1={0} x2={width} y1={PANEL_HEIGHT} y2={PANEL_HEIGHT} stroke="var(--baseline)" strokeWidth={1} />

          {rows.map((row, i) => {
            const groupX = i * (GROUP_WIDTH + GROUP_GAP);
            const buyV = buyOf(row);
            const sellV = sellOf(row);
            const buyY = PANEL_HEIGHT - Math.max(0, (buyV / max) * (PANEL_HEIGHT - 8));
            const sellY = PANEL_HEIGHT - Math.max(0, (sellV / max) * (PANEL_HEIGHT - 8));
            return (
              <g key={row.month}>
                {bar(groupX, buyY, BAR_WIDTH, 'var(--series-1)', buyV)}
                {bar(groupX + BAR_WIDTH + BAR_GAP, sellY, BAR_WIDTH, 'var(--series-2)', sellV)}
                <text
                  x={groupX + GROUP_WIDTH / 2}
                  y={PANEL_HEIGHT + 16}
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
          {hover.text}
        </div>
      )}
    </div>
  );
}

/**
 * 원화와 달러는 단위/스케일 자체가 다른 값이라(dataviz 스킬: "Two measures of
 * different scale → 두 개의 차트/스몰 멀티플로 나눈다") 예전처럼 환율로 환산해
 * 하나의 막대로 합치지 않는다. 이번 연도에 달러 거래가 하나라도 있으면 원화
 * 패널과 달러 패널을 위아래로 따로 그리고, 없으면 원화 패널만 보여준다.
 * 막대 위 금액은 항상 라벨로 표시한다(호버 전용이면 값이 안 보인다는 피드백) —
 * 막대가 최댓값에 가깝게 길어져도 라벨이 잘리지 않도록 위쪽 여백(LABEL_SPACE)을
 * 넉넉히 잡았다.
 */
export default function TradesChart({ rows }: { rows: MonthlyTradeSummary[] }) {
  const hasUsd = rows.some((r) => r.buyUsd > 0 || r.sellUsd > 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <Panel
        title="원화"
        rows={rows}
        buyOf={(r) => r.buyKrw}
        sellOf={(r) => r.sellKrw}
        formatCompact={krwCompact.format}
        formatFull={(v) => `${krw.format(Math.round(v))}원`}
      />
      {hasUsd && (
        <Panel
          title="달러"
          rows={rows}
          buyOf={(r) => r.buyUsd}
          sellOf={(r) => r.sellUsd}
          formatCompact={usdCompact.format}
          formatFull={usdFmt.format}
        />
      )}
    </div>
  );
}
