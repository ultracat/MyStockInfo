import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { effectiveRate } from '../fx';
import { loadUsdKrwRates } from '../fxLoader';
import {
  excludeReceived,
  brokerDividendSums,
  brokerLines as brokerLinesOf,
  grandTotal as grandTotalOf,
  investedAsOf,
  type BrokerInvested,
  type YearFilter,
} from '../calc/dividends';
import { HEAVY_RESUME_REFRESH_MS, RESUME_REFRESH_MS, useResumeRefresh } from '../pageActivity';
import type { AccountLabel, BrokerId, DividendRecord } from '../types';
import UpcomingDividends from '../components/UpcomingDividends';
import { BROKER_ORDER } from '../brokers';
import { DividendAddCard } from './dividends/DividendAddCard';
import { DividendListCard } from './dividends/DividendListCard';
import { DividendSummaryCard } from './dividends/DividendSummaryCard';
import { useDividendSync } from './dividends/useDividendSync';
import { useInvestedByBroker } from './dividends/useInvestedByBroker';
import { useUpcomingDividends } from './dividends/useUpcomingDividends';
import { DividendCalendarCard } from './dividends/DividendCalendarCard';
import { DividendYieldCard } from './dividends/DividendYieldCard';
import { usePlanner } from '../usePlanner';
import Hint from '../components/Hint';
import SectionNav from '../components/SectionNav';

const CURRENT_YEAR = new Date().getFullYear();

// 배당금 화면 — 2026-11-17 나눴다: 데이터 훅(dividends/use*.ts), 계산(calc/dividends.ts), 카드(dividends/*Card.tsx).
// 여기엔 여러 카드가 같이 쓰는 것만 둔다 — 배당 기록, 연도 필터, 환율(오늘·지급월 평균), 계좌 별칭, 상단 총합계.
/** 이번 달 마지막 날(이 PC 날짜). */
function monthEndLocal(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
}

export default function Dividends() {
  const [records, setRecords] = useState<DividendRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<YearFilter>('ALL');

  // 배당금 화면 전용 환율: 달러 배당/투자금을 원화로 환산해 보여주기 위함.
  // Dashboard.tsx의 비중 계산과 같은 우선순위(설정에서 직접 입력한 값 >
  // 토스 실시간 환율)를 그대로 따른다 — 토스만 환율 API를 제공한다.
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = effectiveRate(manualFxRate, liveFxRate);

  // 배당금은 오늘 환율이 아니라 그 배당금이 지급된 달의 평균 환율로 환산한다
  // (한국수출입은행 영업일 매매기준율 평균 — Overview.tsx와 같은 이유/방식,
  // backend/CLAUDE.md의 "월별 종가 조회" 절 인근 참고). 그 달을 못 구했으면
  // effectiveFxRate(오늘/수동 환율)로 대체한다.
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});
  const dividendFxRateFor = useCallback(
    (month: string): number | null => monthlyAvgFxRates[month]?.rate ?? effectiveFxRate,
    [monthlyAvgFxRates, effectiveFxRate]
  );

  async function refresh() {
    setRecords(await api.listDividends());
  }

  const { upcoming: upcomingRaw, loadUpcoming } = useUpcomingDividends();
  // 이미 받은 배당(같은 증권사·계좌·종목·지급일 기록)은 다가오는 배당 목록·그래프에서 뺀다 — 지급일 당일까지 남는 항목이
  // 입금(기록) 뒤에도 남아 있지 않게(calc/dividends.ts excludeReceived).
  // 백엔드에서 12개월치를 한 번 받는다(2026-11-17 UI 점검 — 예전엔 12개월 카드가 따로 한 번 더 받아 표와 어긋날 수 있었다).
  // 목록·월별 그래프의 예상 막대는 예전처럼 "확정 + 이번 달 지급 예상·추정"만, 12개월 카드와 달력은 전부.
  const upcomingAll = useMemo(() => (upcomingRaw.items ? excludeReceived(upcomingRaw.items, records) : null), [upcomingRaw, records]);
  const upcoming = useMemo(
    () => (upcomingAll ? { ...upcomingRaw, items: upcomingAll.filter((i) => i.status === 'confirmed' || ((i.payDate ?? i.recordDate) ?? '') <= monthEndLocal()) } : upcomingRaw),
    [upcomingRaw, upcomingAll]
  );
  const sync = useDividendSync(refresh);
  const { planner, update: updatePlanner } = usePlanner();
  const invested = useInvestedByBroker();
  const { investedByBroker, investedErrors, investedLoading, avgCostByBroker, tradesByBroker } = invested;

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

  // records가 바뀔 때마다(최초 로드/추가/수정/가져오기 등) 그 안의 달러 배당
  // 기록이 걸쳐 있는 달들의 평균 환율을 다시 구한다 — 연도 필터(year)는 이
  // records 전체에서 클라이언트 쪽으로만 좁히는 필터라 여기 의존성에 안 넣는다
  // (연도를 바꿔도 이미 가진 records 범위 안이면 새로 조회할 게 없다). 백엔드가
  // 달마다 이미 강하게 캐싱해서(4시간~30일) 반복 호출이 비싸지 않다.
  // 한국수출입은행 환율 인증키(사용자 입력) — 없으면 달러 배당을 지급월 평균 환율로 못 바꿔 오늘 환율로 환산된다.
  // 그 사실을 화면 위에 알린다(설정에서 키를 넣으면 dataChanged로 다시 보일 때 갱신).
  const [eximbankConfigured, setEximbankConfigured] = useState<boolean | null>(null);
  const loadEximbankStatus = () =>
    api
      .getEximbankKeyStatus()
      .then((s) => setEximbankConfigured(s.configured))
      .catch(() => {});
  useEffect(() => {
    void loadEximbankStatus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const months = [...new Set(records.filter((r) => r.currency === 'USD').map((r) => r.paidDate.slice(0, 7)))];
    if (months.length === 0) {
      setMonthlyAvgFxRates({});
      return;
    }
    api
      .getMonthlyAvgUsdKrwRates(months)
      .then((rates) => {
        if (!cancelled) setMonthlyAvgFxRates(rates);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [records]);

  // 계좌 별칭 — 관리는 Settings.tsx에서만 하고 여기선 읽기만 한다(마운트 시 한 번).
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  useEffect(() => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 수동·실시간을 동시에 받는다(fxLoader.ts) — 실패해도 던지지 않고 null. 규칙은 fx.ts의 effectiveRate.
      const { manual, live } = await loadUsdKrwRates();
      if (cancelled) return;
      setManualFxRate(manual);
      if (live !== null) setLiveFxRate(live);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 메뉴를 옮겼다 돌아오면 지금 화면을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx) — 배당 기록·계좌 별칭·다가오는 배당·
  // 투자금은 30초 간격, 증권사 배당 동기화(거래내역을 통째로 다시 받음)는 10분 간격.
  useResumeRefresh(() => {
    refresh().catch(() => {});
    void loadEximbankStatus();
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
    if (!upcoming.refreshing) loadUpcoming();
    invested.reload();
  }, RESUME_REFRESH_MS);
  useResumeRefresh(() => {
    if (sync.syncOwnedBrokers.size > 0 && !sync.dividendSyncing) void sync.runDividendSync(false);
  }, HEAVY_RESUME_REFRESH_MS);

  // 특정 연도를 고르면 배당수익률의 분모(투자금)도 그 연도 기준으로 바꾼다 —
  // "전체"는 지금처럼 오늘 투자금을 그대로 쓴다. 그 해 12/31까지의 매매내역만으로
  // 종목별 누적 보유수량을 재구성하고(Overview.tsx의 monthlyAmountRows와 같은
  // 알고리즘 — BUY는 더하고 SELL은 그만큼 빼되 0 밑으로 안 내려가게 clamp), 그
  // 수량에 매매내역에서 재구성한 과거 원가가 아니라 오늘 기준 평단가
  // (avgCostByBroker, 이미 신뢰할 수 있는 값)를 곱한다 — 이 프로젝트가 매매내역으로
  // 원가 자체를 재구성했다가 계좌마다 매매내역이 다 안 모여있어 상단 통계와
  // 어긋난 전례가 있어(Overview.tsx 주석 참고) 같은 이유로 원가는 항상 오늘 값을
  // 쓴다. **한계**: 지금 보유 중인 종목만 대상이라(avgCostByBroker에 있는 심볼만),
  // 전량 매도한 종목은 그 해에 배당을 줬어도 그 해 투자금엔 안 잡힌다. 매매내역이
  // 로컬 저장소 기준이라, 한 번도 조회/동기화/CSV로 안 채운 계좌의 과거 매수도
  // 반영이 안 될 수 있다.
  const investedByBrokerForYear = useMemo(() => {
    if (year === 'ALL') return investedByBroker;
    const cutoff = `${year}-12-31`;

    const result: Partial<Record<BrokerId, BrokerInvested>> = {};
    for (const brokerId of Object.keys(avgCostByBroker) as BrokerId[]) {
      const costs = avgCostByBroker[brokerId];
      if (!costs) continue;

      // 연도 말 기준 투자금 재구성 — calc/dividends.ts(순수 함수, 테스트 있음).
      result[brokerId] = investedAsOf(costs, tradesByBroker[brokerId] ?? [], cutoff);
    }
    return result;
  }, [year, investedByBroker, avgCostByBroker, tradesByBroker]);

  const yearOptions = useMemo(() => {
    const years = new Set<number>([CURRENT_YEAR]);
    for (const r of records) years.add(Number(r.paidDate.slice(0, 4)));
    return Array.from(years).sort((a, b) => b - a);
  }, [records]);

  // 연도 선택은 배당 기록(과거 데이터)에만 적용된다 — investedByBroker는
  // "지금 시점의 보유 투자금"이라 연도별로 나뉘는 값이 아니어서 그대로 둔다.
  const visibleRecords = useMemo(() => {
    if (year === 'ALL') return records;
    const prefix = String(year);
    return records.filter((r) => r.paidDate.startsWith(prefix));
  }, [records, year]);

  // 증권사 필터 옵션 — 실제로 기록이 있는 증권사만 보여준다(연도와 무관하게 records
  // 전체 기준 — 특정 연도로 좁혔을 때 옵션 목록이 들쭉날쭉 사라졌다 나타났다 하지
  // 않게 하기 위함). "월별 배당금" 그래프용(chartBroker)과 하단 "배당 기록" 목록용
  // (listBroker) 두 필터가 이 옵션 목록을 그대로 같이 쓴다.
  const brokerOptions = useMemo(() => {
    const present = new Set<BrokerId>(records.map((r) => r.broker));
    return BROKER_ORDER.filter((id) => present.has(id));
  }, [records]);

  const sums = useMemo(() => brokerDividendSums(visibleRecords, dividendFxRateFor), [visibleRecords, dividendFxRateFor]);
  const brokerLines = useMemo(
    () =>
      brokerLinesOf(sums, investedByBrokerForYear, effectiveFxRate, (b) =>
        investedLoading ? '불러오는 중...' : investedErrors[b] ? '조회 실패' : '-'
      ),
    [sums, investedByBrokerForYear, effectiveFxRate, investedLoading, investedErrors]
  );
  const grandTotal = useMemo(
    () => grandTotalOf(sums, investedByBrokerForYear, effectiveFxRate, investedLoading),
    [sums, investedByBrokerForYear, effectiveFxRate, investedLoading]
  );

  return (
    <div>
      <h2 className="page-title">배당금</h2>
      <SectionNav
        items={[
          { id: 'div-monthly', label: '월별 배당' },
          { id: 'div-upcoming', label: '다가오는 배당' },
          { id: 'div-calendar', label: '배당 달력' },
          { id: 'div-yield', label: '종목별 배당수익률' },
          { id: 'div-list', label: '배당 기록' },
        ]}
      />
      <Hint card>
        토스증권·한국투자증권은 API 키가 등록돼 있으면 이 화면에 들어올 때 배당(국내 ETF 분배금, 외화세금환급 포함)을
        API 내용으로 자동으로 맞춥니다 — 그 증권사 기록은 직접 고칠 수 없습니다. 그 밖의 증권사는 입금된 배당을
        조회하는 API가 없어 지급 시 직접 입력합니다. 배당금은 세후 실수령액이고, 세금은 따로 적습니다.
      </Hint>
      {eximbankConfigured === false && records.some((r) => r.currency === 'USD') && (
        <div className="notice">
          <strong>한국수출입은행 환율 인증키가 없습니다.</strong> 달러 배당금을 지급한 달의 평균 환율 대신 오늘 환율로 원화
          환산하고 있습니다. <strong>설정 → 한국수출입은행 환율 인증키</strong>에 직접 발급받은 키를 넣어 주세요.
        </div>
      )}

      <div className="form-row">
        <label>연도</label>
        <select value={year} onChange={(e) => setYear(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}>
          <option value="ALL">전체</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
      </div>

      <div className="summary-row">
        <div className="stat-tile">
          <div className="label">총 배당금</div>
          <div className="value">{grandTotal.dividendText}</div>
        </div>
        <div className="stat-tile">
          <div className="label">총 투자금</div>
          <div className="value">{grandTotal.investedText}</div>
        </div>
        <div className="stat-tile">
          <div className="label">총 배당수익률</div>
          <div className="value">{grandTotal.yieldText}</div>
        </div>
      </div>

      <div id="div-monthly" className="section-anchor" />
      <DividendSummaryCard
        year={year}
        visibleRecords={visibleRecords}
        brokerOptions={brokerOptions}
        upcomingItems={upcoming.items}
        rateFor={dividendFxRateFor}
        avgCostByBroker={avgCostByBroker}
        lines={brokerLines}
        investedLoading={investedLoading}
        projection={{
          items: upcomingAll,
          available: upcomingRaw.available,
          error: upcomingRaw.error,
          records: records,
          rateFor: dividendFxRateFor,
          goalKrw: planner?.dividendGoalMonthlyKrw ?? null,
          onGoalChange: async (v) => void (await updatePlanner({ dividendGoalMonthlyKrw: v })),
        }}
      />

      <div id="div-upcoming" className="section-anchor" />
      <UpcomingDividends accountLabels={accountLabels} state={upcoming} onRefresh={() => loadUpcoming(true)} />


      <div id="div-calendar" className="section-anchor" />
      <DividendCalendarCard records={records} upcomingItems={upcomingAll} />

      <div id="div-yield" className="section-anchor" />
      <DividendYieldCard records={records} rateFor={dividendFxRateFor} />

      <div id="div-list" className="section-anchor" />
      <DividendAddCard
        syncOwnedBrokers={sync.syncOwnedBrokers}
        isRowSyncOwned={sync.isRowSyncOwned}
        error={error}
        setError={setError}
        onAdded={refresh}
      />
      <DividendListCard
        year={year}
        visibleRecords={visibleRecords}
        brokerOptions={brokerOptions}
        accountLabels={accountLabels}
        sync={sync}
        refresh={refresh}
        fxRateFor={dividendFxRateFor}
      />
    </div>
  );
}
