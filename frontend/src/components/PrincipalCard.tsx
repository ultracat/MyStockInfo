import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PortfolioOverview, TossAccountCashFlows } from '../types';
import { krw, usdFmt } from '../format';
import CollapseToggle from './CollapseToggle';

// 보유 종목 화면(토스증권·NH투자증권) — 은행에서 넣고 뺀 돈(토스: 거래내역의 입금·출금, 백엔드 tossCashFlows.ts /
// NH: 입출금내역, nhCashFlows.ts)으로
// "실제 투자원금"을 잡고, 지금 계좌 자산(평가금액 + 예수금)과 비교한다. 매입금액 기준 손익과 달리 매도해서
// 확정된 손익·배당·이자·세금·수수료가 전부 반영된다. 타사에서 옮겨 온 주식(입고)은 금액이 없어 원금에
// 못 넣으므로, 입고가 있으면 수익이 그만큼 부풀 수 있다고 알린다.

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const signedWon = (v: number) => `${v >= 0 ? '+' : ''}${won(v)}`;

export default function PrincipalCard({
  broker = 'toss',
  portfolio,
  accountSeqs,
  fxRate,
}: {
  broker?: 'toss' | 'nh' | 'kiwoom';
  portfolio: PortfolioOverview;
  /** 대상 계좌(토스 accountSeq / NH 계좌번호) — "전체 계좌"면 실전 계좌 전부. */
  accountSeqs: string[];
  fxRate: number | null;
}) {
  const [flows, setFlows] = useState<TossAccountCashFlows[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (broker === 'nh' ? api.getNhCashFlows() : broker === 'kiwoom' ? api.getKiwoomCashFlows() : api.getTossCashFlows())
      .then((f) => !cancelled && setFlows(f))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [broker]);

  const picked = (flows ?? []).filter((f) => accountSeqs.includes(f.accountSeq));
  const sum = (k: 'depositKrw' | 'withdrawalKrw' | 'depositUsd' | 'withdrawalUsd' | 'transferIn') =>
    picked.reduce((s, f) => s + f[k], 0);
  const principal = picked.some((f) => f.netPrincipalKrw === null)
    ? null
    : picked.reduce((s, f) => s + (f.netPrincipalKrw ?? 0), 0);

  const usdAssets = (portfolio.totalMarketValueUsd ?? 0) + (portfolio.cashBalanceUsd ?? 0);
  const assets =
    usdAssets !== 0 && !fxRate
      ? null
      : portfolio.totalMarketValueKrw + (portfolio.cashBalanceKrw ?? 0) + usdAssets * (fxRate ?? 0);
  const cashKnown = portfolio.cashBalanceKrw !== null;
  const gain = assets !== null && principal !== null ? assets - principal : null;
  const rate = gain !== null && principal && principal > 0 ? (gain / principal) * 100 : null;
  const firstDate = picked.map((f) => f.firstDate).filter(Boolean).sort()[0] ?? null;
  const transferIn = sum('transferIn');

  const years = new Map<string, { dk: number; wk: number; du: number; wu: number }>();
  for (const f of picked)
    for (const y of f.byYear) {
      const r = years.get(y.year) ?? { dk: 0, wk: 0, du: 0, wu: 0 };
      years.set(y.year, { dk: r.dk + y.depositKrw, wk: r.wk + y.withdrawalKrw, du: r.du + y.depositUsd, wu: r.wu + y.withdrawalUsd });
    }
  const hasUsdFlows = sum('depositUsd') + sum('withdrawalUsd') > 0;

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h3 style={{ margin: 0 }}>입금 기준 투자원금과 수익</h3>
        <CollapseToggle collapsed={collapsed} onClick={() => setCollapsed((c) => !c)} />
      </div>
      {error ? (
        <p className="text-critical">{error}</p>
      ) : !flows ? (
        <p style={{ color: 'var(--text-muted)' }}>거래내역을 불러오는 중...</p>
      ) : picked.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>이 계좌의 입출금 내역이 없습니다.</p>
      ) : (
        <>
          <div className="summary-row" style={{ marginTop: 12 }}>
            <div className="stat-tile">
              <div className="label">순입금 (입금 − 출금)</div>
              <div className="value">{principal === null ? '환율 없음' : won(principal)}</div>
              {firstDate && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{firstDate}부터</div>}
            </div>
            <div className="stat-tile">
              <div className="label">지금 계좌 자산 (평가금액 + 예수금)</div>
              <div className="value">{assets === null ? '환율 미적용' : won(assets)}</div>
              {!cashKnown && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>예수금을 못 받아 평가금액만</div>}
            </div>
            <div className="stat-tile">
              <div className="label">입금 기준 수익 · 수익률</div>
              <div className={`value ${gain === null ? '' : gain >= 0 ? 'text-good' : 'text-critical'}`}>
                {gain === null ? '-' : signedWon(gain)}
              </div>
              {rate !== null && <div style={{ fontSize: 12 }}>{`${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%`}</div>}
            </div>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 0 }}>
            은행에서 넣고 뺀 돈만 원금으로 봅니다 — 매도로 확정된 손익, 배당·이자, 세금·수수료가 모두 수익에
            들어갑니다(위 매입금액 기준 손익과 다른 이유). 달러 입출금은 그때 환율, 지금 자산의 달러는 현재 환율로
            환산합니다.
            {transferIn > 0 && (
              <>
                {' '}
                <strong>
                  다른 증권사에서 옮겨 온 주식(입고) {transferIn}건은 금액이 없어 원금에 들어가지 않아, 그만큼 수익이
                  크게 보일 수 있습니다.
                </strong>
              </>
            )}
          </p>
          {!collapsed && (
            <div className="table-scroll" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>연도</th>
                    <th>입금</th>
                    <th>출금</th>
                    <th>순입금</th>
                    {hasUsdFlows && <th>달러 입금 / 출금</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...years.entries()].map(([y, r]) => (
                    <tr key={y}>
                      <td>{y}년</td>
                      <td>{won(r.dk)}</td>
                      <td>{won(r.wk)}</td>
                      <td>{signedWon(r.dk - r.wk)}</td>
                      {hasUsdFlows && (
                        <td>
                          {usdFmt.format(r.du)} / {usdFmt.format(r.wu)}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
