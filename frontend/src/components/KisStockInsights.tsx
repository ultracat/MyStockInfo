import { useEffect, useState } from 'react';
import { api } from '../api';
import type { KisStockDetail, StockNewsItem } from '../types';
import { krw } from '../format';

// 관심종목 상세 아래 — 국내 종목의 한국투자증권 시세 참조 정보(백엔드 routes/kisReports.ts의 /stock-detail).
// ETF면 NAV·괴리율·구성 종목, 주식이면 재무비율·증권사 투자의견, 둘 다 최근 뉴스·공시 제목.
// 한국투자증권 키가 없으면(409) 아무것도 안 그린다. 실패한 칸(null)은 "불러오지 못했습니다"로.

const pct = (v: number | null, digits = 2) => (v === null ? '-' : `${v.toFixed(digits)}%`);
const won = (v: number | null) => (v === null ? '-' : `${krw.format(Math.round(v))}원`);
const muted = { color: 'var(--text-muted)', fontSize: 13 } as const;

function News({ items }: { items: StockNewsItem[] | null }) {
  return (
    <>
      <h4>최근 뉴스·공시 제목</h4>
      {items === null ? (
        <p style={muted}>불러오지 못했습니다.</p>
      ) : items.length === 0 ? (
        <p style={muted}>최근 등록된 뉴스·공시가 없습니다.</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {items.map((n, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <span style={muted}>
                {n.date} {n.time} · {n.source}
              </span>{' '}
              {n.title}
            </li>
          ))}
        </ul>
      )}
      <p style={{ ...muted, fontSize: 12 }}>제목만 제공됩니다(본문은 증권사 앱·HTS에서 확인).</p>
    </>
  );
}

export default function KisStockInsights({ symbol }: { symbol: string }) {
  const [detail, setDetail] = useState<KisStockDetail | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setHidden(false);
    api
      .getKisStockDetail(symbol)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => {
        if (cancelled) return;
        const msg = (e as Error).message;
        if (/API 키가 설정되지|6자리 종목코드만/.test(msg)) setHidden(true);
        else setError(msg);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (hidden) return null;
  return (
    <div
      style={{
        marginTop: 16,
        borderTop: '1px solid var(--border)',
        paddingTop: 12,
      }}
    >
      <h3 style={{ marginTop: 0 }}>종목 정보 (한국투자증권)</h3>
      {error ? (
        <p className="text-critical">{error}</p>
      ) : !detail ? (
        <p style={muted}>불러오는 중...</p>
      ) : detail.kind === 'etf' ? (
        <>
          <div className="summary-row">
            <div className="stat-tile">
              <div className="label">NAV (현재가)</div>
              <div className="value">{won(detail.etf.nav)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>현재가 {won(detail.etf.price)}</div>
            </div>
            <div className="stat-tile">
              <div className="label">괴리율 · 추적오차율</div>
              <div className="value">
                {pct(detail.etf.premiumRate)} · {pct(detail.etf.trackingErrorRate)}
              </div>
            </div>
            <div className="stat-tile">
              <div className="label">순자산</div>
              <div className="value">
                {detail.etf.netAssetsEok === null ? '-' : `${krw.format(detail.etf.netAssetsEok)}억원`}
              </div>
            </div>
          </div>
          <p style={muted}>
            {[
              detail.etf.benchmark && `기초지수 ${detail.etf.benchmark}`,
              detail.etf.manager && `운용사 ${detail.etf.manager}`,
              detail.etf.dividendCycle && `분배 주기 ${detail.etf.dividendCycle}`,
              detail.etf.componentCount !== null && `구성 종목 ${detail.etf.componentCount}개`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <h4>구성 종목 (비중 상위)</h4>
          {detail.etf.components === null ? (
            <p style={muted}>불러오지 못했습니다.</p>
          ) : detail.etf.components.length === 0 ? (
            <p style={muted}>구성 종목 정보가 없습니다(해외 자산 위주 ETF는 비어 있을 수 있습니다).</p>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th>비중</th>
                      <th>등락률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.etf.components.map((c) => (
                      <tr key={c.symbol || c.name}>
                        <td style={{ textAlign: 'left' }}>
                          <span className="cell-name-truncate">
                            {c.name} <span style={{ color: 'var(--text-muted)' }}>{c.symbol}</span>
                          </span>
                        </td>
                        <td>{pct(c.weight)}</td>
                        <td
                          className={
                            c.changeRate === null ? undefined : c.changeRate >= 0 ? 'text-good' : 'text-critical'
                          }
                        >
                          {pct(c.changeRate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={muted}>
                한국투자증권은 상위 {detail.etf.components.length}개 종목만 줍니다(합계 비중{' '}
                {pct(
                  detail.etf.components.reduce((s, c) => s + (c.weight ?? 0), 0),
                  1,
                )}
                ).
              </p>
            </>
          )}
          <News items={detail.news} />
        </>
      ) : (
        <>
          <h4>재무비율 (연간)</h4>
          {detail.financials === null ? (
            <p style={muted}>불러오지 못했습니다.</p>
          ) : detail.financials.length === 0 ? (
            <p style={muted}>재무 정보가 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>결산</th>
                    <th>매출 증가율</th>
                    <th>영업이익 증가율</th>
                    <th>순이익 증가율</th>
                    <th>ROE</th>
                    <th>EPS</th>
                    <th>BPS</th>
                    <th>부채비율</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.financials.map((f) => (
                    <tr key={f.period}>
                      <td>{f.period}</td>
                      <td>{pct(f.revenueGrowth)}</td>
                      <td>{pct(f.operatingIncomeGrowth)}</td>
                      <td>{pct(f.netIncomeGrowth)}</td>
                      <td>{pct(f.roe)}</td>
                      <td>{won(f.eps)}</td>
                      <td>{won(f.bps)}</td>
                      <td>{pct(f.debtRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ ...muted, fontSize: 12 }}>
            증가율은 직전 결산 대비입니다. 가장 최근 줄은 결산 전 누적(분기까지) 값일 수 있습니다.
          </p>
          <h4>증권사 투자의견 (최근 6개월)</h4>
          {detail.opinions === null ? (
            <p style={muted}>불러오지 못했습니다.</p>
          ) : detail.opinions.length === 0 ? (
            <p style={muted}>최근 6개월 투자의견이 없습니다.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>날짜</th>
                    <th>증권사</th>
                    <th style={{ textAlign: 'left' }}>의견</th>
                    <th>목표가</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.opinions.map((o, i) => (
                    <tr key={`${o.date}:${o.firm}:${i}`}>
                      <td>{o.date}</td>
                      <td>{o.firm}</td>
                      <td style={{ textAlign: 'left' }}>
                        {o.opinion}
                        {o.previousOpinion && o.previousOpinion !== o.opinion && (
                          <span style={muted}> (이전 {o.previousOpinion})</span>
                        )}
                      </td>
                      <td>{won(o.targetPrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ ...muted, fontSize: 12 }}>증권사 리포트 의견을 그대로 옮긴 것이며 투자 권유가 아닙니다.</p>
          <News items={detail.news} />
        </>
      )}
    </div>
  );
}
