import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAllHoldings, type HoldingLine } from '../allHoldings';
import { rebalance } from '../calc/rebalance';
import { krw, formatSignedKrw } from '../format';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../pageActivity';
import { usePlanner } from '../usePlanner';
import type { TargetWeight } from '../types';
import Hint from '../components/Hint';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
// 부호 있는 원화는 앱 전체가 format.ts 하나로(2026-11-17 UI 점검 — 파일마다 기호가 달랐다)
const signedWon = formatSignedKrw;

/**
 * 리밸런싱 — 종목별 목표 비중을 정해 두면, 모든 증권사·계좌를 합친 지금 보유와 비교해 얼마를 사고팔면 맞춰지는지 계산한다(calc/rebalance.ts).
 * 목표를 정한 종목끼리만 맞추고, 목표 없는 종목은 "유지"로 따로 보여 준다. 추가 투자금을 넣으면 "매수만으로" 나눈 금액도 보여 준다.
 * 주문은 하지 않는다(조회 전용 앱) — 숫자는 참고용이고 수수료·세금·호가 단위는 반영하지 않는다.
 */
export default function Rebalance() {
  const [lines, setLines] = useState<HoldingLine[] | null>(null);
  const [fxRate, setFxRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { planner, update } = usePlanner();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [extraCash, setExtraCash] = useState('');
  const [newSymbol, setNewSymbol] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [showSmall, setShowSmall] = useState(false);

  const load = useCallback((forceRefresh = false) => {
    setLoading(true);
    loadAllHoldings({ forceRefresh })
      .then(({ lines: l, fxRate: r }) => {
        setLines(l);
        setFxRate(r);
        setError(null);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);
  useResumeRefresh(() => load(), RESUME_REFRESH_MS);
  useEffect(() => {
    if (planner) setDraft(Object.fromEntries(planner.targets.map((t) => [t.symbol, String(t.weight)])));
  }, [planner]);

  // 화면의 입력값(draft)으로 바로 다시 계산한다 — 저장 전에도 결과를 보며 고칠 수 있게.
  const draftTargets: TargetWeight[] = useMemo(() => {
    const names = new Map((lines ?? []).map((l) => [l.symbol, l.name]));
    for (const t of planner?.targets ?? []) if (!names.has(t.symbol)) names.set(t.symbol, t.name);
    return Object.entries(draft)
      .filter(([, v]) => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0)
      .map(([symbol, v]) => ({ symbol, name: names.get(symbol) ?? symbol, weight: Number(v) }));
  }, [draft, lines, planner]);
  const extraCashKrw = Number(extraCash.replace(/,/g, '')) || 0;
  const result = useMemo(
    () => (lines ? rebalance(lines, draftTargets, fxRate, extraCashKrw) : null),
    [lines, draftTargets, fxRate, extraCashKrw]
  );
  const dirty = JSON.stringify(draftTargets.map((t) => [t.symbol, t.weight]).sort()) !==
    JSON.stringify((planner?.targets ?? []).map((t) => [t.symbol, t.weight]).sort());

  const save = async () => {
    try {
      await update({ targets: draftTargets });
      setMessage('목표 비중을 저장했습니다.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  // 처음 열면 전 종목이 "목표 없음 · 유지"라 어디서 시작할지 몰랐다(2026-11-18 UX 점검) — 지금 비중을 목표로 채워 두고 바꿀 종목만 고치게.
  const fillFromCurrent = () => {
    if (!result) return;
    setDraft(Object.fromEntries(result.rows.filter((r) => r.currentPct > 0).map((r) => [r.symbol, r.currentPct.toFixed(1)])));
    setMessage('지금 비중으로 채웠습니다. 바꾸고 싶은 종목만 고친 뒤 "목표 저장"을 누르세요.');
  };
  const clearTargets = () => {
    setDraft({});
    setMessage('목표를 모두 지웠습니다(저장해야 반영됩니다).');
  };
  // 목표가 없고 비중이 1% 밑인 종목은 접어 둔다 — 작은 종목 수십 줄이 표를 늘어뜨렸다.
  const SMALL_PCT = 1;
  const isSmall = (r: { targetPct: number | null; currentPct: number; symbol: string }) =>
    r.targetPct === null && r.currentPct < SMALL_PCT && !(draft[r.symbol] ?? '').trim();
  const smallCount = result ? result.rows.filter(isSmall).length : 0;
  const shownRows = result ? (showSmall ? result.rows : result.rows.filter((r) => !isSmall(r))) : [];

  const addSymbol = () => {
    const s = newSymbol.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,20}$/.test(s)) return setMessage('종목코드를 확인하세요(예: 005930, SCHD).');
    setDraft((d) => ({ ...d, [s]: d[s] ?? '0' }));
    setNewSymbol('');
    setMessage(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
        <h2 className="page-title" style={{ margin: 0 }}>리밸런싱</h2>
        <button type="button" className="ghost" onClick={() => load(true)} disabled={loading}>
          {loading ? '불러오는 중...' : '새로고침'}
        </button>
      </div>
      <div className="card">
        <Hint>
          종목별 <b>목표 비중(%)</b>을 적으면 모든 증권사·계좌를 합친 지금 보유와 비교해 맞추려면 얼마를 사고팔아야 하는지 보여 줍니다. 목표를 적은 종목끼리만
          맞추고(합이 100%가 아니면 비례로 환산), 목표가 없는 종목은 그대로 둡니다. <b>추가 투자금</b>을 넣으면 팔지 않고 부족한 종목만 사서 맞추는 배분도 보여 줍니다.
          참고용 계산이며 수수료·세금·호가 단위는 반영하지 않습니다. 앱은 주문하지 않습니다.
        </Hint>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <label htmlFor="extra-cash" style={{ fontSize: 13 }}>
            추가 투자금(원)
          </label>
          <input id="extra-cash" inputMode="numeric" value={extraCash} onChange={(e) => setExtraCash(e.target.value)} placeholder="0" style={{ width: 140 }} />
          <span style={{ flex: 1 }} />
          <input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value)} placeholder="종목코드 추가" style={{ width: 140 }} aria-label="목표에 넣을 종목코드" />
          <button type="button" className="ghost" onClick={addSymbol}>
            추가
          </button>
          <button type="button" className="ghost" onClick={fillFromCurrent} disabled={!result} title="모든 종목의 목표를 지금 비중으로 채웁니다">
            현재 비중으로 채우기
          </button>
          <button type="button" className="ghost" onClick={clearTargets} disabled={draftTargets.length === 0}>
            목표 지우기
          </button>
          <button type="button" className="primary" onClick={() => void save()} disabled={!dirty}>
            {dirty ? '목표 저장' : '저장됨'}
          </button>
        </div>
        {message && <p style={{ fontSize: 13 }}>{message}</p>}
        {error && <p className="text-critical">{error}</p>}
        {result && (
          <>
            <div className="summary-row">
              <div className="stat-tile">
                <div className="label">목표 종목 기준 금액</div>
                <div className="value">{won(result.baseKrw)}</div>
              </div>
              <div className="stat-tile">
                <div className="label">전체 평가금액</div>
                <div className="value">{won(result.totalKrw)}</div>
              </div>
              <div className="stat-tile">
                <div className="label">목표 비중 합계</div>
                <div className="value">
                  {result.targetSum.toFixed(1)}%{draftTargets.length > 0 && Math.abs(result.targetSum - 100) > 0.01 ? ' ⚠' : ''}
                </div>
                {draftTargets.length > 0 && Math.abs(result.targetSum - 100) > 0.01 && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>100%로 비례 환산해 계산합니다</div>
                )}
              </div>
            </div>
            {draftTargets.length === 0 && (
              <div className="notice" style={{ fontSize: 13 }}>
                아직 목표 비중이 없습니다. <b>현재 비중으로 채우기</b>로 시작해 바꾸고 싶은 종목만 고치거나, 표의 "목표 비중" 칸에 직접 적으세요.
              </div>
            )}
            {result.unconverted.length > 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>환율을 못 구해 뺀 달러 종목: {result.unconverted.join(', ')}</p>
            )}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>종목</th>
                    <th>평가금액</th>
                    <th>현재 비중</th>
                    <th>목표 비중(%)</th>
                    <th>맞추려면</th>
                    <th>대략 수량</th>
                    <th>추가 투자금 배분</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => (
                    <tr key={r.symbol}>
                      <td style={{ textAlign: 'left' }}>
                        <span className="upcoming-cell-truncate" title={`${r.name} ${r.symbol}`}>
                          {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.symbol}</span>
                        </span>
                      </td>
                      <td>{won(r.valueKrw)}</td>
                      <td>{r.currentPct.toFixed(1)}%</td>
                      <td>
                        <input
                          inputMode="decimal"
                          value={draft[r.symbol] ?? ''}
                          placeholder="목표 없음"
                          onChange={(e) => setDraft((d) => ({ ...d, [r.symbol]: e.target.value }))}
                          style={{ width: 90, textAlign: 'right' }}
                          aria-label={`${r.symbol} 목표 비중`}
                        />
                      </td>
                      {/* 매수·매도는 좋고 나쁨이 아니라 상태 색(--good/--critical)을 쓰지 않는다(frontend/CLAUDE.md TradesChart와 같은 규칙). */}
                      <td style={{ color: r.targetPct === null ? 'var(--text-muted)' : undefined }}>
                        {r.targetPct === null ? '유지' : Math.abs(r.diffKrw) < 1 ? '맞음' : `${r.diffKrw > 0 ? '매수' : '매도'} ${signedWon(r.diffKrw)}`}
                      </td>
                      <td>{r.targetPct === null || r.diffShares === null ? '-' : `${r.diffShares > 0 ? '+' : ''}${r.diffShares.toFixed(r.diffShares % 1 === 0 ? 0 : 2)}주`}</td>
                      <td>{r.buyOnlyKrw > 0 ? won(r.buyOnlyKrw) : '-'}</td>
                    </tr>
                  ))}
                  {smallCount > 0 && (
                    <tr className="group-toggle-row">
                      <td colSpan={7} style={{ textAlign: 'left' }}>
                        <button type="button" className="ghost" onClick={() => setShowSmall((v) => !v)}>
                          {showSmall ? `▾ 비중 ${SMALL_PCT}% 미만 ${smallCount}종목 접기` : `▸ 목표 없는 비중 ${SMALL_PCT}% 미만 ${smallCount}종목 펼치기`}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
        {!result && !error && <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>}
      </div>
    </div>
  );
}
