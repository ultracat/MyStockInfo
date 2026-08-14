import { useState } from 'react';

export interface MonthlyTradeSummary {
  month: string; // YYYY-MM
  buyKrw: number;
  buyUsd: number;
  sellKrw: number;
  sellUsd: number;
}

const HEIGHT = 180;
const GROUP_WIDTH = 48;
const BAR_GAP = 2; // between 매수/매도 bars within a month group
const GROUP_GAP = 10; // between month groups
const BAR_WIDTH = (GROUP_WIDTH - BAR_GAP) / 2;
const LABEL_SPACE = 8;
const AXIS_SPACE = 24;

const krw = new Intl.NumberFormat('ko-KR');
const krwCompact = new Intl.NumberFormat('ko-KR', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

interface HoverInfo {
  month: string;
  side: '매수' | '매도';
  x: number;
  y: number;
  valueKrw: number;
}

/**
 * 12개월 고정 그룹형 막대 그래프 — 월별로 매수(series-1, 파랑)/매도(series-2,
 * 주황) 막대를 나란히 보여준다. 막대가 24개(12개월×2)라 DividendsChart처럼
 * 막대마다 라벨을 박으면 너무 빽빽해지므로, 정확한 값은 호버 툴팁으로만
 * 보여주고 막대 위 직접 라벨은 생략한다(dataviz 스킬의 "선택적 직접 라벨" —
 * 막대가 많을 땐 전부 라벨링하지 않는다). 달러 거래는 fxRate로 원화 환산해서
 * 하나의 막대 높이로 합친다 — 통화별로 쪼개면 4개 시리즈가 되어 과하다.
 */
export default function TradesChart({ rows, fxRate }: { rows: MonthlyTradeSummary[]; fxRate: number | null }) {
  const [hover, setHover] = useState<HoverInfo | null>(null);

  const hasUnconvertedUsd = !fxRate && rows.some((r) => r.buyUsd > 0 || r.sellUsd > 0);
  const buyKrwEquiv = (r: MonthlyTradeSummary) => r.buyKrw + (fxRate ? r.buyUsd * fxRate : 0);
  const sellKrwEquiv = (r: MonthlyTradeSummary) => r.sellKrw + (fxRate ? r.sellUsd * fxRate : 0);

  const totalBuy = rows.reduce((sum, r) => sum + buyKrwEquiv(r), 0);
  const totalSell = rows.reduce((sum, r) => sum + sellKrwEquiv(r), 0);
  const max = Math.max(...rows.map((r) => Math.max(buyKrwEquiv(r), sellKrwEquiv(r))), 1);
  const width = rows.length * GROUP_WIDTH + (rows.length - 1) * GROUP_GAP;

  function bar(x: number, y: number, w: number, color: string, onEnter: () => void) {
    const h = HEIGHT - y;
    return (
      <path
        d={`M ${x} ${HEIGHT} L ${x} ${y + 4} Q ${x} ${y} ${x + 4} ${y} L ${x + w - 4} ${y} Q ${x + w} ${y} ${x + w} ${y + 4} L ${x + w} ${HEIGHT} Z`}
        fill={color}
        onMouseEnter={onEnter}
        onMouseLeave={() => setHover(null)}
        style={{ display: h <= 0 ? 'none' : undefined }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--series-1)', display: 'inline-block' }} />
          매수 <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(totalBuy))}원</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--series-2)', display: 'inline-block' }} />
          매도 <strong style={{ color: 'var(--text-primary)' }}>{krw.format(Math.round(totalSell))}원</strong>
        </div>
        {hasUnconvertedUsd && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>(달러 거래는 환율 미적용 — 설정에서 환율을 등록해주세요)</span>
        )}
      </div>
      <div style={{ position: 'relative', overflowX: 'auto' }}>
        <svg width={width} height={LABEL_SPACE + HEIGHT + AXIS_SPACE} role="img" aria-label="월별 매수/매도 금액 막대 그래프">
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
              const groupX = i * (GROUP_WIDTH + GROUP_GAP);
              const buyV = buyKrwEquiv(row);
              const sellV = sellKrwEquiv(row);
              const buyY = HEIGHT - Math.max(0, (buyV / max) * (HEIGHT - 8));
              const sellY = HEIGHT - Math.max(0, (sellV / max) * (HEIGHT - 8));
              return (
                <g key={row.month}>
                  {bar(groupX, buyY, BAR_WIDTH, 'var(--series-1)', () =>
                    setHover({ month: row.month, side: '매수', x: groupX + BAR_WIDTH / 2, y: buyY + LABEL_SPACE, valueKrw: buyV })
                  )}
                  {bar(groupX + BAR_WIDTH + BAR_GAP, sellY, BAR_WIDTH, 'var(--series-2)', () =>
                    setHover({
                      month: row.month,
                      side: '매도',
                      x: groupX + BAR_WIDTH + BAR_GAP + BAR_WIDTH / 2,
                      y: sellY + LABEL_SPACE,
                      valueKrw: sellV,
                    })
                  )}
                  <text
                    x={groupX + GROUP_WIDTH / 2}
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
            {hover.month} {hover.side}: {krwCompact.format(hover.valueKrw)}원
          </div>
        )}
      </div>
    </div>
  );
}
