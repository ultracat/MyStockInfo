import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, UpcomingDividend } from '../types';
import { BROKER_LABELS } from '../brokers';
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import { krw } from '../format';
import CollapseToggle from './CollapseToggle';

// 다가오는 배당(백엔드 upcomingDividends.ts) — 한국투자증권 키가 있어야 뜬다(없으면 카드 자체를 안 그림).
// 확정 = 한투 계좌의 지급 예정 권리(세전·세금 정확), 예상 = 예탁원 배당일정의 주당 배당금 × 지금 보유 수량(세전),
// 추정 = 예탁원에 아직 없는(또는 금액 미정인) 다음 배당을 지난 일정의 주기·최근 12회 주당 중간값으로 만든 것.
// 해외 종목은 지급 일정을 주는 API가 없어 대상이 아니다.
export default function UpcomingDividends({ accountLabels }: { accountLabels: AccountLabel[] }) {
  const [items, setItems] = useState<UpcomingDividend[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getUpcomingDividends()
      .then((r) => {
        if (cancelled) return;
        setAvailable(r.available);
        setItems(r.items);
      })
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;
  const total = (items ?? []).reduce((s, i) => s + i.grossAmount, 0);

  return (
    <div className="card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0 }}>다가오는 배당 (국내)</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {!collapsed && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <strong>확정</strong>은 한국투자증권 계좌에 배정된 지급 예정 배당이고, <strong>예상</strong>은 예탁결제원
            배당 일정의 주당 배당금 × 지금 보유 수량입니다(모든 증권사의 국내 보유 종목, 기준일까지 보유해야 받음).
            <strong>추정</strong>은 예탁원에 아직 올라오지 않았거나 금액이 미정인 배당을, 매달·분기처럼 일정하게 주는
            종목의 지난 일정으로 짐작한 것입니다(주당 금액은 최근 12회의 중간값, 기준일이 휴일이면 직전 영업일, 지급일은 지난 일정처럼 기준일 뒤 몇 영업일).
            확정은 앞으로 120일, 예상·추정은 <strong>이번 달 지급분까지만</strong> 보여 줍니다.
            금액은 세전이며 해외 종목은 일정을 주는 API가 없어 빠집니다.
          </p>
          {error ? (
            <p className="text-critical">{error}</p>
          ) : items === null ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : items.length === 0 ? (
            <p style={{ color: 'var(--text-muted)' }}>예정된 배당이 없습니다(확정 120일 · 예상·추정 이번 달).</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>지급일</th>
                    <th>기준일</th>
                    <th style={{ textAlign: 'left' }}>구분</th>
                    <th style={{ textAlign: 'left' }}>증권사 · 계좌</th>
                    <th style={{ textAlign: 'left' }}>종목</th>
                    <th>수량 × 주당</th>
                    <th>세전 금액</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i, idx) => (
                    <tr key={`${i.broker}:${i.accountId}:${i.symbol}:${i.recordDate}:${idx}`}>
                      <td>{i.payDate ?? '미정'}</td>
                      <td>{i.recordDate ?? '-'}</td>
                      <td style={{ textAlign: 'left' }}>
                        <span
                          className={i.status === 'confirmed' ? 'text-good' : undefined}
                          style={i.status === 'projected' ? { color: 'var(--text-muted)' } : undefined}
                        >
                          {i.status === 'confirmed' ? '확정' : i.status === 'estimated' ? '예상' : '추정'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <span className="cell-name-truncate">
                          {BROKER_LABELS[i.broker]} ·{' '}
                          {formatAccountOption(
                            { id: i.accountId },
                            findAccountLabel(accountLabels, i.broker, i.accountId),
                          )}
                        </span>
                      </td>
                      <td style={{ textAlign: 'left' }}>
                        <span className="cell-name-truncate">
                          {i.name} <span style={{ color: 'var(--text-muted)' }}>{i.symbol}</span>
                        </span>
                      </td>
                      <td>{i.perShare !== null ? `${krw.format(i.quantity)}주 × ${krw.format(i.perShare)}원` : '-'}</td>
                      <td>
                        {krw.format(i.grossAmount)}원
                        {i.tax !== null && i.tax > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>세금 {krw.format(i.tax)}원</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>합계(세전)</td>
                    <td>{krw.format(total)}원</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
