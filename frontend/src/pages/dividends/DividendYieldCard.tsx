import { useEffect, useMemo, useState } from 'react';
import { loadAllHoldings, type HoldingLine } from '../../allHoldings';
import CollapseToggle from '../../components/CollapseToggle';
import { dividendYields } from '../../calc/insights';
import { krw, localToday } from '../../format';
import type { DividendRecord } from '../../types';
import Hint from '../../components/Hint';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const pct = (v: number | null) => (v === null ? '-' : `${v.toFixed(2)}%`);

/**
 * 종목별 배당수익률 — 최근 12개월 받은 배당(세전)을 매입금액(YOC — 내 원가 기준)과 평가금액(지금 시가 기준)으로 나누고, 그 전 12개월과 비교한
 * 증가율을 보여 준다(calc/insights.ts dividendYields). 모든 증권사·계좌 합산, 지금 보유 중인 종목만. 펼쳤을 때만 보유를 불러온다.
 */
export function DividendYieldCard({ records, rateFor }: { records: DividendRecord[]; rateFor: (month: string) => number | null }) {
  const [collapsed, setCollapsed] = useState(true);
  const [holdings, setHoldings] = useState<{ lines: HoldingLine[]; fxRate: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (collapsed || holdings) return;
    let alive = true;
    loadAllHoldings()
      .then((h) => alive && setHoldings(h))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [collapsed, holdings]);
  const rows = useMemo(() => {
    if (!holdings) return null;
    const conv = (v: number, currency: string | null) => (currency === 'USD' ? (holdings.fxRate ? v * holdings.fxRate : null) : v);
    const input = holdings.lines
      .map((h) => ({ symbol: h.symbol, name: h.name, costKrw: conv(h.purchaseAmount, h.currency), valueKrw: conv(h.marketValue, h.currency) }))
      .filter((h): h is { symbol: string; name: string; costKrw: number; valueKrw: number } => h.costKrw !== null && h.valueKrw !== null);
    return dividendYields(input, records, rateFor, localToday());
  }, [holdings, records, rateFor]);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>종목별 배당수익률</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && (
        <>
          <Hint>
            최근 12개월 받은 배당(세전)을 <b>매입금액</b>으로 나눈 값이 YOC(내 원가 기준 수익률), <b>평가금액</b>으로 나눈 값이 지금 시가 기준 수익률입니다.
            증가율은 그 전 12개월 대비입니다(그 사이 수량을 늘렸다면 같이 커집니다). 모든 계좌를 합친 지금 보유 종목만, 달러 배당은 지급 달 평균 환율로 셉니다.
          </Hint>
          {error ? (
            <p className="text-critical">{error}</p>
          ) : !rows ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>최근 2년 안에 배당을 받은 보유 종목이 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>종목</th>
                    <th>최근 12개월 배당</th>
                    <th>YOC(매입 기준)</th>
                    <th>시가 기준</th>
                    <th>전년 대비</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.symbol}>
                      <td style={{ textAlign: 'left' }}>
                        <span className="upcoming-cell-truncate" title={`${r.name} ${r.symbol}`}>
                          {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.symbol}</span>
                        </span>
                      </td>
                      <td>{won(r.trailingKrw)}</td>
                      <td>{pct(r.yoc)}</td>
                      <td>{pct(r.currentYield)}</td>
                      <td className={r.growth === null ? undefined : r.growth >= 0 ? 'text-good' : 'text-critical'}>
                        {r.growth === null ? '-' : `${r.growth >= 0 ? '+' : ''}${r.growth.toFixed(1)}%`}
                      </td>
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
