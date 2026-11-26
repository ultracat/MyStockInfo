import { BROKER_LABELS } from '../../brokers';
import { FINANCIAL_INCOME_THRESHOLD_KRW, type DividendIncomeSummary } from '../../calc/realizedGains';
import Hint from '../../components/Hint';
import { formatKrwValue } from '../../format';

/**
 * 배당소득 카드 — 고른 연도·증권사의 일반계좌 배당 합계(달러는 지급월 평균 환율)와 금융소득종합과세 기준(연 2,000만원) 대비 비율,
 * 증권사별 표. 합계는 calc/realizedGains.ts의 `dividendIncomeSummary`(RealizedGains.tsx가 계산해 넘긴다).
 */
export function DividendIncomeCard({ year, summary }: { year: number; summary: DividendIncomeSummary }) {
  const dividendRatio = summary.grossKrw / FINANCIAL_INCOME_THRESHOLD_KRW;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>배당소득</h3>
      <Hint>
        배당금은 매매차익과 다른 소득(배당소득)이라 위 양도소득세에 합산되지 않고, 지급될 때
        원천징수(국내 15.4%, 미국 주식은 현지 15%)로 끝납니다. 다만 이자·배당소득이 연{' '}
        {formatKrwValue(FINANCIAL_INCOME_THRESHOLD_KRW)}을 넘으면 초과분이 금융소득종합과세 대상이
        됩니다. 배당금 화면에 입력한 금액 기준이며(세전 금액으로 입력해야 기준과 정확히 비교됨),
        달러 배당은 지급월 평균 환율로 환산합니다. ISA/연금저축/IRP 계좌 배당과, 위 "국내 상장
        종목 매도"의 해외·기타 ETF 매매차익(배당소득으로 과세)은 포함하지 않습니다.
      </Hint>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">{year}년 배당소득 합계(일반계좌, 원화 환산)</div>
          <div className="value">{formatKrwValue(summary.convertedKrw)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {summary.count}건 · 원화 {formatKrwValue(summary.krwTotal)} · 달러 $
            {summary.usdTotal.toFixed(2)}
            {summary.unconvertedCount > 0 && ` · 환율 미적용 ${summary.unconvertedCount}건 제외`}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">금융소득종합과세 기준 대비</div>
          <div className={`value ${dividendRatio >= 1 ? 'text-critical' : ''}`}>
            {(dividendRatio * 100).toFixed(1)}%
          </div>
          <div
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(dividendRatio, 1) * 100)}
            aria-label="금융소득종합과세 기준 대비 배당소득"
            style={{ height: 6, borderRadius: 3, background: 'var(--gridline)', marginTop: 8, overflow: 'hidden' }}
          >
            <div
              style={{
                width: `${Math.min(dividendRatio, 1) * 100}%`,
                height: '100%',
                background: dividendRatio >= 1 ? 'var(--critical)' : 'var(--series-1)',
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {dividendRatio >= 1
              ? `기준 초과 ${formatKrwValue(summary.convertedKrw - FINANCIAL_INCOME_THRESHOLD_KRW)} — 종합과세 대상`
              : `기준까지 ${formatKrwValue(FINANCIAL_INCOME_THRESHOLD_KRW - summary.convertedKrw)} 남음 (이자소득 별도)`}
          </div>
        </div>
      </div>
      {summary.brokerRows.length > 0 ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>증권사</th>
                <th>건수</th>
                <th>원화</th>
                <th>달러</th>
                <th>합계(환산)</th>
              </tr>
            </thead>
            <tbody>
              {summary.brokerRows.map((r) => (
                <tr key={r.broker}>
                  <td>{BROKER_LABELS[r.broker]}</td>
                  <td>{r.count}</td>
                  <td>{formatKrwValue(r.krw)}</td>
                  <td>${r.usd.toFixed(2)}</td>
                  <td>{formatKrwValue(r.totalKrw)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>{year}년 일반계좌 배당 기록이 없습니다.</p>
      )}
    </div>
  );
}
