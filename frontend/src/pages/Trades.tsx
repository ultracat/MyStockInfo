import { useMemo, useState } from 'react';
import { SavingsPlanCard } from './trades/SavingsPlanCard';
import type { StoredTrade, TradeRecord } from '../types';
import TradesChart from '../components/TradesChart';
import { toDisplayTrades, tradeBuckets, tradeTotals, type DisplayTrade, type ViewMode } from '../calc/trades';
import CollapseToggle from '../components/CollapseToggle';
import { krw } from '../format';
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import { TradeAddCard } from './trades/TradeAddCard';
import { TradeListCard } from './trades/TradeListCard';
import { TradesToolbar } from './trades/TradesToolbar';
import { useTradesData, type BrokerSelection } from './trades/useTradesData';

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

// 매매내역 화면 — 2026-11-17 나눴다: 데이터는 trades/useTradesData.ts, 집계는 calc/trades.ts, 머리줄·추가 폼·목록은 trades/*.
// 여기엔 선택(증권사·계좌·보기·연도·월), 상단 타일, 그래프만 둔다.
export default function Trades() {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [viewMode, setViewMode] = useState<ViewMode>('year');
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [chartCollapsed, setChartCollapsed] = useState(false);
  const data = useTradesData(year);
  const { loading, error, selectedBroker, setSelectedBroker, accounts, accountId, setAccountId, accountLabels, trades, allTrades, effectiveFxRate } = data;

  const isAllMode = selectedBroker === 'ALL';

  // "전체" 모드는 allTrades(로컬 저장소 전체)를, 개별 브로커 모드는 위쪽
  // 선택으로 이미 받아온 trades를 소스로 쓴다 — 둘 다 우선 연도로 좁힌다.
  // (개별 브로커 모드에서 API 브로커는 애초에 [from,to]가 연도 범위라 이 필터가
  // 항상 참이라 무해하지만, CSV 전용 브로커는 계좌 전체 히스토리를 한 번에
  // 받아오므로 이 필터가 실제로 여러 해를 걸러내는 역할을 한다 — 이전엔 연간
  // 보기에서 연도 무관하게 다 합산되는 버그가 있었음.)
  const periodTrades = useMemo(() => {
    const source: (TradeRecord | StoredTrade)[] = isAllMode ? allTrades : trades;
    return source.filter((t) => t.executedAt.startsWith(String(year)));
  }, [isAllMode, allTrades, trades, year]);

  // 연간 보기면 periodTrades를 12개월 버킷으로, 월간 보기면 선택한 달의
  // 거래만 골라 그 달의 날짜 수만큼 일별 버킷으로 나눈다.
  const visibleTrades = useMemo(() => {
    if (viewMode === 'year') return periodTrades;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return periodTrades.filter((t) => t.executedAt.startsWith(prefix));
  }, [periodTrades, viewMode, year, month]);

  const chartRows = useMemo(() => tradeBuckets(periodTrades, visibleTrades, viewMode, year, month), [periodTrades, visibleTrades, viewMode, year, month]);
  const totals = useMemo(() => tradeTotals(visibleTrades), [visibleTrades]);

  // 매매내역 목록(하단 표)은 별도 필터 없이 위쪽에서 고른 기간(연도/월)·
  // 브로커·계좌를 그대로 따라간다("전체"면 allTrades 기반 visibleTrades를,
  // 개별 브로커면 trades 기반 visibleTrades를 그대로) — 두 소스의 행 모양이
  // 달라서(TradeRecord엔 broker/accountId가 없음) DisplayTrade로 정규화한다.
  const displayTrades = useMemo<DisplayTrade[]>(() => {
    if (isAllMode) return visibleTrades as StoredTrade[];
    if (!selectedBroker || !accountId) return [];
    return toDisplayTrades(visibleTrades as TradeRecord[], selectedBroker, accountId);
  }, [isAllMode, visibleTrades, selectedBroker, accountId]);

  const sortedTrades = useMemo(
    () => [...displayTrades].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)),
    [displayTrades]
  );

  function amountTileValue(krwAmount: number, usdAmount: number) {
    if (!usdAmount) return `${krw.format(Math.round(krwAmount))}원`;
    const total = krwAmount + (effectiveFxRate ? usdAmount * effectiveFxRate : 0);
    return effectiveFxRate ? `${krw.format(Math.round(total))}원` : '환율 미적용';
  }

  if (loading && trades.length === 0 && !error) return <p>불러오는 중...</p>;
  if (error)
    return (
      <p className="notice text-critical" style={{ whiteSpace: 'pre-wrap' }}>
        {error}
      </p>
    );

  return (
    <div>
      <TradesToolbar data={data} />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div className="form-row">
          <label>증권사</label>
          <select
            value={selectedBroker ?? ''}
            onChange={(e) => {
              // Dashboard.tsx와 같은 이유로 accountId를 같은 커밋에서 동기적으로 리셋한다.
              setSelectedBroker(e.target.value as BrokerSelection);
              setAccountId(null);
            }}
          >
            <option value="ALL">전체</option>
            {data.configuredBrokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        </div>

        {!isAllMode && accounts.length > 1 && selectedBroker && (
          <div className="form-row">
            <label>계좌</label>
            <select
              value={accountId ?? ''}
              onChange={(e) => {
                data.userPickedAccountRef.current = true;
                setAccountId(e.target.value);
              }}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountOption(
                    a,
                    findAccountLabel(accountLabels, selectedBroker, a.id)
                  )}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-row">
          <label>보기</label>
          <select
            value={viewMode}
            onChange={(e) => {
              setViewMode(e.target.value as ViewMode);
            }}
          >
            <option value="year">연간</option>
            <option value="month">월간</option>
          </select>
        </div>

        <div className="form-row">
          <label>연도</label>
          <select
            value={year}
            onChange={(e) => {
              setYear(Number(e.target.value));
            }}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>

        {viewMode === 'month' && (
          <div className="form-row">
            <label>월</label>
            <select
              value={month}
              onChange={(e) => {
                setMonth(Number(e.target.value));
              }}
            >
              {MONTH_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">총 매수금액</div>
          <div className="value">{amountTileValue(totals.buyKrw, totals.buyUsd)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">총 매도금액</div>
          <div className="value">{amountTileValue(totals.sellKrw, totals.sellUsd)}</div>
        </div>
        <div className="stat-tile">
          <div className="label">매수 건수</div>
          <div className="value">{totals.buyCount}건</div>
        </div>
        <div className="stat-tile">
          <div className="label">매도 건수</div>
          <div className="value">{totals.sellCount}건</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ margin: 0 }}>
            {viewMode === 'year' ? `${year}년 월별 매수/매도` : `${year}년 ${month}월 일별 매수/매도`}
          </h3>
          <CollapseToggle collapsed={chartCollapsed} onClick={() => setChartCollapsed((c) => !c)} />
        </div>
        {!chartCollapsed && (
          <div style={{ marginTop: 12 }}>
            <TradesChart rows={chartRows} />
          </div>
        )}
      </div>

      <SavingsPlanCard allTrades={allTrades} fxRate={effectiveFxRate} />
      <TradeAddCard onAdded={data.refreshAfterAdd} />
      <TradeListCard
        sortedTrades={sortedTrades}
        isAllMode={isAllMode}
        accountLabels={accountLabels}
        periodKey={`${viewMode}|${year}|${month}`}
        periodLabel={viewMode === 'year' ? `${year}년` : `${year}년 ${month}월`}
        kbLinkedAccountId={data.kbLinkedAccountId}
        onEdited={data.refreshAfterEdit}
        onDeleted={data.refreshAfterDelete}
      />
    </div>
  );
}
