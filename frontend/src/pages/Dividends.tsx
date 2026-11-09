import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, BrokerId, DividendCurrency, DividendRecord, MonthlySummaryRow, StoredTrade } from '../types';
import DividendsChart from '../components/DividendsChart';
import DonutDetailModal from '../components/DonutDetailModal';
import CollapseToggle from '../components/CollapseToggle';
import { krw, usdFmt } from '../format';
import { downloadCsv, parseCsv } from '../csv';
import { formatImportResult } from '../importResult';
import { API_BROKER_IDS, BROKER_LABELS, BROKER_ORDER } from '../brokers';
import { accountLabelKey } from '../accountLabels';
import StockNameLink, { useStockLinkResolver } from '../components/StockNameLink';

// export/import 왕복 호환을 위한 CSV 컬럼 — DividendRecord 필드명을 그대로 헤더로
// 쓴다(한글 헤더 대신 필드명을 쓰는 이유: 내보낸 파일을 그대로 다시 가져올 때
// 헤더 매칭이 대소문자만 다르면 되게 하기 위함). name(종목명)은 없다 — 심볼로부터
// 서버가 자동조회하므로 CSV에 넣을 필요가 없다(가져오기도 마찬가지). accountId는
// 선택 컬럼 — 브로커 한 곳에 계좌가 여러 개일 때만 채우면 된다.
// amount = 세후(실수령), tax = 원천징수 세금(선택 — 예전 CSV처럼 없어도 된다).
const DIVIDEND_CSV_HEADER = ['broker', 'accountId', 'symbol', 'currency', 'amount', 'paidDate', 'memo', 'tax'];

// 토스 종목 기본 정보 API가 symbols 파라미터에 실제로 허용하는 문자 범위
// (backend/src/routes/stockInfo.ts의 TOSS_SYMBOL_PATTERN과 동일 — 백엔드가 이미
// 이 패턴 밖이면 토스를 안 부르고 바로 거부하지만, 한글 IME로 종목명 등을 이
// 칸에 잘못 타이핑하는 동안 자모 하나짜리 중간 상태마다 500ms 디바운스로 왕복
// 요청을 보내는 건 여전히 낭비라 프론트에서도 먼저 걸러 요청 자체를 생략한다).
const SYMBOL_CODE_PATTERN = /^[A-Za-z0-9.,-]+$/;

const today = () => new Date().toISOString().slice(0, 10);
const CURRENT_YEAR = new Date().getFullYear();

function formatKrwValue(v: number) {
  return `${krw.format(Math.round(v))}원`;
}

/** 배당내역 팝업의 종목별 행 meta — 지금 보유 중이 아닌 종목(전량 매도 등)은
 *  수량 정보가 없어 배당 건수만 보여준다. */
function formatDividendMeta(count: number, quantity: number | undefined) {
  return quantity ? `배당 ${count}건 · 보유 ${quantity}주` : `배당 ${count}건`;
}

type YearFilter = 'ALL' | number;
type BrokerFilter = 'ALL' | BrokerId;
type PageSize = 10 | 20 | 30 | 'ALL';

const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, 'ALL'];
const PAGE_GROUP_SIZE = 10;

interface BrokerInvested {
  krw: number;
  usd: number;
}

/** 종목 하나의 오늘 기준 평단가(브로커 안의 여러 계좌에 같은 심볼이 있으면
 *  가중평균) — "연도별 투자금 재구성"이 재구성한 수량에 곱하는 값. quantity는
 *  오늘 기준 실제 보유수량 합계 — 배당내역 팝업의 "총 주식갯수" 표시에 쓴다. */
interface BrokerSymbolCost {
  avgCost: number;
  currency: string;
  quantity: number;
}

interface BrokerLine {
  broker: BrokerId;
  /** Shown in the single leftmost column — broker name on the first line of
   *  a group, an indented segment label on the rest. No separate "구분"
   *  column (that read as a second column next to 증권사, which is what the
   *  user objected to) — segment identity lives in this one column instead. */
  label: string;
  muted: boolean;
  invested: string;
  dividend: string;
  yieldText: string;
}

export default function Dividends() {
  const [records, setRecords] = useState<DividendRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<YearFilter>('ALL');
  const [chartBroker, setChartBroker] = useState<BrokerFilter>('ALL');
  const [listBroker, setListBroker] = useState<BrokerFilter>('ALL');
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);
  const [dividendPanelsCollapsed, setDividendPanelsCollapsed] = useState(false);

  const [broker, setBroker] = useState<BrokerId>('toss');
  const [accountId, setAccountId] = useState('');
  const [currency, setCurrency] = useState<DividendCurrency>('KRW');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [taxInput, setTaxInput] = useState('');

  // 종목명 자동조회 — 백엔드가 심볼별로 로컬 캐시(SQLite, stockNames.sqlite)를
  // 두므로 같은 심볼을 다시 입력해도 매번 토스 API를 부르지 않는다. 사용자가
  // "직접 입력"을 누르면 그 뒤로는 자동조회가 name을 덮어쓰지 않는다.
  const [nameStatus, setNameStatus] = useState<'idle' | 'loading' | 'resolved' | 'error'>('idle');
  const [nameError, setNameError] = useState<string | null>(null);
  const [manualNameEntry, setManualNameEntry] = useState(false);
  const [refreshingNames, setRefreshingNames] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importBroker, setImportBroker] = useState<BrokerFilter>('ALL');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const [investedByBroker, setInvestedByBroker] = useState<Partial<Record<BrokerId, BrokerInvested>>>({});
  const [investedErrors, setInvestedErrors] = useState<Partial<Record<BrokerId, string>>>({});
  const [investedLoading, setInvestedLoading] = useState(true);
  // 아래 investedByBroker 조회 effect가 같이 받아둔다 — 연도를 바꿀 때마다
  // 서버를 다시 안 묻고 클라이언트에서 즉시 "그 연도 기준 투자금"을 재계산하기
  // 위한 재료(investedByBrokerForYear 참고).
  const [avgCostByBroker, setAvgCostByBroker] = useState<Partial<Record<BrokerId, Map<string, BrokerSymbolCost>>>>({});
  const [tradesByBroker, setTradesByBroker] = useState<Partial<Record<BrokerId, StoredTrade[]>>>({});

  // 배당금 화면 전용 환율: 달러 배당/투자금을 원화로 환산해 보여주기 위함.
  // Dashboard.tsx의 비중 계산과 같은 우선순위(설정에서 직접 입력한 값 >
  // 토스 실시간 환율)를 그대로 따른다 — 토스만 환율 API를 제공한다.
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = manualFxRate ?? liveFxRate;

  // 배당금은 오늘 환율이 아니라 그 배당금이 지급된 달의 평균 환율로 환산한다
  // (한국수출입은행 영업일 매매기준율 평균 — Overview.tsx와 같은 이유/방식,
  // backend/CLAUDE.md의 "월별 종가 조회" 절 인근 참고). 그 달을 못 구했으면
  // effectiveFxRate(오늘/수동 환율)로 대체한다.
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});
  function dividendFxRateFor(month: string): number | null {
    return monthlyAvgFxRates[month]?.rate ?? effectiveFxRate;
  }

  async function refresh() {
    setRecords(await api.listDividends());
  }

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

  // ---- 배당 동기화(토스증권·한국투자증권) ----
  // API로 배당을 받을 수 있는 증권사는 그 계좌 배당 기록을 **API 내용으로 통째로 교체**한다(백엔드
  // brokers/*/…DividendSync.ts). 화면에 들어오면 백그라운드로 한 번 돌고, 버튼으로 다시 돌릴 수 있다.
  // 그 증권사 행은 직접 추가·수정·삭제를 막는다(syncOwnedBrokers — 백엔드도 409로 막는다).
  const [syncOwnedBrokers, setSyncOwnedBrokers] = useState<Set<BrokerId>>(new Set());
  const [dividendSyncing, setDividendSyncing] = useState(false);
  const [dividendSyncNotice, setDividendSyncNotice] = useState<string | null>(null);

  async function runDividendSync(manual: boolean) {
    setDividendSyncing(true);
    if (manual) setDividendSyncNotice(null);
    try {
      const { results, errors } = await api.syncDividends();
      const changed = results.filter((r) => r.added > 0 || r.removed > 0);
      const parts = changed.map(
        (r) => `${BROKER_LABELS[r.broker]} 추가 ${r.added}건${r.removed ? ` · 삭제 ${r.removed}건` : ''}`
      );
      const errs = errors.map((e) => `${BROKER_LABELS[e.broker]} 실패: ${e.error}`);
      if (changed.length > 0) await refresh();
      if (parts.length > 0 || errs.length > 0) setDividendSyncNotice(['배당 동기화', ...parts, ...errs].join(' — '));
      else if (manual) setDividendSyncNotice('배당 동기화: 이미 최신입니다.');
    } catch (e) {
      setDividendSyncNotice(`배당 동기화 실패: ${(e as Error).message}`);
    } finally {
      setDividendSyncing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .listBrokers()
      .then((brokers) => {
        const owned = new Set(
          brokers.filter((b) => (b.id === 'toss' || b.id === 'kis') && b.configured).map((b) => b.id)
        );
        if (cancelled || owned.size === 0) return;
        setSyncOwnedBrokers(owned);
        void runDividendSync(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 직접 입력 폼의 증권사 기본값이 API 동기화 증권사면 직접 입력 가능한 첫 증권사로 옮긴다.
  useEffect(() => {
    if (syncOwnedBrokers.has(broker)) {
      const first = BROKER_ORDER.find((id) => !syncOwnedBrokers.has(id));
      if (first) setBroker(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncOwnedBrokers]);

  // records가 바뀔 때마다(최초 로드/추가/수정/가져오기 등) 그 안의 달러 배당
  // 기록이 걸쳐 있는 달들의 평균 환율을 다시 구한다 — 연도 필터(year)는 이
  // records 전체에서 클라이언트 쪽으로만 좁히는 필터라 여기 의존성에 안 넣는다
  // (연도를 바꿔도 이미 가진 records 범위 안이면 새로 조회할 게 없다). 백엔드가
  // 달마다 이미 강하게 캐싱해서(4시간~30일) 반복 호출이 비싸지 않다.
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

  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();

  // 계좌 별칭 — 관리는 Settings.tsx에서만 하고 여기선 읽기만 한다(마운트 시 한 번).
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  useEffect(() => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
  }, []);
  const accountLabelMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of accountLabels) {
      const text = l.label || l.accountNumber;
      if (text) m.set(accountLabelKey(l.broker, l.accountId), text);
    }
    return m;
  }, [accountLabels]);
  function displayAccountId(recordBroker: BrokerId, accountId: string | null): string {
    if (!accountId) return '-';
    return accountLabelMap.get(accountLabelKey(recordBroker, accountId)) ?? accountId;
  }

  // 종목코드 입력이 멈추면(500ms 디바운스) 종목명을 자동조회한다. 사용자가
  // "직접 입력"으로 전환했으면(manualNameEntry) 여기서 name을 건드리지 않는다.
  useEffect(() => {
    const trimmed = symbol.trim();
    if (manualNameEntry) return;
    if (!trimmed) {
      setName('');
      setNameStatus('idle');
      setNameError(null);
      return;
    }
    // 한글 IME로 이 칸에 다른 값을 입력하는 도중(조합 중인 자모 하나짜리 상태
    // 등)엔 토스가 아예 허용하지 않는 문자라 조회할 필요가 없다 — 매 디바운스마다
    // 왕복 요청을 보내는 대신 여기서 바로 "찾을 수 없음"으로 처리한다.
    if (!SYMBOL_CODE_PATTERN.test(trimmed)) {
      setName('');
      setNameStatus('error');
      setNameError(`'${trimmed}' 종목 정보를 찾을 수 없습니다. 종목코드를 확인하거나 직접 입력해주세요.`);
      return;
    }

    let cancelled = false;
    setNameStatus('loading');
    setNameError(null);
    const timer = setTimeout(() => {
      api
        .getStockInfo(trimmed)
        .then((info) => {
          if (cancelled) return;
          setName(info.name);
          setNameStatus('resolved');
        })
        .catch((e) => {
          if (cancelled) return;
          setName('');
          setNameStatus('error');
          setNameError((e as Error).message);
        });
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol, manualNameEntry]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fx = await api.getFxRate().catch(() => ({ usdKrwRate: null }));
      if (cancelled) return;
      setManualFxRate(fx.usdKrwRate);
      // getUsdKrwRate는 토스→한국수출입은행 순으로 시도하고(backend/CLAUDE.md의
      // "환율 조회" 절 참고) 실패해도 예외 없이 {rate:null}을 준다 — 그럼 수동
      // 환율 또는 미환산으로 대체됨.
      const live = await api.getUsdKrwRate().catch(() => ({ rate: null }));
      if (!cancelled && live.rate) setLiveFxRate(live.midRate ?? live.rate);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 종목별 오늘 기준 평단가 — 브로커 안에 계좌가 여러 개면 같은 심볼을 가중평균
  // 한다(investedByBroker가 계좌 경계를 무시하고 브로커 단위로 합산하는 것과
  // 같은 원칙). "연도별 투자금 재구성"(investedByBrokerForYear)이 재구성한
  // 수량에 이 평단가를 곱한다.
  function buildAvgCostMap(
    rows: { symbol: string; currency: string | null; quantity: number; purchaseAmount: number }[]
  ): Map<string, BrokerSymbolCost> {
    const bySymbol = new Map<string, { amount: number; qty: number; currency: string }>();
    for (const r of rows) {
      if (r.quantity <= 0 || !r.currency) continue;
      const existing = bySymbol.get(r.symbol) ?? { amount: 0, qty: 0, currency: r.currency };
      existing.amount += r.purchaseAmount;
      existing.qty += r.quantity;
      bySymbol.set(r.symbol, existing);
    }
    const result = new Map<string, BrokerSymbolCost>();
    for (const [symbol, v] of bySymbol) {
      if (v.qty > 0) result.set(symbol, { avgCost: v.amount / v.qty, currency: v.currency, quantity: v.qty });
    }
    return result;
  }

  useEffect(() => {
    // 투자금(총 매입금액)은 배당 DB에는 없어 증권사 API에서 직접 계좌별로
    // 조회해 합산한다. 브로커 하나가 실패해도(미연동/레이트리밋 등) 나머지는
    // 계속 보여야 하므로 개별 try/catch로 감싼다 — backend/CLAUDE.md의 목록형
    // 엔드포인트 방침과 동일한 이유. 같은 조회에서 종목별 평단가와 매매내역도
    // 같이 받아둔다(avgCostByBroker/tradesByBroker) — "연도별 투자금 재구성"이
    // 연도를 바꿀 때마다 서버를 다시 안 묻고 클라이언트에서 즉시 계산하기 위함.
    let cancelled = false;

    (async () => {
      setInvestedLoading(true);
      const brokers = await api.listBrokers().catch(() => []);
      if (cancelled) return;
      const configured = brokers.filter((b) => b.configured);

      const results = await Promise.all(
        configured.map(async (b) => {
          try {
            const tradesPromise = api.listTradesStore({ broker: b.id });

            if (API_BROKER_IDS.includes(b.id)) {
              const accounts = await api.listAccounts(b.id);
              const portfolios = await Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id)));
              const totalKrw = portfolios.reduce((sum, p) => sum + p.totalPurchaseAmountKrw, 0);
              const totalUsd = portfolios.reduce((sum, p) => sum + (p.totalPurchaseAmountUsd ?? 0), 0);
              const avgCosts = buildAvgCostMap(portfolios.flatMap((p) => p.positions));
              const trades = await tradesPromise;
              return {
                id: b.id,
                invested: { krw: totalKrw, usd: totalUsd } as BrokerInvested | null,
                avgCosts,
                trades,
                error: null as string | null,
              };
            }

            // CSV 전용 브로커(KB/삼성/미래에셋)는 라이브 API가 없다 — 유일한
            // 투자금 소스는 로컬 저장소(holdings-store, CSV로 가져온 실제
            // 보유종목)라 그 매입금액을 통화별로 합산한다(Dashboard.tsx의
            // buildPortfolioFromStored와 같은 집계 방식).
            const holdings = await api.listHoldingsStore({ broker: b.id });
            const totalKrw = holdings.filter((h) => h.currency !== 'USD').reduce((sum, h) => sum + h.purchaseAmount, 0);
            const totalUsd = holdings.filter((h) => h.currency === 'USD').reduce((sum, h) => sum + h.purchaseAmount, 0);
            const avgCosts = buildAvgCostMap(holdings);
            const trades = await tradesPromise;
            return {
              id: b.id,
              invested: { krw: totalKrw, usd: totalUsd } as BrokerInvested | null,
              avgCosts,
              trades,
              error: null as string | null,
            };
          } catch (e) {
            return { id: b.id, invested: null, avgCosts: null, trades: [] as StoredTrade[], error: (e as Error).message };
          }
        })
      );
      if (cancelled) return;

      const invested: Partial<Record<BrokerId, BrokerInvested>> = {};
      const errors: Partial<Record<BrokerId, string>> = {};
      const avgCosts: Partial<Record<BrokerId, Map<string, BrokerSymbolCost>>> = {};
      const trades: Partial<Record<BrokerId, StoredTrade[]>> = {};
      for (const r of results) {
        if (r.invested !== null) invested[r.id] = r.invested;
        if (r.error) errors[r.id] = r.error;
        if (r.avgCosts) avgCosts[r.id] = r.avgCosts;
        trades[r.id] = r.trades;
      }
      setInvestedByBroker(invested);
      setInvestedErrors(errors);
      setAvgCostByBroker(avgCosts);
      setTradesByBroker(trades);
      setInvestedLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
      const brokerTrades = tradesByBroker[brokerId] ?? [];

      const tradesBySymbol = new Map<string, StoredTrade[]>();
      for (const t of brokerTrades) {
        if (!costs.has(t.symbol)) continue; // 지금 안 갖고 있는 종목은 대상 아님
        if (!tradesBySymbol.has(t.symbol)) tradesBySymbol.set(t.symbol, []);
        tradesBySymbol.get(t.symbol)!.push(t);
      }

      let krw = 0;
      let usd = 0;
      for (const [symbol, cost] of costs) {
        const symTrades = (tradesBySymbol.get(symbol) ?? [])
          .filter((t) => t.executedAt <= cutoff)
          .sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1));
        let qty = 0;
        for (const t of symTrades) qty += t.side === 'BUY' ? t.quantity : -Math.min(t.quantity, qty);
        // 과거 시점 보유수량이 오늘 실제 보유수량보다 많을 수는 있지만(그 뒤에
        // 팔았으면), 매도 기록이 다 모여 있지 않거나 매매내역이 중복 저장되면
        // 재구성 수량이 터무니없이 커진다(실사례: 중복으로 NVDY 448주 → 1,631주,
        // 투자금이 2배로 부풀려짐). 매도를 거의 안 하는 배당 포트폴리오에선 오늘
        // 수량이 사실상 상한이라 그걸로 묶는다.
        qty = Math.min(qty, cost.quantity);
        if (qty <= 0) continue;
        const amount = qty * cost.avgCost;
        if (cost.currency === 'USD') usd += amount;
        else krw += amount;
      }
      result[brokerId] = { krw, usd };
    }
    return result;
  }, [year, investedByBroker, avgCostByBroker, tradesByBroker]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountNum = Number(amount);
    if (!symbol || !name || !amountNum || amountNum <= 0 || !paidDate) {
      setError('종목코드, 종목명, 배당금(양수), 지급일을 입력해주세요.');
      return;
    }
    const taxNum = taxInput.trim() ? Number(taxInput) : null;
    if (taxNum !== null && (!Number.isFinite(taxNum) || taxNum < 0)) {
      setError('세금은 0 이상의 숫자로 입력해주세요(모르면 비워 두세요).');
      return;
    }
    try {
      await api.addDividend({
        broker,
        accountId: accountId.trim() || null,
        symbol,
        name,
        currency,
        amount: amountNum,
        paidDate,
        memo: memo || null,
        tax: taxNum,
      });
      setSymbol('');
      setTaxInput('');
      setName('');
      setAmount('');
      setMemo('');
      setManualNameEntry(false);
      setNameStatus('idle');
      setNameError(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDelete(id: string) {
    await api.deleteDividend(id);
    await refresh();
  }

  // 배당 기록 목록의 인라인 수정 — 한 번에 한 행만 편집 가능(editingId).
  // 다른 행에서 "수정"을 누르면 그 행으로 그냥 전환된다(저장 안 한 편집 내용은
  // 버려짐) — 개인용 기록 관리 화면이라 "저장 안 한 변경사항" 경고까지는
  // 과하다고 판단.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    broker: BrokerId;
    accountId: string;
    symbol: string;
    name: string;
    currency: DividendCurrency;
    amount: string;
    paidDate: string;
    memo: string;
    tax: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(r: DividendRecord) {
    setEditingId(r.id);
    setEditDraft({
      broker: r.broker,
      accountId: r.accountId ?? '',
      symbol: r.symbol,
      name: r.name,
      currency: r.currency,
      amount: String(r.amount),
      paidDate: r.paidDate,
      memo: r.memo ?? '',
      tax: r.tax === null ? '' : String(r.tax),
    });
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditError(null);
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    const amountNum = Number(editDraft.amount);
    if (!editDraft.symbol || !editDraft.name || !amountNum || amountNum <= 0 || !editDraft.paidDate) {
      setEditError('종목코드, 종목명, 배당금(양수), 지급일을 입력해주세요.');
      return;
    }
    const editTax = editDraft.tax.trim() ? Number(editDraft.tax) : null;
    if (editTax !== null && (!Number.isFinite(editTax) || editTax < 0)) {
      setEditError('세금은 0 이상의 숫자로 입력해주세요(모르면 비워 두세요).');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateDividend(id, {
        broker: editDraft.broker,
        accountId: editDraft.accountId.trim() || null,
        symbol: editDraft.symbol,
        name: editDraft.name,
        currency: editDraft.currency,
        amount: amountNum,
        paidDate: editDraft.paidDate,
        memo: editDraft.memo || null,
        tax: editTax,
      });
      setEditingId(null);
      setEditDraft(null);
      await refresh();
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function onRefreshNames() {
    setRefreshingNames(true);
    setRefreshResult(null);
    try {
      const result = await api.refreshDividendNames();
      setRefreshResult(
        result.failed.length > 0
          ? `${result.updated}건 갱신됨 (조회 실패: ${result.failed.join(', ')})`
          : `${result.updated}건 갱신됨 (${result.resolved}개 종목 조회)`
      );
      await refresh();
    } catch (e) {
      setRefreshResult((e as Error).message);
    } finally {
      setRefreshingNames(false);
    }
  }

  // listBroker(하단 목록 필터)를 그대로 내보내기 범위로 쓴다 — "전체"면 전체,
  // 특정 증권사를 골라두면 그 증권사만. 화면에 이미 있는 필터를 재사용하는 것뿐이라
  // 내보내기 전용 UI를 따로 둘 필요가 없다.
  function onExportCsv() {
    const rows: string[][] = [
      DIVIDEND_CSV_HEADER,
      ...listFilteredRecords.map((r) => [
        r.broker,
        r.accountId ?? '',
        r.symbol,
        r.currency,
        String(r.amount),
        r.paidDate,
        r.memo ?? '',
        r.tax === null ? '' : String(r.tax),
      ]),
    ];
    const scope = listBroker === 'ALL' ? 'all' : listBroker;
    downloadCsv(`dividends-${scope}-${today()}.csv`, rows);
  }

  function onImportClick() {
    fileInputRef.current?.click();
  }

  // CSV 헤더에서 필요한 컬럼 인덱스를 찾는다 — 컬럼 순서가 바뀐 파일도(예: 사용자가
  // 스프레드시트에서 열 순서를 바꿔 저장한 경우) 헤더 이름만 맞으면 그대로 읽는다.
  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setImportResult('CSV 파일이 비어 있습니다.');
        return;
      }

      const [header, ...dataRows] = rows;
      const colIndex = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
      const iBroker = colIndex('broker');
      const iAccountId = colIndex('accountId');
      const iSymbol = colIndex('symbol');
      const iCurrency = colIndex('currency');
      const iAmount = colIndex('amount');
      const iPaidDate = colIndex('paidDate');
      const iMemo = colIndex('memo');
      const iTax = colIndex('tax');

      if ([iBroker, iSymbol, iCurrency, iAmount, iPaidDate].some((i) => i === -1)) {
        setImportResult(`CSV 헤더가 올바르지 않습니다. 다음 컬럼이 필요합니다: ${DIVIDEND_CSV_HEADER.join(', ')}`);
        return;
      }

      let parsedRecords = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim().toLowerCase() as BrokerId,
          accountId: iAccountId !== -1 && (r[iAccountId] ?? '').trim() ? r[iAccountId].trim() : null,
          symbol: (r[iSymbol] ?? '').trim(),
          currency: (r[iCurrency] ?? '').trim() as DividendCurrency,
          amount: Number((r[iAmount] ?? '').trim()),
          paidDate: (r[iPaidDate] ?? '').trim(),
          memo: iMemo !== -1 && (r[iMemo] ?? '').trim() ? r[iMemo] : null,
          tax: iTax !== -1 && (r[iTax] ?? '').trim() ? Number(r[iTax].trim()) : null,
        }));

      // "가져오기 대상" 선택이 전체가 아니면 해당 증권사 행만 골라서 보낸다 —
      // 여러 증권사가 섞인 CSV에서 특정 증권사분만 가져오고 싶을 때 쓴다.
      if (importBroker !== 'ALL') {
        parsedRecords = parsedRecords.filter((r) => r.broker === importBroker);
      }

      if (parsedRecords.length === 0) {
        setImportResult('가져올 행이 없습니다.');
        return;
      }

      const result = await api.importDividends(parsedRecords);
      setImportResult(formatImportResult(result));
      await refresh();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // Google Sheets 연동 — Settings.tsx에서 연결 여부만 확인하고, 실제 내보내기/
  // 가져오기는 여기서 실행한다(CSV 내보내기/가져오기와 같은 대상: 전체 배당
  // 기록, 브로커/계좌 필터 없음 — importBroker 필터는 CSV 전용).
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googleSyncResult, setGoogleSyncResult] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGoogleStatus()
      .then((s) => setGoogleConnected(s.connected))
      .catch(() => setGoogleConnected(false));
  }, []);

  async function onExportToGoogleSheet() {
    // 내보내기는 시트의 해당 탭 전체를 지우고 로컬 내용으로 다시 쓴다(전체
    // 교체) — 시트에 직접 입력했지만 아직 "가져오기"로 로컬에 반영 안 한 내용이
    // 있으면 그대로 지워진다. 그렇게 사라진 실제 사례가 있어(토스 배당 기록을
    // 시트에 직접 입력했다가 내보내기를 먼저 눌러 유실) 확인창을 넣는다.
    if (!window.confirm('Google Sheets의 Dividends 탭 전체를 로컬 데이터로 덮어씁니다. 시트에 직접 입력했지만 아직 "가져오기"로 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.exportToGoogleSheet('dividends');
      setGoogleSyncResult(`Google Sheets로 ${result.rowCount}건 내보냈습니다.`);
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  async function onImportFromGoogleSheet() {
    // 가져오기도 전체 교체다 — 로컬에서 직접 추가/수정했지만 아직 시트로
    // "내보내기"를 안 한 내용이 있으면 시트 내용으로 덮어써지며 사라진다.
    if (!window.confirm('Google Sheets의 Dividends 탭 내용으로 로컬 데이터 전체를 교체합니다. 시트에 실패하는 행이 하나라도 있으면 아무것도 바꾸지 않습니다. 로컬에서 직접 추가/수정했지만 아직 "내보내기"로 시트에 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.importFromGoogleSheet('dividends');
      setGoogleSyncResult(formatImportResult(result));
      await refresh();
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

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

  const chartRecords = useMemo(() => {
    if (chartBroker === 'ALL') return visibleRecords;
    return visibleRecords.filter((r) => r.broker === chartBroker);
  }, [visibleRecords, chartBroker]);

  // 배당 기록 목록 전용 증권사 필터 — chartBroker(그래프 전용)와는 독립적이다.
  // 연도 필터(visibleRecords)는 그래프·증권사별 표·목록에 전부 적용되는 페이지
  // 전역 필터인 반면, 이건 하단 "배당 기록" 목록 하나만 좁힌다("증권사별 배당금
  // 총계" 표는 비교가 목적이라 여기서도 필터링하지 않는다).
  const listFilteredRecords = useMemo(() => {
    if (listBroker === 'ALL') return visibleRecords;
    return visibleRecords.filter((r) => r.broker === listBroker);
  }, [visibleRecords, listBroker]);

  // 하단 배당 기록 목록의 페이지네이션. `page` state가 필터/삭제로 범위를
  // 벗어나도(예: 마지막 페이지 항목을 지운 경우) 별도 effect로 되돌리지 않고
  // 매 렌더마다 pageCount 안으로 clamp해서 쓴다 — 그래서 슬라이스에도, "현재
  // 페이지" 표시에도 항상 이 clamp된 값 하나만 쓴다.
  const pageCount = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(listFilteredRecords.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedRecords = useMemo(() => {
    if (pageSize === 'ALL') return listFilteredRecords;
    const start = (currentPage - 1) * pageSize;
    return listFilteredRecords.slice(start, start + pageSize);
  }, [listFilteredRecords, pageSize, currentPage]);

  // 페이지 번호 버튼은 한 번에 10개(PAGE_GROUP_SIZE) 그룹 단위로만 보여준다 —
  // pageCount가 크면(예: "표시 개수"를 10개로 두고 기록이 몇 백 건이면) 버튼이
  // 한 줄에 다 안 들어가서, currentPage가 속한 그룹만 렌더링하고 그 그룹 양 끝에
  // "이전 10개"/"다음 10개"로 그룹 자체를 이동하는 버튼을 둔다.
  const pageGroupStart = Math.floor((currentPage - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1;
  const pageGroupEnd = Math.min(pageGroupStart + PAGE_GROUP_SIZE - 1, pageCount);

  const monthlyRows = useMemo<MonthlySummaryRow[]>(() => {
    const byMonth = new Map<string, { totalKrw: number; totalUsd: number; count: number }>();
    for (const r of chartRecords) {
      const month = r.paidDate.slice(0, 7);
      const existing = byMonth.get(month) ?? { totalKrw: 0, totalUsd: 0, count: 0 };
      if (r.currency === 'USD') existing.totalUsd += r.amount;
      else existing.totalKrw += r.amount;
      existing.count += 1;
      byMonth.set(month, existing);
    }
    return Array.from(byMonth.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
  }, [chartRecords]);

  // 배당내역 팝업에 "총 주식갯수"(오늘 기준 보유수량)를 같이 보여주기 위한 조회용
  // 맵 — avgCostByBroker(오늘 기준 평단가 계산용으로 이미 조회해둔 값)가 종목별
  // 수량도 갖고 있어(quantity) 재사용한다. chartBroker가 특정 증권사면 그 브로커만,
  // "전체"면 전 브로커 합계로 — chartRecords/monthlyRows와 같은 범위를 유지한다.
  const qtyBySymbol = useMemo(() => {
    const m = new Map<string, number>();
    const brokerIds = chartBroker === 'ALL' ? (Object.keys(avgCostByBroker) as BrokerId[]) : [chartBroker];
    for (const brokerId of brokerIds) {
      const costs = avgCostByBroker[brokerId];
      if (!costs) continue;
      for (const [symbol, v] of costs) {
        m.set(symbol, (m.get(symbol) ?? 0) + v.quantity);
      }
    }
    return m;
  }, [avgCostByBroker, chartBroker]);

  // 월별 배당금 막대를 눌렀을 때 보여줄 그 달의 종목별 배당 상세 — 그래프와 같은
  // 데이터(chartRecords, 즉 chartBroker/연도 필터가 적용된 범위)를 종목별로 합쳐
  // 배당금이 큰 순서로 정렬한다(Overview.tsx의 selectedMonthDetailRows와 동일 방식).
  const [selectedDividendMonth, setSelectedDividendMonth] = useState<string | null>(null);
  const selectedMonthDetailRows = useMemo(() => {
    if (!selectedDividendMonth) return [];
    const bySymbol = new Map<string, { name: string; valueKrw: number; count: number }>();
    for (const r of chartRecords) {
      if (!r.paidDate.startsWith(selectedDividendMonth)) continue;
      const rate = r.currency === 'USD' ? dividendFxRateFor(selectedDividendMonth) : null;
      const v = r.currency === 'USD' ? (rate ? r.amount * rate : null) : r.amount;
      if (v === null) continue;
      const existing = bySymbol.get(r.symbol) ?? { name: r.name, valueKrw: 0, count: 0 };
      existing.valueKrw += v;
      existing.count += 1;
      bySymbol.set(r.symbol, existing);
    }
    return Array.from(bySymbol.entries())
      .map(([symbol, v]) => ({ symbol, ...v }))
      .filter((e) => e.valueKrw > 0)
      .sort((a, b) => b.valueKrw - a.valueKrw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRecords, selectedDividendMonth, effectiveFxRate, monthlyAvgFxRates]);

  const brokerDividendTotals = useMemo(() => {
    const byBroker = new Map<BrokerId, { krw: number; usd: number }>();
    for (const r of visibleRecords) {
      const existing = byBroker.get(r.broker) ?? { krw: 0, usd: 0 };
      if (r.currency === 'USD') existing.usd += r.amount;
      else existing.krw += r.amount;
      byBroker.set(r.broker, existing);
    }
    return byBroker;
  }, [visibleRecords]);

  // 브로커별 "합계(환산)" 행이 쓰는, 배당금을 각 기록의 지급월 평균 환율로
  // 환산해 이미 원화로 합쳐둔 값 — 위 brokerDividendTotals(원화/달러 각 행이
  // 쓰는 통화별 원본 합계)와 달리, 여기서는 레코드 단위로 그 달 환율을 먼저
  // 적용한 뒤에 브로커별로 더한다(브로커 합계를 낸 뒤 환율 하나로 한꺼번에
  // 곱하면 달마다 다른 환율을 반영할 수 없다). 그 달 환율도 fallback
  // (effectiveFxRate)도 없는 기록은 unconvertedUsd에 따로 모아 "환율 미적용"
  // 여부를 표로 알려준다.
  const brokerDividendKrwByBroker = useMemo(() => {
    const byBroker = new Map<BrokerId, { krwTotal: number; unconvertedUsd: number }>();
    for (const r of visibleRecords) {
      const existing = byBroker.get(r.broker) ?? { krwTotal: 0, unconvertedUsd: 0 };
      if (r.currency === 'USD') {
        const rate = dividendFxRateFor(r.paidDate.slice(0, 7));
        if (rate) existing.krwTotal += r.amount * rate;
        else existing.unconvertedUsd += r.amount;
      } else {
        existing.krwTotal += r.amount;
      }
      byBroker.set(r.broker, existing);
    }
    return byBroker;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRecords, effectiveFxRate, monthlyAvgFxRates]);

  function investedPlaceholder(brokerError: string | null | undefined) {
    if (investedLoading) return '불러오는 중...';
    return brokerError ? '조회 실패' : '-';
  }

  // 달러 투자금/배당금이 있는 브로커는 원화/달러/합계(환산) 3줄로 나눠서
  // 보여준다 — 통화별 실제 수익률(원화 대비, 달러 대비)과 환산 합계를 각각
  // 정확히 보여주기 위함(하나로 합치면 통화별 수익률을 알 수 없다). 이
  // 3줄은 별도의 "구분" 컬럼이 아니라 첫 컬럼(증권사) 안에서 표현한다 — 첫
  // 줄엔 증권사명, 나머지 줄엔 들여쓴 구분 라벨만 적어서 컬럼 수를
  // 늘리지 않는다.
  const brokerLines = useMemo<BrokerLine[]>(() => {
    // investedByBroker는 이제 CSV 전용 브로커도 항상 항목을 갖는다(보유종목을
    // 하나도 안 넣었으면 0/0) — 배당 기록도 없고 투자금도 0인 브로커까지 표에
    // 나오면 안 되니, 실제로 뭔가 있는 브로커만 걸러서 넣는다.
    const ids = new Set<BrokerId>([
      ...brokerDividendTotals.keys(),
      ...(Object.entries(investedByBrokerForYear) as [BrokerId, BrokerInvested][])
        .filter(([, inv]) => inv.krw > 0 || inv.usd > 0)
        .map(([id]) => id),
    ]);
    const lines: BrokerLine[] = [];

    for (const brokerId of BROKER_ORDER.filter((id) => ids.has(id))) {
      const dividend = brokerDividendTotals.get(brokerId) ?? { krw: 0, usd: 0 };
      const invested = investedByBrokerForYear[brokerId] ?? null;
      const investedKrw = invested?.krw ?? null;
      const investedUsd = invested?.usd ?? null;
      const placeholder = investedPlaceholder(investedErrors[brokerId]);
      const hasUsd = (investedUsd !== null && investedUsd > 0) || dividend.usd > 0;

      if (!hasUsd) {
        const y = investedKrw && investedKrw > 0 ? dividend.krw / investedKrw : null;
        lines.push({
          broker: brokerId,
          label: BROKER_LABELS[brokerId],
          muted: false,
          invested: investedKrw !== null ? `${krw.format(investedKrw)}원` : placeholder,
          dividend: `${krw.format(dividend.krw)}원`,
          yieldText: y !== null ? `${(y * 100).toFixed(2)}%` : '-',
        });
        continue;
      }

      const krwYield = investedKrw && investedKrw > 0 ? dividend.krw / investedKrw : null;
      const usdYield = investedUsd && investedUsd > 0 ? dividend.usd / investedUsd : null;
      const investedTotalKrw = (investedKrw ?? 0) + (effectiveFxRate ? (investedUsd ?? 0) * effectiveFxRate : 0);
      // 투자금(매입원가)은 지금 이 순간의 값이라 effectiveFxRate(오늘/수동
      // 환율)로 환산하지만, 배당금은 위 brokerDividendKrwByBroker가 각 기록의
      // 지급월 평균 환율로 이미 환산해둔 값을 그대로 쓴다.
      const dividendConv = brokerDividendKrwByBroker.get(brokerId) ?? { krwTotal: 0, unconvertedUsd: 0 };
      const dividendTotalKrw = dividendConv.krwTotal;
      const dividendFxMissing = dividendConv.unconvertedUsd > 0;
      const totalYield =
        effectiveFxRate && !dividendFxMissing && investedTotalKrw > 0 ? dividendTotalKrw / investedTotalKrw : null;

      lines.push({
        broker: brokerId,
        label: BROKER_LABELS[brokerId],
        muted: false,
        invested: investedKrw !== null ? `${krw.format(investedKrw)}원` : placeholder,
        dividend: `${krw.format(dividend.krw)}원`,
        yieldText: krwYield !== null ? `${(krwYield * 100).toFixed(2)}%` : '-',
      });
      lines.push({
        broker: brokerId,
        label: '　달러',
        muted: true,
        invested: investedUsd !== null ? usdFmt.format(investedUsd) : placeholder,
        dividend: usdFmt.format(dividend.usd),
        yieldText: usdYield !== null ? `${(usdYield * 100).toFixed(2)}%` : '-',
      });
      lines.push({
        broker: brokerId,
        label: '　합계(환산)',
        muted: true,
        invested: effectiveFxRate ? `${krw.format(Math.round(investedTotalKrw))}원` : '환율 미적용',
        dividend: !dividendFxMissing ? `${krw.format(Math.round(dividendTotalKrw))}원` : '환율 미적용',
        yieldText: totalYield !== null ? `${(totalYield * 100).toFixed(2)}%` : '-',
      });
    }

    return lines;
  }, [brokerDividendTotals, brokerDividendKrwByBroker, investedByBrokerForYear, investedErrors, investedLoading, effectiveFxRate]);

  // "총합계" 스탯 타일 — 증권사별 표는 이미 통화별 상세를 보여주므로, 여기서는
  // 환산된 단일 숫자만 보여준다(중복 표시 방지). 브로커 하나라도 투자금 조회가
  // 안 됐으면(로딩/에러) 부분합을 총합처럼 보여주지 않고 그 사실을 그대로 알린다.
  const grandTotal = useMemo(() => {
    const ids = new Set<BrokerId>([
      ...brokerDividendKrwByBroker.keys(),
      ...(Object.keys(investedByBrokerForYear) as BrokerId[]),
    ]);
    let dividendKrwTotal = 0;
    let dividendUnconvertedUsd = 0;
    let investedKrw = 0;
    let investedUsd = 0;
    let missingInvested = false;

    for (const id of ids) {
      const div = brokerDividendKrwByBroker.get(id);
      if (div) {
        dividendKrwTotal += div.krwTotal;
        dividendUnconvertedUsd += div.unconvertedUsd;
      }
      const inv = investedByBrokerForYear[id];
      if (inv) {
        investedKrw += inv.krw;
        investedUsd += inv.usd;
      } else {
        missingInvested = true;
      }
    }

    // 투자금(매입원가)은 지금 이 순간의 값이라 effectiveFxRate로 환산하고,
    // 배당금은 위 brokerDividendKrwByBroker가 각 기록의 지급월 평균 환율로
    // 이미 환산해둔 값을 그대로 더한다 — 두 값의 "환율 미적용" 조건이 서로
    // 다르므로(투자금은 effectiveFxRate 유무, 배당금은 레코드별 변환 성공
    // 여부) 따로 판단한다.
    const investedTotal = investedKrw + (effectiveFxRate ? investedUsd * effectiveFxRate : 0);
    const investedFxMissing = !effectiveFxRate && investedUsd > 0;
    const dividendFxMissing = dividendUnconvertedUsd > 0;

    return {
      hasAny: ids.size > 0,
      dividendText: dividendFxMissing ? '환율 미적용' : `${krw.format(Math.round(dividendKrwTotal))}원`,
      investedText: investedLoading
        ? '불러오는 중...'
        : missingInvested
          ? '일부 조회 실패'
          : investedFxMissing
            ? '환율 미적용'
            : `${krw.format(Math.round(investedTotal))}원`,
      yieldText:
        !missingInvested && !investedFxMissing && !dividendFxMissing && investedTotal > 0
          ? `${((dividendKrwTotal / investedTotal) * 100).toFixed(2)}%`
          : '-',
    };
  }, [brokerDividendKrwByBroker, investedByBrokerForYear, investedLoading, effectiveFxRate]);

  return (
    <div>
      <h2 className="page-title">배당금</h2>
      <div className="notice">
        토스증권·한국투자증권은 API 키가 등록돼 있으면 이 화면에 들어올 때 배당(국내 ETF 분배금, 외화세금환급 포함)을
        API 내용으로 자동으로 맞춥니다 — 그 증권사 기록은 직접 고칠 수 없습니다. 그 밖의 증권사는 입금된 배당을
        조회하는 API가 없어 지급 시 직접 입력합니다. 배당금은 세후 실수령액이고, 세금은 따로 적습니다.
      </div>

      <div className="form-row">
        <label>연도</label>
        <select
          value={year}
          onChange={(e) => {
            setYear(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value));
            setPage(1);
          }}
        >
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

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>월별 배당금</h3>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>증권사</label>
            <select value={chartBroker} onChange={(e) => setChartBroker(e.target.value as BrokerFilter)}>
              <option value="ALL">전체</option>
              {brokerOptions.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
          <CollapseToggle collapsed={dividendPanelsCollapsed} onClick={() => setDividendPanelsCollapsed((c) => !c)} />
        </div>

        {!dividendPanelsCollapsed && (
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <DividendsChart
                rows={monthlyRows}
                fxRate={dividendFxRateFor}
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
              {brokerLines.length === 0 ? (
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
                    {brokerLines.map((line, i) => (
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

      <div className="card">
        <h3 style={{ marginTop: 0 }}>배당 기록 추가</h3>
        {error && (
          <p className="text-critical" style={{ whiteSpace: 'pre-wrap' }}>
            {error}
          </p>
        )}
        <form onSubmit={onSubmit}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="form-row">
              <label>증권사</label>
              <select value={broker} onChange={(e) => setBroker(e.target.value as BrokerId)}>
                {BROKER_ORDER.filter((id) => !syncOwnedBrokers.has(id)).map((id) => (
                  <option key={id} value={id}>
                    {BROKER_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>계좌 (선택)</label>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="한 증권사에 계좌가 여러 개일 때만"
              />
            </div>
            <div className="form-row">
              <label>종목코드</label>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="예: AAPL, 005930" />
            </div>
            <div className="form-row">
              <label>종목명</label>
              {manualNameEntry ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="예: 애플"
                    style={{ flex: 1 }}
                  />
                  <button type="button" className="ghost" onClick={() => setManualNameEntry(false)}>
                    자동조회
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
                  {nameStatus === 'idle' && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>종목코드 입력 시 자동 조회</span>
                  )}
                  {nameStatus === 'loading' && (
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>조회 중...</span>
                  )}
                  {nameStatus === 'resolved' && <span>{name}</span>}
                  {nameStatus === 'error' && (
                    <span className="text-critical" style={{ fontSize: 12 }}>
                      {nameError ?? '조회 실패'}
                    </span>
                  )}
                  <button type="button" className="ghost" onClick={() => setManualNameEntry(true)}>
                    직접 입력
                  </button>
                </div>
              )}
            </div>
            <div className="form-row">
              <label>통화</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value as DividendCurrency)}>
                <option value="KRW">원화 (KRW)</option>
                <option value="USD">달러 (USD)</option>
              </select>
            </div>
            <div className="form-row">
              <label>배당금 · 세후 ({currency === 'USD' ? '$' : '원'})</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="form-row">
              <label>세금 (선택)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={taxInput}
                onChange={(e) => setTaxInput(e.target.value)}
                placeholder="원천징수 세금"
              />
            </div>
            <div className="form-row">
              <label>지급일</label>
              <input type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} />
            </div>
            <div className="form-row">
              <label>메모 (선택)</label>
              <input value={memo} onChange={(e) => setMemo(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="primary">
            추가
          </button>
        </form>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={onRefreshNames} disabled={refreshingNames}>
            {refreshingNames ? '갱신 중...' : '종목명 일괄 갱신'}
          </button>
          {refreshResult && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{refreshResult}</span>}
          {syncOwnedBrokers.size > 0 && (
            <button
              className="ghost"
              onClick={() => runDividendSync(true)}
              disabled={dividendSyncing}
              title={`${[...syncOwnedBrokers].map((b) => BROKER_LABELS[b]).join('·')} 배당을 API 내용으로 다시 맞춥니다`}
            >
              {dividendSyncing ? '배당 동기화 중...' : '배당 동기화'}
            </button>
          )}
          {dividendSyncNotice && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dividendSyncNotice}</span>}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>증권사</label>
            <select
              value={listBroker}
              onChange={(e) => {
                setListBroker(e.target.value as BrokerFilter);
                setPage(1);
              }}
            >
              <option value="ALL">전체</option>
              {brokerOptions.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={onExportCsv} disabled={listFilteredRecords.length === 0}>
            CSV 내보내기 ({listBroker === 'ALL' ? '전체' : BROKER_LABELS[listBroker]})
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>가져오기 대상</label>
            <select value={importBroker} onChange={(e) => setImportBroker(e.target.value as BrokerFilter)}>
              <option value="ALL">전체</option>
              {BROKER_ORDER.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
            <button className="ghost" onClick={onImportClick} disabled={importing}>
              {importing ? '가져오는 중...' : 'CSV 가져오기'}
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onImportFile} />
          </div>
          <button
            className="ghost"
            onClick={onExportToGoogleSheet}
            disabled={!googleConnected || googleSyncing}
            title={googleConnected ? undefined : '설정에서 Google 계정을 먼저 연결해주세요.'}
          >
            {googleSyncing ? '처리 중...' : 'Google Sheets로 내보내기'}
          </button>
          <button
            className="ghost"
            onClick={onImportFromGoogleSheet}
            disabled={!googleConnected || googleSyncing}
            title={googleConnected ? undefined : '설정에서 Google 계정을 먼저 연결해주세요.'}
          >
            {googleSyncing ? '처리 중...' : 'Google Sheets에서 가져오기'}
          </button>
          {importResult && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{importResult}</span>
          )}
          {googleSyncResult && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{googleSyncResult}</span>
          )}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          {pageCount > 1 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <button className="ghost" disabled={pageGroupStart === 1} onClick={() => setPage(pageGroupStart - PAGE_GROUP_SIZE)}>
                ◀ 이전 10개
              </button>
              {Array.from({ length: pageGroupEnd - pageGroupStart + 1 }, (_, i) => pageGroupStart + i).map((p) => (
                <button
                  key={p}
                  className="ghost"
                  style={
                    p === currentPage
                      ? { background: 'var(--series-1)', color: '#fff', borderColor: 'var(--series-1)' }
                      : undefined
                  }
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button className="ghost" disabled={pageGroupEnd === pageCount} onClick={() => setPage(pageGroupEnd + 1)}>
                다음 10개 ▶
              </button>
            </div>
          ) : (
            <div />
          )}
          <div className="form-row" style={{ margin: 0 }}>
            <label>표시 개수</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(e.target.value === 'ALL' ? 'ALL' : (Number(e.target.value) as PageSize));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s === 'ALL' ? '전체' : `${s}개`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>지급일</th>
              <th>증권사</th>
              <th>계좌</th>
              <th>종목코드</th>
              <th>종목명</th>
              <th title="세후 실수령액">배당금</th>
              <th title="원천징수 세금 — 세전 = 배당금 + 세금">세금</th>
              <th>메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listFilteredRecords.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {year === 'ALL' ? '배당 기록이 없습니다.' : `${year}년 배당 기록이 없습니다.`}
                  {listBroker !== 'ALL' ? ` (${BROKER_LABELS[listBroker]} 기준)` : ''}
                </td>
              </tr>
            )}
            {pagedRecords.map((r) =>
              editingId === r.id && editDraft ? (
                <tr key={r.id}>
                  <td>
                    <input
                      type="date"
                      value={editDraft.paidDate}
                      onChange={(e) => setEditDraft({ ...editDraft, paidDate: e.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={editDraft.broker}
                      onChange={(e) => setEditDraft({ ...editDraft, broker: e.target.value as BrokerId })}
                    >
                      {BROKER_ORDER.map((id) => (
                        <option key={id} value={id}>
                          {BROKER_LABELS[id]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      value={editDraft.accountId}
                      onChange={(e) => setEditDraft({ ...editDraft, accountId: e.target.value })}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <input
                      value={editDraft.symbol}
                      onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <select
                        value={editDraft.currency}
                        onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value as DividendCurrency })}
                      >
                        <option value="KRW">원</option>
                        <option value="USD">USD</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.amount}
                        onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
                        style={{ width: 90 }}
                      />
                    </div>
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editDraft.tax}
                      onChange={(e) => setEditDraft({ ...editDraft, tax: e.target.value })}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      value={editDraft.memo}
                      onChange={(e) => setEditDraft({ ...editDraft, memo: e.target.value })}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ghost" onClick={() => saveEdit(r.id)} disabled={editSaving}>
                        {editSaving ? '저장 중...' : '저장'}
                      </button>
                      <button className="ghost" onClick={cancelEdit} disabled={editSaving}>
                        취소
                      </button>
                    </div>
                    {editError && (
                      <div className="text-critical" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>
                        {editError}
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td>{r.paidDate}</td>
                  <td>{BROKER_LABELS[r.broker]}</td>
                  <td>{displayAccountId(r.broker, r.accountId)}</td>
                  <td>{r.symbol}</td>
                  <td>
                    <StockNameLink name={r.name} url={stockLinkFor(r.symbol, r.currency)} />
                  </td>
                  <td>{r.currency === 'USD' ? usdFmt.format(r.amount) : `${krw.format(r.amount)}원`}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {r.tax === null ? '-' : r.currency === 'USD' ? usdFmt.format(r.tax) : `${krw.format(r.tax)}원`}
                  </td>
                  <td>{r.memo ?? '-'}</td>
                  <td>
                    {syncOwnedBrokers.has(r.broker) ? (
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }} title="API 동기화로만 관리됩니다">
                        API 연동
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="ghost" onClick={() => startEdit(r)}>
                          수정
                        </button>
                        <button className="ghost" onClick={() => onDelete(r.id)}>
                          삭제
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
