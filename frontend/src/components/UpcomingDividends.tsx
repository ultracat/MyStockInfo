import { useState } from 'react';
import type { AccountLabel, UpcomingDividend } from '../types';
import { BROKER_LABELS } from '../brokers';
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import { krw, usd4dp, usdFmt } from '../format';
import CollapseToggle from './CollapseToggle';

// 다가오는 배당(백엔드 upcomingDividends.ts) — 한국투자증권 키로만 만든다. 키가 없으면(`available:false`) 카드 자리에
// "한국투자증권 API 키를 등록하면 보인다"는 안내만 그린다.
// 확정 = 한투 계좌의 지급 예정 권리(세전·세금 정확), 예상 = 예탁원 배당일정(국내) / ICE 일정 + 해외 기간별권리(미국)의
// 주당 배당금 × 지금 보유 수량(세전), 추정 = 아직 금액이 없는 다음 배당을 지난 일정의 주기·최근 12회 주당 중간값으로 만든 것.
// 국내(원화)와 해외·미국(달러)을 소제목으로 나눠 표를 따로 그리고 합계도 각자 낸다(환율로 합치지 않는다).
// 데이터는 배당금 화면(Dividends.tsx)이 받아 이 표와 "월별 배당금" 그래프의 흐린 예상 막대에 같이 넘긴다.
// 일정은 백엔드에 저장돼 하루 한 번 다시 받는다 — 머리에 받은 시각과 "갱신 중"을, 옆에 새로고침 버튼을 둔다.
export interface UpcomingDividendsState {
  items: UpcomingDividend[] | null;
  available: boolean;
  error: string | null;
  /** 지금 보이는 일정을 받은 시각(ISO). */
  builtAt: string | null;
  /** 백엔드가 뒤에서 다시 받는 중. */
  refreshing: boolean;
}

/** ISO → "11-16 09:12"(이 PC 시간대). */
function shortStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function UpcomingDividends({
  accountLabels,
  state: { items, available, error, builtAt, refreshing },
  onRefresh,
}: {
  accountLabels: AccountLabel[];
  state: UpcomingDividendsState;
  onRefresh: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  if (!available) {
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>다가오는 배당</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 0 }}>
          한국투자증권 API 키가 등록되어 있지 않아 다가오는 배당을 보여 줄 수 없습니다. 배당 일정(국내 예탁결제원 · 미국
          ICE)과 주당 배당금을 한국투자증권 API로 조회하기 때문입니다 — 한국투자증권 계좌가 없어도 키만 있으면 다른
          증권사의 보유 종목까지 보입니다. <strong>설정 → API 키 등록</strong>에서 한국투자증권 키를 등록해주세요.
        </p>
      </div>
    );
  }
  const domestic = (items ?? []).filter((i) => i.currency !== 'USD');
  const overseas = (items ?? []).filter((i) => i.currency === 'USD');

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
        <h3 style={{ margin: 0 }}>다가오는 배당</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(builtAt || refreshing) && (
            <span style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
              {builtAt ? `기준 ${shortStamp(builtAt)}` : ''}
              {builtAt && refreshing ? ' · ' : ''}
              {refreshing ? '갱신 중…' : ''}
            </span>
          )}
          <button type="button" className="ghost" onClick={onRefresh} disabled={refreshing || items === null}>
            새로고침
          </button>
          <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
        </div>
      </div>
      {!collapsed && (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            <strong>확정</strong>은 한국투자증권 계좌에 배정된 지급 예정 배당이고, <strong>예상</strong>은 발표된 배당
            일정(국내는 예탁결제원, 미국은 ICE)의 주당 배당금 × 지금 보유 수량입니다(모든 증권사의 보유 종목, 기준일까지
            보유해야 받음). <strong>추정</strong>은 아직 일정이 없거나 금액이 미정인 배당을, 매달·분기처럼 일정하게 주는
            종목의 지난 일정으로 짐작한 것입니다(주당 금액은 최근 12회의 중간값, 기준일이 휴일이면 직전 영업일, 지급일은 지난 일정처럼 기준일 뒤 몇 영업일 —
            미국 종목은 미국 증시 정기 휴장일 기준). 확정은 앞으로 120일, 예상·추정은 <strong>이번 달 지급분까지만</strong>{' '}
            보여 줍니다. 금액은 세전이고(미국 배당은 현지 원천징수 15% 전), 국내는 원화·해외는 달러로 따로 합계를 냅니다.
            배당 일정은 <strong>하루 한 번</strong> 새로 받아 저장해 두고(그사이엔 저장된 일정 × 지금 보유 수량), 새로 산 종목은
            바로 받아 더합니다 — 지금 다시 받으려면 <strong>새로고침</strong>.
          </p>
          {error ? (
            <p className="text-critical">{error}</p>
          ) : items === null ? (
            <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
          ) : (
            <>
              <DividendSection title="국내" currency="KRW" rows={domestic} accountLabels={accountLabels} />
              <DividendSection title="해외 (미국)" currency="USD" rows={overseas} accountLabels={accountLabels} />
            </>
          )}
        </>
      )}
    </div>
  );
}

const money = (currency: 'KRW' | 'USD', v: number) => (currency === 'USD' ? usdFmt.format(v) : `${krw.format(v)}원`);
const perShareText = (currency: 'KRW' | 'USD', v: number) => (currency === 'USD' ? usd4dp.format(v) : `${krw.format(v)}원`);

/** 국내(원화)·해외(달러) 한 묶음 — 소제목 + 표 + 그 통화의 합계. 통화가 달라 환율로 합치지 않고 묶음마다 따로 합산한다. */
function DividendSection({
  title,
  currency,
  rows,
  accountLabels,
}: {
  title: string;
  currency: 'KRW' | 'USD';
  rows: UpcomingDividend[];
  accountLabels: AccountLabel[];
}) {
  const total = rows.reduce((s, i) => s + i.grossAmount, 0);
  return (
    <section style={{ marginTop: 16 }}>
      <h4 style={{ margin: '0 0 8px' }}>
        {title}{' '}
        <span style={{ color: 'var(--text-muted)', fontWeight: 'normal', fontSize: 13 }}>
          {rows.length ? `${rows.length}건 · 세전 ${money(currency, total)}` : ''}
        </span>
      </h4>
      {rows.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>예정된 배당이 없습니다(확정 120일 · 예상·추정 이번 달).</p>
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
              {rows.map((i, idx) => (
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
                    {(() => {
                      const account = `${BROKER_LABELS[i.broker]} · ${formatAccountOption({ id: i.accountId }, findAccountLabel(accountLabels, i.broker, i.accountId))}`;
                      return (
                        <span className="upcoming-cell-truncate" title={account}>
                          {account}
                        </span>
                      );
                    })()}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <span className="upcoming-cell-truncate" title={`${i.name} ${i.symbol}`}>
                      {i.name} <span style={{ color: 'var(--text-muted)' }}>{i.symbol}</span>
                    </span>
                  </td>
                  <td>{i.perShare !== null ? `${krw.format(i.quantity)}주 × ${perShareText(currency, i.perShare)}` : '-'}</td>
                  <td>
                    {money(currency, i.grossAmount)}
                    {i.tax !== null && i.tax > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>세금 {money(currency, i.tax)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>합계(세전)</td>
                <td>{money(currency, total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
