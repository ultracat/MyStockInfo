import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../pageActivity';
import type { WatchlistEntry } from '../types';
import { krw2dp, usdFmt } from '../format';
import StockNameLink, { useStockLinkResolver } from '../components/StockNameLink';
import WarningBadges from '../components/WarningBadges';
import { useStockWarnings } from '../marketInsights';
import WatchDetail from './watchlist/WatchDetail';
import { usePlanner } from '../usePlanner';

function formatPrice(entry: WatchlistEntry): string {
  if (entry.lastPrice === null) return '-';
  return priceIn(entry.lastPrice, entry.currency);
}

function priceIn(v: number, currency: string | null): string {
  return currency === 'USD' ? usdFmt.format(v) : `${krw2dp.format(v)}원`;
}

export default function Watchlist() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  // 목록에서 목표가를 바로 보이게(예전엔 행을 눌러 상세를 열어야 알았다, 2026-11-18 UX 점검). 고치는 곳은 그대로 상세의 WatchTargetEditor.
  const { planner } = usePlanner();
  const targetBySymbol = useMemo(() => new Map((planner?.watchTargets ?? []).map((t) => [t.symbol, t])), [planner]);
  // 관심종목의 매수 유의사항(토스) — 종목명 옆 배지.
  const warningsBySymbol = useStockWarnings(entries.map((e) => e.symbol));
  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 선택된 종목의 상세 — 표에서 행을 누르면 그 종목으로 바뀐다(내용은 watchlist/WatchDetail.tsx).
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setEntries(await api.listWatchlist());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // 메뉴를 옮겼다 돌아오면 목록(현재가)을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx) — 실패하면 이전 값 유지.
  useResumeRefresh(() => api.listWatchlist().then(setEntries).catch(() => {}), RESUME_REFRESH_MS);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = symbol.trim();
    if (!trimmed) return;
    setAdding(true);
    setAddError(null);
    try {
      await api.addWatchlist(trimmed);
      setSymbol('');
      await refresh();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function onRemove(sym: string) {
    try {
      await api.removeWatchlist(sym);
      if (selectedSymbol === sym) setSelectedSymbol(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const selectedEntry = entries.find((e) => e.symbol === selectedSymbol) ?? null;

  return (
    <div>
      <h2 className="page-title">관심종목</h2>
      {error && <p className="text-critical">{error}</p>}

      <div className="card">
        <form onSubmit={onAdd} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>종목코드</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="예: AAPL, 005930" />
          </div>
          <button type="submit" className="primary" disabled={adding || !symbol.trim()}>
            {adding ? '추가 중...' : '추가'}
          </button>
        </form>
        {addError && (
          <p className="text-critical" style={{ fontSize: 13, marginTop: 8 }}>
            {addError}
          </p>
        )}
      </div>

      <div className="card">
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        ) : entries.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>등록된 관심종목이 없습니다.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>시장</th>
                  <th>현재가</th>
                  <th title="직전 거래일 종가 대비(토스증권 키 필요)">등락률</th>
                  <th title="상세에서 정한 목표가 — 이상/이하가 되면 알림(설정 → 알림)">목표가</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr
                    key={e.symbol}
                    onClick={() => setSelectedSymbol(e.symbol)}
                    style={{
                      cursor: 'pointer',
                      background: selectedSymbol === e.symbol ? 'var(--surface-2, var(--gridline))' : undefined,
                    }}
                  >
                    <td>
                      <StockNameLink name={e.name} url={stockLinkFor(e.symbol, e.currency)} />{' '}
                      <span style={{ color: 'var(--text-muted)' }}>({e.symbol})</span>
                      <WarningBadges warnings={warningsBySymbol[e.symbol]} />
                      {e.memo && (
                        <span className="cell-sub" title={e.memo} style={{ display: 'block' }}>
                          {e.memo.split('\n')[0].slice(0, 40)}
                        </span>
                      )}
                    </td>
                    <td>{e.market ?? '-'}</td>
                    <td>{formatPrice(e)}</td>
                    <td className={e.changeRate == null ? undefined : e.changeRate >= 0 ? 'text-good' : 'text-critical'}>
                      {e.changeRate == null ? '-' : `${e.changeRate >= 0 ? '+' : ''}${(e.changeRate * 100).toFixed(2)}%`}
                    </td>
                    <td>
                      {(() => {
                        const t = targetBySymbol.get(e.symbol);
                        if (!t || (t.above === null && t.below === null)) return <span style={{ color: 'var(--text-muted)' }}>-</span>;
                        const p = e.lastPrice;
                        const hit = p !== null && ((t.above !== null && p >= t.above) || (t.below !== null && p <= t.below));
                        return (
                          <span style={{ fontWeight: hit ? 700 : undefined }} title={hit ? '지금 가격이 목표에 닿았습니다' : undefined}>
                            {[t.above !== null && `≥ ${priceIn(t.above, e.currency)}`, t.below !== null && `≤ ${priceIn(t.below, e.currency)}`]
                              .filter(Boolean)
                              .join(' · ')}
                            {hit && ' · 도달'}
                          </span>
                        );
                      })()}
                    </td>
                    <td>
                      <button
                        className="ghost"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void onRemove(e.symbol);
                        }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedEntry && (
        <WatchDetail
          key={selectedEntry.symbol}
          entry={selectedEntry}
          entries={entries}
          onEntryChange={(next) => setEntries((list) => list.map((x) => (x.symbol === next.symbol ? { ...x, memo: next.memo } : x)))}
        />
      )}
    </div>
  );
}
