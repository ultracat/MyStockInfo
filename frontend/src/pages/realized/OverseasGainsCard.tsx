import { BROKER_LABELS, BROKER_ORDER } from '../../brokers';
import { estimateOverseasCapitalGainsTax, type RealizedSale } from '../../calc/realizedGains';
import { formatKrwValue, recentYears } from '../../format';
import type { AccountLabel, BrokerId } from '../../types';
import { SalesTable } from './SalesTable';

/**
 * 연도·증권사 필터 + 해외주식 양도소득(22% 대상) 카드 — 일반계좌의 해외 상장(통화가 KRW가 아닌) 매도만 합산한다.
 * 필터는 화면 전체(국내 매도·공식 대조·배당소득·세제혜택 매도)가 같이 쓰는 값이라 상태는 RealizedGains.tsx가 든다.
 */
export function OverseasGainsCard({
  year,
  onYearChange,
  thisYear,
  broker,
  onBrokerChange,
  sales,
  showAccount,
  accountLabels,
}: {
  year: number;
  onYearChange: (year: number) => void;
  thisYear: number;
  broker: 'ALL' | BrokerId;
  onBrokerChange: (broker: 'ALL' | BrokerId) => void;
  sales: RealizedSale[];
  showAccount: boolean;
  accountLabels: AccountLabel[];
}) {
  const totalGainKrw = sales.reduce((sum, s) => sum + s.gainKrw, 0);
  const estimatedTaxKrw = estimateOverseasCapitalGainsTax(totalGainKrw);
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>연도</label>
          <select value={year} onChange={(e) => onYearChange(Number(e.target.value))}>
            {recentYears(5, thisYear).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>증권사</label>
          <select value={broker} onChange={(e) => onBrokerChange(e.target.value as 'ALL' | BrokerId)}>
            <option value="ALL">전체</option>
            {BROKER_ORDER.map((id) => (
              <option key={id} value={id}>
                {BROKER_LABELS[id]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3 style={{ marginTop: 0 }}>해외주식 양도소득 (22% 대상)</h3>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">{year}년 해외 상장 종목 실현손익(일반계좌)</div>
          <div className={`value ${totalGainKrw >= 0 ? 'text-good' : 'text-critical'}`}>
            {totalGainKrw >= 0 ? '+' : ''}
            {formatKrwValue(totalGainKrw)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">추정 세액(참고용)</div>
          <div className="value">{formatKrwValue(estimatedTaxKrw)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            기본공제 250만원 적용 후 22% — 참고용 추정치, 일반계좌의 해외 상장 종목만 포함
          </div>
        </div>
      </div>

      {sales.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{year}년에 일반계좌에서 실현된 해외 상장 종목 매도 기록이 없습니다.</p>
      ) : (
        <SalesTable rows={sales} showAccount={showAccount} accountLabels={accountLabels} />
      )}
    </div>
  );
}
