import { useMemo, useState } from 'react';
import { findAccountLabel } from '../../accountLabels';
import { BROKER_LABELS } from '../../brokers';
import { realizedTotals, sortRealizedSales, type RealizedSale, type RealizedSortKey } from '../../calc/realizedGains';
import AccountCell from '../../components/AccountCell';
import SortButton, { ariaSort } from '../../components/SortButton';
import StockCell from '../../components/StockCell';
import { formatKrwValue, formatRatePct, qtyFmt } from '../../format';
import type { AccountLabel } from '../../types';

/**
 * 실현손익 화면의 매도 내역 표(해외·국내·세제혜택 세 곳 공용, 2026-11-20 RealizedGains.tsx에서 뺐다).
 * 매도금액 아래 작은 글씨로 취득금액, 손익 아래 손익률(7열 → 6열). 일자·종목·매도금액·손익·손익률로 정렬, 맨 아래 합계 줄.
 * 증권사·계좌 칸은 "전체" 증권사일 때만(`showAccount`).
 */
export function SalesTable({ rows, showAccount, accountLabels }: { rows: RealizedSale[]; showAccount: boolean; accountLabels: AccountLabel[] }) {
  const [sortKey, setSortKey] = useState<RealizedSortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);
  const sorted = useMemo(() => sortRealizedSales(rows, sortKey, sortAsc), [rows, sortKey, sortAsc]);
  const totals = useMemo(() => realizedTotals(rows), [rows]);
  const btn = (key: RealizedSortKey, label: string, opts?: { text?: boolean; small?: boolean }) => (
    <SortButton
      sortKey={key}
      label={label}
      current={sortKey}
      asc={sortAsc}
      onChange={(k, asc) => {
        setSortKey(k);
        setSortAsc(asc);
      }}
      {...opts}
    />
  );
  const tone = (v: number) => (v >= 0 ? 'text-good' : 'text-critical');
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${formatKrwValue(v)}`;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th aria-sort={ariaSort(sortKey, sortAsc, 'date')}>{btn('date', '일자')}</th>
            {showAccount && <th>계좌</th>}
            <th className="text" aria-sort={ariaSort(sortKey, sortAsc, 'name')}>{btn('name', '종목', { text: true })}</th>
            <th>수량</th>
            <th aria-sort={ariaSort(sortKey, sortAsc, 'proceeds')}>
              {btn('proceeds', '매도금액')}
              <span className="cell-sub">취득금액</span>
            </th>
            <th aria-sort={ariaSort(sortKey, sortAsc, 'gain', 'gainRate')}>
              {btn('gain', '손익')}
              {btn('gainRate', '손익률', { small: true })}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s, idx) => (
            <tr key={`${s.broker}:${s.accountId}:${s.symbol}:${s.date}:${idx}`}>
              <td>{s.date}</td>
              {showAccount && (
                <td>
                  <AccountCell accountId={s.accountId} entry={findAccountLabel(accountLabels, s.broker, s.accountId)} sub={BROKER_LABELS[s.broker]} />
                </td>
              )}
              <td className="text">
                <StockCell symbol={s.symbol} name={s.name} url={null} />
              </td>
              <td>{qtyFmt.format(s.quantity)}</td>
              <td>
                {formatKrwValue(s.proceedsKrw)}
                <span className="cell-sub">{formatKrwValue(s.costKrw)}</span>
              </td>
              <td className={tone(s.gainKrw)}>
                {signed(s.gainKrw)}
                <span className="cell-sub">{formatRatePct(s.costKrw > 0 ? s.gainKrw / s.costKrw : null)}</span>
              </td>
            </tr>
          ))}
        </tbody>
        {rows.length > 1 && (
          <tfoot>
            <tr>
              <td style={{ fontWeight: 600 }}>합계 ({rows.length}건)</td>
              {showAccount && <td />}
              <td />
              <td />
              <td style={{ fontWeight: 600 }}>
                {formatKrwValue(totals.proceedsKrw)}
                <span className="cell-sub">{formatKrwValue(totals.costKrw)}</span>
              </td>
              <td className={tone(totals.gainKrw)} style={{ fontWeight: 600 }}>
                {signed(totals.gainKrw)}
                <span className="cell-sub">{formatRatePct(totals.rate)}</span>
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
