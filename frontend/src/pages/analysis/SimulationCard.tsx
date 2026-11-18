import { useEffect, useMemo, useState } from 'react';
import { scenarios, yearsToTarget, type SimulationInput } from '../../calc/simulation';
import { krw } from '../../format';
import type { PlannerState, SimulationPlan } from '../../types';
import Hint from '../../components/Hint';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const eok = (v: number) => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(2)}억원` : `${krw.format(Math.round(v / 1e4))}만원`);

const DEFAULTS: SimulationPlan = {
  startKrw: null,
  monthlyKrw: 1_000_000,
  annualReturnPct: 6,
  dividendYieldPct: 3,
  reinvest: true,
  contributionGrowthPct: 0,
  inflationPct: 2.5,
  years: 20,
  targetAssetsKrw: null,
  targetMonthlyDividendKrw: null,
};

/** 원 단위 칸은 천 단위 쉼표를 붙여 보여 준다(1500000 → 1,500,000 — 2026-11-18 UX 점검). 저장할 땐 `num()`이 쉼표를 뗀다. */
const isMoney = (k: string) => k.endsWith('Krw');
const withCommas = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '');
  return digits === '' ? '' : krw.format(Number(digits));
};

type Field = { key: keyof SimulationPlan; label: string; step?: string; hint?: string };
const FIELDS: Field[] = [
  { key: 'startKrw', label: '시작 자산(원)', hint: '비우면 지금 평가금액' },
  { key: 'monthlyKrw', label: '월 적립액(원)' },
  { key: 'annualReturnPct', label: '연 총수익률(%)', step: '0.1', hint: '가격 + 배당' },
  { key: 'dividendYieldPct', label: '배당수익률(%)', step: '0.1' },
  { key: 'contributionGrowthPct', label: '적립액 연 증가율(%)', step: '0.1' },
  { key: 'inflationPct', label: '물가상승률(%)', step: '0.1' },
  { key: 'years', label: '기간(년)' },
  { key: 'targetAssetsKrw', label: '목표 자산(원, 오늘 가치)' },
  { key: 'targetMonthlyDividendKrw', label: '목표 월 배당(원, 세후·오늘 가치)' },
];

/**
 * 은퇴·목표 자산 시뮬레이션 — 지금 자산 + 월 적립 + 가정 수익률(비관·보통·낙관 ±2%p)로 해마다 자산과 월 배당을 그린다(calc/simulation.ts).
 * 목표 자산·월 배당은 물가를 뺀 "오늘 돈 가치"로 비교한다. 입력은 planner에 저장된다(다음에 열어도 그대로).
 */
export function SimulationCard({
  currentKrw,
  planner,
  onSave,
}: {
  currentKrw: number;
  planner: PlannerState | null;
  onSave: (patch: Partial<PlannerState>) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [reinvest, setReinvest] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const p = planner?.simulation ?? DEFAULTS;
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, p[f.key] === null ? '' : isMoney(f.key) ? krw.format(Number(p[f.key])) : String(p[f.key])])));
    setReinvest(p.reinvest);
  }, [planner]);

  const num = (k: keyof SimulationPlan) => {
    const v = (draft[k] ?? '').replace(/,/g, '').trim();
    return v === '' ? null : Number(v);
  };
  const input: SimulationInput | null = useMemo(() => {
    const required = ['monthlyKrw', 'annualReturnPct', 'dividendYieldPct', 'years'] as const;
    if (required.some((k) => num(k) === null || !Number.isFinite(num(k)!))) return null;
    return {
      startKrw: num('startKrw') ?? currentKrw,
      monthlyKrw: num('monthlyKrw')!,
      annualReturnPct: num('annualReturnPct')!,
      dividendYieldPct: num('dividendYieldPct')!,
      reinvest,
      contributionGrowthPct: num('contributionGrowthPct') ?? 0,
      inflationPct: num('inflationPct') ?? 0,
      years: Math.max(1, Math.min(60, Math.round(num('years')!))),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, reinvest, currentKrw]);
  const result = useMemo(() => (input ? scenarios(input) : null), [input]);
  const base = result?.[1].rows ?? [];
  const targets = input ? yearsToTarget(base, num('targetAssetsKrw'), num('targetMonthlyDividendKrw'), input.inflationPct) : null;

  const save = async () => {
    if (!input) return setMsg('필수 칸(월 적립액·수익률·배당수익률·기간)을 채우세요.');
    try {
      await onSave({
        simulation: {
          startKrw: num('startKrw'),
          monthlyKrw: input.monthlyKrw,
          annualReturnPct: input.annualReturnPct,
          dividendYieldPct: input.dividendYieldPct,
          reinvest,
          contributionGrowthPct: input.contributionGrowthPct,
          inflationPct: input.inflationPct,
          years: input.years,
          targetAssetsKrw: num('targetAssetsKrw'),
          targetMonthlyDividendKrw: num('targetMonthlyDividendKrw'),
        },
      });
      setMsg('입력을 저장했습니다.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // 선 그래프(보통 시나리오 자산 + 비관·낙관 범위) — 작은 SVG
  const chart = useMemo(() => {
    if (!result) return null;
    // 축 눈금(왼쪽 금액, 아래 연차)을 단다 — 예전엔 축이 없어 크기를 가늠할 수 없었다(2026-11-18 UX 점검).
    const W = 720;
    const H = 200;
    const L = 56; // 왼쪽 금액 눈금 자리
    const B = 20; // 아래 연차 눈금 자리
    const max = Math.max(...result[2].rows.map((r) => r.valueKrw), 1);
    const n = result[1].rows.length;
    const x = (i: number) => (n <= 1 ? (W + L) / 2 : L + (i / (n - 1)) * (W - L - 10));
    const y = (v: number) => H - B - (v / max) * (H - B - 10);
    const yTicks = [0, 0.5, 1].map((f) => ({ y: y(max * f), label: eok(max * f) }));
    const step = n > 12 ? 5 : n > 6 ? 2 : 1;
    const xTicks = result[1].rows.map((r, i) => ({ i, year: r.year })).filter((t) => t.year === 1 || t.year % step === 0);
    const line = (rows: { valueKrw: number }[]) => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.valueKrw).toFixed(1)}`).join(' ');
    const band = `${line(result[2].rows)} ${result[0].rows.map((r, i) => `L${x(n - 1 - i).toFixed(1)},${y(result[0].rows[n - 1 - i].valueKrw).toFixed(1)}`).join(' ')} Z`;
    return {
      W,
      H,
      L,
      band,
      mid: line(result[1].rows),
      contributed: line(result[1].rows.map((r) => ({ valueKrw: r.contributedKrw }))),
      yTicks,
      xTicks: xTicks.map((t) => ({ x: x(t.i), label: `${t.year}년` })),
      baseY: y(0),
    };
  }, [result]);

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>은퇴·목표 자산 시뮬레이션</h3>
      <Hint>
        지금 자산에 매달 적립하고 가정한 수익률로 불어난다고 보고 해마다 자산과 월 배당을 계산합니다. 비관·낙관은 수익률 ±2%p입니다. 배당은 15.4% 원천징수 후 금액,
        목표는 물가를 뺀 <b>오늘 돈 가치</b>로 비교합니다. 매매 세금·수수료는 무시한 단순 계산이며 미래 수익을 보장하지 않습니다.
      </Hint>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {f.label}
            <input
              inputMode="decimal"
              value={draft[f.key] ?? ''}
              placeholder={f.key === 'startKrw' ? krw.format(Math.round(currentKrw)) : f.hint}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: isMoney(f.key) ? withCommas(e.target.value) : e.target.value }))}
            />
          </label>
        ))}
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={reinvest} onChange={(e) => setReinvest(e.target.checked)} /> 배당 재투자
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <button type="button" className="ghost" onClick={() => void save()}>
          입력 저장
        </button>
        {msg && <span style={{ fontSize: 13 }}>{msg}</span>}
      </div>
      {result && input && (
        <>
          <div className="summary-row" style={{ marginTop: 12 }}>
            {result.map((s) => {
              const last = s.rows[s.rows.length - 1];
              return (
                <div className="stat-tile" key={s.label}>
                  <div className="label">
                    {s.label}({s.returnPct.toFixed(1)}%) · {input.years}년 뒤
                  </div>
                  <div className="value">{eok(last.valueKrw)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    오늘 가치 {eok(last.realValueKrw)} · 월 배당 {won(last.monthlyDividendKrw)}
                  </div>
                </div>
              );
            })}
          </div>
          {targets && (num('targetAssetsKrw') || num('targetMonthlyDividendKrw')) && (
            <p style={{ fontSize: 14 }}>
              {num('targetAssetsKrw') ? <>목표 자산까지 <b>{targets.assets ? `${targets.assets}년` : `${input.years}년 안에 못 닿음`}</b>. </> : null}
              {num('targetMonthlyDividendKrw') ? <>목표 월 배당까지 <b>{targets.dividend ? `${targets.dividend}년` : `${input.years}년 안에 못 닿음`}</b>(보통 시나리오).</> : null}
            </p>
          )}
          {chart && (
            <svg viewBox={`0 0 ${chart.W} ${chart.H}`} style={{ width: '100%', maxWidth: 900, height: 'auto' }} role="img" aria-label="자산 추이(보통 시나리오와 비관·낙관 범위)">
              {chart.yTicks.map((t) => (
                <g key={t.label}>
                  <line x1={chart.L} x2={chart.W - 10} y1={t.y} y2={t.y} stroke={t.y === chart.baseY ? 'var(--baseline)' : 'var(--gridline)'} />
                  <text x={chart.L - 6} y={t.y + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                    {t.label}
                  </text>
                </g>
              ))}
              {chart.xTicks.map((t) => (
                <text key={t.label} x={t.x} y={chart.H - 4} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                  {t.label}
                </text>
              ))}
              <path d={chart.band} fill="var(--series-1)" opacity={0.15} />
              <path d={chart.contributed} fill="none" stroke="var(--baseline)" strokeDasharray="4 3" />
              <path d={chart.mid} fill="none" stroke="var(--series-1)" strokeWidth={2} />
            </svg>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>파란 선 = 보통, 옅은 영역 = 비관~낙관, 점선 = 넣은 돈 누계.</p>
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>연차</th>
                  <th>넣은 돈</th>
                  <th>자산(보통)</th>
                  <th>오늘 가치</th>
                  <th>그해 배당(세후)</th>
                  <th>월 배당</th>
                </tr>
              </thead>
              <tbody>
                {base
                  .filter((r) => r.year === 1 || r.year % 5 === 0 || r.year === base.length)
                  .map((r) => (
                    <tr key={r.year}>
                      <td style={{ textAlign: 'left' }}>{r.year}년</td>
                      <td>{eok(r.contributedKrw)}</td>
                      <td>{eok(r.valueKrw)}</td>
                      <td>{eok(r.realValueKrw)}</td>
                      <td>{won(r.dividendsKrw)}</td>
                      <td>{won(r.monthlyDividendKrw)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
