import { useMemo } from 'react';
import type { BenchmarkRow, CostYear, Diversification, RiskSummary, Breakdown } from '../../calc/analysis';
import { krw } from '../../format';

const won = (v: number) => `${krw.format(Math.round(v))}원`;
const pct = (v: number | null, digits = 1) => (v === null ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`);
const plain = (v: number | null, digits = 1) => (v === null ? '-' : `${(v * 100).toFixed(digits)}%`);
const signClass = (v: number | null) => (v === null || v === 0 ? undefined : v > 0 ? 'text-good' : 'text-critical');

/**
 * 잘린 이름 위에 마우스를 올리면(키보드 포커스도) **바로** 전체 이름을 띄운다 — 브라우저 `title` 툴팁은 1초쯤 늦고 눈에 잘 안 띈다(2026-11-18 사용자 요청).
 * CSS만(`.name-tip`), 화면 낭독기는 `aria-label`로 전체 이름을 읽는다. `place`: 열 머리는 아래, 행 머리는 오른쪽(표 스크롤 영역 안에 머물게).
 */
function NameTip({ full, place, children }: { full: string; place: 'below' | 'right'; children: React.ReactNode }) {
  return (
    <span className={`name-tip name-tip-${place}`} data-full={full} tabIndex={0} aria-label={full}>
      {children}
    </span>
  );
}

/** 표 머리에 쓸 짧은 이름 — 길면 앞 9자 + …(전체 이름과 코드는 마우스를 올리면). */
export function shortName(name: string): string {
  const n = name.trim();
  return n.length > 9 ? `${n.slice(0, 9)}…` : n;
}

export const BENCH_LABELS: Record<string, string> = { KOSPI: '코스피', KOSDAQ: '코스닥', SPY: 'S&P500(SPY)', QQQ: '나스닥100(QQQ)' };

/** 벤치마크 대비 성과 — 기간별 누적 수익률 표. */
export function BenchmarkCard({ rows, benchKeys }: { rows: BenchmarkRow[]; benchKeys: string[] }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>벤치마크 대비 성과</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        내 수익률은 대시보드 "지수와 비교"와 같은 월간 근사((평가 변화 − 투자금 변화) ÷ 전월 평가)를 기간만큼 곱한 값입니다. 지금 보유 종목의 매매내역으로
        최근 12개월을 재구성하므로 전량 매도한 종목은 빠집니다. 코스피·코스닥은 원화, S&P500(SPY)·나스닥100(QQQ)은 <b>달러 기준</b> ETF 수익률(환율 미반영)입니다.
      </p>
      {rows.every((r) => r.mine === null) ? (
        <p style={{ color: 'var(--text-muted)' }}>비교할 월간 수익률이 아직 없습니다(매매내역·월별 종가 필요).</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>기간</th>
                <th>내 보유</th>
                {benchKeys.map((k) => (
                  <th key={k}>{BENCH_LABELS[k] ?? k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ textAlign: 'left' }}>{r.label}</td>
                  <td className={signClass(r.mine)}>
                    <b>{pct(r.mine)}</b>
                  </td>
                  {benchKeys.map((k) => (
                    <td key={k} className={signClass(r.bench[k] ?? null)}>
                      {pct(r.bench[k] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 위험 지표 — 내 포트폴리오 월간 수익률 기준 + 상위 종목별 변동성·상관계수. */
export function RiskCard({
  risk,
  holdingRows,
  matrix,
}: {
  risk: RiskSummary;
  holdingRows: Array<{ symbol: string; name: string; volatility: number | null; months: number }>;
  matrix: Array<Array<number | null>>;
}) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>위험 지표</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        내 보유의 월간 수익률 {risk.months}개월로 계산합니다(표본이 적어 참고용). <b>변동성</b>은 월간 표준편차 × √12(연환산), <b>최대 낙폭</b>은 누적 가치가 고점에서
        가장 많이 떨어진 비율, <b>베타</b>는 코스피가 1% 움직일 때 내 보유가 평균 몇 % 움직였는지입니다. 종목별 값은 월말 종가 기준입니다.
      </p>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">연환산 변동성</div>
          <div className="value">{plain(risk.volatility)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">최대 낙폭(MDD)</div>
          <div className="value">{risk.maxDrawdown === null ? '-' : `${(risk.maxDrawdown * 100).toFixed(1)}%`}</div>
        </div>
        <div className="stat-tile">
          <div className="label">코스피 대비 베타 · 상관</div>
          <div className="value">
            {risk.betaKospi === null ? '-' : risk.betaKospi.toFixed(2)} · {risk.correlationKospi === null ? '-' : risk.correlationKospi.toFixed(2)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">가장 좋았던 / 나빴던 달</div>
          <div className="value" style={{ fontSize: 16 }}>
            {risk.best ? `${risk.best.month} ${pct(risk.best.r)}` : '-'}
            <br />
            {risk.worst ? `${risk.worst.month} ${pct(risk.worst.r)}` : '-'}
          </div>
        </div>
      </div>
      {holdingRows.length > 0 && (
        <>
          <h4 style={{ margin: '16px 0 4px' }}>종목별 변동성 (평가 상위 {holdingRows.length}종목, 최근 12개월)</h4>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>종목</th>
                  <th>연환산 변동성</th>
                  <th>계산에 쓴 개월 수</th>
                </tr>
              </thead>
              <tbody>
                {holdingRows.map((h) => (
                  <tr key={h.symbol}>
                    <td style={{ textAlign: 'left' }}>
                      {h.name} <span style={{ color: 'var(--text-muted)' }}>{h.symbol}</span>
                    </td>
                    <td>{plain(h.volatility)}</td>
                    <td>{h.months ? `${h.months}개월` : '자료 없음'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 style={{ margin: '16px 0 4px' }}>종목끼리 상관계수</h4>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 6px' }}>
            <b>가로 종목과 세로 종목이 만나는 칸</b> = 두 종목이 매달 얼마나 같이 오르내렸는지(−1~1). <b>1</b>이면 똑같이 움직이고(대각선은 자기 자신이라 항상 1),
            <b>0 근처</b>면 서로 상관없이, <b>음수</b>면 반대로 움직입니다. <b>0.7 이상("높음")</b>은 거의 같이 움직여 둘 다 들고 있어도 위험이 잘 나뉘지 않습니다.
          </p>
          <div className="table-scroll">
            <table className="corr-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }} />
                  {holdingRows.map((h) => (
                    <th key={h.symbol}>
                      <NameTip full={`${h.name} (${h.symbol})`} place="below">
                        {shortName(h.name)}
                      </NameTip>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {holdingRows.map((h, i) => (
                  <tr key={h.symbol}>
                    <th scope="row" style={{ textAlign: 'left', fontWeight: 'normal' }}>
                      <NameTip full={`${h.name} (${h.symbol})`} place="right">
                        {shortName(h.name)}
                      </NameTip>
                    </th>
                    {matrix[i].map((c, j) => {
                      const high = c !== null && i !== j && c >= 0.7;
                      return (
                        <td
                          key={j}
                          style={{ fontWeight: high ? 700 : undefined, color: i === j ? 'var(--text-muted)' : undefined }}
                          title={c === null ? '자료 부족' : `${holdingRows[i].name} × ${holdingRows[j].name}: ${c.toFixed(2)}`}
                        >
                          {c === null ? '-' : c.toFixed(2)}
                          {high ? ' 높음' : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {holdingRows.some((h) => h.months < 6) && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              "-"는 월말 종가가 6개월 넘게 겹치지 않아 계산하지 못한 칸입니다
              ({holdingRows.filter((h) => h.months < 6).map((h) => h.name).join(', ')} — 토스증권에서 그 종목의 월별 시세를 받지 못했거나 상장한 지 얼마 안 됨).
            </p>
          )}
        </>
      )}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Breakdown[] }) {
  return (
    <div>
      <h4 style={{ margin: '8px 0' }}>{title}</h4>
      <table>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ textAlign: 'left' }}>{r.label}</td>
              <td>{won(r.valueKrw)}</td>
              <td style={{ width: 120 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 6, background: 'var(--gridline)', borderRadius: 3 }}>
                    <div style={{ width: `${Math.min(100, r.pct)}%`, height: 6, background: 'var(--series-1)', borderRadius: 3 }} />
                  </div>
                  <span style={{ fontSize: 12, minWidth: 40, textAlign: 'right' }}>{r.pct.toFixed(1)}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 분산 현황 — 통화·자산군·증권사·계좌 유형, 집중도. */
export function DiversificationCard({ d }: { d: Diversification }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>분산 현황</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        모든 계좌를 합친 평가금액 기준입니다. 자산군은 종목 이름으로 짐작한 것이라(채권·리츠·커버드콜 등 흔한 낱말) 틀릴 수 있습니다. <b>실질 종목 수</b>는 비중이
        고르다고 쳤을 때 몇 종목에 나눈 것과 같은지(1 ÷ 비중 제곱합)입니다.
      </p>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">보유 종목 / 실질 종목 수</div>
          <div className="value">
            {d.holdingsCount} / {d.effectiveN.toFixed(1)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">최대 종목 비중</div>
          <div className="value">{d.top1Pct.toFixed(1)}%</div>
        </div>
        <div className="stat-tile">
          <div className="label">상위 5종목 비중</div>
          <div className="value">{d.top5Pct.toFixed(1)}%</div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <BreakdownTable title="통화(국가)" rows={d.byCurrency} />
        <BreakdownTable title="자산군" rows={d.byAssetClass} />
        <BreakdownTable title="증권사" rows={d.byBroker} />
        <BreakdownTable title="계좌 유형" rows={d.byTaxType} />
      </div>
    </div>
  );
}

/** 비용 분석 — 연도별 수수료·거래 세금·배당 원천징수. */
export function CostCard({ rows }: { rows: CostYear[] }) {
  const total = useMemo(
    () => rows.reduce((s, r) => ({ c: s.c + r.commissionKrw, t: s.t + r.tradeTaxKrw, d: s.d + r.dividendTaxKrw }), { c: 0, t: 0, d: 0 }),
    [rows]
  );
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>비용 분석</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        매매내역의 수수료·세금 칸과 배당 기록의 세금(원천징수)을 연도별로 더합니다. 증권사가 수수료·세금을 주지 않는 거래(한국투자증권 등)는 0으로 셉니다 —
        그런 거래 수를 따로 보여 주니 실제 비용은 더 클 수 있습니다. 달러는 그 달 평균 환율로 환산합니다.
      </p>
      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">누적 수수료</div>
          <div className="value">{won(total.c)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">누적 매매 세금</div>
          <div className="value">{won(total.t)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">누적 배당 원천징수</div>
          <div className="value">{won(total.d)}</div>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>연도</th>
              <th>거래금액</th>
              <th>수수료</th>
              <th>매매 세금</th>
              <th>비용률</th>
              <th>배당 원천징수</th>
              <th>비용 정보 없는 거래</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <td style={{ textAlign: 'left' }}>{r.year}</td>
                <td>{won(r.tradedKrw)}</td>
                <td>{won(r.commissionKrw)}</td>
                <td>{won(r.tradeTaxKrw)}</td>
                <td>{r.costRatePct === null ? '-' : `${r.costRatePct.toFixed(3)}%`}</td>
                <td>{won(r.dividendTaxKrw)}</td>
                <td>{r.unknownTrades ? `${r.unknownTrades}건` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
