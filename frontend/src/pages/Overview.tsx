import { useMemo, useState } from 'react';
import PurchaseMarketTile from '../components/PurchaseMarketTile';
import { formatKrwValue, formatRatePct, ratioOf } from '../format';
import {
  dividendMonthlyRows as dividendMonthlyRowsOf,
  heldDividendTotal,
  holdingDetailRows,
  indexComparisonRows as indexComparisonRowsOf,
  monthlyAmountRows as monthlyAmountRowsOf,
  yearDividendTotal,
} from '../calc/overview';
import { DividendCards } from './overview/DividendCards';
import { HoldingsCards } from './overview/HoldingsCards';
import { TrendCards } from './overview/TrendCards';
import { useOverviewData } from './overview/useOverviewData';
import { FxEffectCard, LookThroughCard } from './overview/InsightCards';

/**
 * 대시보드 — 전체 브로커/계좌를 한데 합친 요약 화면. 다른 화면들(보유 종목/배당금/
 * 매매내역)은 브로커·계좌 단위로 파고드는 화면이고, 이 화면만 유일하게 "전부 합쳐서"
 * 본다 — 그래서 자동 새로고침 없이 마운트 시 한 번 + 수동 새로고침 버튼만 둔다
 * (브로커마다 계좌 목록 조회 + 계좌마다 보유종목 조회를 병렬로 하므로 호출량이 다른
 * 화면보다 훨씬 많다 — Dashboard.tsx의 "전체 계좌" 모드를 브로커 여러 개로 넓힌 것).
 *
 * 2026-11-17 나눴다: 데이터는 overview/useOverviewData.ts, 계산은 calc/overview.ts(테스트 frontend/test/overview.test.ts),
 * 카드는 overview/HoldingsCards·DividendCards·TrendCards. 여기엔 상단 요약 타일과 여러 카드가 같이 쓰는 값만 둔다.
 */
export default function Overview() {
  const data = useOverviewData();
  const { holdings, dividends, trades, accountLabels, toKrw, dividendFxRateFor } = data;
  const [year, setYear] = useState(new Date().getFullYear());

  // 배당 팝업의 "총 주식갯수"(오늘 기준 보유수량) — 종목별 상세 집계의 수량을 그대로 쓴다.
  const qtyBySymbol = useMemo(
    () => new Map(holdingDetailRows(holdings, toKrw).map((r) => [r.symbol, r.quantity])),
    [holdings, toKrw]
  );
  const dividendMonthlyRows = useMemo(() => dividendMonthlyRowsOf(dividends, year), [dividends, year]);
  const yearDividends = useMemo(() => yearDividendTotal(dividendMonthlyRows, dividendFxRateFor), [dividendMonthlyRows, dividendFxRateFor]);
  const heldDividends = useMemo(
    () => heldDividendTotal(holdings, dividends, accountLabels, dividendFxRateFor),
    [holdings, dividends, accountLabels, dividendFxRateFor]
  );

  // 월별 수익률·투자금 두 카드와 지수 비교가 같은 월별 체크포인트에서 나온다 — 한 번만 계산해 나눠 쓴다.
  const monthlyAmountRows = useMemo(
    () => monthlyAmountRowsOf(holdings, trades, data.monthlyClosePrices, toKrw),
    [holdings, trades, data.monthlyClosePrices, toKrw]
  );
  const monthlyReturnRows = useMemo(
    () =>
      monthlyAmountRows.map((r) => ({
        month: r.month,
        rate: (r.currentKrw - r.investedKrw) / r.investedKrw,
        amountKrw: r.currentKrw - r.investedKrw,
      })),
    [monthlyAmountRows]
  );
  const indexComparisonRows = useMemo(() => indexComparisonRowsOf(monthlyAmountRows, data.indexCloses), [monthlyAmountRows, data.indexCloses]);
  const hasIndexData = Object.values(data.indexCloses).some((l) => l.length > 0);

  if (data.loading) return <p>불러오는 중...</p>;
  if (data.error)
    return (
      <p className="notice text-critical" style={{ whiteSpace: 'pre-wrap' }}>
        {data.error}
      </p>
    );

  const { totalPurchaseKrw, totalMarketKrw } = data;
  const totalPl = totalMarketKrw - totalPurchaseKrw;
  const totalPlWithDividends = totalPl + heldDividends.totalKrw;
  // 맨 위 카드의 % — 전부 **총 매입금액(지금 보유 종목의 투자금) 대비**(2026-11-20 사용자 요청). 종목별 수익 화면의 손익률·배당수익률과 같은 기준.
  const plRate = ratioOf(totalPl, totalPurchaseKrw);
  const plWithDividendsRate = ratioOf(totalPlWithDividends, totalPurchaseKrw);
  const yearDividendRate = ratioOf(yearDividends.totalKrw, totalPurchaseKrw);
  const tileNote = { fontSize: 12, color: 'var(--text-muted)', marginTop: 2 } as const;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">대시보드</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.lastLoadedAt && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {data.lastLoadedAt.toLocaleTimeString('ko-KR')} 기준
            </span>
          )}
          <button className="ghost" onClick={data.handleRefresh} disabled={data.refreshing}>
            {data.refreshing ? '새로고침 중...' : '새로고침'}
          </button>
        </div>
      </div>

      {data.unconvertedUsdHoldings && (
        <div className="notice">
          USD 보유종목이 있지만 환율을 가져오지 못해 일부 합계에서 제외됩니다. 설정 화면에서 USD/KRW 환율을
          직접 입력하시거나, 토스증권 연동 상태를 확인해주세요.
        </div>
      )}

      <div className="summary-row">
        <PurchaseMarketTile
          purchase={{ krw: totalPurchaseKrw }}
          market={{ krw: totalMarketKrw, note: plRate === null ? undefined : `매입 대비 ${formatRatePct(plRate)}` }}
        />
        <div className="stat-tile">
          <div className="label">총 손익금액 (배당 제외)</div>
          <div className="value" style={{ color: totalPl >= 0 ? 'var(--good)' : 'var(--critical)' }}>
            {totalPl >= 0 ? '+' : ''}
            {formatKrwValue(totalPl)}
          </div>
          <div style={tileNote}>수익률 {formatRatePct(plRate)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">총 손익금액 (배당 포함)</div>
          <div
            className="value"
            style={{ color: totalPlWithDividends >= 0 ? 'var(--good)' : 'var(--critical)' }}
            title={`평가손익 ${formatKrwValue(totalPl)} + 보유 종목 누적 배당금 ${formatKrwValue(heldDividends.totalKrw)}`}
          >
            {totalPlWithDividends >= 0 ? '+' : ''}
            {formatKrwValue(totalPlWithDividends)}
          </div>
          <div style={tileNote}>
            수익률 {formatRatePct(plWithDividendsRate)}
            {heldDividends.totalKrw > 0 && ` · 배당 ${formatRatePct(ratioOf(heldDividends.totalKrw, totalPurchaseKrw), false)}`}
          </div>
          {heldDividends.unconverted && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>일부 배당은 환율이 없어 빠짐</div>
          )}
        </div>
        <div className="stat-tile">
          <div className="label">{year}년 총 배당금</div>
          <div className="value">{formatKrwValue(yearDividends.totalKrw)}</div>
          <div style={tileNote}>투자금 대비 {formatRatePct(yearDividendRate, false)}</div>
        </div>
      </div>

      <HoldingsCards
        holdings={holdings}
        accountLabels={accountLabels}
        totalMarketKrw={totalMarketKrw}
        toKrw={toKrw}
        whenActive={data.whenActive}
      />
      <DividendCards
        year={year}
        onYearChange={setYear}
        dividends={dividends}
        monthlyRows={dividendMonthlyRows}
        yearTotalKrw={yearDividends.totalKrw}
        hasUnconvertedUsdDividend={yearDividends.hasUnconvertedUsd}
        accountLabels={accountLabels}
        rateFor={dividendFxRateFor}
        qtyBySymbol={qtyBySymbol}
      />
      <FxEffectCard holdings={holdings} trades={trades} currentFx={toKrw(1, 'USD')} />
      <LookThroughCard holdings={holdings} toKrw={toKrw} />
      <TrendCards
        monthlyReturnRows={monthlyReturnRows}
        monthlyAmountRows={monthlyAmountRows}
        indexComparisonRows={indexComparisonRows}
        hasIndexData={hasIndexData}
        loadingClosePrices={data.loadingClosePrices}
        netWorthSnapshots={data.netWorthSnapshots}
      />
    </div>
  );
}
