import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { WatchlistEntry } from '../types';
import { krw2dp, usdFmt } from '../format';
import PriceChart, { type PricePoint } from '../components/PriceChart';
import StockNameLink, { useStockLinkResolver } from '../components/StockNameLink';

function formatPrice(entry: WatchlistEntry): string {
  if (entry.lastPrice === null) return '-';
  return entry.currency === 'USD' ? usdFmt.format(entry.lastPrice) : `${krw2dp.format(entry.lastPrice)}원`;
}

export default function Watchlist() {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // 선택된 종목의 상세(월별 종가 차트) — 표에서 행을 누르면 그 종목으로 바뀐다.
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [pricePoints, setPricePoints] = useState<PricePoint[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  // 차트 기간 — 'RECENT'(최근 12개월, 기본) / 'ALL'(받은 전체) / 'YYYY'(그 해만).
  // 데이터는 종목을 고를 때 전체 기간을 한 번 받아두고 여기선 화면에서만 거른다.
  const [period, setPeriod] = useState<string>('RECENT');

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

  // 선택된 종목이 바뀔 때마다 월별 종가를 **상장 초기까지 전체** 받아온다
  // (months='all') — 기간 선택(최근 12개월/연도/전체)은 이 데이터를 화면에서
  // 거르기만 해서, 기간을 바꿀 때마다 다시 요청하지 않는다. 처음 보는 종목은
  // 일봉 수십 페이지를 받아 몇 초 걸릴 수 있지만, 백엔드가 확정된 달을 디스크에
  // 캐시해 두 번째부터는 최신 1페이지만 받는다(backend/CLAUDE.md의 "월별 종가
  // 조회" 절 참고). 새로고침을 연타해도 오래된 응답이 최신 선택을 덮어쓰지
  // 않도록 선택이 바뀌면 그 즉시 이전 데이터를 비운다.
  useEffect(() => {
    if (!selectedSymbol) {
      setPricePoints([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setPricePoints([]);
    setPeriod('RECENT');
    api
      .getMonthlyClosePrices([selectedSymbol], 'all')
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

  const yearOptions = useMemo(
    () => [...new Set(pricePoints.map((p) => p.month.slice(0, 4)))].sort().reverse(),
    [pricePoints]
  );
  const shownPoints = useMemo(() => {
    if (period === 'ALL') return pricePoints;
    if (period === 'RECENT') return pricePoints.slice(-12);
    return pricePoints.filter((p) => p.month.startsWith(period));
  }, [pricePoints, period]);
  const periodTitle =
    period === 'RECENT'
      ? '최근 12개월'
      : period === 'ALL'
        ? pricePoints.length > 0
          ? `전체 기간 · ${pricePoints[0].month} ~ ${pricePoints[pricePoints.length - 1].month}`
          : '전체 기간'
        : `${period}년`;

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
                      <StockNameLink name={e.name} url={stockLinkFor(e.symbol, e.currency)} />{' '}
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
          <div
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}
          >
            <h4 style={{ margin: '8px 0' }}>월별 종가({periodTitle})</h4>
            <div className="form-row" style={{ margin: 0 }}>
              <select
                value={period}
                aria-label="차트 기간"
                disabled={detailLoading || pricePoints.length === 0}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="RECENT">최근 12개월</option>
                <option value="ALL">전체 기간</option>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </div>
          </div>
          {detailLoading ? (
            <p style={{ color: 'var(--text-muted)' }}>
              불러오는 중... (처음 보는 종목은 상장 이후 전체 시세를 받느라 몇 초 걸릴 수 있습니다)
            </p>
          ) : (
            <PriceChart points={shownPoints} />
          )}
        </div>
      )}
    </div>
  );
}
