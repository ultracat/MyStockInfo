import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { loadAllHoldings, type HoldingLine } from '../allHoldings';
import { computeRealizedSales } from '../calc/realizedGains';
import { buildReport } from '../calc/report';
import { monthlyRateOr } from '../fx';
import { krw, localToday } from '../format';
import { BROKER_LABELS } from '../brokers';
import { accountLabelKey } from '../accountLabels';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../pageActivity';
import type { AccountTaxTypeEntry, DividendRecord, SnapshotRecord, StoredTrade } from '../types';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const signedWon = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${krw.format(Math.abs(Math.round(v)))}원`;

function recentMonths(today: string, n: number): string[] {
  const out: string[] = [];
  let idx = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  for (let k = 0; k < n; k++, idx--) out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`);
  return out;
}

/**
 * 월간·연간 보고서 — 기간의 배당·매매·실현손익·순자산 변화와 작성 시점 보유 상위를 한 장에 모은다(calc/report.ts). "PDF로 저장"은 메인 프로세스가
 * 이 화면을 그대로 PDF로 찍는다(backend routes/report.ts) — 인쇄 CSS(styles.css `@media print`)가 사이드바·버튼·줌을 걷어 낸다.
 */
export default function Report() {
  const today = localToday();
  const [kind, setKind] = useState<'month' | 'year'>('month');
  const [period, setPeriod] = useState(today.slice(0, 7));
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [trades, setTrades] = useState<StoredTrade[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([]);
  const [taxTypes, setTaxTypes] = useState<AccountTaxTypeEntry[]>([]);
  const [holdings, setHoldings] = useState<{ lines: HoldingLine[]; fxRate: number | null } | null>(null);
  const [rates, setRates] = useState<Record<string, { rate: number } | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([api.listDividends(), api.listTradesStore(), api.listPortfolioSnapshots(), api.listAccountTaxTypes()])
      .then(([d, t, s, tt]) => {
        setDividends(d);
        setTrades(t);
        setSnapshots(s);
        setTaxTypes(tt);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
    loadAllHoldings()
      .then(setHoldings)
      .catch(() => setHoldings({ lines: [], fxRate: null }));
  }, []);
  useEffect(() => load(), [load]);
  useResumeRefresh(load, RESUME_REFRESH_MS);

  // 달러 배당·매매가 있는 달의 월평균 환율(실현손익 화면과 같은 규칙 — 못 구하면 지금 환율)
  const usdMonths = useMemo(
    () => [...new Set([...dividends.filter((d) => d.currency === 'USD').map((d) => d.paidDate.slice(0, 7)), ...trades.filter((t) => t.currency === 'USD').map((t) => t.executedAt.slice(0, 7))])].sort(),
    [dividends, trades]
  );
  useEffect(() => {
    if (!usdMonths.length) return;
    let alive = true;
    api
      .getMonthlyAvgUsdKrwRates(usdMonths)
      .then((r) => alive && setRates(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [usdMonths]);
  const fxNow = holdings?.fxRate ?? null;
  const rateFor = useCallback((m: string) => monthlyRateOr(rates, m, fxNow), [rates, fxNow]);
  const taxAdvantaged = useMemo(() => new Set(taxTypes.filter((t) => t.taxType !== 'GENERAL').map((t) => accountLabelKey(t.broker, t.accountId))), [taxTypes]);

  const report = useMemo(() => {
    const { sales } = computeRealizedSales(trades, rateFor);
    return buildReport({ period, dividends, trades, sales, snapshots, rateFor }, (b, a) => taxAdvantaged.has(accountLabelKey(b as never, a)));
  }, [period, dividends, trades, snapshots, rateFor, taxAdvantaged]);

  const topHoldings = useMemo(() => {
    if (!holdings) return null;
    const by = new Map<string, { name: string; valueKrw: number; costKrw: number }>();
    for (const h of holdings.lines) {
      const r = h.currency === 'USD' ? holdings.fxRate : 1;
      if (!r) continue;
      const cur = by.get(h.symbol) ?? { name: h.name, valueKrw: 0, costKrw: 0 };
      cur.valueKrw += h.marketValue * r;
      cur.costKrw += h.purchaseAmount * r;
      by.set(h.symbol, cur);
    }
    const all = [...by.entries()].map(([symbol, v]) => ({ symbol, ...v }));
    const total = all.reduce((s, v) => s + v.valueKrw, 0);
    const cost = all.reduce((s, v) => s + v.costKrw, 0);
    return { total, cost, rows: all.sort((a, b) => b.valueKrw - a.valueKrw).slice(0, 10) };
  }, [holdings]);

  const periodLabel = kind === 'year' ? `${period}년` : `${period.slice(0, 4)}년 ${Number(period.slice(5))}월`;
  const savePdf = async () => {
    setSaving(true);
    setSaved(null);
    try {
      const r = await api.saveReportPdf(`MyStock-보고서-${period}.pdf`);
      setSaved(r.saved ? `저장했습니다: ${r.saved}` : '저장을 취소했습니다.');
    } catch (e) {
      setSaved((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="report-page">
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ marginRight: 'auto' }}>보고서</h1>
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as 'month' | 'year';
            setKind(k);
            setPeriod(k === 'year' ? today.slice(0, 4) : today.slice(0, 7));
          }}
          aria-label="보고서 종류"
        >
          <option value="month">월간</option>
          <option value="year">연간</option>
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="기간">
          {(kind === 'year' ? Array.from({ length: 6 }, (_, i) => String(Number(today.slice(0, 4)) - i)) : recentMonths(today, 24)).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void savePdf()} disabled={saving}>
          {saving ? 'PDF 만드는 중...' : 'PDF로 저장'}
        </button>
      </div>
      {saved && <p className="no-print" style={{ fontSize: 13 }}>{saved}</p>}
      {error && <p className="text-critical">{error}</p>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>MyStock {kind === 'year' ? '연간' : '월간'} 보고서 — {periodLabel}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
          작성일 {today}. 배당은 세후, 달러는 그 달 평균 환율(없으면 작성일 환율)로 원화 환산. 보유 현황은 작성 시점 값입니다. 참고용 자료이며 세무 자문이 아닙니다.
        </p>
      </div>

      <div className="card report-section">
        <h3 style={{ marginTop: 0 }}>요약</h3>
        <div className="summary-row">
          <div className="stat-tile">
            <div className="label">받은 배당(세후)</div>
            <div className="value">{won(report.dividends.totalKrw)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{report.dividends.count}건</div>
          </div>
          <div className="stat-tile">
            <div className="label">실현손익(일반 계좌)</div>
            <div className={`value ${report.realized.totalKrw > 0 ? 'text-good' : report.realized.totalKrw < 0 ? 'text-critical' : ''}`}>{signedWon(report.realized.totalKrw)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>매도 {report.realized.count}건</div>
          </div>
          <div className="stat-tile">
            <div className="label">순자산 변화(기록 기준)</div>
            <div className="value">{report.netWorth.changeKrw === null ? '-' : signedWon(report.netWorth.changeKrw)}</div>
            {report.netWorth.start && report.netWorth.end && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {report.netWorth.start.date} {won(report.netWorth.start.totalMarketValueKrw)} → {report.netWorth.end.date} {won(report.netWorth.end.totalMarketValueKrw)}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card report-section">
        <h3 style={{ marginTop: 0 }}>배당</h3>
        {report.dividends.count === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>이 기간에 받은 배당이 없습니다.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: report.kind === 'year' ? '1fr 1fr' : '1fr', gap: 16 }}>
            {report.kind === 'year' && (
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>월</th>
                    <th>세후 배당</th>
                  </tr>
                </thead>
                <tbody>
                  {report.dividends.byMonth.map((m) => (
                    <tr key={m.month}>
                      <td style={{ textAlign: 'left' }}>{m.month}</td>
                      <td>{won(m.krw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>종목(상위 10)</th>
                  <th>세후 배당</th>
                </tr>
              </thead>
              <tbody>
                {report.dividends.topSymbols.map((s) => (
                  <tr key={s.symbol}>
                    <td style={{ textAlign: 'left' }}>
                      {s.name} <span style={{ color: 'var(--text-muted)' }}>{s.symbol}</span>
                    </td>
                    <td>{won(s.krw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.dividends.unconvertedUsd > 0 && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>환율을 몰라 뺀 달러 배당 ${report.dividends.unconvertedUsd.toFixed(2)}</p>
        )}
      </div>

      <div className="card report-section">
        <h3 style={{ marginTop: 0 }}>매매와 실현손익</h3>
        <table>
          <tbody>
            <tr>
              <td style={{ textAlign: 'left' }}>매수</td>
              <td>
                {won(report.trades.buyKrw)} ({report.trades.buyCount}건)
              </td>
            </tr>
            <tr>
              <td style={{ textAlign: 'left' }}>매도</td>
              <td>
                {won(report.trades.sellKrw)} ({report.trades.sellCount}건)
              </td>
            </tr>
            <tr>
              <td style={{ textAlign: 'left' }}>실현손익 — 해외 상장</td>
              <td>{signedWon(report.realized.overseasKrw)}</td>
            </tr>
            <tr>
              <td style={{ textAlign: 'left' }}>실현손익 — 국내 상장</td>
              <td>{signedWon(report.realized.domesticKrw)}</td>
            </tr>
            {report.realized.estimatedOverseasTaxKrw !== null && (
              <tr>
                <td style={{ textAlign: 'left' }}>해외주식 양도소득세 추정(기본공제 250만원 후 22%)</td>
                <td>{won(report.realized.estimatedOverseasTaxKrw)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          실현손익은 매매내역으로 이동평균해 계산한 추정이며 ISA·연금저축·IRP 계좌는 뺐습니다(실현손익 화면과 같은 규칙).
        </p>
      </div>

      <div className="card report-section">
        <h3 style={{ marginTop: 0 }}>보유 상위 10 (작성 시점)</h3>
        {!topHoldings ? (
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        ) : (
          <>
            <p style={{ fontSize: 13, margin: '0 0 8px' }}>
              총 평가금액 {won(topHoldings.total)} · 총 매입금액 {won(topHoldings.cost)} · 평가손익 {signedWon(topHoldings.total - topHoldings.cost)}
            </p>
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>종목</th>
                  <th>평가금액</th>
                  <th>비중</th>
                  <th>손익률</th>
                </tr>
              </thead>
              <tbody>
                {topHoldings.rows.map((r) => (
                  <tr key={r.symbol}>
                    <td style={{ textAlign: 'left' }}>
                      {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.symbol}</span>
                    </td>
                    <td>{won(r.valueKrw)}</td>
                    <td>{topHoldings.total > 0 ? ((r.valueKrw / topHoldings.total) * 100).toFixed(1) : '0'}%</td>
                    <td>{r.costKrw > 0 ? `${(((r.valueKrw - r.costKrw) / r.costKrw) * 100).toFixed(1)}%` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              증권사: {[...new Set(holdings?.lines.map((l) => BROKER_LABELS[l.broker]) ?? [])].join(', ') || '-'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
