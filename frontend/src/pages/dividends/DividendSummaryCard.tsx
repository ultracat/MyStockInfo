import { useMemo, useState } from 'react';
import CollapseToggle from '../../components/CollapseToggle';
import DividendsChart from '../../components/DividendsChart';
import DonutDetailModal from '../../components/DonutDetailModal';
import { BROKER_LABELS } from '../../brokers';
import { formatDividendMeta, formatKrwValue } from '../../format';
import { dividendSymbolRows } from '../../calc/overview';
import {
  monthlySummaryRows,
  quantityBySymbol,
  upcomingMonthlyRows as upcomingMonthlyRowsOf,
  type BrokerFilter,
  type BrokerLine,
  type BrokerSymbolCost,
  type YearFilter,
} from '../../calc/dividends';
import type { BrokerId, DividendRecord, UpcomingDividend } from '../../types';
import type { ComponentProps } from 'react';
import { DividendProjectionCard } from './DividendProjectionCard';

/**
 * "월별 배당금"(그래프 전용 증권사 필터, 흐린 예상 막대) + "증권사별 배당금 총계" 카드 — 하나의 접기 토글을 공유한다.
 * 막대를 누르면 그 달 배당을 종목별로 합친 팝업(Overview.tsx와 같은 계산 — calc/overview.ts의 dividendSymbolRows).
 */
export function DividendSummaryCard({
  year,
  visibleRecords,
  brokerOptions,
  upcomingItems,
  rateFor,
  avgCostByBroker,
  lines,
  investedLoading,
  projection,
}: {
  year: YearFilter;
  /** 연도 필터를 적용한 배당 기록. */
  visibleRecords: DividendRecord[];
  brokerOptions: BrokerId[];
  upcomingItems: UpcomingDividend[] | null;
  rateFor: (month: string) => number | null;
  avgCostByBroker: Partial<Record<BrokerId, Map<string, BrokerSymbolCost>>>;
  lines: BrokerLine[];
  investedLoading: boolean;
  /** "앞으로 12개월" 보기에 넘길 값(DividendProjectionCard props) — 예전엔 따로 된 카드였다. */
  projection: Omit<ComponentProps<typeof DividendProjectionCard>, 'embedded'>;
}) {
  // 보기: 지난 배당(연도·증권사 필터, 증권사별 총계) / 앞으로 12개월 예상(목표 대비) — 비슷한 막대 그래프 카드 두 개를 한 카드로(2026-11-18)
  const [view, setView] = useState<'past' | 'next12'>('past');
  const [chartBroker, setChartBroker] = useState<BrokerFilter>('ALL');
  const [dividendPanelsCollapsed, setDividendPanelsCollapsed] = useState(false);
  const [selectedDividendMonth, setSelectedDividendMonth] = useState<string | null>(null);

  const chartRecords = useMemo(
    () => (chartBroker === 'ALL' ? visibleRecords : visibleRecords.filter((r) => r.broker === chartBroker)),
    [visibleRecords, chartBroker]
  );
  const monthlyRows = useMemo(() => monthlySummaryRows(chartRecords), [chartRecords]);
  const upcomingMonthlyRows = useMemo(() => upcomingMonthlyRowsOf(upcomingItems ?? [], chartBroker, year), [upcomingItems, chartBroker, year]);
  // 배당 팝업의 "총 주식갯수"(오늘 기준 보유수량) — 그래프와 같은 증권사 범위.
  const qtyBySymbol = useMemo(() => quantityBySymbol(avgCostByBroker, chartBroker), [avgCostByBroker, chartBroker]);
  const selectedMonthDetailRows = useMemo(
    () => (selectedDividendMonth ? dividendSymbolRows(chartRecords, selectedDividendMonth, rateFor) : []),
    [chartRecords, selectedDividendMonth, rateFor]
  );

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>월별 배당금</h3>
            <div className="seg" role="tablist" aria-label="월별 배당금 보기">
              <button type="button" role="tab" aria-selected={view === 'past'} className={view === 'past' ? 'on' : ''} onClick={() => setView('past')}>
                받은 배당
              </button>
              <button type="button" role="tab" aria-selected={view === 'next12'} className={view === 'next12' ? 'on' : ''} onClick={() => setView('next12')}>
                앞으로 12개월 예상
              </button>
            </div>
            {view === 'past' && (
              <>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>증권사</label>
                <select value={chartBroker} onChange={(e) => setChartBroker(e.target.value as BrokerFilter)}>
                  <option value="ALL">전체</option>
                  {brokerOptions.map((id) => (
                    <option key={id} value={id}>
                      {BROKER_LABELS[id]}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
          <CollapseToggle collapsed={dividendPanelsCollapsed} onClick={() => setDividendPanelsCollapsed((c) => !c)} />
        </div>

        {!dividendPanelsCollapsed && view === 'next12' && (
          <div style={{ marginTop: 12 }}>
            <DividendProjectionCard {...projection} embedded />
          </div>
        )}
        {!dividendPanelsCollapsed && view === 'past' && (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <DividendsChart
                rows={monthlyRows}
                expectedRows={upcomingMonthlyRows}
                fxRate={rateFor}
                onBarClick={(month) => setSelectedDividendMonth(month)}
              />
            </div>

            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />

            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>증권사별 배당금 총계</h3>
              {year !== 'ALL' && (
                <p style={{ marginTop: -8, marginBottom: 12, fontSize: 13, color: 'var(--text-muted)' }}>
                  선택한 연도의 투자금은 매매내역을 재구성해 그 해 말 기준으로 계산합니다(현재 보유 중인
                  종목만 대상 — 전량 매도한 종목, 매매내역이 없는 계좌의 과거 매수는 반영되지 않을 수
                  있습니다).
                </p>
              )}
              {lines.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>
                  {investedLoading ? '불러오는 중...' : '배당 기록이 없습니다.'}
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>증권사</th>
                      <th>투자금</th>
                      <th>배당금</th>
                      <th>배당수익률</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => (
                      <tr key={`${line.broker}-${i}`}>
                        <td style={line.muted ? { color: 'var(--text-muted)', fontSize: 12 } : undefined}>
                          {line.label}
                        </td>
                        <td>{line.invested}</td>
                        <td>{line.dividend}</td>
                        <td>{line.yieldText}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {selectedDividendMonth && (
        <DonutDetailModal
          title={`${selectedDividendMonth} 배당 내역`}
          totalValueKrw={selectedMonthDetailRows.reduce((sum, r) => sum + r.valueKrw, 0)}
          rows={selectedMonthDetailRows.map((r) => ({
            symbol: r.symbol,
            name: r.name,
            valueKrw: r.valueKrw,
            meta: formatDividendMeta(r.count, qtyBySymbol.get(r.symbol)),
          }))}
          formatValue={formatKrwValue}
          onClose={() => setSelectedDividendMonth(null)}
        />
      )}
    </>
  );
}
