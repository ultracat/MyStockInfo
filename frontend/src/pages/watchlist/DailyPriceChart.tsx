import { useState } from 'react';
import { useContainerWidth } from '../../useContainerWidth';
import { krw, krwCompact, qtyFmt, usdFmt } from '../../format';
import type { DailyCandle } from '../../types';
import type { TradeMark } from '../../calc/watchDetail';

/** 이동평균선 — 색은 카테고리 슬롯 3·4·6(종가 1, 매도 표시 2와 겹치지 않게). */
export const MA_LINES = [
  { period: 20, color: 'var(--series-3)' },
  { period: 60, color: 'var(--series-4)' },
  { period: 120, color: 'var(--series-6)' },
] as const;

const PRICE_H = 200;
const VOL_H = 44;
const GAP = 10;
const TOP = 12;
const AXIS_H = 18;
const Y_AXIS = 64;
const RIGHT = 8;

function fmtPrice(v: number, currency: string): string {
  return currency === 'USD' ? usdFmt.format(v) : `${krw.format(Math.round(v))}원`;
}

function fmtAxis(v: number, currency: string): string {
  if (currency === 'USD') return `$${v >= 100 ? Math.round(v) : v.toFixed(2)}`;
  return v >= 100_000 ? krwCompact.format(v) : krw.format(Math.round(v));
}

/**
 * 관심종목 상세의 일봉 차트(2026-11-19) — 종가 선 + 이동평균(20·60·120일, 켜고 끔) + 목표가(이상·이하) 점선 + 내 매수(▲)·매도(▼) 표시,
 * 아래에 거래량 막대. 이동평균은 호출부가 **보기 기간보다 긴 일봉으로** 계산해 넘긴다(기간 첫날부터 선이 있게). 목표가가 가격 범위 밖이면
 * 위·아래 가장자리에 화살표 글자로만 알린다(축을 늘리면 가격 움직임이 납작해져서).
 */
export default function DailyPriceChart({
  candles,
  ma,
  currency,
  targets,
  marks,
}: {
  candles: DailyCandle[];
  /** 보여 줄 이동평균 — `values`는 `candles`와 같은 길이. */
  ma: Array<{ period: number; color: string; values: (number | null)[] }>;
  currency: string;
  targets: { above: number | null; below: number | null };
  marks: TradeMark[];
}) {
  const [ref, boxWidth] = useContainerWidth(640);
  const [hover, setHover] = useState<number | null>(null);
  if (candles.length < 2) return <p style={{ color: 'var(--text-muted)' }}>이 기간의 일봉이 없습니다.</p>;

  const width = Math.max(320, boxWidth);
  const plotW = width - Y_AXIS - RIGHT;
  const values = candles.map((c) => c.close);
  for (const m of ma) for (const v of m.values) if (v !== null) values.push(v);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = (max - min) * 0.06 || max * 0.02 || 1;
  min -= pad;
  max += pad;
  const step = plotW / candles.length;
  const x = (i: number) => Y_AXIS + i * step + step / 2;
  const y = (v: number) => TOP + PRICE_H - ((v - min) / (max - min)) * PRICE_H;
  const volTop = TOP + PRICE_H + GAP;
  const maxVol = Math.max(...candles.map((c) => c.volume), 1);
  const line = (vals: (number | null)[]) =>
    vals.reduce((d, v, i) => (v === null ? d : `${d}${d === '' || vals[i - 1] === null ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)} `), '');
  const ticks = [0, 0.5, 1].map((t) => min + pad + (max - min - 2 * pad) * t);
  const height = volTop + VOL_H + AXIS_H;
  const byDate = new Map(candles.map((c, i) => [c.date, i]));
  const shownMarks = marks.flatMap((m) => {
    const i = byDate.get(m.date);
    return i === undefined ? [] : [{ ...m, i }];
  });
  // 날짜 라벨 — 대략 6개(월이 바뀌는 첫 봉 우선)
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));
  const targetLines = (
    [
      ['above', targets.above, '≥'],
      ['below', targets.below, '≤'],
    ] as const
  ).flatMap(([key, v, sign]) => (v === null ? [] : [{ key, v, sign }]));
  const h = hover === null ? null : candles[hover];

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" aria-label="일봉 종가·이동평균·거래량 차트" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={Y_AXIS} x2={width - RIGHT} y1={y(t)} y2={y(t)} stroke="var(--gridline)" />
            <text x={Y_AXIS - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-muted)">
              {fmtAxis(t, currency)}
            </text>
          </g>
        ))}
        {targetLines.map((t) => {
          const inRange = t.v >= min && t.v <= max;
          const ty = inRange ? y(t.v) : t.v > max ? TOP + 8 : TOP + PRICE_H - 4;
          return (
            <g key={t.key}>
              {inRange && <line x1={Y_AXIS} x2={width - RIGHT} y1={ty} y2={ty} stroke="var(--text-muted)" strokeDasharray="4 3" />}
              {/* 범위 밖이면 축 바로 옆 위·아래 귀퉁이에(오른쪽 끝은 최근 가격 선과 겹친다) */}
              <text x={inRange ? width - RIGHT - 2 : Y_AXIS + 4} y={inRange ? ty - 4 : t.v > max ? TOP - 2 : TOP + PRICE_H + 8} textAnchor={inRange ? 'end' : 'start'} fontSize={10} fill="var(--text-secondary)">
                {inRange ? '' : t.v > max ? '↑ ' : '↓ '}목표 {t.sign} {fmtPrice(t.v, currency)}
              </text>
            </g>
          );
        })}
        {candles.map((c, i) => {
          const bh = (c.volume / maxVol) * VOL_H;
          return <rect key={c.date} x={x(i) - Math.max(0.5, step * 0.35)} width={Math.max(1, step * 0.7)} y={volTop + VOL_H - bh} height={bh} fill="var(--baseline)" />;
        })}
        {ma.map((m) => (
          <path key={m.period} d={line(m.values)} fill="none" stroke={m.color} strokeWidth={1.25} />
        ))}
        <path d={line(candles.map((c) => c.close))} fill="none" stroke="var(--series-1)" strokeWidth={2} />
        {shownMarks.map((m, k) => {
          const px = x(m.i);
          const py = y(Math.min(max, Math.max(min, m.price)));
          const up = m.side === 'BUY';
          const d = up ? `M ${px} ${py + 3} l -5 9 l 10 0 Z` : `M ${px} ${py - 3} l -5 -9 l 10 0 Z`;
          return <path key={k} d={d} fill={up ? 'var(--series-1)' : 'var(--series-2)'} stroke="var(--surface-1)" strokeWidth={1} />;
        })}
        {candles.map((c, i) =>
          i % labelEvery === 0 ? (
            <text key={c.date} x={x(i)} y={height - 4} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
              {c.date.slice(2).replace(/-/g, '.')}
            </text>
          ) : null
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={TOP} y2={volTop + VOL_H} stroke="var(--text-muted)" strokeWidth={1} />}
        {hover !== null && <circle cx={x(hover)} cy={y(candles[hover].close)} r={3.5} fill="var(--series-1)" />}
        <rect
          x={Y_AXIS}
          y={0}
          width={plotW}
          height={height}
          fill="transparent"
          onMouseMove={(e) => {
            // 비율로 계산 — 화면 줌(transform)과 무관(frontend/CLAUDE.md "화면 줌")
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const i = Math.floor(((e.clientX - r.left) / r.width) * candles.length);
            setHover(Math.min(candles.length - 1, Math.max(0, i)));
          }}
        />
      </svg>
      {h && hover !== null && (
        <div
          className="tooltip"
          style={{
            left: x(hover),
            top: TOP,
            transform: x(hover) > width * 0.7 ? 'translate(-105%, 0)' : 'translate(8px, 0)',
          }}
        >
          <div>
            <b>{h.date}</b>
          </div>
          <div>종가 {fmtPrice(h.close, currency)}</div>
          {h.high > 0 && (
            <div>
              시가 {fmtPrice(h.open, currency)} · 고가 {fmtPrice(h.high, currency)} · 저가 {fmtPrice(h.low, currency)}
            </div>
          )}
          <div>거래량 {qtyFmt.format(h.volume)}</div>
          {ma.map((m) =>
            m.values[hover] !== null ? (
              <div key={m.period}>
                {m.period}일 평균 {fmtPrice(m.values[hover]!, currency)}
              </div>
            ) : null
          )}
          {shownMarks
            .filter((m) => m.i === hover)
            .map((m, k) => (
              <div key={k}>
                내 {m.side === 'BUY' ? '매수' : '매도'} {qtyFmt.format(m.quantity)}주 @ {fmtPrice(m.price, currency)}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
