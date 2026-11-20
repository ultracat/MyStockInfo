import type { HoldingPosition } from '../types';
import { formatMoneyIn as formatMoney, formatRatePct, qtyFmt } from '../format';
import StockCell from './StockCell';
import WarningBadges from './WarningBadges';
import type { ActiveWarning } from '../types';
import { useMemo } from 'react';
import { sortHoldingRows, type HoldingSortKey } from '../calc/portfolio';
import SortButton, { ariaSort } from './SortButton';
import { AccountLines } from './AccountCell';


interface Row extends HoldingPosition {
  /** null when it can't be blended into a common-currency weight (see Dashboard). */
  weight: number | null;
  /** Dashboard.tsx의 "전체 계좌" 모드에서만 채워진다 — 계좌번호(위)와 별칭(아래 작은 글씨).
   *  채워진 행이 하나라도 있으면 "계좌" 열을 보여준다. */
  account?: { number: string; label?: string };
  /** 종목명을 눌렀을 때 열 외부 링크(stockLinks.ts의 resolveStockLink) — 없으면 텍스트. */
  externalUrl?: string;
  /** 이 계좌의 이 종목에서 지금까지 받은 배당금 합계(포지션 통화 기준) — 다른 계좌의
   *  같은 종목 배당은 포함하지 않는다(Dashboard.tsx의 dividendFor). null이면 배당
   *  통화가 포지션 통화와 달라 환산이 필요한데 환율이 없는 경우. */
  dividendAmount: number | null;
  /** 토스 매수 유의사항(정리매매·투자경고·VI 등) — 활성인 것만, 없으면 undefined. */
  warnings?: ActiveWarning[];
}

export interface HoldingSort {
  key: HoldingSortKey;
  asc: boolean;
}

/**
 * `fxRate`는 정렬에만 쓴다 — 원화·달러 종목을 원화로 환산해 한 순서로 비교한다(calc/portfolio.ts의 sortHoldingRows).
 * 정렬 상태는 화면(Dashboard.tsx)이 든다 — 증권사를 바꾸면 이 표가 잠깐 사라졌다 다시 생겨서, 표 안에 두면 고른 정렬이 초기화됐다.
 */
export default function HoldingsTable({
  rows,
  fxRate,
  sort,
  onSortChange,
}: {
  rows: Row[];
  fxRate: number | null;
  sort: HoldingSort;
  onSortChange: (sort: HoldingSort) => void;
}) {
  const showAccount = rows.some((r) => r.account);
  // 계좌 열이 없는 보기(개별 계좌)로 오면 계좌 기준은 평가금액 순서로 본다.
  const sortKey: HoldingSortKey = sort.key === 'account' && !showAccount ? 'market' : sort.key;
  const sortAsc = sort.key === sortKey ? sort.asc : false;
  const sortedRows = useMemo(() => sortHoldingRows(rows, sortKey, sortAsc, fxRate), [rows, sortKey, sortAsc, fxRate]);
  const sortButton = (key: HoldingSortKey, label: string, opts?: { text?: boolean; small?: boolean }) => (
    <SortButton
      sortKey={key}
      label={label}
      current={sortKey}
      asc={sortAsc}
      onChange={(k, asc) => onSortChange({ key: k, asc })}
      {...opts}
    />
  );
  const aria = (...keys: HoldingSortKey[]) => ariaSort(sortKey, sortAsc, ...keys);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {showAccount && <th aria-sort={aria('account')}>{sortButton('account', '계좌', { text: true })}</th>}
            <th aria-sort={aria('name')}>{sortButton('name', '종목', { text: true })}</th>
            <th>수량</th>
            <th>
              평균가<span className="cell-sub">현재가</span>
            </th>
            <th aria-sort={aria('purchase')}>{sortButton('purchase', '매입금액')}</th>
            <th aria-sort={aria('market')}>{sortButton('market', '평가금액')}</th>
            <th aria-sort={aria('profit', 'profitRate')}>
              {sortButton('profit', '평가손익')}
              {sortButton('profitRate', '손익률', { small: true })}
            </th>
            <th aria-sort={aria('profitWithDividend')}>{sortButton('profitWithDividend', '배당 포함 손익')}</th>
            <th>비중</th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r, idx) => (
            <tr key={`${r.accountId ?? ''}:${r.symbol}:${r.memo ?? ''}:${idx}`}>
              {showAccount && <td>{r.account ? <AccountLines {...r.account} /> : '-'}</td>}
              <td>
                <StockCell symbol={r.symbol} name={r.name} url={r.externalUrl}>
                  {/* 시장은 따로 열을 두지 않고 코드 옆에 작게(2026-11-20 — 10열이 넘쳤다) */}
                  {r.market && <span className="cell-inline-muted"> {r.market}</span>}
                  {r.memo && <span style={{ color: 'var(--text-muted)' }}> · {r.memo}</span>}
                  <WarningBadges warnings={r.warnings} />
                </StockCell>
              </td>
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
                <span className="cell-sub">{formatRatePct(r.profitLossRate)}</span>
              </td>
              {r.dividendAmount === null ? (
                <td style={{ color: 'var(--text-muted)' }}>환율 미적용</td>
              ) : (
                (() => {
                  const total = r.profitLossAmount + r.dividendAmount;
                  return (
                    <td className={total >= 0 ? 'text-good' : 'text-critical'}>
                      {total >= 0 ? '+' : ''}
                      {formatMoney(total, r.currency)}
                      {/* 예전엔 마우스를 올려야(title) 보였다 — Electron에선 안 떠서 작은 글씨로 */}
                      {r.dividendAmount > 0 && <span className="cell-sub">배당 +{formatMoney(r.dividendAmount, r.currency)}</span>}
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
