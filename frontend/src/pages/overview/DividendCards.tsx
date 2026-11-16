import { useMemo, useState } from 'react';
import DividendsChart from '../../components/DividendsChart';
import DonutChart from '../../components/DonutChart';
import DonutDetailModal, { type DonutDetailView } from '../../components/DonutDetailModal';
import { formatDividendMeta, formatKrwValue } from '../../format';
import type { AccountLabel, DividendRecord, MonthlySummaryRow } from '../../types';
import { accountDividendRows, dividendSlices, dividendSymbolRows, type RateFor } from '../../calc/overview';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

function accountDividendView(rows: ReturnType<typeof accountDividendRows>): DonutDetailView {
  return {
    id: 'account',
    label: '계좌별',
    countLabel: (n) => `${n}개 계좌`,
    rows: rows.map((r) => ({
      symbol: r.key,
      name: r.label,
      label: r.label,
      valueKrw: r.valueKrw,
      meta: `배당 ${r.count}건 · ${r.details.length}개 종목`,
      details: r.details,
    })),
  };
}

/**
 * 대시보드 "N년 월별 배당금"(막대, 연도 선택) · "N년 배당금 비중"(도넛) 카드 + 두 상세 팝업(종목별/계좌별).
 * 달러 배당은 오늘 환율이 아니라 지급월 평균 환율(rateFor)로 환산한다. 연도는 상단 "총 배당금" 카드와 같이 쓰므로 위에서 받는다.
 */
export function DividendCards({
  year,
  onYearChange,
  dividends,
  monthlyRows,
  yearTotalKrw,
  hasUnconvertedUsdDividend,
  accountLabels,
  rateFor,
  qtyBySymbol,
}: {
  year: number;
  onYearChange: (year: number) => void;
  dividends: DividendRecord[];
  monthlyRows: MonthlySummaryRow[];
  yearTotalKrw: number;
  hasUnconvertedUsdDividend: boolean;
  accountLabels: AccountLabel[];
  rateFor: RateFor;
  /** 배당 팝업에 "총 주식갯수"(오늘 보유수량)를 같이 보여주려고. */
  qtyBySymbol: Map<string, number>;
}) {
  // 월별 막대를 누르면 그 달 배당을 종목별로 합쳐 큰 순서로.
  const [selectedDividendMonth, setSelectedDividendMonth] = useState<string | null>(null);
  const selectedMonthDetailRows = useMemo(
    () => (selectedDividendMonth ? dividendSymbolRows(dividends, selectedDividendMonth, rateFor) : []),
    [dividends, selectedDividendMonth, rateFor]
  );
  const selectedMonthAccountRows = useMemo(
    () => (selectedDividendMonth ? accountDividendRows(dividends, accountLabels, selectedDividendMonth, rateFor) : []),
    [dividends, selectedDividendMonth, accountLabels, rateFor]
  );

  const slices = useMemo(() => dividendSlices(dividends, year, rateFor), [dividends, year, rateFor]);
  // 도넛 가운데 숫자를 누르면 그 해 배당을 준 전 종목을 건수까지.
  const [showDividendDetail, setShowDividendDetail] = useState(false);
  const dividendDetailRows = useMemo(() => dividendSymbolRows(dividends, String(year), rateFor), [dividends, year, rateFor]);
  const yearAccountDividendRows = useMemo(
    () => (showDividendDetail ? accountDividendRows(dividends, accountLabels, String(year), rateFor) : []),
    [dividends, year, showDividendDetail, accountLabels, rateFor]
  );

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{year}년 월별 배당금</h3>
          <div className="form-row" style={{ margin: 0 }}>
            <select value={year} onChange={(e) => onYearChange(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>
        </div>
        {hasUnconvertedUsdDividend && (
          <div className="notice" style={{ marginTop: 12 }}>
            USD 배당금이 있지만 환율을 가져오지 못해 원화 환산에서 제외됩니다.
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <DividendsChart
            rows={monthlyRows}
            fxRate={rateFor}
            onBarClick={(month) => setSelectedDividendMonth(month)}
          />
        </div>
      </div>

      {selectedDividendMonth && (
        <DonutDetailModal
          title={`${selectedDividendMonth} 배당 내역`}
          totalValueKrw={selectedMonthDetailRows.reduce((sum, r) => sum + r.valueKrw, 0)}
          views={[
            {
              id: 'symbol',
              label: '종목별',
              countLabel: (n) => `${n}개 종목`,
              rows: selectedMonthDetailRows.map((r) => ({
                symbol: r.symbol,
                name: r.name,
                valueKrw: r.valueKrw,
                meta: formatDividendMeta(r.count, qtyBySymbol.get(r.symbol)),
              })),
            },
            accountDividendView(selectedMonthAccountRows),
          ]}
          formatValue={formatKrwValue}
          onClose={() => setSelectedDividendMonth(null)}
        />
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{year}년 배당금 비중</h3>
        <DonutChart
          slices={slices}
          centerLabel={`${year}년 배당금`}
          centerValue={formatKrwValue(yearTotalKrw)}
          formatValue={formatKrwValue}
          onCenterClick={() => setShowDividendDetail(true)}
        />
      </div>

      {showDividendDetail && (
        <DonutDetailModal
          title={`${year}년 배당금 상세`}
          totalValueKrw={yearTotalKrw}
          views={[
            {
              id: 'symbol',
              label: '종목별',
              countLabel: (n) => `${n}개 종목`,
              rows: dividendDetailRows.map((r) => ({
                symbol: r.symbol,
                name: r.name,
                valueKrw: r.valueKrw,
                meta: formatDividendMeta(r.count, qtyBySymbol.get(r.symbol)),
              })),
            },
            accountDividendView(yearAccountDividendRows),
          ]}
          formatValue={formatKrwValue}
          onClose={() => setShowDividendDetail(false)}
        />
      )}
    </>
  );
}
