import { qtyFmt, usdFmt } from '../../format';
import DividendBars from './DividendBars';
import type { myTradeSummary, monthlyReturnGrid } from '../../calc/watchDetail';
import type { OverseasStockDetail, SymbolDividends } from '../../types';
import type { Load } from './useWatchData';
import { pct, price, rateClass, usdCap } from './watchUi';

// 관심종목 상세의 표시 전용 칸들(월별 등락률·배당·내 매매·미국 종목 정보) — 2026-11-26 WatchDetail.tsx에서 옮겼다(동작 그대로).

/** 월별 등락률 표 — 그 달 마지막 종가 ÷ 전달 마지막 종가. */
export function MonthlyReturnGrid({ grid }: { grid: ReturnType<typeof monthlyReturnGrid> }) {
  return (
    <>
      <h4 style={{ margin: '20px 0 8px' }}>월별 등락률</h4>
      <div className="table-scroll">
        <table style={{ fontSize: 12, textAlign: 'center' }}>
          <thead>
            <tr>
              <th />
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} style={{ textAlign: 'center' }}>
                  {i + 1}월
                </th>
              ))}
              <th style={{ textAlign: 'center' }}>합계</th>
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.year}>
                <th style={{ textAlign: 'left' }}>{row.year}</th>
                {[...row.months, row.total].map((v, i) => (
                  <td
                    key={i}
                    style={{
                      background: v == null ? undefined : `color-mix(in srgb, var(${v >= 0 ? '--good' : '--critical'}) ${Math.round(Math.min(1, Math.abs(v) / 0.15) * 35)}%, transparent)`,
                      fontWeight: i === 12 ? 600 : undefined,
                    }}
                  >
                    {v == null ? '' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
        % · 그 달 마지막 종가 ÷ 전달 마지막 종가(배당 제외, 실제 거래 가격) · 색이 진할수록 크게 움직인 달 · 합계는 그해 받은 달들을 이어 곱한 값
      </p>
    </>
  );
}

/** 배당 — 막대(지난·다음), 지난 배당 8건, 다음 배당(발표·추정) 6건. */
export function WatchDividendsSection({ divRes, currency }: { divRes: Load<SymbolDividends>; currency: string | null }) {
  return (
    <>
      <h4 style={{ margin: '20px 0 8px' }}>배당</h4>
      {divRes.state === 'loading' ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
      ) : divRes.state === 'error' ? (
        <p style={{ color: 'var(--text-muted)' }}>{divRes.message}</p>
      ) : divRes.value.history.length === 0 && divRes.value.upcoming.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>최근 1년여 동안 배당 기록이 없습니다.</p>
      ) : (
        <>
          <DividendBars history={divRes.value.history} upcoming={divRes.value.upcoming} fmt={(v) => price(v, currency)} />
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>지난 배당 (기준일 · 주당 세전)</div>
              <div className="table-scroll">
                <table className="num2">
                  <tbody>
                    {[...divRes.value.history].reverse().slice(0, 8).map((e) => (
                      <tr key={e.recordDate}>
                        <td>{e.recordDate}</td>
                        <td>{e.perShare > 0 ? price(e.perShare, currency) : '금액 미정'}</td>
                        <td style={{ color: 'var(--text-muted)' }}>{e.payDate ? `지급 ${e.payDate}` : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ flex: '1 1 260px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>다음 배당 (발표·추정, 지급일 · 주당 세전)</div>
              {divRes.value.upcoming.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>예정이나 추정할 수 있는 배당이 없습니다.</p>
              ) : (
                <div className="table-scroll">
                  <table className="num2">
                    <tbody>
                      {divRes.value.upcoming.slice(0, 6).map((e) => (
                        <tr key={e.recordDate}>
                          <td>{e.payDate ?? e.recordDate}</td>
                          <td>{price(e.perShare, currency)}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{e.status === 'estimated' ? '발표' : '추정'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** 내 매매 기록 — 매수·매도 합, 마지막 매도 뒤 수익률, 최근 5건. */
export function WatchTradesSection({
  loading,
  mine,
  currency,
}: {
  loading: boolean;
  mine: ReturnType<typeof myTradeSummary>;
  currency: string | null;
}) {
  return (
    <>
      <h4 style={{ margin: '20px 0 8px' }}>내 매매 기록</h4>
      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
      ) : mine.marks.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>매매내역에 이 종목 기록이 없습니다.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, margin: '0 0 6px' }}>
            매수 {qtyFmt.format(mine.buyQty)}주{mine.avgBuyPrice !== null && ` (평균 ${price(mine.avgBuyPrice, currency)})`} · 매도 {qtyFmt.format(mine.sellQty)}주
            {mine.lastSell && (
              <>
                {' '}
                · 마지막 매도 {mine.lastSell.date} {price(mine.lastSell.price, currency)}
                {mine.lastSell.rateSince !== null && (
                  <>
                    {' '}
                    → 판 뒤 <b className={rateClass(mine.lastSell.rateSince)}>{pct(mine.lastSell.rateSince)}</b>
                  </>
                )}
              </>
            )}
          </p>
          <div className="table-scroll">
            <table>
              <tbody>
                {[...mine.marks].reverse().slice(0, 5).map((m, i) => (
                  <tr key={i}>
                    <td>{m.date}</td>
                    <td>{m.side === 'BUY' ? '매수' : '매도'}</td>
                    <td>{qtyFmt.format(m.quantity)}주</td>
                    <td>{price(m.price, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** 미국 종목 정보(한국투자증권) — PER·PBR·EPS·BPS·시가총액·52주. */
export function OverseasInfoSection({ overseasRes }: { overseasRes: Load<OverseasStockDetail> }) {
  return (
    <>
      <h4 style={{ margin: '20px 0 8px' }}>종목 정보 (한국투자증권)</h4>
      {overseasRes.state === 'loading' ? (
        <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
      ) : overseasRes.state === 'error' ? (
        <p style={{ color: 'var(--text-muted)' }}>{overseasRes.message}</p>
      ) : (
        <div className="summary-row">
          {(
            [
              ['PER', overseasRes.value.per?.toFixed(2)],
              ['PBR', overseasRes.value.pbr?.toFixed(2)],
              ['EPS', overseasRes.value.eps != null ? usdFmt.format(overseasRes.value.eps) : null],
              ['BPS', overseasRes.value.bps != null ? usdFmt.format(overseasRes.value.bps) : null],
              ['시가총액', overseasRes.value.marketCap ? usdCap(overseasRes.value.marketCap) : null],
              ['52주 최고 · 최저', overseasRes.value.high52 != null && overseasRes.value.low52 != null ? `${usdFmt.format(overseasRes.value.high52)} · ${usdFmt.format(overseasRes.value.low52)}` : null],
            ] as const
          ).map(([label, v]) => (
            <div className="stat-tile" key={label}>
              <div className="label">{label}</div>
              <div className="value" style={{ fontSize: 15 }}>
                {v ?? '-'}
              </div>
            </div>
          ))}
        </div>
      )}
      {overseasRes.state === 'ok' && (overseasRes.value.sector || overseasRes.value.etpType) && (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
          업종 {overseasRes.value.sector ?? overseasRes.value.etpType} · 52주 최고·최저는 한국투자증권 값이라 위 요약(일봉 실제 가격)과 다를 수 있습니다
        </p>
      )}
    </>
  );
}
