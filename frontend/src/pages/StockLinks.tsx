import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../pageActivity';
import type { StockLinkEntry } from '../types';
import { autoStockLink, resolveStockLink, stockLinkMap, type StockLinkSource } from '../stockLinks';
import Hint from '../components/Hint';
import StockCell from '../components/StockCell';

type SourceKind = '보유' | '배당' | '매매' | '관심';
const SOURCE_ORDER: SourceKind[] = ['보유', '배당', '매매', '관심'];

interface KnownStock {
  symbol: string;
  name: string;
  currency: string | null;
  sources: Set<SourceKind>;
}

type Filter = 'ALL' | 'LINKED' | 'UNLINKED' | 'MANUAL';

const SOURCE_TEXT: Record<StockLinkSource, string> = {
  manual: '직접 입력',
  auto: '자동',
  none: '없음',
};

/**
 * 종목 링크 — 보유종목/배당금/매매내역 로컬 저장소에 한 번이라도 나온 종목을 모아
 * 종목별 외부 링크(기본: 토스증권 웹 종목 페이지)를 관리한다. 목록은 저장소에서
 * 매번 다시 모으므로 새 종목은 자동으로 추가된다(이 화면에 별도 "종목 추가"가 없음).
 * 국내 종목과 확인된 일부 미국 종목은 자동 링크가 채워져 있고(`stockLinks.ts`),
 * 사용자가 입력하면 그 값이 우선한다. 보유종목 표(HoldingsTable)는 여기서 정한
 * 링크로 종목명을 연다.
 */
export default function StockLinks() {
  const [stocks, setStocks] = useState<KnownStock[]>([]);
  const [saved, setSaved] = useState<StockLinkEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  // 링크가 있는 행은 긴 URL 입력칸 대신 짧은 글자로 보여 주고 "수정"을 눌러야 입력칸이 된다 — 수십 줄 모두 입력칸이라 빽빽했다(2026-11-18 UX 점검).
  const [editing, setEditing] = useState<Set<string>>(new Set());

  // 메뉴를 옮겼다 돌아오면 목록을 그대로 둔 채 다시 모은다(pageActivity.tsx) — 0은 첫 로딩.
  const [reload, setReload] = useState(0);
  useResumeRefresh(() => setReload((n) => n + 1), RESUME_REFRESH_MS);
  useEffect(() => {
    void (async () => {
      try {
        const [holdings, dividends, trades, watchlist, links] = await Promise.all([
          api.listHoldingsStore(),
          api.listDividends(),
          api.listTradesStore(),
          // 관심종목은 현재가를 매번 라이브 조회하는 엔드포인트라 실패해도 목록 전체를
          // 막지 않는다.
          api.listWatchlistEntries().catch(() => []),
          api.listStockLinks(),
        ]);
        const bySymbol = new Map<string, KnownStock>();
        const add = (symbol: string, name: string | null, currency: string | null, source: SourceKind) => {
          const key = symbol.toUpperCase();
          const existing = bySymbol.get(key) ?? { symbol: key, name: '', currency: null, sources: new Set() };
          if (!existing.name && name) existing.name = name;
          if (!existing.currency && currency) existing.currency = currency;
          existing.sources.add(source);
          bySymbol.set(key, existing);
        };
        for (const h of holdings) add(h.symbol, h.name, h.currency, '보유');
        for (const d of dividends) add(d.symbol, d.name, d.currency, '배당');
        for (const t of trades) add(t.symbol, t.name, t.currency, '매매');
        for (const w of watchlist) add(w.symbol, w.name, w.currency, '관심');
        setStocks(
          Array.from(bySymbol.values()).sort(
            (a, b) =>
              Number(b.sources.has('보유')) - Number(a.sources.has('보유')) ||
              (a.name || a.symbol).localeCompare(b.name || b.symbol, 'ko')
          )
        );
        setSaved(links);
      } catch (e) {
        if (reload === 0) setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const savedMap = useMemo(() => stockLinkMap(saved), [saved]);

  function effective(s: KnownStock) {
    return resolveStockLink(s.symbol, s.currency, savedMap);
  }

  function draftFor(s: KnownStock): string {
    return drafts[s.symbol] ?? effective(s).url ?? '';
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stocks.filter((s) => {
      if (q && !s.symbol.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
      const { url, source } = resolveStockLink(s.symbol, s.currency, savedMap);
      if (filter === 'LINKED') return url !== null;
      if (filter === 'UNLINKED') return url === null;
      if (filter === 'MANUAL') return source === 'manual';
      return true;
    });
  }, [stocks, query, filter, savedMap]);

  const linkedCount = stocks.filter((s) => effective(s).url !== null).length;

  async function persist(symbol: string, action: () => Promise<unknown>, done: string) {
    setError(null);
    setMessage(null);
    try {
      await action();
      setSaved(await api.listStockLinks());
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
      setMessage(done);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function onSave(s: KnownStock) {
    const url = draftFor(s).trim();
    // 자동 링크와 똑같은 값을 "저장"하면 굳이 사용자 입력으로 고정하지 않는다 —
    // 그래야 나중에 자동 규칙이 고쳐지면 같이 따라간다.
    if (url && url === autoStockLink(s.symbol, s.currency)) {
      return persist(s.symbol, () => api.deleteStockLink(s.symbol), `${s.symbol}: 자동 링크를 사용합니다.`);
    }
    if (!url) {
      return persist(s.symbol, () => api.saveStockLink(s.symbol, ''), `${s.symbol}: 링크 없음으로 저장했습니다.`);
    }
    return persist(s.symbol, () => api.saveStockLink(s.symbol, url), `${s.symbol}: 저장했습니다.`);
  }

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>;

  return (
    <div>
      <h2 className="page-title">종목 링크</h2>
      {error && <p className="text-critical">{error}</p>}
      {message && <p className="text-good">{message}</p>}

      <Hint card>
        보유종목·배당금·매매내역·관심종목에 나온 종목이 자동으로 모입니다. 여기서 정한 링크는
        보유 종목·배당금·매매내역·관심종목 화면에서 종목명을 누르면 브라우저로 열립니다. <strong>국내 종목</strong>은 토스증권 종목
        페이지가 자동으로 채워지고, <strong>미국 종목</strong>은 토스 내부 코드를 규칙으로 알 수
        없어 확인된 몇 종목만 채워져 있습니다 — 토스증권 웹에서 그 종목 페이지 주소를 복사해
        붙여넣으면 됩니다. 칸을 비우고 저장하면 "링크 없음", "자동으로" 버튼은 직접 입력한 값을
        지우고 자동 링크로 되돌립니다.
      </Hint>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>검색</label>
            <input
              type="text"
              value={query}
              placeholder="종목명 또는 코드"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>보기</label>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="ALL">전체</option>
              <option value="UNLINKED">링크 없는 종목</option>
              <option value="LINKED">링크 있는 종목</option>
              <option value="MANUAL">직접 입력한 종목</option>
            </select>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {stocks.length}개 종목 중 {linkedCount}개 링크 있음
          </span>
        </div>

        {visible.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>표시할 종목이 없습니다.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>나온 곳</th>
                  <th>외부 링크</th>
                  <th>상태</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => {
                  const { url, source } = effective(s);
                  const draft = draftFor(s);
                  const dirty = draft.trim() !== (url ?? '');
                  return (
                    <tr key={s.symbol}>
                      <td>
                        <StockCell symbol={s.symbol} name={s.name} url={null} />
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {SOURCE_ORDER.filter((k) => s.sources.has(k)).join(' · ')}
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        {url && !dirty && !editing.has(s.symbol) ? (
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            {/* 주소 전체를 줄바꿈해 보이고 누르면 열린다(예전엔 240px에서 잘리고 전체는 title에만 — Electron에선 안 떴다) */}
                            <a
                              className="stock-link cell-url"
                              href={url ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {(url ?? '').replace(/^https?:\/\/(www\.)?/, '')}
                            </a>
                            <button className="ghost" onClick={() => setEditing((prev) => new Set(prev).add(s.symbol))}>
                              수정
                            </button>
                          </span>
                        ) : (
                          <input
                            type="url"
                            value={draft}
                            placeholder="https://www.tossinvest.com/stocks/…/order"
                            style={{ width: 280, maxWidth: '100%' }}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [s.symbol]: e.target.value }))}
                          />
                        )}
                      </td>
                      <td style={{ fontSize: 13, color: source === 'none' ? 'var(--text-muted)' : undefined }}>
                        {SOURCE_TEXT[source]}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {url && !dirty && (
                            <a className="ghost-link" href={url} target="_blank" rel="noreferrer">
                              열기
                            </a>
                          )}
                          {(dirty || editing.has(s.symbol) || !url) && (
                            <button className="ghost" disabled={!dirty} onClick={() => onSave(s)}>
                              저장
                            </button>
                          )}
                          {savedMap.has(s.symbol) && (
                            <button
                              className="ghost"
                              onClick={() =>
                                persist(s.symbol, () => api.deleteStockLink(s.symbol), `${s.symbol}: 자동 링크로 되돌렸습니다.`)
                              }
                            >
                              자동으로
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
