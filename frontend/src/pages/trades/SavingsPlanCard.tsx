import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import CollapseToggle from '../../components/CollapseToggle';
import { savingsStatus } from '../../calc/savings';
import { monthlyRateOr } from '../../fx';
import { krw, localToday } from '../../format';
import { usePlanner } from '../../usePlanner';
import type { SavingsPlan, StoredTrade } from '../../types';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const STATE_LABEL = { met: '달성', partial: '부족', missed: '누락', current: '진행 중' } as const;

/**
 * 적립식 계획 추적 — "이 종목을 매달 얼마씩"을 정해 두면 모든 계좌의 실제 매수(매매내역 저장소, 원화 환산)와 달마다 맞춰 본다(calc/savings.ts).
 * 계획은 planner에 저장. 달러 매수는 그 달 평균 환율(없으면 지금 환율). 매매내역이 저장소에 모여 있어야 정확하다(API 계좌는 그 달을 한 번 조회해야 쌓인다).
 */
export function SavingsPlanCard({ allTrades, fxRate }: { allTrades: StoredTrade[]; fxRate: number | null }) {
  const { planner, update } = usePlanner();
  const [collapsed, setCollapsed] = useState(false);
  const [rates, setRates] = useState<Record<string, { rate: number } | null>>({});
  const [form, setForm] = useState({ symbol: '', monthly: '', start: localToday().slice(0, 7) });
  const [msg, setMsg] = useState<string | null>(null);
  const plans = useMemo(() => planner?.savingsPlans ?? [], [planner]);
  const usdMonths = useMemo(
    () => [...new Set(allTrades.filter((t) => t.currency === 'USD' && plans.some((p) => p.symbol === t.symbol)).map((t) => t.executedAt.slice(0, 7)))],
    [allTrades, plans]
  );
  useEffect(() => {
    if (!usdMonths.length) return;
    let alive = true;
    api
      .getMonthlyAvgUsdKrwRates(usdMonths)
      .then((r) => alive && setRates(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [usdMonths]);
  const status = useMemo(
    () => savingsStatus(plans, allTrades, (m) => monthlyRateOr(rates, m, fxRate), localToday()),
    [plans, allTrades, rates, fxRate]
  );

  const save = async (next: SavingsPlan[]) => {
    try {
      await update({ savingsPlans: next });
      setMsg(null);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const add = () => {
    const symbol = form.symbol.trim().toUpperCase();
    const monthly = Number(form.monthly.replace(/,/g, ''));
    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) return setMsg('종목코드를 확인하세요.');
    if (!(monthly > 0)) return setMsg('월 적립액을 0보다 큰 숫자로 입력하세요.');
    const name = allTrades.find((t) => t.symbol === symbol)?.name ?? symbol;
    void save([...plans.filter((p) => p.symbol !== symbol), { symbol, name, monthlyKrw: Math.round(monthly), startMonth: form.start }]);
    setForm((f) => ({ ...f, symbol: '', monthly: '' }));
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>적립식 계획</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            "이 종목을 매달 얼마씩 산다"를 적어 두면 모든 계좌의 실제 매수와 달마다 맞춰 봅니다(최근 12개월). 계획의 95% 이상이면 달성입니다. 매매내역이 앱에 모여 있어야
            정확합니다 — 증권사 API 계좌는 매매내역 화면에서 그 기간을 한 번 조회해야 쌓입니다. 달러 매수는 그 달 평균 환율로 원화 환산합니다.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={form.symbol} onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))} placeholder="종목코드" style={{ width: 120 }} aria-label="적립 종목코드" />
            <input value={form.monthly} onChange={(e) => setForm((f) => ({ ...f, monthly: e.target.value }))} placeholder="월 적립액(원)" inputMode="numeric" style={{ width: 140 }} aria-label="월 적립액" />
            <input type="month" value={form.start} onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} aria-label="시작 달" />
            <button type="button" className="ghost" onClick={add}>
              계획 추가
            </button>
            {msg && <span className="text-critical" style={{ fontSize: 13 }}>{msg}</span>}
          </div>
          {status.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>아직 계획이 없습니다.</p>
          ) : (
            status.map((s) => (
              <div key={s.plan.symbol} style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <b>
                    {s.plan.name} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>{s.plan.symbol}</span>
                  </b>
                  <span style={{ fontSize: 13 }}>
                    매달 {won(s.plan.monthlyKrw)} · 지난 달까지 {won(s.boughtKrw)} / {won(s.plannedKrw)}
                    {s.plannedKrw > 0 && ` (${Math.round((s.boughtKrw / s.plannedKrw) * 100)}%)`} · 연속 달성 {s.streak}개월 · 이번 달 남은 금액{' '}
                    <b>{won(s.thisMonthRemainingKrw)}</b>
                  </span>
                  <button type="button" className="ghost" onClick={() => void save(plans.filter((p) => p.symbol !== s.plan.symbol))}>
                    삭제
                  </button>
                </div>
                <div className="savings-months">
                  {s.months.map((m) => (
                    <div key={m.month} className={`savings-month savings-${m.state}`} title={`${m.month} 매수 ${won(m.boughtKrw)}`}>
                      <span>{m.month.slice(2).replace('-', '.')}</span>
                      <span>{STATE_LABEL[m.state]}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
