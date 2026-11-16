import MonthlyInvestmentChart, { type MonthlyInvestmentRow } from '../../components/MonthlyInvestmentChart';
import MonthlyReturnChart, { type MonthlyReturnRow } from '../../components/MonthlyReturnChart';
import NetWorthChart from '../../components/NetWorthChart';
import type { SnapshotRecord } from '../../types';
import type { indexComparisonRows as indexComparisonRowsFn } from '../../calc/overview';

/** 대시보드 아래쪽 추이 카드 셋 — 월별 수익률(+ 지수와 비교), 월별 총 투자금·총 수입금, 순자산 추이. */
export function TrendCards({
  monthlyReturnRows,
  monthlyAmountRows,
  indexComparisonRows,
  hasIndexData,
  loadingClosePrices,
  netWorthSnapshots,
}: {
  monthlyReturnRows: MonthlyReturnRow[];
  monthlyAmountRows: MonthlyInvestmentRow[];
  indexComparisonRows: ReturnType<typeof indexComparisonRowsFn>;
  hasIndexData: boolean;
  loadingClosePrices: boolean;
  netWorthSnapshots: SnapshotRecord[];
}) {
  return (
    <>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>매월 보유종목 투자금 대비 수익률</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          지금 보유 중인 종목들만 대상으로, 그 달까지 보유했던 수량에 오늘 기준 평단가를 곱한
          투자금이 그 달의 실제 종가(토스 일봉 기준, 못 구하면 오늘 현재가로 대체) 기준으로
          당시 얼마였는지를 매월 누적으로 보여줍니다(최근 12개월). 전량 매도한 종목은
          포함되지 않습니다.
          {loadingClosePrices && ' 실제 월별 종가를 불러오는 중 — 그동안 오늘 현재가로 표시됩니다.'}
        </p>
        <MonthlyReturnChart rows={monthlyReturnRows} />
        {hasIndexData && indexComparisonRows.length > 1 && (
          <>
            <h4 style={{ margin: '16px 0 4px' }}>지수와 비교 (월간 수익률)</h4>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 0 }}>
              내 보유종목은 그 달 평가금액 변화에서 새로 넣은 투자금을 뺀 값을 전월 평가금액으로 나눈 근사치입니다(위 그래프와
              같은 월말 기준). 지수는 토스증권 시장 지표의 월말 종가 대비이며, 미국 지수는 토스 API가 제공하지 않습니다.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>월</th>
                    <th>내 보유종목</th>
                    <th>코스피</th>
                    <th>코스닥</th>
                  </tr>
                </thead>
                <tbody>
                  {indexComparisonRows.slice(1).map((r) => (
                    <tr key={r.month}>
                      <td>{r.month}</td>
                      {[r.mine, r.kospi, r.kosdaq].map((v, i) => (
                        <td key={i} className={v === null ? undefined : v >= 0 ? 'text-good' : 'text-critical'}>
                          {v === null ? '-' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>월별 총 투자금 · 총 수입금</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          지금 보유 중인 종목들만 대상으로, 그 달까지 보유했던 수량에 오늘 기준 평단가를 곱한
          투자금(총 투자금)과 그 수량에 그 달의 실제 종가(토스 일봉 기준, 못 구하면 오늘
          현재가로 대체)를 곱한 평가금액(총 수입금)을 매월 누적으로 보여줍니다(최근 12개월).
          전량 매도한 종목은 포함되지 않습니다.
          {loadingClosePrices && ' 실제 월별 종가를 불러오는 중 — 그동안 오늘 현재가로 표시됩니다.'}
        </p>
        <MonthlyInvestmentChart rows={monthlyAmountRows} />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>순자산 추이(기록 시작 이후)</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          위 두 차트와 달리 매매내역에서 재구성한 근사치가 아니라, 이 화면에 들어올 때마다
          실제로 계산된 합계를 하루 한 번 그대로 기록한 값입니다 — 그만큼 정확하지만
          이 기능을 쓰기 시작한 날부터만 쌓입니다(과거 소급 불가).
        </p>
        <NetWorthChart rows={netWorthSnapshots} />
      </div>
    </>
  );
}
