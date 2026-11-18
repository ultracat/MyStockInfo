import { useEffect, useMemo, useState } from 'react';
import CollapseToggle from '../../components/CollapseToggle';
import DividendsChart from '../../components/DividendsChart';
import { projectionRows, rowsKrw } from '../../calc/projection';
import { krw, localToday } from '../../format';
import type { DividendRecord, UpcomingDividend } from '../../types';
import Hint from '../../components/Hint';

/**
 * 앞으로 12개월 예상 배당 — 다가오는 배당(확정·예상·추정)을 1년 뒤까지 넓혀(`GET /dividends/upcoming?months=12`) 월별 세후 추정을 그린다.
 * 이번 달은 이미 받은 배당(진한 막대) + 남은 예상(흐린 막대). 월 배당 목표(planner)를 정하면 월평균 대비 진행률을 보여 준다.
 * 추정은 지난 일정으로 짐작한 것이라(주당 = 최근 12회 중간값) 배당 정책이 바뀌면 틀린다 — 카드 설명에 적는다.
 */
export function DividendProjectionCard({
  items,
  available,
  error,
  records,
  rateFor,
  goalKrw,
  onGoalChange,
  embedded = false,
}: {
  /** 다가오는 배당 12개월치(받은 것은 이미 뺀 것) — 배당금 화면이 한 번 받아 목록·달력과 같이 쓴다. null = 불러오는 중. */
  items: UpcomingDividend[] | null;
  available: boolean;
  error: string | null;
  records: DividendRecord[];
  rateFor: (month: string) => number | null;
  goalKrw: number | null;
  onGoalChange: (v: number | null) => Promise<void>;
  /** "월별 배당금" 카드 안의 "앞으로 12개월" 보기로 그린다 — 카드 틀·제목·접기 없이 내용만(2026-11-18, 두 막대 그래프 카드를 하나로 합침). */
  embedded?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const [goalMsg, setGoalMsg] = useState<string | null>(null);

  useEffect(() => setGoalDraft(goalKrw ? String(goalKrw) : ''), [goalKrw]);

  const today = localToday();
  const view = useMemo(() => {
    if (!items) return null;
    const { months, received, expected } = projectionRows(items, records, today, 12);
    const exp = rowsKrw(expected, rateFor);
    const got = rowsKrw(received, rateFor);
    return { months, received, expected, totalKrw: exp.krw + got.krw, unconvertedUsd: exp.unconvertedUsd + got.unconvertedUsd };
  }, [items, records, today, rateFor]);

  const monthlyAvg = view ? Math.round(view.totalKrw / 12) : null;
  const saveGoal = async () => {
    const v = goalDraft.trim() === '' ? null : Number(goalDraft.replace(/,/g, ''));
    if (v !== null && !(Number.isFinite(v) && v >= 0)) return setGoalMsg('목표는 0 이상의 숫자로 입력하세요.');
    try {
      await onGoalChange(v);
      setGoalMsg(null);
    } catch (e) {
      setGoalMsg((e as Error).message);
    }
  };

  const body = (
        <>
          <Hint>
            이번 달부터 12개월 동안 받을 배당의 <b>세후 추정</b>입니다. 이번 달은 받은 배당(진한 막대) 위에 남은 예상(흐린 막대)을 얹습니다.
            예상은 발표된 일정, 그 뒤는 지난 일정으로 짐작한 것이라(주당 = 최근 12회 중간값) 배당 정책이 바뀌면 달라집니다. 지금 보유 수량 기준이고,
            ISA·연금 계좌의 국내 배당은 세전 그대로, 그 밖은 국내 15.4%·미국 15%를 뺐습니다. 달러는 환율이 있을 때만 원화로 더합니다.
          </Hint>
          {!available ? (
            <p style={{ color: 'var(--text-muted)' }}>한국투자증권 API 키를 등록하면 배당 일정을 받아 예상할 수 있습니다.</p>
          ) : error ? (
            <p className="text-critical">{error}</p>
          ) : !view ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : (
            <>
              <div className="summary-row">
                <div className="stat-tile">
                  <div className="label">12개월 예상 합계</div>
                  <div className="value">{krw.format(view.totalKrw)}원</div>
                </div>
                <div className="stat-tile">
                  <div className="label">월평균</div>
                  <div className="value">{krw.format(monthlyAvg ?? 0)}원</div>
                </div>
                <div className="stat-tile">
                  <div className="label">월 배당 목표 대비</div>
                  <div className="value">{goalKrw ? `${Math.round(((monthlyAvg ?? 0) / goalKrw) * 100)}%` : '-'}</div>
                </div>
              </div>
              {view.unconvertedUsd > 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>환율을 못 구한 달러 ${view.unconvertedUsd.toFixed(2)}는 합계에서 빠졌습니다.</p>
              )}
              <DividendsChart rows={view.received} expectedRows={view.expected} fxRate={rateFor} />
            </>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <label htmlFor="dividend-goal" style={{ fontSize: 13 }}>
              월 배당 목표(원, 세후)
            </label>
            <input
              id="dividend-goal"
              inputMode="numeric"
              value={goalDraft}
              placeholder="예: 500000"
              onChange={(e) => setGoalDraft(e.target.value)}
              style={{ width: 140 }}
            />
            <button type="button" className="ghost" onClick={() => void saveGoal()}>
              저장
            </button>
            {goalKrw !== null && monthlyAvg !== null && (
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {monthlyAvg >= goalKrw ? '목표 달성 예상' : `월 ${krw.format(goalKrw - monthlyAvg)}원 부족`}
              </span>
            )}
            {goalMsg && <span className="text-critical">{goalMsg}</span>}
          </div>
        </>
  );
  if (embedded) return body;
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0 }}>앞으로 12개월 예상 배당</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && body}
    </div>
  );
}
