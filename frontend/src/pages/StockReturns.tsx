import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { effectiveRate } from '../fx';
import { loadUsdKrwRates } from '../fxLoader';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../pageActivity';
import type { BrokerId, DividendRecord } from '../types';
import { API_BROKER_IDS } from '../brokers';
import { useStockLinkResolver } from '../components/StockNameLink';
import StockCell from '../components/StockCell';
import { formatKrwValue, formatRatePct, formatSignedKrw, qtyFmt } from '../format';
import Hint from '../components/Hint';
import SortButton, { ariaSort } from '../components/SortButton';
import { sortStockReturnRows, type StockReturnSortKey, type SymbolRow } from '../calc/stockReturns';

/** 전체 브로커/계좌의 보유종목 한 줄 — 종목별로 합치기 전의 원본(통화 기준 금액). */
interface FlatHolding {
  broker: BrokerId;
  symbol: string;
  name: string;
  currency: string | null;
  quantity: number;
  purchaseAmount: number;
  marketValue: number;
}



function toneOf(v: number) {
  return v >= 0 ? 'text-good' : 'text-critical';
}

/**
 * 종목별 수익 — "투자금 / 현재평가금 / 누적배당금"을 종목 한 줄로 한눈에 보는 화면.
 *
 * 다른 화면과의 차이: 보유 종목(Dashboard)은 브로커·계좌 하나를 골라 그 계좌의
 * 포지션을 보고, 배당금(Dividends)은 배당 기록만 본다 — 이 화면은 Overview.tsx처럼
 * **전체 브로커/계좌를 합치면서** 그 둘(보유종목 + 배당 기록)을 종목 기준으로 조인한다.
 * 새 백엔드 라우트는 없다(순수 클라이언트 집계, Overview.tsx와 같은 원칙).
 *
 * 자동 새로고침은 없다(마운트 시 한 번 + 수동 버튼) — Overview.tsx와 같은 이유로
 * 브로커마다 계좌 목록 + 계좌마다 보유종목을 조회해 호출량이 많다.
 */
export default function StockReturns() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holdings, setHoldings] = useState<FlatHolding[]>([]);
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});
  const [sortKey, setSortKey] = useState<StockReturnSortKey>('market');
  const [sortAsc, setSortAsc] = useState(false);
  const [includeSoldOut, setIncludeSoldOut] = useState(true);
  const [soldOpen, setSoldOpen] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();

  const effectiveFxRate = effectiveRate(manualFxRate, liveFxRate);

  function toKrw(amount: number, currency: string | null): number | null {
    if (currency === 'USD') return effectiveFxRate ? amount * effectiveFxRate : null;
    return amount;
  }

  // 배당금만 "오늘 환율"이 아니라 지급월 평균 환율로 환산한다 — Dividends.tsx/
  // Overview.tsx와 같은 규칙(backend/CLAUDE.md의 "배당금 월평균 환율" 절 참고).
  // 그 달을 못 구했으면 오늘/수동 환율로 대체한다.
  function dividendFxRateFor(month: string): number | null {
    return monthlyAvgFxRates[month]?.rate ?? effectiveFxRate;
  }

  // 월평균 환율 조회는 달 수만큼 한국수출입은행 영업일 조회가 필요해서 느릴 수
  // 있으므로 loadAll()을 막지 않는다 — 응답 전까진 dividendFxRateFor가 오늘/수동
  // 환율로 대체하므로 표는 즉시 뜨고, 응답이 오면 배당금 열만 조용히 정확해진다.
  const monthlyAvgFxRequestId = useRef(0);

  async function loadMonthlyAvgFxRates(divs: DividendRecord[]) {
    const requestId = ++monthlyAvgFxRequestId.current;
    const months = [...new Set(divs.filter((d) => d.currency === 'USD').map((d) => d.paidDate.slice(0, 7)))];
    if (months.length === 0) {
      if (requestId === monthlyAvgFxRequestId.current) setMonthlyAvgFxRates({});
      return;
    }
    const rates = await api.getMonthlyAvgUsdKrwRates(months).catch(() => ({}));
    if (requestId === monthlyAvgFxRequestId.current) setMonthlyAvgFxRates(rates);
  }

  async function loadAll(opts: { forceRefresh?: boolean } = {}) {
    setError(null);

    // 환율(수동·실시간, fxLoader.ts — 던지지 않음)과 증권사 목록을 동시에 받는다.
    const [{ manual: manualRate, live: resolvedLiveFxRate }, brokers] = await Promise.all([
      loadUsdKrwRates(opts),
      api.listBrokers(),
    ]);

    const configured = brokers.filter((b) => b.configured);
    const flat: FlatHolding[] = [];

    const [, divs] = await Promise.all([
      Promise.all(
        configured.map(async (b) => {
          // API 브로커는 계좌 목록 → 계좌별 라이브 조회, CSV 전용 브로커는 로컬
          // 저장소(Overview.tsx/Dashboard.tsx와 같은 분기).
          const rows = API_BROKER_IDS.includes(b.id)
            ? await api
                .listAccounts(b.id, opts)
                .then((accounts) =>
                  Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id, opts).catch(() => null)))
                )
                .then((portfolios) =>
                  portfolios.filter((p): p is NonNullable<typeof p> => p !== null).flatMap((p) => p.positions)
                )
            : await api.listHoldingsStore({ broker: b.id });

          for (const r of rows) {
            flat.push({
              broker: b.id,
              symbol: r.symbol,
              name: r.name,
              currency: r.currency,
              quantity: r.quantity,
              purchaseAmount: r.purchaseAmount,
              marketValue: r.marketValue,
            });
          }
        })
      ),
      api.listDividends(),
    ]);

    setHoldings(flat);
    setDividends(divs);
    setManualFxRate(manualRate);
    setLiveFxRate(resolvedLiveFxRate);
    setLastLoadedAt(new Date());

    void loadMonthlyAvgFxRates(divs);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        await loadAll();
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadAll({ forceRefresh: true });
      markRefreshed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  // 메뉴를 옮겼다 돌아오면 지금 화면을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx) — 실패하면 이전 값 유지.
  const markRefreshed = useResumeRefresh(async () => {
    setRefreshing(true);
    try {
      await loadAll();
    } catch {
      // 이전 화면 유지
    } finally {
      setRefreshing(false);
    }
  }, RESUME_REFRESH_MS);

  // 보유종목(투자금/현재평가금) + 배당 기록(누적배당금)을 종목 기준으로 조인한다.
  // IRP처럼 같은 종목이 memo/계좌로 나뉘어 여러 행인 경우는 한 종목으로 합친다.
  const rows = useMemo<SymbolRow[]>(() => {
    const bySymbol = new Map<string, SymbolRow>();

    function entryFor(symbol: string, name: string, currency: string | null): SymbolRow {
      const existing = bySymbol.get(symbol);
      if (existing) return existing;
      const created: SymbolRow = {
        symbol,
        name,
        currency,
        quantity: 0,
        purchaseKrw: 0,
        marketKrw: 0,
        dividendKrw: 0,
        held: false,
        unconverted: false,
      };
      bySymbol.set(symbol, created);
      return created;
    }

    for (const h of holdings) {
      const e = entryFor(h.symbol, h.name, h.currency);
      e.quantity += h.quantity;
      if (h.quantity > 0) e.held = true;
      const pv = toKrw(h.purchaseAmount, h.currency);
      const mv = toKrw(h.marketValue, h.currency);
      if (pv === null || mv === null) {
        // 환율을 못 구한 달러 보유분 — 조용히 틀린 합계를 보여주지 않고 이 종목을
        // "환율 미적용"으로 표시한다(다른 화면들과 같은 규칙).
        e.unconverted = true;
        continue;
      }
      e.purchaseKrw += pv;
      e.marketKrw += mv;
    }

    for (const d of dividends) {
      const e = entryFor(d.symbol, d.name, d.currency);
      if (d.currency === 'USD') {
        const rate = dividendFxRateFor(d.paidDate.slice(0, 7));
        if (rate === null) {
          e.unconverted = true;
          continue;
        }
        e.dividendKrw += d.amount * rate;
      } else {
        e.dividendKrw += d.amount;
      }
    }

    return Array.from(bySymbol.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, dividends, effectiveFxRate, monthlyAvgFxRates]);

  const shownRows = useMemo(() => {
    const filtered = includeSoldOut ? rows : rows.filter((r) => r.held);
    return sortStockReturnRows(filtered, sortKey, sortAsc);
  }, [rows, includeSoldOut, sortKey, sortAsc]);

  const totals = useMemo(() => {
    const t = { purchaseKrw: 0, marketKrw: 0, dividendKrw: 0, unconverted: false };
    for (const r of shownRows) {
      t.purchaseKrw += r.purchaseKrw;
      t.marketKrw += r.marketKrw;
      t.dividendKrw += r.dividendKrw;
      if (r.unconverted) t.unconverted = true;
    }
    return t;
  }, [shownRows]);

  const totalValuationGain = totals.marketKrw - totals.purchaseKrw;
  const totalReturn = totalValuationGain + totals.dividendKrw;
  const totalReturnRate = totals.purchaseKrw > 0 ? totalReturn / totals.purchaseKrw : null;
  const totalValuationRate = totals.purchaseKrw > 0 ? totalValuationGain / totals.purchaseKrw : null;
  const totalDividendRate = totals.purchaseKrw > 0 ? totals.dividendKrw / totals.purchaseKrw : null;

  // 지금 보유하지 않고 배당 기록만 있는 종목은 표 아래에 접어 둔다(합계에는 포함 — 예전엔 0원 줄 수십 개가 보유 종목 사이에 섞였다, 2026-11-18).
  const heldShown = shownRows.filter((r) => r.held);
  const soldShown = shownRows.filter((r) => !r.held);
  const soldToggle = (
    <tr className="group-toggle-row">
      <td colSpan={7} style={{ textAlign: 'left' }}>
        <button className="ghost" onClick={() => setSoldOpen((v) => !v)}>
          {soldOpen ? '▾' : '▸'} 지금 보유하지 않는 종목 {soldShown.length}개(배당 기록만) {soldOpen ? '접기' : '펼치기'}
        </button>
      </td>
    </tr>
  );

  function sortButton(key: StockReturnSortKey, label: string, opts?: { text?: boolean; small?: boolean }) {
    return (
      <SortButton
        sortKey={key}
        label={label}
        current={sortKey}
        asc={sortAsc}
        {...opts}
        onChange={(k, asc) => {
          setSortKey(k);
          setSortAsc(asc);
        }}
      />
    );
  }

  return (
    <div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}
      >
        <h2 className="page-title">종목별 수익</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastLoadedAt && (
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              {lastLoadedAt.toLocaleTimeString('ko-KR')} 기준
            </span>
          )}
          <button className="ghost" onClick={handleRefresh} disabled={loading || refreshing}>
            {refreshing ? '새로고침 중...' : '새로고침'}
          </button>
        </div>
      </div>
      {error && <p className="text-critical">{error}</p>}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
      ) : (
        <>
          <div className="summary-row">
            <div className="stat-tile">
              <div className="label">총 투자금(매입금액)</div>
              <div className="value">{formatKrwValue(totals.purchaseKrw)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">총 현재평가금</div>
              <div className="value">{formatKrwValue(totals.marketKrw)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">평가손익</div>
              <div className={`value ${toneOf(totalValuationGain)}`}>
                {formatSignedKrw(totalValuationGain)}
                <span style={{ fontSize: 13 }}> ({formatRatePct(totalValuationRate)})</span>
              </div>
            </div>
            <div className="stat-tile">
              <div className="label">총 누적배당금</div>
              <div className="value">
                {formatKrwValue(totals.dividendKrw)}
                <span style={{ fontSize: 13 }}> ({formatRatePct(totalDividendRate, false)})</span>
              </div>
            </div>
            <div className="stat-tile">
              <div className="label">총 수익(평가손익 + 배당)</div>
              <div className={`value ${toneOf(totalReturn)}`}>
                {formatSignedKrw(totalReturn)}
                <span style={{ fontSize: 13 }}> ({formatRatePct(totalReturnRate)})</span>
              </div>
            </div>
          </div>

          <div className="card">
            <Hint>
              전체 증권사·계좌의 보유종목을 종목 단위로 합치고, 같은 종목의 배당 기록을 전부 더한 누적배당금을 함께
              보여줍니다. 모든 금액은 원화 환산값입니다 — 달러 보유분은 지금 환율, 달러 배당금은 지급월 평균 환율로
              환산합니다. 배당금은 배당금 화면의 기록(세후)이 전부입니다 — 토스증권·한국투자증권은 API로 자동 동기화되고, 그
              밖의 증권사는 직접 기록한 내역만 반영됩니다(기록하지 않은 배당은 0으로 나옵니다).
            </Hint>
            {totals.unconverted && (
              <p className="text-critical" style={{ fontSize: 13 }}>
                환율을 가져오지 못해 일부 달러 금액이 합계에서 빠졌습니다(설정에서 환율을 직접 입력할 수 있습니다).
              </p>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={includeSoldOut}
                onChange={(e) => setIncludeSoldOut(e.target.checked)}
              />
              지금 보유하지 않지만 배당 기록이 있는 종목도 포함
            </label>
          </div>

          <div className="card">
            {shownRows.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>보여줄 종목이 없습니다.</p>
            ) : (
              <div className="table-scroll">
                <table className="num2">
                  <thead>
                    <tr>
                      <th aria-sort={ariaSort(sortKey, sortAsc, 'name')}>{sortButton('name', '종목', { text: true })}</th>
                      <th>수량</th>
                      <th aria-sort={ariaSort(sortKey, sortAsc, 'purchase')}>{sortButton('purchase', '매입금액')}</th>
                      <th aria-sort={ariaSort(sortKey, sortAsc, 'market')}>{sortButton('market', '평가금액')}</th>
                      <th aria-sort={ariaSort(sortKey, sortAsc, 'valuation', 'valuationRate')}>
                        {sortButton('valuation', '평가손익')}
                        {sortButton('valuationRate', '손익률', { small: true })}
                      </th>
                      <th aria-sort={ariaSort(sortKey, sortAsc, 'dividend', 'dividendRate')}>
                        {sortButton('dividend', '누적배당금')}
                        {sortButton('dividendRate', '배당수익률', { small: true })}
                      </th>
                      <th aria-sort={ariaSort(sortKey, sortAsc, 'totalReturn', 'totalReturnRate')}>
                        {sortButton('totalReturn', '총 수익')}
                        {sortButton('totalReturnRate', '총 수익률', { small: true })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...heldShown, ...(soldOpen ? soldShown : [])].map((r, i) => {
                      const valuationGain = r.marketKrw - r.purchaseKrw;
                      const rowReturn = valuationGain + r.dividendKrw;
                      const valuationRate = r.purchaseKrw > 0 ? valuationGain / r.purchaseKrw : null;
                      const dividendRate = r.purchaseKrw > 0 ? r.dividendKrw / r.purchaseKrw : null;
                      const returnRate = r.purchaseKrw > 0 ? rowReturn / r.purchaseKrw : null;
                      return (
                        <Fragment key={r.symbol}>
                        {i === heldShown.length && soldShown.length > 0 && soldToggle}
                        <tr>
                          <td>
                            <StockCell symbol={r.symbol} name={r.name} url={stockLinkFor(r.symbol, r.currency)}>
                              {!r.held && <span style={{ color: 'var(--text-muted)' }}> · 보유 없음</span>}
                              {r.unconverted && <span className="text-critical"> · 환율 미적용</span>}
                            </StockCell>
                          </td>
                          <td>{qtyFmt.format(r.quantity)}</td>
                          <td>{formatKrwValue(r.purchaseKrw)}</td>
                          <td>{formatKrwValue(r.marketKrw)}</td>
                          <td className={toneOf(valuationGain)}>
                            {formatSignedKrw(valuationGain)}
                            <span className="cell-sub">{formatRatePct(valuationRate)}</span>
                          </td>
                          <td>
                            {formatKrwValue(r.dividendKrw)}
                            <span className="cell-sub">
                              {formatRatePct(dividendRate, false)}
                            </span>
                          </td>
                          <td className={toneOf(rowReturn)}>
                            {formatSignedKrw(rowReturn)}
                            <span className="cell-sub">{formatRatePct(returnRate)}</span>
                          </td>
                        </tr>
                        </Fragment>
                      );
                    })}
                    {!soldOpen && soldShown.length > 0 && soldToggle}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 600 }}>합계 ({shownRows.length}종목)</td>
                      <td></td>
                      <td style={{ fontWeight: 600 }}>{formatKrwValue(totals.purchaseKrw)}</td>
                      <td style={{ fontWeight: 600 }}>{formatKrwValue(totals.marketKrw)}</td>
                      <td className={toneOf(totalValuationGain)} style={{ fontWeight: 600 }}>
                        {formatSignedKrw(totalValuationGain)}
                        <span className="cell-sub">{formatRatePct(totalValuationRate)}</span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {formatKrwValue(totals.dividendKrw)}
                        <span className="cell-sub">
                          {formatRatePct(totalDividendRate, false)}
                        </span>
                      </td>
                      <td className={toneOf(totalReturn)} style={{ fontWeight: 600 }}>
                        {formatSignedKrw(totalReturn)}
                        <span className="cell-sub">{formatRatePct(totalReturnRate)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
