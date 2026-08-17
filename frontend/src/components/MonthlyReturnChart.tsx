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

// 기준선(0%) 위/아래 영역 각각의 최대 픽셀 높이 — 실제로는 데이터에 따라 이보다
// 작게 쓰인다(아래 topHeight/bottomHeight 계산 참고). 위/아래 둘 다 이 값을 꽉
// 채우는 경우는 양수/음수 막대의 최대 크기(절댓값)가 같을 때뿐이다.
const MAX_SIDE_HEIGHT = 120;
// 막대 + 퍼센트 라벨이 차지하는 여백 — 값이 있는 쪽에만 더해진다(예: 전부 양수면
// 아래쪽엔 이 여백조차 필요 없음).
const LABEL_MARGIN = 18;
const BAR_GAP = 6;
const AXIS_SPACE = 22;

/**
 * 월별 손익률 diverging 막대 — 값의 의미(코호트 vs 누적 등)는 호출부가 정하고,
 * 이 컴포넌트는 `{month, rate, amountKrw}` 배열만 그린다(Overview.tsx의 "매월
 * 보유종목 투자금 대비 수익률" 카드가 씀 — 누적 투자금 대비 수익률 추이).
 * 기준선(0%) 위/아래로 막대가 자라는 diverging 막대라 status 색(good/critical)을
 * 쓴다 — 이 값 자체가 "좋다/나쁘다"를 뜻하는 손익이라 카테고리 색이 아니라 상태
 * 색이 맞다(color-formula.md의 "series가 곧 good/bad를 뜻하면 status를 입는다" 규칙).
 *
 * **기준선 위/아래 영역 높이는 비대칭이다** — 예전엔 위/아래를 항상 절반씩
 * 고정으로 나눴는데, 값이 전부 양수(또는 전부 음수)인 흔한 경우 안 쓰는 쪽 절반이
 * 통째로 빈칸으로 남아 막대와 아래 월 라벨 사이가 불필요하게 벌어지는
 * 문제였다("막대와 월 숫자 사이 빈칸이 너무 크다" 피드백). 그래서 양수 쪽 최대값과
 * 음수 쪽 최대값(절댓값) 각각에 비례해서 위/아래 높이를 따로 잡는다 — 막대 하나당
 * 픽셀 비율(`pxPerUnit`)은 전체에서 하나로 고정해 크기 비교는 그대로 정확하게
 * 유지하면서, 값이 없는 쪽은 그 쪽 높이 자체가 거의 0이 되게 한다.
 */
// 툴팁 max-width(styles.css)의 절반 — 가장자리 막대에서 툴팁이 차트 스크롤
// 영역 밖으로 안 나가게 좌/우 정렬을 바꿀지 판단하는 여유 폭으로 쓴다.
const TOOLTIP_HALF_WIDTH = 100;

export default function MonthlyReturnChart({ rows }: { rows: MonthlyReturnRow[] }) {
  const [hover, setHover] = useState<{
    index: number;
    x: number;
    y: number;
    vAlign: 'above' | 'below';
    hAlign: 'center' | 'left' | 'right';
  } | null>(null);

  if (rows.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>매수 후 보유 중인 종목의 매매내역이 없습니다.</p>;
  }

  const maxPositive = Math.max(0, ...rows.map((r) => r.rate));
  const maxNegative = Math.max(0, ...rows.map((r) => -r.rate));
  const maxAbs = Math.max(maxPositive, maxNegative, 0.01);
  const pxPerUnit = MAX_SIDE_HEIGHT / maxAbs;

  const topHeight = maxPositive > 0 ? maxPositive * pxPerUnit + LABEL_MARGIN : 0;
  const bottomHeight = maxNegative > 0 ? maxNegative * pxPerUnit + LABEL_MARGIN : 0;
  const mid = topHeight;
  const plotHeight = topHeight + bottomHeight;
  const totalHeight = plotHeight + AXIS_SPACE;

  const barWidth = Math.max(18, Math.min(48, 480 / rows.length - BAR_GAP));
  const width = rows.length * (barWidth + BAR_GAP);

  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={width} height={totalHeight} role="img" aria-label="월별 손익률">
        <line x1={0} x2={width} y1={mid} y2={mid} stroke="var(--baseline)" strokeWidth={1} />
        {rows.map((row, i) => {
          const barHeight = Math.abs(row.rate) * pxPerUnit;
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
                height={Math.max(2, barHeight)}
                rx={3}
                fill={color}
                onMouseEnter={() => {
                  const anchorY = positive ? y : y + barHeight;
                  const barCenterX = x + barWidth / 2;
                  // 값이 큰 막대는 꼭대기가 차트 그리기 영역(SVG) 맨 위에 바싹
                  // 붙는다(예: 93% 막대는 top이 20px 정도) — 기본 배치("막대 위에
                  // 툴팁")로 그대로 두면 카드 안의 차트 위 안내 문구나 제목과
                  // 겹쳐서 잘린 것처럼 보인다("텍스트가 짤리는 경우가 많다" 피드백의
                  // 실제 원인 중 하나). 뷰포트 좌표가 아니라 이 차트 자기 그리기
                  // 영역 안에서 위쪽 여유가 얼마나 있는지(anchorY)로 판단해야
                  // 이 카드가 페이지 어디에 있든 항상 같은 기준으로 동작한다.
                  const vAlign: 'above' | 'below' = anchorY < 40 ? 'below' : 'above';
                  // 좌우 가장자리 막대(1번째, 마지막 근처)는 가운데 정렬 툴팁이
                  // 차트의 스크롤 영역(overflowX:auto) 밖으로 반쯤 튀어나가 잘린다
                  // — 그 경우 가운데 대신 막대 안쪽 모서리에 붙여서 항상 스크롤
                  // 영역 안에 들어오게 한다.
                  let hAlign: 'center' | 'left' | 'right' = 'center';
                  if (barCenterX < TOOLTIP_HALF_WIDTH) hAlign = 'left';
                  else if (barCenterX > width - TOOLTIP_HALF_WIDTH) hAlign = 'right';
                  setHover({
                    index: i,
                    x: hAlign === 'left' ? x : hAlign === 'right' ? x + barWidth : barCenterX,
                    y: anchorY,
                    vAlign,
                    hAlign,
                  });
                }}
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
        <div
          className="tooltip"
          style={{
            left: hover.x,
            top: hover.y,
            transform: `translate(${
              hover.hAlign === 'left' ? '0' : hover.hAlign === 'right' ? '-100%' : '-50%'
            }, ${hover.vAlign === 'below' ? '14px' : '-110%'})`,
          }}
        >
          {rows[hover.index].month}
          <br />
          {(rows[hover.index].rate * 100).toFixed(2)}% ({rows[hover.index].amountKrw >= 0 ? '+' : ''}
          {krw.format(Math.round(rows[hover.index].amountKrw))}원)
        </div>
      )}
    </div>
  );
}
