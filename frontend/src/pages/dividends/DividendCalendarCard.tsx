import { useMemo, useState } from 'react';
import CollapseToggle from '../../components/CollapseToggle';
import { BROKER_LABELS } from '../../brokers';
import { calendarEntries, calendarGrid, shiftMonth, type CalendarEntry } from '../../calc/projection';
import { krw, localToday, usdFmt } from '../../format';
import type { BrokerId, DividendRecord, UpcomingDividend } from '../../types';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const money = (e: Pick<CalendarEntry, 'currency' | 'net'>) => (e.currency === 'USD' ? usdFmt.format(e.net) : `${krw.format(e.net)}원`);

/**
 * 배당 달력 — 한 달을 칸으로 그려 날짜마다 받은 배당(진한 점)과 다가오는 배당(흐린 점)을 보여 준다. 날짜를 누르면 아래에 그날 내역.
 * 다가오는 배당은 이번 달 지급분까지만 있다(다가오는 배당 카드와 같은 범위) — 지난달은 받은 기록만 보인다.
 */
export function DividendCalendarCard({ records, upcomingItems }: { records: DividendRecord[]; upcomingItems: UpcomingDividend[] | null }) {
  const today = localToday();
  const [collapsed, setCollapsed] = useState(false);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState<string | null>(null);
  const byDay = useMemo(() => calendarEntries(records, upcomingItems ?? [], month), [records, upcomingItems, month]);
  const cells = calendarGrid(month);
  const dayTotals = (entries: CalendarEntry[]) => {
    const k = entries.filter((e) => e.currency === 'KRW').reduce((s, e) => s + e.net, 0);
    const u = entries.filter((e) => e.currency === 'USD').reduce((s, e) => s + e.net, 0);
    return [k ? `${krw.format(Math.round(k))}원` : null, u ? usdFmt.format(u) : null].filter(Boolean).join(' · ');
  };
  const selectedEntries = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h3 style={{ margin: 0 }}>배당 달력</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="ghost" onClick={() => (setMonth((m) => shiftMonth(m, -1)), setSelected(null))} aria-label="이전 달">
            ◀
          </button>
          <span style={{ minWidth: 72, textAlign: 'center' }}>{month.replace('-', '년 ')}월</span>
          <button type="button" className="ghost" onClick={() => (setMonth((m) => shiftMonth(m, 1)), setSelected(null))} aria-label="다음 달">
            ▶
          </button>
          {month !== today.slice(0, 7) && (
            <button type="button" className="ghost" onClick={() => (setMonth(today.slice(0, 7)), setSelected(null))}>
              이번 달
            </button>
          )}
          <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
        </div>
      </div>
      {!collapsed && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <span className="cal-dot cal-dot-received" /> 받은 배당(세후 기록) &nbsp;
            <span className="cal-dot cal-dot-upcoming" /> 다가오는 배당(세후 추정, 이번 달 지급분까지). 날짜를 누르면 그날 내역이 보입니다.
          </p>
          <div className="cal-grid" role="grid" aria-label={`${month} 배당 달력`}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-head">
                {w}
              </div>
            ))}
            {cells.map((day, i) => {
              if (!day) return <div key={`e${i}`} className="cal-cell cal-empty" />;
              const entries = byDay.get(day) ?? [];
              const received = entries.some((e) => e.kind === 'received');
              const upcoming = entries.some((e) => e.kind === 'upcoming');
              return (
                <button
                  type="button"
                  key={day}
                  className={`cal-cell${day === today ? ' cal-today' : ''}${day === selected ? ' cal-selected' : ''}`}
                  onClick={() => setSelected(day === selected ? null : day)}
                  disabled={entries.length === 0}
                >
                  <span className="cal-day">{Number(day.slice(8))}</span>
                  {entries.length > 0 && (
                    <>
                      <span>
                        {received && <span className="cal-dot cal-dot-received" />}
                        {upcoming && <span className="cal-dot cal-dot-upcoming" />}
                        <span className="cal-count">{entries.length}건</span>
                      </span>
                      <span className="cal-amount">{dayTotals(entries)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {selected && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>{selected}</th>
                    <th style={{ textAlign: 'left' }}>증권사</th>
                    <th style={{ textAlign: 'left' }}>종목</th>
                    <th>세후</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedEntries.map((e, idx) => (
                    <tr key={idx}>
                      <td style={{ textAlign: 'left' }}>
                        {e.kind === 'received' ? '받음' : e.status === 'confirmed' ? '확정' : e.status === 'estimated' ? '예상' : '추정'}
                      </td>
                      <td style={{ textAlign: 'left' }}>{BROKER_LABELS[e.broker as BrokerId] ?? e.broker}</td>
                      <td style={{ textAlign: 'left' }}>
                        {e.name} <span style={{ color: 'var(--text-muted)' }}>{e.symbol}</span>
                      </td>
                      <td>{money(e)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
