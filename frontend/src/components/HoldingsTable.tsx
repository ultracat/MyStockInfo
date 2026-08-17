import type { HoldingPosition } from '../types';
import { krw2dp } from '../format';

function formatMoney(value: number, currency: string | null) {
  const formatted = krw2dp.format(value);
  return currency && currency !== 'KRW' ? `${formatted} ${currency}` : `${formatted}원`;
}

function formatRate(rate: number) {
  const pct = (rate * 100).toFixed(2);
  return `${rate >= 0 ? '+' : ''}${pct}%`;
}

interface Row extends HoldingPosition {
  /** null when it can't be blended into a common-currency weight (see Dashboard). */
  weight: number | null;
  /** Dashboard.tsx의 "전체 계좌" 모드에서만 채워진다 — 계좌 라벨(또는 계좌번호)
   *  표시용 텍스트. 채워진 행이 하나라도 있으면 "계좌" 열을 보여준다. */
  accountLabel?: string;
}

export default function HoldingsTable({ rows }: { rows: Row[] }) {
  const showAccount = rows.some((r) => r.accountLabel);
  return (
    <table>
      <thead>
        <tr>
          {showAccount && <th>계좌</th>}
          <th>종목</th>
          <th>시장</th>
          <th>수량</th>
          <th>매입평균가</th>
          <th>현재가</th>
          <th>매입금액</th>
          <th>평가금액</th>
          <th>손익금액</th>
          <th>손익률</th>
          <th>비중</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, idx) => (
          <tr key={`${r.accountId ?? ''}:${r.symbol}:${r.memo ?? ''}:${idx}`}>
            {showAccount && <td>{r.accountLabel ?? '-'}</td>}
            <td>
              {r.name} <span style={{ color: 'var(--text-muted)' }}>({r.symbol})</span>
              {r.memo && <span style={{ color: 'var(--text-muted)' }}> · {r.memo}</span>}
            </td>
            <td>{r.market ?? '-'}</td>
            <td>{r.quantity}</td>
            <td>{formatMoney(r.averagePurchasePrice, r.currency)}</td>
            <td>{formatMoney(r.lastPrice, r.currency)}</td>
            <td>{formatMoney(r.purchaseAmount, r.currency)}</td>
            <td>{formatMoney(r.marketValue, r.currency)}</td>
            <td className={r.profitLossAmount >= 0 ? 'text-good' : 'text-critical'}>
              {r.profitLossAmount >= 0 ? '+' : ''}
              {formatMoney(r.profitLossAmount, r.currency)}
            </td>
            <td className={r.profitLossRate >= 0 ? 'text-good' : 'text-critical'}>
              {formatRate(r.profitLossRate)}
            </td>
            <td style={{ minWidth: 90 }}>
              {r.weight === null ? (
                <span style={{ color: 'var(--text-muted)' }}>-</span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="weight-bar-track" style={{ width: 48 }}>
                    <div className="weight-bar-fill" style={{ width: `${Math.min(r.weight * 100, 100)}%` }} />
                  </div>
                  <span>{(r.weight * 100).toFixed(1)}%</span>
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
