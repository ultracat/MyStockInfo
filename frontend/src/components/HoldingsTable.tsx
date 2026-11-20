import type { HoldingPosition } from '../types';
import { formatMoneyIn as formatMoney, qtyFmt } from '../format';
import StockNameLink from './StockNameLink';
import WarningBadges from './WarningBadges';
import type { ActiveWarning } from '../types';
import { useMemo, useState } from 'react';
import { sortHoldingRows, type HoldingSortKey } from '../calc/portfolio';
import SortButton from './SortButton';

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
  /** 종목명을 눌렀을 때 열 외부 링크(stockLinks.ts의 resolveStockLink) — 없으면 텍스트. */
  externalUrl?: string;
  /** 이 계좌의 이 종목에서 지금까지 받은 배당금 합계(포지션 통화 기준) — 다른 계좌의
   *  같은 종목 배당은 포함하지 않는다(Dashboard.tsx의 dividendFor). null이면 배당
   *  통화가 포지션 통화와 달라 환산이 필요한데 환율이 없는 경우. */
  dividendAmount: number | null;
  /** 토스 매수 유의사항(정리매매·투자경고·VI 등) — 활성인 것만, 없으면 undefined. */
  warnings?: ActiveWarning[];
}

/** `fxRate`는 정렬에만 쓴다 — 원화·달러 종목을 원화로 환산해 한 순서로 비교한다(calc/portfolio.ts의 sortHoldingRows). */
export default function HoldingsTable({ rows, fxRate }: { rows: Row[]; fxRate: number | null }) {
  const showAccount = rows.some((r) => r.accountLabel);
  // 종목별 수익 화면과 같은 방식 — 기본은 평가금액 큰 순서.
  const [sortKey, setSortKey] = useState<HoldingSortKey>('market');
  const [sortAsc, setSortAsc] = useState(false);
  const sortedRows = useMemo(() => sortHoldingRows(rows, sortKey, sortAsc, fxRate), [rows, sortKey, sortAsc, fxRate]);
  const sortButton = (key: HoldingSortKey, label: string) => (
    <SortButton
      sortKey={key}
      label={label}
      current={sortKey}
      asc={sortAsc}
      onChange={(k, asc) => {
        setSortKey(k);
        setSortAsc(asc);
      }}
    />
  );
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {showAccount && <th>계좌</th>}
            <th>{sortButton('symbol', '종목')}</th>
            <th>시장</th>
            <th>수량</th>
            <th title="위: 매입평균가, 아래: 현재가">평균가 · 현재가</th>
            <th>{sortButton('purchase', '매입금액')}</th>
            <th>{sortButton('market', '평가금액')}</th>
            <th title="위: 손익금액, 아래: 손익률">{sortButton('profit', '손익')}</th>
            <th title="평가손익 + 이 계좌에서 이 종목으로 받은 배당금(배당금 화면에 기록한 내역)">{sortButton('profitWithDividend', '배당 포함 손익')}</th>
            <th>비중</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r, idx) => (
            <tr key={`${r.accountId ?? ''}:${r.symbol}:${r.memo ?? ''}:${idx}`}>
              {showAccount && <td>{r.accountLabel ?? '-'}</td>}
              <td>
                <StockNameLink name={r.name} url={r.externalUrl} />{' '}
                <span style={{ color: 'var(--text-muted)' }}>({r.symbol})</span>
                {r.memo && <span style={{ color: 'var(--text-muted)' }}> · {r.memo}</span>}
                <WarningBadges warnings={r.warnings} />
              </td>
              <td>{r.market ?? '-'}</td>
              <td>{qtyFmt.format(r.quantity)}</td>
              <td>
                {formatMoney(r.averagePurchasePrice, r.currency)}
                <span className="cell-sub">{formatMoney(r.lastPrice, r.currency)}</span>
              </td>
              <td>{formatMoney(r.purchaseAmount, r.currency)}</td>
              <td>{formatMoney(r.marketValue, r.currency)}</td>
              <td className={r.profitLossAmount >= 0 ? 'text-good' : 'text-critical'}>
                {r.profitLossAmount >= 0 ? '+' : ''}
                {formatMoney(r.profitLossAmount, r.currency)}
                <span className="cell-sub">{formatRate(r.profitLossRate)}</span>
              </td>
              {r.dividendAmount === null ? (
                <td style={{ color: 'var(--text-muted)' }}>환율 미적용</td>
              ) : (
                (() => {
                  const total = r.profitLossAmount + r.dividendAmount;
                  return (
                    <td
                      className={total >= 0 ? 'text-good' : 'text-critical'}
                      title={`평가손익 ${formatMoney(r.profitLossAmount, r.currency)} + 배당금 ${formatMoney(r.dividendAmount, r.currency)}`}
                    >
                      {total >= 0 ? '+' : ''}
                      {formatMoney(total, r.currency)}
                    </td>
                  );
                })()
              )}
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
    </div>
  );
}
