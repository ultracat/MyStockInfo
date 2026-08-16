import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { BrokerId, DividendCurrency, DividendRecord, MonthlySummaryRow } from '../types';
import DividendsChart from '../components/DividendsChart';
import CollapseToggle from '../components/CollapseToggle';
import { krw, usdFmt } from '../format';
import { downloadCsv, parseCsv } from '../csv';
import { API_BROKER_IDS, BROKER_LABELS, BROKER_ORDER } from '../brokers';

// export/import 왕복 호환을 위한 CSV 컬럼 — DividendRecord 필드명을 그대로 헤더로
// 쓴다(한글 헤더 대신 필드명을 쓰는 이유: 내보낸 파일을 그대로 다시 가져올 때
// 헤더 매칭이 대소문자만 다르면 되게 하기 위함). name(종목명)은 없다 — 심볼로부터
// 서버가 자동조회하므로 CSV에 넣을 필요가 없다(가져오기도 마찬가지).
const DIVIDEND_CSV_HEADER = ['broker', 'symbol', 'currency', 'amount', 'paidDate', 'memo'];

const today = () => new Date().toISOString().slice(0, 10);
const CURRENT_YEAR = new Date().getFullYear();

type YearFilter = 'ALL' | number;
type BrokerFilter = 'ALL' | BrokerId;
type PageSize = 10 | 20 | 30 | 'ALL';

const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, 'ALL'];
const PAGE_GROUP_SIZE = 10;

interface BrokerInvested {
  krw: number;
  usd: number;
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
  const [currency, setCurrency] = useState<DividendCurrency>('KRW');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(today());
  const [memo, setMemo] = useState('');

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

  // 배당금 화면 전용 환율: 달러 배당/투자금을 원화로 환산해 보여주기 위함.
  // Dashboard.tsx의 비중 계산과 같은 우선순위(설정에서 직접 입력한 값 >
  // 토스 실시간 환율)를 그대로 따른다 — 토스만 환율 API를 제공한다.
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = manualFxRate ?? liveFxRate;

  async function refresh() {
    setRecords(await api.listDividends());
  }

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

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
      try {
        const live = await api.getExchangeRate('toss', 'USD', 'KRW');
        if (!cancelled) setLiveFxRate(live.midRate ?? live.rate);
      } catch {
        // 토스 미연동 등 — 수동 환율 또는 미환산으로 대체됨
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 투자금(총 매입금액)은 배당 DB에는 없어 증권사 API에서 직접 계좌별로
    // 조회해 합산한다. 브로커 하나가 실패해도(미연동/레이트리밋 등) 나머지는
    // 계속 보여야 하므로 개별 try/catch로 감싼다 — backend/CLAUDE.md의 목록형
    // 엔드포인트 방침과 동일한 이유.
    let cancelled = false;

    (async () => {
      setInvestedLoading(true);
      const brokers = await api.listBrokers().catch(() => []);
      if (cancelled) return;
      const configured = brokers.filter((b) => b.configured);

      const results = await Promise.all(
        configured.map(async (b) => {
          try {
            if (API_BROKER_IDS.includes(b.id)) {
              const accounts = await api.listAccounts(b.id);
              const portfolios = await Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id)));
              const totalKrw = portfolios.reduce((sum, p) => sum + p.totalPurchaseAmountKrw, 0);
              const totalUsd = portfolios.reduce((sum, p) => sum + (p.totalPurchaseAmountUsd ?? 0), 0);
              return { id: b.id, invested: { krw: totalKrw, usd: totalUsd } as BrokerInvested | null, error: null as string | null };
            }

            // CSV 전용 브로커(KB/삼성/미래에셋)는 라이브 API가 없다 — 유일한
            // 투자금 소스는 로컬 저장소(holdings-store, CSV로 가져온 실제
            // 보유종목)라 그 매입금액을 통화별로 합산한다(Dashboard.tsx의
            // buildPortfolioFromStored와 같은 집계 방식).
            const holdings = await api.listHoldingsStore({ broker: b.id });
            const totalKrw = holdings.filter((h) => h.currency !== 'USD').reduce((sum, h) => sum + h.purchaseAmount, 0);
            const totalUsd = holdings.filter((h) => h.currency === 'USD').reduce((sum, h) => sum + h.purchaseAmount, 0);
            return { id: b.id, invested: { krw: totalKrw, usd: totalUsd } as BrokerInvested | null, error: null as string | null };
          } catch (e) {
            return { id: b.id, invested: null, error: (e as Error).message };
          }
        })
      );
      if (cancelled) return;

      const invested: Partial<Record<BrokerId, BrokerInvested>> = {};
      const errors: Partial<Record<BrokerId, string>> = {};
      for (const r of results) {
        if (r.invested !== null) invested[r.id] = r.invested;
        if (r.error) errors[r.id] = r.error;
      }
      setInvestedByBroker(invested);
      setInvestedErrors(errors);
      setInvestedLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const amountNum = Number(amount);
    if (!symbol || !name || !amountNum || amountNum <= 0 || !paidDate) {
      setError('종목코드, 종목명, 배당금(양수), 지급일을 입력해주세요.');
      return;
    }
    try {
      await api.addDividend({ broker, symbol, name, currency, amount: amountNum, paidDate, memo: memo || null });
      setSymbol('');
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
    symbol: string;
    name: string;
    currency: DividendCurrency;
    amount: string;
    paidDate: string;
    memo: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit(r: DividendRecord) {
    setEditingId(r.id);
    setEditDraft({
      broker: r.broker,
      symbol: r.symbol,
      name: r.name,
      currency: r.currency,
      amount: String(r.amount),
      paidDate: r.paidDate,
      memo: r.memo ?? '',
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
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateDividend(id, {
        broker: editDraft.broker,
        symbol: editDraft.symbol,
        name: editDraft.name,
        currency: editDraft.currency,
        amount: amountNum,
        paidDate: editDraft.paidDate,
        memo: editDraft.memo || null,
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
      ...listFilteredRecords.map((r) => [r.broker, r.symbol, r.currency, String(r.amount), r.paidDate, r.memo ?? '']),
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
      const iSymbol = colIndex('symbol');
      const iCurrency = colIndex('currency');
      const iAmount = colIndex('amount');
      const iPaidDate = colIndex('paidDate');
      const iMemo = colIndex('memo');

      if ([iBroker, iSymbol, iCurrency, iAmount, iPaidDate].some((i) => i === -1)) {
        setImportResult(`CSV 헤더가 올바르지 않습니다. 다음 컬럼이 필요합니다: ${DIVIDEND_CSV_HEADER.join(', ')}`);
        return;
      }

      let parsedRecords = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim() as BrokerId,
          symbol: (r[iSymbol] ?? '').trim(),
          currency: (r[iCurrency] ?? '').trim() as DividendCurrency,
          amount: Number((r[iAmount] ?? '').trim()),
          paidDate: (r[iPaidDate] ?? '').trim(),
          memo: iMemo !== -1 && (r[iMemo] ?? '').trim() ? r[iMemo] : null,
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
      setImportResult(
        result.failed.length > 0
          ? `${result.added}건 추가됨 (실패 ${result.failed.length}건: ${result.failed
              .map((f) => `${f.row}행 - ${f.error}`)
              .join('; ')})`
          : `${result.added}건 추가됨`
      );
      await refresh();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
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
    const ids = new Set<BrokerId>([
      ...brokerDividendTotals.keys(),
      ...(Object.keys(investedByBroker) as BrokerId[]),
    ]);
    const lines: BrokerLine[] = [];

    for (const brokerId of BROKER_ORDER.filter((id) => ids.has(id))) {
      const dividend = brokerDividendTotals.get(brokerId) ?? { krw: 0, usd: 0 };
      const invested = investedByBroker[brokerId] ?? null;
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
      const dividendTotalKrw = dividend.krw + (effectiveFxRate ? dividend.usd * effectiveFxRate : 0);
      const totalYield = effectiveFxRate && investedTotalKrw > 0 ? dividendTotalKrw / investedTotalKrw : null;

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
        dividend: effectiveFxRate ? `${krw.format(Math.round(dividendTotalKrw))}원` : '환율 미적용',
        yieldText: totalYield !== null ? `${(totalYield * 100).toFixed(2)}%` : '-',
      });
    }

    return lines;
  }, [brokerDividendTotals, investedByBroker, investedErrors, investedLoading, effectiveFxRate]);

  // "총합계" 스탯 타일 — 증권사별 표는 이미 통화별 상세를 보여주므로, 여기서는
  // 환산된 단일 숫자만 보여준다(중복 표시 방지). 브로커 하나라도 투자금 조회가
  // 안 됐으면(로딩/에러) 부분합을 총합처럼 보여주지 않고 그 사실을 그대로 알린다.
  const grandTotal = useMemo(() => {
    const ids = new Set<BrokerId>([
      ...brokerDividendTotals.keys(),
      ...(Object.keys(investedByBroker) as BrokerId[]),
    ]);
    let dividendKrw = 0;
    let dividendUsd = 0;
    let investedKrw = 0;
    let investedUsd = 0;
    let missingInvested = false;

    for (const id of ids) {
      const div = brokerDividendTotals.get(id);
      if (div) {
        dividendKrw += div.krw;
        dividendUsd += div.usd;
      }
      const inv = investedByBroker[id];
      if (inv) {
        investedKrw += inv.krw;
        investedUsd += inv.usd;
      } else {
        missingInvested = true;
      }
    }

    const dividendTotal = dividendKrw + (effectiveFxRate ? dividendUsd * effectiveFxRate : 0);
    const investedTotal = investedKrw + (effectiveFxRate ? investedUsd * effectiveFxRate : 0);
    const fxMissing = !effectiveFxRate && (dividendUsd > 0 || investedUsd > 0);

    return {
      hasAny: ids.size > 0,
      dividendText: fxMissing ? '환율 미적용' : `${krw.format(Math.round(dividendTotal))}원`,
      investedText: investedLoading
        ? '불러오는 중...'
        : missingInvested
          ? '일부 조회 실패'
          : fxMissing
            ? '환율 미적용'
            : `${krw.format(Math.round(investedTotal))}원`,
      yieldText:
        !missingInvested && !fxMissing && investedTotal > 0
          ? `${((dividendTotal / investedTotal) * 100).toFixed(2)}%`
          : '-',
    };
  }, [brokerDividendTotals, investedByBroker, investedLoading, effectiveFxRate]);

  return (
    <div>
      <h2 className="page-title">배당금</h2>
      <div className="notice">
        토스증권/한국투자증권 Open API 모두 "내 계좌에 실제로 입금된 배당금" 내역을 조회하는 API는
        제공하지 않아 (한국투자증권은 종목별 배당 일정/배당률 같은 공개 시세 데이터는 있지만, 개인
        계좌의 배당 지급 내역은 없습니다), 배당금은 지급 시 직접 입력해 관리합니다.
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
              <DividendsChart rows={monthlyRows} fxRate={effectiveFxRate} />
            </div>

            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />

            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              <h3 style={{ marginTop: 0 }}>증권사별 배당금 총계</h3>
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
                {BROKER_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {BROKER_LABELS[id]}
                  </option>
                ))}
              </select>
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
              <label>배당금 ({currency === 'USD' ? '$' : '원'})</label>
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
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
          {importResult && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{importResult}</span>
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
        <table>
          <thead>
            <tr>
              <th>지급일</th>
              <th>증권사</th>
              <th>종목코드</th>
              <th>종목명</th>
              <th>배당금</th>
              <th>메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listFilteredRecords.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
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
                  <td>{r.symbol}</td>
                  <td>{r.name}</td>
                  <td>{r.currency === 'USD' ? usdFmt.format(r.amount) : `${krw.format(r.amount)}원`}</td>
                  <td>{r.memo ?? '-'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="ghost" onClick={() => startEdit(r)}>
                        수정
                      </button>
                      <button className="ghost" onClick={() => onDelete(r.id)}>
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
