import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { BROKER_LABELS } from '../brokers';
import { buildStockIndex, searchStocks, type StockIndexEntry } from '../calc/stockSearch';
import { krw, localToday, usdFmt } from '../format';

type Target = 'dashboard' | 'dividends' | 'trades' | 'watchlist' | 'stockReturns';
const money = (v: number, currency: string | null) => (currency === 'USD' ? usdFmt.format(v) : `${krw.format(Math.round(v))}원`);

/**
 * 빠른 종목 검색(⌘K / Ctrl+K, 앱 어디서나) — 보유·관심·배당·매매에 나온 종목을 코드·이름으로 찾고(calc/stockSearch.ts), 고르면 그 종목의 요약
 * (계좌별 보유·손익, 최근 12개월 배당, 최근 매매, 목표가)을 보여 준 뒤 관련 화면으로 이동한다. 열 때마다 로컬 저장소를 다시 읽는다(API 호출 없음 —
 * API 계좌의 보유·매매는 마지막으로 조회한 시점 값). `position: fixed`라 줌 바깥(document.body)으로 포털한다(frontend/CLAUDE.md 화면 줌).
 */
export function QuickSearch({ open, onClose, onNavigate }: { open: boolean; onClose: () => void; onNavigate: (page: Target) => void }) {
  const [index, setIndex] = useState<StockIndexEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [picked, setPicked] = useState<StockIndexEntry | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setPicked(null);
    setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    let alive = true;
    Promise.all([api.listHoldingsStore(), api.listWatchlist().catch(() => []), api.listDividends(), api.listTradesStore()])
      .then(([h, w, d, t]) => alive && setIndex(buildStockIndex(h, w, d, t)))
      .catch(() => alive && setIndex([]));
    return () => {
      alive = false;
    };
  }, [open]);
  const results = useMemo(() => (index ? searchStocks(index, query) : []), [index, query]);
  useEffect(() => setCursor(0), [query]);

  if (!open) return null;
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (picked) setPicked(null);
      else onClose();
    } else if (!picked && e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(0, results.length - 1)));
    } else if (!picked && e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (!picked && e.key === 'Enter' && results[cursor]) {
      e.preventDefault();
      setPicked(results[cursor]);
    }
  };
  const go = (t: Target) => {
    onNavigate(t);
    onClose();
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose} onKeyDown={onKey} role="dialog" aria-label="종목 검색">
      <div className="modal-content quick-search" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPicked(null);
          }}
          placeholder="종목코드·이름 검색 (↑↓ 이동, Enter 선택, Esc 닫기)"
          aria-label="종목 검색어"
          style={{ width: '100%' }}
        />
        {!picked ? (
          <ul className="quick-search-list">
            {index === null ? (
              <li className="quick-search-empty">불러오는 중...</li>
            ) : results.length === 0 ? (
              <li className="quick-search-empty">{query ? '찾는 종목이 없습니다.' : '보유·관심 종목이 없습니다.'}</li>
            ) : (
              results.map((r, i) => (
                <li key={r.symbol}>
                  <button type="button" className={i === cursor ? 'active' : undefined} onMouseEnter={() => setCursor(i)} onClick={() => setPicked(r)}>
                    <span>
                      {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.symbol}</span>
                    </span>
                    <span className="quick-search-tags">
                      {r.held.length > 0 && <span>보유</span>}
                      {r.watch && <span>관심</span>}
                      {r.dividends.length > 0 && <span>배당</span>}
                      {r.trades.length > 0 && <span>매매</span>}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : (
          <StockSummary entry={picked} onNavigate={go} onBack={() => setPicked(null)} />
        )}
      </div>
    </div>,
    document.body
  );
}

function StockSummary({ entry, onNavigate, onBack }: { entry: StockIndexEntry; onNavigate: (t: Target) => void; onBack: () => void }) {
  const today = localToday();
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const div12 = entry.dividends.filter((d) => d.paidDate > yearAgo && d.paidDate <= today);
  const divByCur = div12.reduce<Record<string, number>>((m, d) => ({ ...m, [d.currency]: (m[d.currency] ?? 0) + d.amount }), {});
  const recentTrades = [...entry.trades].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)).slice(0, 5);
  const qty = entry.held.reduce((s, h) => s + h.quantity, 0);
  const value = entry.held.reduce((s, h) => s + h.marketValue, 0);
  const cost = entry.held.reduce((s, h) => s + h.purchaseAmount, 0);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>
          {entry.name} <span style={{ color: 'var(--text-muted)', fontWeight: 'normal' }}>{entry.symbol}</span>
        </h3>
        <button type="button" className="ghost" onClick={onBack}>
          ← 목록
        </button>
      </div>
      {entry.held.length > 0 ? (
        <>
          <p style={{ margin: '8px 0 4px' }}>
            보유 {krw.format(qty)}주 · 평가 {money(value, entry.currency)} · 손익{' '}
            <span className={value - cost >= 0 ? 'text-good' : 'text-critical'}>
              {money(value - cost, entry.currency)} ({cost > 0 ? (((value - cost) / cost) * 100).toFixed(1) : '0'}%)
            </span>
          </p>
          <table>
            <tbody>
              {entry.held.map((h, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'left' }}>
                    {BROKER_LABELS[h.broker]} · {h.accountId}
                    {h.memo ? ` · ${h.memo}` : ''}
                  </td>
                  <td>{krw.format(h.quantity)}주</td>
                  <td>{money(h.marketValue, h.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>지금 보유하지 않습니다.</p>
      )}
      <p style={{ fontSize: 13 }}>
        최근 12개월 배당(세후): {Object.keys(divByCur).length ? Object.entries(divByCur).map(([c, v]) => money(v, c)).join(' · ') : '없음'} ({div12.length}건)
        {entry.watch?.lastPrice ? ` · 현재가 ${money(entry.watch.lastPrice, entry.watch.currency)}` : ''}
      </p>
      {recentTrades.length > 0 && (
        <p style={{ fontSize: 13, margin: '4px 0' }}>
          최근 매매:{' '}
          {recentTrades.map((t) => `${t.executedAt.slice(0, 10)} ${t.side === 'BUY' ? '매수' : '매도'} ${krw.format(t.quantity)}주`).join(', ')}
        </p>
      )}
      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>증권사 API 계좌의 보유·매매는 마지막으로 조회한 시점 값입니다.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ghost" onClick={() => onNavigate('dashboard')}>
          보유 종목
        </button>
        <button type="button" className="ghost" onClick={() => onNavigate('stockReturns')}>
          종목별 수익
        </button>
        <button type="button" className="ghost" onClick={() => onNavigate('dividends')}>
          배당금
        </button>
        <button type="button" className="ghost" onClick={() => onNavigate('trades')}>
          매매내역
        </button>
        <button type="button" className="ghost" onClick={() => onNavigate('watchlist')}>
          관심종목
        </button>
      </div>
    </div>
  );
}
