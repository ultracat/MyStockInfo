import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import CollapseToggle from '../../components/CollapseToggle';
import { fxEffect, lookThrough } from '../../calc/insights';
import type { FlatHolding } from '../../calc/overview';
import { krw, formatSignedKrw } from '../../format';
import type { StoredTrade } from '../../types';
import Hint from '../../components/Hint';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
// 부호 있는 원화는 앱 전체가 format.ts 하나로(2026-11-17 UI 점검 — 파일마다 기호가 달랐다)
const signedWon = formatSignedKrw;
const signClass = (v: number) => (v > 0 ? 'text-good' : v < 0 ? 'text-critical' : undefined);

/**
 * 달러 자산 손익 분해 — 원화 손익을 "주가 효과"(달러로 번 것)와 "환율 효과"(원금을 달러로 들고 있어서)로 나눈다(calc/insights.ts fxEffect).
 * 매입 환율은 매매내역의 매수 달 평균 환율로 이동평균 — 매매내역으로 지금 수량이 재구성되지 않는 종목은 뺀다.
 */
export function FxEffectCard({ holdings, trades, currentFx }: { holdings: FlatHolding[]; trades: StoredTrade[]; currentFx: number | null }) {
  const [collapsed, setCollapsed] = useState(true);
  const [rates, setRates] = useState<Record<string, { rate: number } | null>>({});
  const months = useMemo(() => [...new Set(trades.filter((t) => t.currency === 'USD' && t.side === 'BUY').map((t) => t.executedAt.slice(0, 7)))].sort(), [trades]);
  const monthsKey = months.join(',');
  useEffect(() => {
    if (collapsed || months.length === 0) return;
    let alive = true;
    api
      .getMonthlyAvgUsdKrwRates(months)
      .then((r) => alive && setRates(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, monthsKey]); // 배열 참조가 아니라 내용으로 — 다시 조회돼 새 배열이 와도 같은 달이면 다시 부르지 않는다
  const hasUsd = holdings.some((h) => h.currency === 'USD' && h.quantity > 0);
  const result = useMemo(
    () => fxEffect(holdings, trades, (m) => rates[m]?.rate ?? null, currentFx),
    [holdings, trades, rates, currentFx]
  );
  if (!hasUsd) return null;
  const sum = (k: 'priceEffectKrw' | 'fxEffectKrw' | 'totalKrw') => result.rows.reduce((s, r) => s + r[k], 0);
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>달러 자산 손익: 주가 효과 · 환율 효과</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && (
        <>
          <Hint>
            미국 주식의 원화 손익을 <b>주가 효과</b>(지금가 − 평단가, 지금 환율로 환산)와 <b>환율 효과</b>(달러 원금 × (지금 환율 − 매입 환율))로 나눕니다.
            매입 환율은 매매내역의 매수 달 평균 환율(한국수출입은행)로 이동평균한 값이라, 매매내역이 다 없는 종목은 뺍니다.
          </Hint>
          {!currentFx ? (
            <p style={{ color: 'var(--text-muted)' }}>지금 환율을 몰라 계산할 수 없습니다.</p>
          ) : result.rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>매입 환율을 알 수 있는 미국 종목이 없습니다(매매내역·월평균 환율 필요).</p>
          ) : (
            <>
              <div className="summary-row">
                <div className="stat-tile">
                  <div className="label">주가 효과</div>
                  <div className={`value ${signClass(sum('priceEffectKrw')) ?? ''}`}>{signedWon(sum('priceEffectKrw'))}</div>
                </div>
                <div className="stat-tile">
                  <div className="label">환율 효과</div>
                  <div className={`value ${signClass(sum('fxEffectKrw')) ?? ''}`}>{signedWon(sum('fxEffectKrw'))}</div>
                </div>
                <div className="stat-tile">
                  <div className="label">합계(원화 손익)</div>
                  <div className={`value ${signClass(sum('totalKrw')) ?? ''}`}>{signedWon(sum('totalKrw'))}</div>
                </div>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>종목</th>
                      <th>매입 환율</th>
                      <th>주가 효과</th>
                      <th>환율 효과</th>
                      <th>합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.symbol}>
                        <td style={{ textAlign: 'left' }}>
                          <span className="upcoming-cell-truncate" title={`${r.name} ${r.symbol}`}>
                            {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.symbol}</span>
                          </span>
                        </td>
                        <td>{krw.format(Math.round(r.purchaseFx))}원</td>
                        <td className={signClass(r.priceEffectKrw)}>{signedWon(r.priceEffectKrw)}</td>
                        <td className={signClass(r.fxEffectKrw)}>{signedWon(r.fxEffectKrw)}</td>
                        <td className={signClass(r.totalKrw)}>{signedWon(r.totalKrw)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>지금 환율 {krw.format(Math.round(currentFx))}원 기준.</p>
            </>
          )}
          {result.unknown.length > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>매입 환율을 몰라 뺀 종목: {result.unknown.join(', ')}</p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ETF 포함 실질 보유 비중 — 보유 국내 ETF를 구성 종목(한국투자증권, 상위 30)으로 펼쳐 같은 종목의 직접 보유와 합친다(calc/insights.ts lookThrough).
 * "삼성전자를 직접 5% + ETF로 7% = 실제로 12%"처럼 겹침을 보여 준다. 펼쳤을 때만 조회한다(ETF마다 API 호출).
 */
export function LookThroughCard({ holdings, toKrw }: { holdings: FlatHolding[]; toKrw: (amount: number, currency: string | null) => number | null }) {
  const [collapsed, setCollapsed] = useState(true);
  const [etfs, setEtfs] = useState<Record<string, Array<{ symbol: string; name: string; weight: number }>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const domestic = useMemo(() => [...new Set(holdings.filter((h) => h.currency === 'KRW' && /^[0-9A-Z]{6}$/.test(h.symbol)).map((h) => h.symbol))].sort(), [holdings]);
  const domesticKey = domestic.join(',');
  useEffect(() => {
    if (collapsed || domestic.length === 0) return;
    let alive = true;
    // 백엔드가 한 번에 60종목까지만 받으므로 나눠 부른다(넘으면 뒤쪽 ETF가 말없이 빠졌다)
    const chunks: string[][] = [];
    for (let i = 0; i < domestic.length; i += 60) chunks.push(domestic.slice(i, i + 60));
    Promise.all(chunks.map((c) => api.getEtfLookThrough(c)))
      .then((rs) => alive && (setEtfs(Object.assign({}, ...rs.map((r) => r.etfs))), setError(null)))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, domesticKey]);
  const result = useMemo(() => {
    if (!etfs) return null;
    const rows: Array<{ symbol: string; name: string; valueKrw: number }> = [];
    for (const h of holdings) {
      const v = toKrw(h.quantity * h.lastPrice, h.currency);
      if (v !== null && v > 0) rows.push({ symbol: h.symbol, name: h.name, valueKrw: v });
    }
    return lookThrough(rows, etfs);
  }, [etfs, holdings, toKrw]);
  const etfCount = etfs ? Object.keys(etfs).length : 0;
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>ETF 포함 실질 보유 비중</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && (
        <>
          <Hint>
            보유한 국내 ETF를 구성 종목(한국투자증권, 비중 상위 30개)으로 펼쳐 직접 보유한 같은 종목과 합칩니다. 여러 ETF에 겹쳐 담긴 종목이 실제로 얼마인지
            보여 줍니다. 상위 30개 밖·현금 등은 "ETF 기타"로 따로 셉니다. 미국 ETF는 구성 정보를 받지 못해 그대로 한 종목으로 봅니다.
          </Hint>
          {error ? (
            <p className="text-critical">{error.includes('설정되지') ? '한국투자증권 API 키가 있어야 ETF 구성을 받을 수 있습니다.' : error}</p>
          ) : !result ? (
            <p style={{ color: 'var(--text-muted)' }}>{domestic.length ? '불러오는 중...' : '국내 종목이 없습니다.'}</p>
          ) : etfCount === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>구성 종목을 받은 국내 ETF가 없습니다.</p>
          ) : (
            <>
              <p style={{ fontSize: 13 }}>
                펼친 ETF {etfCount}개 · ETF 기타 {won(result.etfOtherKrw)} ({result.totalKrw > 0 ? ((result.etfOtherKrw / result.totalKrw) * 100).toFixed(1) : '0'}%)
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>종목</th>
                      <th>직접 보유</th>
                      <th>ETF를 통해</th>
                      <th>합계</th>
                      <th>비중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.slice(0, 20).map((r) => (
                      <tr key={r.symbol}>
                        <td style={{ textAlign: 'left' }}>
                          <span className="upcoming-cell-truncate" title={`${r.name} ${r.symbol}${r.etfs.length ? ` — ETF ${r.etfs.join(', ')}` : ''}`}>
                            {r.name} <span style={{ color: 'var(--text-muted)' }}>{r.symbol}</span>
                          </span>
                        </td>
                        <td>{r.directKrw ? won(r.directKrw) : '-'}</td>
                        <td>{r.viaEtfKrw ? `${won(r.viaEtfKrw)} (${r.etfs.length}개)` : '-'}</td>
                        <td>{won(r.totalKrw)}</td>
                        <td>{r.pct.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.rows.length > 20 && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>상위 20개만 보여 줍니다(전체 {result.rows.length}개).</p>}
            </>
          )}
        </>
      )}
    </div>
  );
}
