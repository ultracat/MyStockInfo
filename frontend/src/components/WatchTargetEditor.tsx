import { useEffect, useState } from 'react';
import { usePlanner } from '../usePlanner';

/** 관심종목 상세의 목표가 알림 — 이상·이하 둘 다 비우면 지운다(planner.watchTargets, 백엔드 alerts.ts가 5분마다 확인). */
export function WatchTargetEditor({ symbol, currency }: { symbol: string; currency: string | null }) {
  const { planner, update } = usePlanner();
  const current = planner?.watchTargets.find((w) => w.symbol === symbol) ?? null;
  const [above, setAbove] = useState('');
  const [below, setBelow] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    setAbove(current?.above ? String(current.above) : '');
    setBelow(current?.below ? String(current.below) : '');
  }, [current?.above, current?.below, symbol]);
  if (!planner) return null;
  const parse = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));
  const save = async () => {
    const a = parse(above);
    const b = parse(below);
    if ((a !== null && !(a > 0)) || (b !== null && !(b > 0))) return setMsg('목표가는 0보다 큰 숫자로 입력하세요.');
    const rest = planner.watchTargets.filter((w) => w.symbol !== symbol);
    try {
      await update({ watchTargets: a === null && b === null ? rest : [...rest, { symbol, above: a, below: b }] });
      setMsg(a === null && b === null ? '목표가 알림을 지웠습니다.' : '저장했습니다.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const unit = currency === 'USD' ? '$' : '원';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
      <span style={{ fontSize: 13 }}>목표가 알림</span>
      <input inputMode="decimal" value={above} onChange={(e) => setAbove(e.target.value)} placeholder={`이상 (${unit})`} style={{ width: 120 }} aria-label="이 값 이상이면 알림" />
      <input inputMode="decimal" value={below} onChange={(e) => setBelow(e.target.value)} placeholder={`이하 (${unit})`} style={{ width: 120 }} aria-label="이 값 이하이면 알림" />
      <button type="button" className="ghost" onClick={() => void save()}>
        저장
      </button>
      {!planner.alerts.targetPrice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>설정 → 알림에서 목표가 알림이 꺼져 있습니다.</span>}
      {msg && <span style={{ fontSize: 12 }}>{msg}</span>}
    </div>
  );
}
