import { useEffect, useState } from 'react';
import { api } from '../api';
import type { WatchlistEntry } from '../types';
import { krw2dp, usdFmt } from '../format';
import PriceChart, { type PricePoint } from '../components/PriceChart';

function formatPrice(entry: WatchlistEntry): string {
  if (entry.lastPrice === null) return '-';
  return entry.currency === 'USD' ? usdFmt.format(entry.lastPrice) : `${krw2dp.format(entry.lastPrice)}원`;
}

export default function Watchlist() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 선택된 종목의 상세(월별 종가 차트) — 표에서 행을 누르면 그 종목으로 바뀐다.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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
    refresh();
  }, []);

  // 선택된 종목이 바뀔 때마다 월별 종가(최근 12개월)를 받아온다 — 보유 종목이
  // 아니라 자체 API 호출이 필요하다(Overview.tsx가 이미 쓰는 것과 같은
  // 엔드포인트, backend/CLAUDE.md의 "월별 종가 조회" 절 참고). 새로고침을
  // 연타해도 오래된 응답이 최신 선택을 덮어쓰지 않도록 선택이 바뀌면 그 즉시
  // 이전 데이터를 비운다.
  useEffect(() => {
    if (!selectedSymbol) {
      setPricePoints([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setPricePoints([]);
    api
      .getMonthlyClosePrices([selectedSymbol], 12)
      .then((result) => {
        if (!cancelled) setPricePoints(result[selectedSymbol] ?? []);
      })
      .catch(() => {
        if (!cancelled) setPricePoints([]);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol]);

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
          <button type="submit" disabled={adding || !symbol.trim()}>
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
                      <span className="cell-name-truncate" title={e.name}>
                        {e.name}
                      </span>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>({e.symbol})</span>
                    </td>
                    <td>{e.market ?? '-'}</td>
                    <td>{formatPrice(e)}</td>
                    <td>
                      <button
                        className="ghost"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onRemove(e.symbol);
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
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            {selectedEntry.name} <span style={{ color: 'var(--text-muted)' }}>({selectedEntry.symbol})</span>
          </h3>
          <div className="summary-row">
            <div className="stat-tile">
              <div className="label">현재가</div>
              <div className="value">{formatPrice(selectedEntry)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">시장</div>
              <div className="value">{selectedEntry.market ?? '-'}</div>
            </div>
            <div className="stat-tile">
              <div className="label">통화</div>
              <div className="value">{selectedEntry.currency ?? '-'}</div>
            </div>
          </div>
          <h4 style={{ marginBottom: 8 }}>월별 종가(최근 12개월)</h4>
          {detailLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : (
            <PriceChart points={pricePoints} />
          )}
        </div>
      )}
    </div>
  );
}
