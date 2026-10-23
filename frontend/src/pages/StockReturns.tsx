import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { BrokerId, DividendRecord } from '../types';
import { API_BROKER_IDS } from '../brokers';
import StockNameLink, { useStockLinkResolver } from '../components/StockNameLink';
import { krw } from '../format';

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

/** 표 한 줄 — 전부 KRW 환산 후의 값. */
interface SymbolRow {
  symbol: string;
  name: string;
  /** 보유종목이 있으면 그 통화, 배당 기록만 있으면 그 기록의 통화. */
  currency: string | null;
  quantity: number;
  purchaseKrw: number;
  marketKrw: number;
  dividendKrw: number;
  /** 지금 보유 중인가(수량 > 0) — 전량 매도했지만 배당 기록만 남은 종목 구분용. */
  held: boolean;
  /** 환율을 못 구해 이 종목의 달러 금액 일부/전부가 빠졌는가. */
  unconverted: boolean;
}

type SortKey = 'market' | 'purchase' | 'dividend' | 'totalReturn' | 'symbol';

function formatKrwValue(v: number) {
  return `${krw.format(Math.round(v))}원`;
}

function formatSignedKrw(v: number) {
  return `${v >= 0 ? '+' : ''}${krw.format(Math.round(v))}원`;
}

function formatRate(rate: number | null) {
  if (rate === null) return '-';
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`;
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
  const [sortKey, setSortKey] = useState<SortKey>('market');
  const [sortAsc, setSortAsc] = useState(false);
  const [includeSoldOut, setIncludeSoldOut] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();

  const effectiveFxRate = manualFxRate ?? liveFxRate;

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

    const [fx, brokers, live] = await Promise.all([
      api.getFxRate().catch(() => ({ usdKrwRate: null })),
      api.listBrokers(),
      api.getUsdKrwRate(opts).catch(() => ({ rate: null })),
    ]);
    const resolvedLiveFxRate = live.rate ? (live.midRate ?? live.rate) : null;

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
    setManualFxRate(fx.usdKrwRate);
    setLiveFxRate(resolvedLiveFxRate);
    setLastLoadedAt(new Date());

    void loadMonthlyAvgFxRates(divs);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

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
    const sorted = [...filtered].sort((a, b) => {
      const dir = sortAsc ? 1 : -1;
      switch (sortKey) {
        case 'symbol':
          return a.symbol.localeCompare(b.symbol) * dir;
        case 'purchase':
          return (a.purchaseKrw - b.purchaseKrw) * dir;
        case 'dividend':
          return (a.dividendKrw - b.dividendKrw) * dir;
        case 'totalReturn':
          return (
            (a.marketKrw - a.purchaseKrw + a.dividendKrw - (b.marketKrw - b.purchaseKrw + b.dividendKrw)) * dir
          );
        case 'market':
        default:
          return (a.marketKrw - b.marketKrw) * dir;
      }
    });
    return sorted;
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

  function sortButton(key: SortKey, label: string) {
    const active = sortKey === key;
    return (
      <button
        className="ghost"
        style={{ padding: 0, font: 'inherit', color: active ? 'var(--text)' : undefined }}
        onClick={() => {
          if (active) setSortAsc((v) => !v);
          else {
            setSortKey(key);
            setSortAsc(false);
          }
        }}
        title="정렬 기준 변경"
      >
        {label}
        {active ? (sortAsc ? ' ▲' : ' ▼') : ''}
      </button>
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
          <button onClick={handleRefresh} disabled={loading || refreshing}>
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
                <span style={{ fontSize: 13 }}> ({formatRate(totalValuationRate)})</span>
              </div>
            </div>
            <div className="stat-tile">
              <div className="label">총 누적배당금</div>
              <div className="value">
                {formatKrwValue(totals.dividendKrw)}
                <span style={{ fontSize: 13 }}> ({formatRate(totalDividendRate)})</span>
              </div>
            </div>
            <div className="stat-tile">
              <div className="label">총 수익(평가손익 + 배당)</div>
              <div className={`value ${toneOf(totalReturn)}`}>
                {formatSignedKrw(totalReturn)}
                <span style={{ fontSize: 13 }}> ({formatRate(totalReturnRate)})</span>
              </div>
            </div>
          </div>

          <div className="card">
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
              전체 증권사·계좌의 보유종목을 종목 단위로 합치고, 같은 종목의 배당 기록을 전부 더한 누적배당금을 함께
              보여줍니다. 모든 금액은 원화 환산값입니다 — 달러 보유분은 지금 환율, 달러 배당금은 지급월 평균 환율로
              환산합니다. 배당금은 증권사 API로 조회할 수 없어 배당금 화면에 직접 기록한 내역이 전부입니다(기록하지
              않은 배당은 0으로 나옵니다).
            </p>
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
                <table>
                  <thead>
                    <tr>
                      <th>{sortButton('symbol', '종목')}</th>
                      <th>수량</th>
                      <th>{sortButton('purchase', '투자금')}</th>
                      <th>{sortButton('market', '현재평가금')}</th>
                      <th>평가손익</th>
                      <th>손익률</th>
                      <th>{sortButton('dividend', '누적배당금')}</th>
                      <th>배당수익률</th>
                      <th>{sortButton('totalReturn', '총 수익')}</th>
                      <th>총 수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownRows.map((r) => {
                      const valuationGain = r.marketKrw - r.purchaseKrw;
                      const rowReturn = valuationGain + r.dividendKrw;
                      const valuationRate = r.purchaseKrw > 0 ? valuationGain / r.purchaseKrw : null;
                      const dividendRate = r.purchaseKrw > 0 ? r.dividendKrw / r.purchaseKrw : null;
                      const returnRate = r.purchaseKrw > 0 ? rowReturn / r.purchaseKrw : null;
                      return (
                        <tr key={r.symbol}>
                          <td className="cell-name-truncate">
                            <StockNameLink name={r.name} url={stockLinkFor(r.symbol, r.currency)} />{' '}
                            <span style={{ color: 'var(--text-muted)' }}>({r.symbol})</span>
                            {!r.held && <span style={{ color: 'var(--text-muted)' }}> · 보유 없음</span>}
                            {r.unconverted && <span className="text-critical"> · 환율 미적용</span>}
                          </td>
                          <td>{r.quantity}</td>
                          <td>{formatKrwValue(r.purchaseKrw)}</td>
                          <td>{formatKrwValue(r.marketKrw)}</td>
                          <td className={toneOf(valuationGain)}>{formatSignedKrw(valuationGain)}</td>
                          <td className={valuationRate === null ? undefined : toneOf(valuationRate)}>
                            {formatRate(valuationRate)}
                          </td>
                          <td>{formatKrwValue(r.dividendKrw)}</td>
                          <td>{dividendRate === null ? '-' : `${(dividendRate * 100).toFixed(2)}%`}</td>
                          <td className={toneOf(rowReturn)}>{formatSignedKrw(rowReturn)}</td>
                          <td className={returnRate === null ? undefined : toneOf(returnRate)}>
                            {formatRate(returnRate)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td style={{ fontWeight: 600 }}>합계 ({shownRows.length}종목)</td>
                      <td></td>
                      <td style={{ fontWeight: 600 }}>{formatKrwValue(totals.purchaseKrw)}</td>
                      <td style={{ fontWeight: 600 }}>{formatKrwValue(totals.marketKrw)}</td>
                      <td className={toneOf(totalValuationGain)} style={{ fontWeight: 600 }}>
                        {formatSignedKrw(totalValuationGain)}
                      </td>
                      <td
                        className={totalValuationRate === null ? undefined : toneOf(totalValuationRate)}
                        style={{ fontWeight: 600 }}
                      >
                        {formatRate(totalValuationRate)}
                      </td>
                      <td style={{ fontWeight: 600 }}>{formatKrwValue(totals.dividendKrw)}</td>
                      <td style={{ fontWeight: 600 }}>
                        {totalDividendRate === null ? '-' : `${(totalDividendRate * 100).toFixed(2)}%`}
                      </td>
                      <td className={toneOf(totalReturn)} style={{ fontWeight: 600 }}>
                        {formatSignedKrw(totalReturn)}
                      </td>
                      <td
                        className={totalReturnRate === null ? undefined : toneOf(totalReturnRate)}
                        style={{ fontWeight: 600 }}
                      >
                        {formatRate(totalReturnRate)}
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
