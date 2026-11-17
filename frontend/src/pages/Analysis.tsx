import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { BROKER_LABELS } from '../brokers';
import { accountLabelKey, TAX_TYPE_LABELS } from '../accountLabels';
import { monthlyAmountRows as monthlyAmountRowsOf } from '../calc/overview';
import {
  benchmarkTable,
  closesToReturns,
  costByYear,
  diversification,
  holdingRisk,
  monthlyReturns,
  riskSummary,
  type MonthlyReturn,
} from '../calc/analysis';
import { localToday } from '../format';
import { usePlanner } from '../usePlanner';
import type { AccountTaxType, AccountTaxTypeEntry, BrokerId } from '../types';
import { useOverviewData } from './overview/useOverviewData';
import { BenchmarkCard, CostCard, DiversificationCard, RiskCard } from './analysis/AnalysisCards';
import { SimulationCard } from './analysis/SimulationCard';

/**
 * 분석 — 벤치마크 대비 성과, 위험 지표, 분산 현황, 비용 분석, 은퇴·목표 시뮬레이션(calc/analysis.ts·simulation.ts).
 * 데이터는 대시보드와 같은 `useOverviewData`(모든 증권사·계좌 보유, 매매내역, 배당, 월별 종가, 국내 지수)를 쓰고, 미국 벤치마크(SPY·QQQ)
 * 월말 종가와 계좌 세금 유형만 따로 받는다.
 */
export default function Analysis() {
  const data = useOverviewData({ captureSnapshot: false });
  const { holdings, trades, dividends, toKrw, dividendFxRateFor } = data;
  const { planner, update } = usePlanner();
  const [usBench, setUsBench] = useState<Record<string, MonthlyReturn[]>>({});
  const [taxTypes, setTaxTypes] = useState<AccountTaxTypeEntry[]>([]);
  useEffect(() => {
    api
      .getMonthlyClosePrices(['SPY', 'QQQ'], 14)
      .then((r) =>
        setUsBench(Object.fromEntries(Object.entries(r).map(([k, list]) => [k, closesToReturns(list.map((c) => ({ month: c.month, close: c.closePrice })))])))
      )
      .catch(() => {});
    api.listAccountTaxTypes().then(setTaxTypes).catch(() => {});
  }, []);

  const amountRows = useMemo(() => monthlyAmountRowsOf(holdings, trades, data.monthlyClosePrices, toKrw), [holdings, trades, data.monthlyClosePrices, toKrw]);
  const mine = useMemo(() => monthlyReturns(amountRows), [amountRows]);
  const benches = useMemo(() => {
    const out: Record<string, MonthlyReturn[]> = {};
    for (const k of ['KOSPI', 'KOSDAQ']) if (data.indexCloses[k]?.length) out[k] = closesToReturns(data.indexCloses[k]);
    for (const [k, v] of Object.entries(usBench)) if (v.length) out[k] = v;
    return out;
  }, [data.indexCloses, usBench]);
  const benchRows = useMemo(() => benchmarkTable(mine, benches, Number(localToday().slice(5, 7))), [mine, benches]);
  const risk = useMemo(() => riskSummary(mine, benches.KOSPI ?? []), [mine, benches]);

  // 평가 상위 6종목 — 종목별 변동성·상관계수
  const top = useMemo(() => {
    const by = new Map<string, { name: string; v: number }>();
    for (const h of holdings) {
      const v = toKrw(h.quantity * h.lastPrice, h.currency);
      if (v === null) continue;
      const cur = by.get(h.symbol) ?? { name: h.name, v: 0 };
      cur.v += v;
      by.set(h.symbol, cur);
    }
    return [...by.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 6).map(([symbol, x]) => ({ symbol, name: x.name }));
  }, [holdings, toKrw]);
  const hRisk = useMemo(() => holdingRisk(top, data.monthlyClosePrices), [top, data.monthlyClosePrices]);

  const taxTypeOf = useMemo(() => {
    const m = new Map(taxTypes.map((t) => [accountLabelKey(t.broker, t.accountId), t.taxType]));
    return (broker: string, accountId: string) => TAX_TYPE_LABELS[(m.get(accountLabelKey(broker as BrokerId, accountId)) ?? 'GENERAL') as AccountTaxType];
  }, [taxTypes]);
  const div = useMemo(
    () => diversification(holdings, toKrw, (b) => BROKER_LABELS[b as BrokerId] ?? b, taxTypeOf),
    [holdings, toKrw, taxTypeOf]
  );
  const costs = useMemo(() => costByYear(trades, dividends, dividendFxRateFor), [trades, dividends, dividendFxRateFor]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1>분석</h1>
        <button type="button" className="ghost" onClick={() => data.handleRefresh()} disabled={data.refreshing}>
          {data.refreshing ? '불러오는 중...' : '새로고침'}
        </button>
      </div>
      {data.error && <p className="text-critical">{data.error}</p>}
      {data.loading ? (
        <div className="card">
          <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>
        </div>
      ) : (
        <>
          {data.loadingClosePrices && <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>월별 종가를 받는 중입니다 — 성과·위험 지표가 곧 채워집니다.</p>}
          <BenchmarkCard rows={benchRows} benchKeys={Object.keys(benches)} />
          <RiskCard risk={risk} holdingRows={hRisk.rows} matrix={hRisk.matrix} />
          <DiversificationCard d={div} />
          <CostCard rows={costs} />
          <SimulationCard currentKrw={div.totalKrw} planner={planner} onSave={update} />
        </>
      )}
    </div>
  );
}
