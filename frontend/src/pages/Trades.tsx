import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, BrokerAccount, BrokerId, BrokerSummary, StoredTrade, TradeRecord } from '../types';
import TradesChart, { type TradeSummaryBucket } from '../components/TradesChart';
import CollapseToggle from '../components/CollapseToggle';
import { krw, usdFmt } from '../format';
import { downloadCsv, parseCsv } from '../csv';
import { API_BROKER_IDS, BROKER_LABELS, BROKER_ORDER, CSV_ONLY_BROKER_IDS } from '../brokers';
import { accountLabelKey, formatAccountOption } from '../accountLabels';

// CSV 전용 브로커(KB/삼성/미래에셋)의 로컬 저장소 행을 화면이 이미 쓰는
// TradeRecord 모양으로 바꾼다 — name은 항상 null(화면이 심볼 폴백을 지원).
function mapStoredTrade(t: StoredTrade): TradeRecord {
  return {
    id: t.id,
    symbol: t.symbol,
    name: null,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    amount: t.amount,
    currency: t.currency,
    commission: t.commission,
    tax: t.tax,
    executedAt: t.executedAt,
  };
}

// name·id 둘 다 없다 — name은 TradeRecord가 원래도 선택적이고 화면이 이미 심볼로
// 폴백 표시하므로 자동조회가 불필요(배당금/보유종목과 다른 점), id는 브로커 고유
// 체결번호라 CSV 입력행엔 없고 없으면 서버가 새로 발급한다.
const TRADES_CSV_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'side',
  'quantity',
  'price',
  'amount',
  'currency',
  'executedAt',
  'commission',
  'tax',
];

const today = () => new Date().toISOString().slice(0, 10);

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

type ViewMode = 'year' | 'month';
type PageSize = 10 | 20 | 30 | 'ALL';
type BrokerFilter = 'ALL' | BrokerId;

function tradeKey(t: StoredTrade): string {
  return `${t.broker}|${t.accountId}|${t.id}`;
}

const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, 'ALL'];
const PAGE_GROUP_SIZE = 10;

function formatAmount(amount: number, currency: string) {
  return currency === 'USD' ? usdFmt.format(amount) : `${krw.format(Math.round(amount))}원`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function accumulate(row: TradeSummaryBucket, t: TradeRecord) {
  const isUsd = t.currency === 'USD';
  if (t.side === 'BUY') {
    if (isUsd) row.buyUsd += t.amount;
    else row.buyKrw += t.amount;
  } else {
    if (isUsd) row.sellUsd += t.amount;
    else row.sellKrw += t.amount;
  }
}

export default function Trades() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<BrokerSummary[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<BrokerId | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [viewMode, setViewMode] = useState<ViewMode>('year');
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);
  const [chartCollapsed, setChartCollapsed] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // 매매내역 수동 입력 — CSV 전용 브로커(KB/삼성/미래에셋)만 대상이다. 토스/KIS는
  // 실시간 API로 실제 체결 내역이 그대로 들어오므로(write-through 동기화), 그
  // 위에 수동 입력을 섞으면 어느 쪽이 진짜 체결 내역인지 알 수 없어진다 —
  // Dividends.tsx의 배당 기록 추가 폼과 달리 브로커 선택지를 CSV 전용으로 제한.
  const [addBroker, setAddBroker] = useState<BrokerId>(CSV_ONLY_BROKER_IDS[0]);
  const [addAccountId, setAddAccountId] = useState('');
  const [addSymbol, setAddSymbol] = useState('');
  const [addSide, setAddSide] = useState<'BUY' | 'SELL'>('BUY');
  const [addQuantity, setAddQuantity] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addCurrency, setAddCurrency] = useState('KRW');
  const [addExecutedAt, setAddExecutedAt] = useState(today());
  const [addCommission, setAddCommission] = useState('');
  const [addTax, setAddTax] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<string | null>(null);

  // 매매내역 목록(하단 표)은 위쪽 증권사/계좌 select(차트·스탯 타일 전용, 실시간
  // 조회 기준)와 완전히 독립된 별도 데이터 소스를 쓴다 — 로컬 저장소
  // 전체(trades-store, 모든 브로커/계좌)를 받아와 목록 전용 증권사 필터
  // (listBroker)로 좁힌다. Dividends.tsx의 chartBroker/listBroker 분리와 같은
  // 패턴. 로컬 저장소는 write-through 캐시라 API 브로커는 실제로 한 번 라이브
  // 조회한 적 있는 연도만 여기 나타난다(CSV 내보내기(전체)가 이미 같은 전제로
  // 동작함) — 완전성보다 "여러 증권사를 한 표에서 훑어보고 CSV 전용 계좌는 바로
  // 고칠 수 있게" 하는 게 목적이라 허용 가능한 트레이드오프.
  const [allTrades, setAllTrades] = useState<StoredTrade[]>([]);
  const [listBroker, setListBroker] = useState<BrokerFilter>('ALL');

  // 매매내역 목록의 인라인 수정/삭제 — CSV 전용 브로커 행에만 허용한다. 토스/KIS
  // 행은 write-through로 실시간 조회가 성공할 때마다 같은 id로 덮어써지므로,
  // 여기서 고쳐도 다음 라이브 조회에 그대로 되돌아가 의미가 없다.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    price: string;
    amount: string;
    currency: string;
    executedAt: string;
    commission: string;
    tax: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function refreshAllTrades() {
    setAllTrades(await api.listTradesStore());
  }

  useEffect(() => {
    refreshAllTrades().catch((e) => setError((e as Error).message));
  }, []);

  const configuredBrokers = brokers.filter((b) => b.configured);

  // 계좌 별칭은 Settings.tsx에서만 관리하고 여기선 읽기만 한다 — 마운트 시 한 번만
  // 불러오면 충분(브로커/계좌를 바꿔도 라벨 목록 자체는 안 바뀜).
  useEffect(() => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
  }, []);

  // 배당금 화면과 같은 방식: 달러 거래를 원화로 환산해 보여주기 위한 환율.
  // 선택된 브로커와 무관하게 한 번만 가져온다(KIS만 보고 있어도 나중에
  // 토스로 전환할 수 있으므로) — 토스만 환율 API를 제공한다.
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = manualFxRate ?? liveFxRate;

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
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await api.listBrokers();
        if (cancelled) return;
        setBrokers(list);

        const firstConfigured = list.find((b) => b.configured);
        if (!firstConfigured) {
          setError('연동된 증권사가 없습니다. 설정 화면에서 먼저 API 키를 등록해주세요.');
          return;
        }
        setSelectedBroker(firstConfigured.id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedBroker) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        setAccountId(null);
        // 브로커를 바꾸는 즉시 이전 브로커의 매매내역을 지운다 — 새 브로커의 계좌
        // 목록이 비어 있으면(CSV 전용 브로커에 아직 아무 것도 안 넣은 경우) 아래
        // 매매내역 조회 effect가 accountId===null이라 아예 안 돌아서, 이 reset이
        // 없으면 화면에 이전 브로커의 표가 그대로 남아있게 된다.
        setTrades([]);
        // CSV 전용 브로커(KB/삼성/미래에셋)는 listAccounts API가 없다 — 로컬
        // 저장소(trades-store)에 실제로 CSV로 넣어둔 accountId를 계좌 목록처럼 쓴다.
        const accs = API_BROKER_IDS.includes(selectedBroker)
          ? await api.listAccounts(selectedBroker)
          : await api
              .listTradesStore({ broker: selectedBroker })
              .then((rows) => Array.from(new Set(rows.map((r) => r.accountId))).map((id) => ({ id })));
        if (cancelled) return;
        setAccounts(accs);
        if (accs.length > 0) setAccountId(accs[0].id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBroker]);

  useEffect(() => {
    if (!selectedBroker || !accountId) return;
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (API_BROKER_IDS.includes(selectedBroker)) {
          const today = new Date().toISOString().slice(0, 10);
          const from = `${year}-01-01`;
          const to = year === CURRENT_YEAR ? today : `${year}-12-31`;
          const data = await api.getTradeHistory(selectedBroker, accountId, from, to);
          if (!cancelled) setTrades(data);
        } else {
          // CSV 전용 브로커는 연도별 라이브 조회가 없다 — 로컬 저장소에 있는
          // 전부를 한 번에 받아오고, 연도/월 필터링은 기존처럼 클라이언트에서 한다.
          const stored = await api.listTradesStore({ broker: selectedBroker, accountId });
          if (!cancelled) setTrades(stored.map(mapStoredTrade));
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBroker, accountId, year]);

  // 로컬 저장소(trades-store)는 실시간 조회가 성공할 때마다 write-through로
  // 갱신되고, CSV로도 채울 수 있다(API 연동이 없는 KB증권 등) — 내보내기는 현재
  // 화면에 보이는 연도/브로커 하나가 아니라 저장소에 쌓인 전체를 대상으로 한다.
  async function onExportCsv() {
    const stored = await api.listTradesStore();
    const rows: string[][] = [
      TRADES_CSV_HEADER,
      ...stored.map((t) => [
        t.broker,
        t.accountId,
        t.symbol,
        t.side,
        String(t.quantity),
        String(t.price),
        String(t.amount),
        t.currency,
        t.executedAt,
        t.commission === null ? '' : String(t.commission),
        t.tax === null ? '' : String(t.tax),
      ]),
    ];
    downloadCsv(`trades-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  }

  function onImportClick() {
    fileInputRef.current?.click();
  }

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
      const iSide = colIndex('side');
      const iQuantity = colIndex('quantity');
      const iPrice = colIndex('price');
      const iAmount = colIndex('amount');
      const iCurrency = colIndex('currency');
      const iExecutedAt = colIndex('executedAt');
      const iCommission = colIndex('commission');
      const iTax = colIndex('tax');

      if (
        [iBroker, iAccountId, iSymbol, iSide, iQuantity, iPrice, iAmount, iCurrency, iExecutedAt].some(
          (i) => i === -1
        )
      ) {
        setImportResult(`CSV 헤더가 올바르지 않습니다. 다음 컬럼이 필요합니다: ${TRADES_CSV_HEADER.join(', ')}`);
        return;
      }

      const num = (v: string | undefined) => {
        const trimmed = (v ?? '').trim();
        return trimmed === '' ? null : Number(trimmed);
      };

      const records = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim() as BrokerId,
          accountId: (r[iAccountId] ?? '').trim(),
          symbol: (r[iSymbol] ?? '').trim(),
          side: (r[iSide] ?? '').trim() as 'BUY' | 'SELL',
          quantity: Number((r[iQuantity] ?? '').trim()),
          price: Number((r[iPrice] ?? '').trim()),
          amount: Number((r[iAmount] ?? '').trim()),
          currency: (r[iCurrency] ?? '').trim(),
          executedAt: (r[iExecutedAt] ?? '').trim(),
          commission: iCommission !== -1 ? num(r[iCommission]) : null,
          tax: iTax !== -1 ? num(r[iTax]) : null,
        }));

      const result = await api.importTradesStore(records);
      setImportResult(
        result.failed.length > 0
          ? `${result.added}건 추가됨 (실패 ${result.failed.length}건: ${result.failed
              .map((f) => `${f.row}행 - ${f.error}`)
              .join('; ')})`
          : `${result.added}건 추가됨`
      );
      await refreshAllTrades();

      // 지금 보고 있는 브로커가 CSV 전용이면, 브로커 재선택 없이 방금 가져온
      // 데이터가 바로 보이도록 계좌 목록/매매내역을 다시 읽는다.
      if (selectedBroker && !API_BROKER_IDS.includes(selectedBroker)) {
        const stored = await api.listTradesStore({ broker: selectedBroker });
        const ids = Array.from(new Set(stored.map((t) => t.accountId)));
        setAccounts(ids.map((id) => ({ id })));
        const nextAccountId = accountId && ids.includes(accountId) ? accountId : (ids[0] ?? null);
        setAccountId(nextAccountId);
        if (nextAccountId) {
          setTrades(stored.filter((t) => t.accountId === nextAccountId).map(mapStoredTrade));
        } else {
          setTrades([]);
        }
      }
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // CSV 가져오기와 같은 백엔드 엔드포인트(POST /trades-store/import)를 행 1개짜리
  // 배열로 호출한다 — id를 안 주면 서버가 새로 발급하므로 항상 새 매매내역으로
  // 추가된다(같은 엔드포인트가 CSV 여러 줄이든 수동 입력 한 줄이든 그대로 처리).
  async function onAddTrade(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddResult(null);

    const quantityNum = Number(addQuantity);
    const priceNum = Number(addPrice);
    const amountNum = Number(addAmount);
    if (
      !addAccountId.trim() ||
      !addSymbol.trim() ||
      !Number.isFinite(quantityNum) ||
      quantityNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum < 0 ||
      !Number.isFinite(amountNum) ||
      amountNum < 0 ||
      !addExecutedAt
    ) {
      setAddError('계좌, 종목코드, 수량(양수), 단가(0 이상), 체결금액(0 이상), 체결일을 입력해주세요.');
      return;
    }

    try {
      const accountIdTrimmed = addAccountId.trim();
      const result = await api.importTradesStore([
        {
          broker: addBroker,
          accountId: accountIdTrimmed,
          symbol: addSymbol.trim(),
          side: addSide,
          quantity: quantityNum,
          price: priceNum,
          amount: amountNum,
          currency: addCurrency,
          executedAt: addExecutedAt,
          commission: addCommission.trim() ? Number(addCommission) : null,
          tax: addTax.trim() ? Number(addTax) : null,
        },
      ]);
      if (result.failed.length > 0) {
        setAddError(result.failed[0].error);
        return;
      }

      setAddSymbol('');
      setAddQuantity('');
      setAddPrice('');
      setAddAmount('');
      setAddCommission('');
      setAddTax('');
      setAddResult('추가되었습니다.');
      await refreshAllTrades();

      // 지금 보고 있는 화면이 방금 추가한 브로커와 같으면 계좌 목록/매매내역을
      // 바로 다시 읽어서 화면 전환 없이 반영한다(CSV 가져오기와 같은 패턴).
      if (selectedBroker === addBroker) {
        const stored = await api.listTradesStore({ broker: addBroker });
        const ids = Array.from(new Set(stored.map((t) => t.accountId)));
        setAccounts(ids.map((id) => ({ id })));
        const nextAccountId = ids.includes(accountIdTrimmed) ? accountIdTrimmed : (accountId ?? ids[0] ?? null);
        setAccountId(nextAccountId);
        if (nextAccountId) {
          setTrades(stored.filter((t) => t.accountId === nextAccountId).map(mapStoredTrade));
        }
      }
    } catch (e) {
      setAddError((e as Error).message);
    }
  }

  function startEditTrade(t: StoredTrade) {
    setEditingKey(tradeKey(t));
    setEditDraft({
      symbol: t.symbol,
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
      amount: String(t.amount),
      currency: t.currency,
      executedAt: t.executedAt,
      commission: t.commission === null ? '' : String(t.commission),
      tax: t.tax === null ? '' : String(t.tax),
    });
    setEditError(null);
  }

  function cancelEditTrade() {
    setEditingKey(null);
    setEditDraft(null);
    setEditError(null);
  }

  // 같은 (broker, accountId, id)로 다시 import를 호출하면 upsertFromImport가
  // 기존 행을 찾아 덮어쓴다(신규 라우트 불필요 — 수동 추가와 같은 엔드포인트).
  async function saveEditTrade(t: StoredTrade) {
    if (!editDraft) return;
    const quantityNum = Number(editDraft.quantity);
    const priceNum = Number(editDraft.price);
    const amountNum = Number(editDraft.amount);
    if (
      !editDraft.symbol.trim() ||
      !Number.isFinite(quantityNum) ||
      quantityNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum < 0 ||
      !Number.isFinite(amountNum) ||
      amountNum < 0 ||
      !editDraft.executedAt
    ) {
      setEditError('종목코드, 수량(양수), 단가(0 이상), 체결금액(0 이상), 체결일을 입력해주세요.');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await api.importTradesStore([
        {
          broker: t.broker,
          accountId: t.accountId,
          id: t.id,
          symbol: editDraft.symbol.trim(),
          side: editDraft.side,
          quantity: quantityNum,
          price: priceNum,
          amount: amountNum,
          currency: editDraft.currency,
          executedAt: editDraft.executedAt,
          commission: editDraft.commission.trim() ? Number(editDraft.commission) : null,
          tax: editDraft.tax.trim() ? Number(editDraft.tax) : null,
        },
      ]);
      if (result.failed.length > 0) {
        setEditError(result.failed[0].error);
        return;
      }

      setEditingKey(null);
      setEditDraft(null);
      await refreshAllTrades();

      // 지금 보고 있는 화면(위쪽 차트/스탯 기준 브로커·계좌)이 이 행과 같으면
      // 거기도 바로 반영한다.
      if (selectedBroker === t.broker && accountId === t.accountId) {
        const stored = await api.listTradesStore({ broker: t.broker, accountId: t.accountId });
        setTrades(stored.map(mapStoredTrade));
      }
    } catch (e) {
      setEditError((e as Error).message);
    } finally {
      setEditSaving(false);
    }
  }

  async function onDeleteTrade(t: StoredTrade) {
    await api.deleteTradeStore(t.broker, t.accountId, t.id);
    await refreshAllTrades();
    if (selectedBroker === t.broker && accountId === t.accountId) {
      setTrades((prev) => prev.filter((x) => x.id !== t.id));
    }
  }

  // 연간 보기면 트래드 전체를 12개월 버킷으로, 월간 보기면 선택한 달의
  // 거래만 골라 그 달의 날짜 수만큼 일별 버킷으로 나눈다 — 서버에서 다시
  // 받아올 필요 없이 이미 받아온 그 해 전체 trades를 그대로 재사용한다.
  const visibleTrades = useMemo(() => {
    if (viewMode === 'year') return trades;
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return trades.filter((t) => t.executedAt.startsWith(prefix));
  }, [trades, viewMode, year, month]);

  const chartRows = useMemo<TradeSummaryBucket[]>(() => {
    if (viewMode === 'year') {
      const rows: TradeSummaryBucket[] = Array.from({ length: 12 }, (_, i) => ({
        label: String(i + 1).padStart(2, '0'),
        buyKrw: 0,
        buyUsd: 0,
        sellKrw: 0,
        sellUsd: 0,
      }));
      for (const t of trades) {
        const monthIdx = Number(t.executedAt.slice(5, 7)) - 1;
        if (monthIdx < 0 || monthIdx > 11) continue;
        accumulate(rows[monthIdx], t);
      }
      return rows;
    }

    const numDays = daysInMonth(year, month);
    const rows: TradeSummaryBucket[] = Array.from({ length: numDays }, (_, i) => ({
      label: String(i + 1),
      buyKrw: 0,
      buyUsd: 0,
      sellKrw: 0,
      sellUsd: 0,
    }));
    for (const t of visibleTrades) {
      const day = Number(t.executedAt.slice(8, 10));
      if (day < 1 || day > numDays) continue;
      accumulate(rows[day - 1], t);
    }
    return rows;
  }, [trades, visibleTrades, viewMode, year, month]);

  const totals = useMemo(() => {
    let buyKrw = 0;
    let buyUsd = 0;
    let sellKrw = 0;
    let sellUsd = 0;
    let buyCount = 0;
    let sellCount = 0;
    for (const t of visibleTrades) {
      const isUsd = t.currency === 'USD';
      if (t.side === 'BUY') {
        buyCount += 1;
        if (isUsd) buyUsd += t.amount;
        else buyKrw += t.amount;
      } else {
        sellCount += 1;
        if (isUsd) sellUsd += t.amount;
        else sellKrw += t.amount;
      }
    }
    return { buyKrw, buyUsd, sellKrw, sellUsd, buyCount, sellCount };
  }, [visibleTrades]);

  // 매매내역 목록 전용 증권사 필터 옵션 — 실제로 로컬 저장소에 있는 브로커만.
  const listBrokerOptions = useMemo(
    () => BROKER_ORDER.filter((id) => allTrades.some((t) => t.broker === id)),
    [allTrades]
  );

  // 목록은 위쪽 차트와 같은 연도/월 필터를 적용하되(같은 "지금 보고 있는 기간"
  // 개념을 공유), 증권사/계좌는 위쪽 select와 무관하게 listBroker 하나로만 좁힌다.
  const sortedTrades = useMemo(() => {
    let rows = allTrades;
    if (listBroker !== 'ALL') rows = rows.filter((t) => t.broker === listBroker);
    const prefix = viewMode === 'year' ? String(year) : `${year}-${String(month).padStart(2, '0')}`;
    rows = rows.filter((t) => t.executedAt.startsWith(prefix));
    return [...rows].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1));
  }, [allTrades, listBroker, viewMode, year, month]);

  // Dividends.tsx의 배당 기록 목록과 같은 페이지네이션 패턴 — `page`를 effect로
  // 되돌리지 않고 매 렌더마다 pageCount 안으로 clamp해서 쓴다. 페이지 번호 버튼도
  // 동일하게 10개(PAGE_GROUP_SIZE) 그룹 단위로만 그린다.
  const pageCount = pageSize === 'ALL' ? 1 : Math.max(1, Math.ceil(sortedTrades.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedTrades = useMemo(() => {
    if (pageSize === 'ALL') return sortedTrades;
    const start = (currentPage - 1) * pageSize;
    return sortedTrades.slice(start, start + pageSize);
  }, [sortedTrades, pageSize, currentPage]);
  const pageGroupStart = Math.floor((currentPage - 1) / PAGE_GROUP_SIZE) * PAGE_GROUP_SIZE + 1;
  const pageGroupEnd = Math.min(pageGroupStart + PAGE_GROUP_SIZE - 1, pageCount);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">매매내역</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={onExportCsv}>
            CSV 내보내기 (전체)
          </button>
          <button className="ghost" onClick={onImportClick} disabled={importing}>
            {importing ? '가져오는 중...' : 'CSV 가져오기'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onImportFile} />
        </div>
      </div>

      {importResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {importResult}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {configuredBrokers.length > 1 && (
          <div className="form-row">
            <label>증권사</label>
            <select
              value={selectedBroker ?? ''}
              onChange={(e) => {
                // Dashboard.tsx와 같은 이유로 accountId를 같은 커밋에서 동기적으로 리셋한다.
                setSelectedBroker(e.target.value as BrokerId);
                setAccountId(null);
              }}
            >
              {configuredBrokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.displayName}
                </option>
              ))}
            </select>
          </div>
        )}

        {accounts.length > 1 && (
          <div className="form-row">
            <label>계좌</label>
            <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {formatAccountOption(
                    a,
                    selectedBroker
                      ? accountLabels.find(
                          (l) => accountLabelKey(l.broker, l.accountId) === accountLabelKey(selectedBroker, a.id)
                        )?.label
                      : undefined
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
              setPage(1);
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
              setPage(1);
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
                setPage(1);
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

      <div className="card">
        <h3 style={{ marginTop: 0 }}>매매내역 추가</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          API 연동이 없는 증권사(KB증권/삼성증권/미래에셋증권)만 직접 입력할 수 있습니다. 토스증권/
          한국투자증권은 실시간 조회로 매매내역이 자동으로 채워집니다.
        </p>
        {addError && (
          <p className="text-critical" style={{ whiteSpace: 'pre-wrap' }}>
            {addError}
          </p>
        )}
        <form onSubmit={onAddTrade}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div className="form-row">
              <label>증권사</label>
              <select value={addBroker} onChange={(e) => setAddBroker(e.target.value as BrokerId)}>
                {CSV_ONLY_BROKER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {BROKER_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>계좌</label>
              <input
                value={addAccountId}
                onChange={(e) => setAddAccountId(e.target.value)}
                placeholder="예: 123-45-678901"
              />
            </div>
            <div className="form-row">
              <label>종목코드</label>
              <input value={addSymbol} onChange={(e) => setAddSymbol(e.target.value)} placeholder="예: 005930" />
            </div>
            <div className="form-row">
              <label>구분</label>
              <select value={addSide} onChange={(e) => setAddSide(e.target.value as 'BUY' | 'SELL')}>
                <option value="BUY">매수</option>
                <option value="SELL">매도</option>
              </select>
            </div>
            <div className="form-row">
              <label>수량</label>
              <input type="number" min="0" step="any" value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)} />
            </div>
            <div className="form-row">
              <label>단가</label>
              <input type="number" min="0" step="any" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} />
            </div>
            <div className="form-row">
              <label>통화</label>
              <select value={addCurrency} onChange={(e) => setAddCurrency(e.target.value)}>
                <option value="KRW">원화 (KRW)</option>
                <option value="USD">달러 (USD)</option>
              </select>
            </div>
            <div className="form-row">
              <label>체결금액</label>
              <input type="number" min="0" step="any" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} />
            </div>
            <div className="form-row">
              <label>체결일</label>
              <input type="date" value={addExecutedAt} onChange={(e) => setAddExecutedAt(e.target.value)} />
            </div>
            <div className="form-row">
              <label>수수료 (선택)</label>
              <input type="number" min="0" step="any" value={addCommission} onChange={(e) => setAddCommission(e.target.value)} />
            </div>
            <div className="form-row">
              <label>세금 (선택)</label>
              <input type="number" min="0" step="any" value={addTax} onChange={(e) => setAddTax(e.target.value)} />
            </div>
          </div>
          <button type="submit" className="primary">
            추가
          </button>
        </form>
        {addResult && (
          <p className="text-good" style={{ fontSize: 13 }}>
            {addResult}
          </p>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>증권사</label>
          <select
            value={listBroker}
            onChange={(e) => {
              setListBroker(e.target.value as BrokerFilter);
              setPage(1);
            }}
          >
            <option value="ALL">전체</option>
            {listBrokerOptions.map((id) => (
              <option key={id} value={id}>
                {BROKER_LABELS[id]}
              </option>
            ))}
          </select>
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
              <th>일자</th>
              <th>증권사</th>
              <th>계좌</th>
              <th>종목코드</th>
              <th>구분</th>
              <th>수량</th>
              <th>단가</th>
              <th>체결금액</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {viewMode === 'year' ? `${year}년` : `${year}년 ${month}월`} 거래 내역이 없습니다.
                  {listBroker !== 'ALL' ? ` (${BROKER_LABELS[listBroker]} 기준)` : ''}
                </td>
              </tr>
            ) : (
              pagedTrades.map((t) => {
                const editable = CSV_ONLY_BROKER_IDS.includes(t.broker);
                const key = tradeKey(t);
                if (editingKey === key && editDraft) {
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="date"
                          value={editDraft.executedAt}
                          onChange={(e) => setEditDraft({ ...editDraft, executedAt: e.target.value })}
                        />
                      </td>
                      <td>{BROKER_LABELS[t.broker]}</td>
                      <td>{formatAccountOption({ id: t.accountId }, accountLabels.find((l) => accountLabelKey(l.broker, l.accountId) === accountLabelKey(t.broker, t.accountId))?.label)}</td>
                      <td>
                        <input
                          value={editDraft.symbol}
                          onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                          style={{ width: 80 }}
                        />
                      </td>
                      <td>
                        <select
                          value={editDraft.side}
                          onChange={(e) => setEditDraft({ ...editDraft, side: e.target.value as 'BUY' | 'SELL' })}
                        >
                          <option value="BUY">매수</option>
                          <option value="SELL">매도</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editDraft.quantity}
                          onChange={(e) => setEditDraft({ ...editDraft, quantity: e.target.value })}
                          style={{ width: 70 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editDraft.price}
                          onChange={(e) => setEditDraft({ ...editDraft, price: e.target.value })}
                          style={{ width: 90 }}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <select
                            value={editDraft.currency}
                            onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value })}
                          >
                            <option value="KRW">원</option>
                            <option value="USD">USD</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={editDraft.amount}
                            onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
                            style={{ width: 90 }}
                          />
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="ghost" onClick={() => saveEditTrade(t)} disabled={editSaving}>
                            {editSaving ? '저장 중...' : '저장'}
                          </button>
                          <button className="ghost" onClick={cancelEditTrade} disabled={editSaving}>
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
                  );
                }

                return (
                  <tr key={key}>
                    <td>{t.executedAt}</td>
                    <td>{BROKER_LABELS[t.broker]}</td>
                    <td>
                      {formatAccountOption(
                        { id: t.accountId },
                        accountLabels.find((l) => accountLabelKey(l.broker, l.accountId) === accountLabelKey(t.broker, t.accountId))?.label
                      )}
                    </td>
                    <td>{t.symbol}</td>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          marginRight: 6,
                          background: t.side === 'BUY' ? 'var(--series-1)' : 'var(--series-2)',
                        }}
                      />
                      {t.side === 'BUY' ? '매수' : '매도'}
                    </td>
                    <td>{t.quantity}</td>
                    <td>{formatAmount(t.price, t.currency)}</td>
                    <td>{formatAmount(t.amount, t.currency)}</td>
                    <td>
                      {editable ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="ghost" onClick={() => startEditTrade(t)}>
                            수정
                          </button>
                          <button className="ghost" onClick={() => onDeleteTrade(t)}>
                            삭제
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>실시간 연동</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
