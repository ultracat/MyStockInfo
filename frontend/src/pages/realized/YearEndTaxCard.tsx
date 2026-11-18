import { useMemo } from 'react';
import { yearEndPlan } from '../../calc/yearEndTax';
import { FINANCIAL_INCOME_THRESHOLD_KRW, TAX_FREE_ALLOWANCE_KRW } from '../../calc/realizedGains';
import { krw } from '../../format';
import type { StoredHolding } from '../../types';
import Hint from '../../components/Hint';

const won = (v: number) => `${krw.format(Math.round(v))}원`;

/**
 * 연말 절세 도우미 — 올해 해외주식 양도소득 기본공제(250만원)가 얼마나 남았는지, 평가손실 종목을 팔면 세금이 얼마 줄지, 남은 공제 안에서
 * 평가이익을 얼마나 세금 없이 실현할 수 있는지, 금융소득 종합과세 기준(2,000만원) 대비 올해 배당소득(calc/yearEndTax.ts). 참고용.
 */
export function YearEndTaxCard({
  realizedOverseasKrw,
  holdings,
  isGeneral,
  usdRate,
  dividendIncomeKrw,
  year,
}: {
  realizedOverseasKrw: number;
  holdings: StoredHolding[];
  isGeneral: (broker: string, accountId: string) => boolean;
  usdRate: number | null;
  dividendIncomeKrw: number;
  year: number;
}) {
  const plan = useMemo(() => yearEndPlan(realizedOverseasKrw, holdings, isGeneral, usdRate), [realizedOverseasKrw, holdings, isGeneral, usdRate]);
  const ratio = dividendIncomeKrw / FINANCIAL_INCOME_THRESHOLD_KRW;
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>연말 절세 도우미 ({year}년)</h3>
      <Hint>
        해외 상장 주식은 그해 손익을 합쳐 {won(TAX_FREE_ALLOWANCE_KRW)} 공제 후 22%를 냅니다. 연말 전에 <b>평가손실 종목을 팔면</b> 이익과 상계돼 세금이 줄고(한국엔
        같은 종목을 다시 사지 못하게 하는 규칙이 없습니다), 순이익이 공제보다 적으면 <b>남은 공제만큼 평가이익을 세금 없이 실현</b>할 수 있습니다. 일반 계좌의 해외 상장
        보유만 대상이고, 평가손익은 지금 환율로 환산한 근사치입니다(신고는 취득·양도일 환율). 세금은 <b>결제일 기준</b>이라 연말 마지막 거래일보다 며칠 앞서 팔아야 그해에
        잡힙니다 — 증권사 공지를 확인하세요. 수수료·환전 비용은 반영하지 않은 참고용입니다.
      </Hint>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">올해 해외 실현손익</div>
          <div className={`value ${plan.realizedKrw > 0 ? 'text-good' : plan.realizedKrw < 0 ? 'text-critical' : ''}`}>{won(plan.realizedKrw)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>지금 추정 세금 {won(plan.taxNowKrw)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">세금 없이 더 실현할 수 있는 이익</div>
          <div className="value">{won(plan.taxFreeRoomKrw)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">손실 종목을 모두 팔면</div>
          <div className="value">{plan.harvestSavingKrw > 0 ? `세금 −${won(plan.harvestSavingKrw)}` : '줄어드는 세금 없음'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>평가손실 합계 {won(plan.totalLossKrw)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">금융소득(배당) / 2,000만원</div>
          <div className="value">
            {(ratio * 100).toFixed(0)}%{ratio >= 0.8 ? ' ⚠ 기준 가까움' : ''}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>올해 일반 계좌 세전 배당 {won(dividendIncomeKrw)} 기준(이자 제외)</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div>
          <h4 style={{ margin: '8px 0' }}>평가손실 종목 (손실 확정 후보)</h4>
          {plan.losers.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>없습니다.</p>
          ) : (
            <table>
              <tbody>
                {plan.losers.slice(0, 10).map((x) => (
                  <tr key={x.symbol}>
                    <td style={{ textAlign: 'left' }}>
                      {x.name} <span style={{ color: 'var(--text-muted)' }}>{x.symbol}</span>
                    </td>
                    <td className="text-critical">−{won(x.lossKrw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h4 style={{ margin: '8px 0' }}>평가이익 종목 (공제 안에서 실현 후보)</h4>
          {plan.taxFreeRoomKrw === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>올해 공제를 다 썼습니다 — 더 실현하면 22%가 붙습니다.</p>
          ) : plan.gainers.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>없습니다.</p>
          ) : (
            <table>
              <tbody>
                {plan.gainers.slice(0, 10).map((x) => (
                  <tr key={x.symbol}>
                    <td style={{ textAlign: 'left' }}>
                      {x.name} <span style={{ color: 'var(--text-muted)' }}>{x.symbol}</span>
                    </td>
                    <td className="text-good">+{won(x.gainKrw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {ratio >= 0.8 && (
        <p style={{ fontSize: 13, fontWeight: 700 }}>
          올해 배당소득이 금융소득 종합과세 기준(2,000만원, 이자 포함)의 80%를 넘었습니다. 넘으면 초과분이 다른 소득과 합산 과세됩니다 — ISA·연금 계좌 활용을 검토하세요.
        </p>
      )}
    </div>
  );
}
