import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, BrokerAccount, BrokerId, BrokerSummary, StoredTrade, TradeRecord } from '../types';
import TradesChart, { type TradeSummaryBucket } from '../components/TradesChart';
import CollapseToggle from '../components/CollapseToggle';
import { krw, usdFmt } from '../format';
import { downloadCsv, parseCsv } from '../csv';
import { formatImportResult, singleRowImportError } from '../importResult';
import { API_BROKER_IDS, BROKER_LABELS, CSV_ONLY_BROKER_IDS } from '../brokers';
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import StockNameLink, { useStockLinkResolver } from '../components/StockNameLink';
import { getKbLinkStatus, type KbLinkStatus } from '../kbSync';

// CSV 전용 브로커(KB/삼성/미래에셋)의 로컬 저장소 행을 화면이 이미 쓰는
// TradeRecord 모양으로 바꾼다 — name은 백엔드가 이미 채워서 저장해준 값을 그대로
// 쓴다(자동조회는 KB 동기화/CSV 가져오기 시점에 백엔드에서 끝남, backend/CLAUDE.md
// "매매내역 종목명" 절 참고).
function mapStoredTrade(t: StoredTrade): TradeRecord {
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name,
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

// id는 브로커 고유 체결번호라 CSV 입력행엔 없고 없으면 서버가 새로 발급한다.
// name(종목명)은 선택 컬럼 — 비워두면 백엔드가 토스→KIS→KB 순으로 자동조회해서
// 채운다(backend/CLAUDE.md 참고), 값을 채우면 그 값을 그대로 쓴다(API 연동이
// 전혀 없을 때의 유일한 채움 경로).
const TRADES_CSV_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'name',
  'side',
  'quantity',
  'price',
  'amount',
  'currency',
  'executedAt',
  'commission',
  'tax',
  // 선택 컬럼(맨 뒤) — 다시 가져올 때 같은 거래로 덮어쓰게 해서 중복을 막는다
  // (backend/src/db/tradesStore.ts의 "중복 방지" 참고).
  'id',
];

const today = () => new Date().toISOString().slice(0, 10);

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

type ViewMode = 'year' | 'month';
type PageSize = 10 | 20 | 30 | 'ALL';
/** 위쪽 증권사 select의 값 — 개별 브로커 하나 또는 "전체"(여러 브로커/계좌를
 *  한 화면에서 합쳐서 봄, 계좌 개념 없음). */
type BrokerSelection = 'ALL' | BrokerId;

/** 매매내역 목록(하단 표) 한 행의 공용 모양 — 개별 브로커 모드(TradeRecord, 위쪽
 *  select가 이미 broker/accountId를 알고 있음)와 전체보기 모드(StoredTrade,
 *  행마다 broker/accountId가 다름)를 같은 렌더링/수정/삭제 로직으로 다루기 위해
 *  둘 다 이 모양으로 정규화한다 — `displayTrades` 참고. */
interface DisplayTrade {
  broker: BrokerId;
  accountId: string;
  id: string;
  symbol: string;
  name: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  commission: number | null;
  tax: number | null;
  executedAt: string;
}

function tradeKey(t: DisplayTrade): string {
  return `${t.broker}|${t.accountId}|${t.id}`;
}

const PAGE_SIZE_OPTIONS: PageSize[] = [10, 20, 30, 'ALL'];
const PAGE_GROUP_SIZE = 10;

function formatAmount(amount: number, currency: string) {
  return currency === 'USD' ? usdFmt.format(amount) : `${krw.format(Math.round(amount))}원`;
}

// 수동 입력(매매내역 추가)/인라인 수정 둘 다 체결금액을 따로 입력받지 않고
// 수량*단가로 계산한다 — CSV 전용 브로커는 브로커가 내려주는 별도 체결금액이
// 없어(사용자가 직접 기록하는 값) 수량/단가만 정확하면 체결금액은 항상 그 곱과
// 같아야 하고, 따로 입력받으면 두 값이 어긋날 위험만 생긴다. 입력칸이 아직 비어
// 있거나 숫자가 아니면 0을 보여준다(완성 전 중간 상태).
function computeAmount(quantity: string, price: string): number {
  const q = Number(quantity);
  const p = Number(price);
  return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
}

// 체결금액(amount)은 체결 그 자체의 금액(수량*단가)이고 수수료/세금은 별도
// 필드다 — 화면에 보여주는 "체결금액"은 수수료·세금을 더한 값으로 계산한다
// (매수/매도 구분 없이 항상 더함 — 표에서도, 매매내역 추가/인라인 수정의
// 자동계산 미리보기에서도 같은 공식을 쓴다). KIS는 이 두 필드를 아직 안
// 내려줘서(commission/tax 항상 null) 사실상 토스/KB증권/CSV·수동 입력 행에만
// 차이가 생긴다.
function netTradeAmount(amount: number, commission: number | null, tax: number | null) {
  return amount + (commission ?? 0) + (tax ?? 0);
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function accumulate(row: TradeSummaryBucket, t: { side: 'BUY' | 'SELL'; currency: string; amount: number }) {
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
  const [selectedBroker, setSelectedBroker] = useState<BrokerSelection | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();
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
  const [addName, setAddName] = useState('');
  const [addSide, setAddSide] = useState<'BUY' | 'SELL'>('BUY');
  const [addQuantity, setAddQuantity] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addCurrency, setAddCurrency] = useState('KRW');
  const [addExecutedAt, setAddExecutedAt] = useState(today());
  const [addCommission, setAddCommission] = useState('');
  const [addTax, setAddTax] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addResult, setAddResult] = useState<string | null>(null);

  // "전체" 모드(selectedBroker === 'ALL')의 유일한 데이터 소스 — 로컬 저장소
  // 전체(trades-store, 모든 브로커/계좌)를 받아온다. 로컬 저장소는 write-through
  // 캐시라 API 브로커는 실제로 한 번 라이브 조회한 적 있는 연도만 여기 나타난다
  // (CSV 내보내기(전체)가 이미 같은 전제로 동작함) — 완전성보다 "여러 증권사를
  // 한 표에서 훑어보고 CSV 전용 계좌는 바로 고칠 수 있게" 하는 게 목적이라
  // 허용 가능한 트레이드오프. CSV 가져오기/수동 추가/수정/삭제가 성공할 때마다
  // 다시 불러와 최신 상태를 유지한다(개별 브로커 모드 여부와 무관하게 항상 갱신 —
  // 나중에 "전체"로 전환해도 바로 최신 데이터를 보게 하기 위함).
  const [allTrades, setAllTrades] = useState<StoredTrade[]>([]);

  // 매매내역 목록의 인라인 수정/삭제 — CSV 전용 브로커 행에만 허용한다. 토스/KIS
  // 행은 write-through로 실시간 조회가 성공할 때마다 같은 id로 덮어써지므로,
  // 여기서 고쳐도 다음 라이브 조회에 그대로 되돌아가 의미가 없다.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    symbol: string;
    name: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    price: string;
    currency: string;
    executedAt: string;
    commission: string;
    tax: string;
  } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [refreshingNames, setRefreshingNames] = useState(false);
  const [refreshNamesResult, setRefreshNamesResult] = useState<string | null>(null);

  async function refreshAllTrades() {
    setAllTrades(await api.listTradesStore());
  }

  // 로컬 저장소(trades-store)에 이미 쌓인 행 중 종목명이 없는 것만 채운다 —
  // name 필드가 생기기 전에 저장됐던 행(당시엔 write-through가 이름을 버렸음)이나,
  // 그때는 API 연동이 없어서 못 채웠던 행을 위한 일괄 백필. Dividends.tsx의
  // "종목명 일괄 갱신"과 같은 패턴(backend/CLAUDE.md의 "매매내역 종목명" 절 참고).
  async function onRefreshNames() {
    setRefreshingNames(true);
    setRefreshNamesResult(null);
    try {
      const result = await api.refreshTradeNames();
      setRefreshNamesResult(
        result.failed.length > 0
          ? `${result.updated}건 갱신됨 (조회 실패: ${result.failed.join(', ')})`
          : `${result.updated}건 갱신됨`
      );
      await refreshAllTrades();
      // 지금 보고 있는 화면이 CSV 전용 브로커의 개별 계좌 모드면 그 목록도 바로
      // 다시 읽는다(CSV 가져오기 성공 후와 같은 패턴) — API 브로커는 다음 실시간
      // 조회 때 이미 자동으로 채워지므로 여기서 더 손댈 게 없다.
      if (selectedBroker && selectedBroker !== 'ALL' && !API_BROKER_IDS.includes(selectedBroker) && accountId) {
        const stored = await api.listTradesStore({ broker: selectedBroker, accountId });
        setTrades(stored.map(mapStoredTrade));
      }
    } catch (e) {
      setRefreshNamesResult((e as Error).message);
    } finally {
      setRefreshingNames(false);
    }
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

  // KB증권 Open API 연동 상태 — Dashboard.tsx와 같은 이유(kbSync.ts 참고). 개별
  // KB 계좌 모드뿐 아니라 "전체" 모드에도 그 계좌 데이터가 섞여 있으므로 두
  // 모드 다 이 상태를 참고해 백그라운드 동기화를 트리거한다(아래).
  const [kbLink, setKbLink] = useState<KbLinkStatus>({ configured: false, linkedAccountId: null });
  const [kbSyncing, setKbSyncing] = useState(false);
  const [kbSyncNotice, setKbSyncNotice] = useState<string | null>(null);
  const kbSyncRequestId = useRef(0);
  // KB는 종합위탁계좌/IRP/연금저축처럼 계좌가 여러 개일 수 있는데, 그 중
  // 실시간 API로 연동된 건 하나뿐이다(kbLink.linkedAccountId). 계좌 목록 조회
  // effect(아래)는 로컬 저장소에서 "먼저 눈에 띈" accountId를 기본값으로
  // 고르는데, 그게 연동 계좌가 아니면(흔한 경우 — IRP/연금저축 등 CSV 전용
  // 계좌가 먼저 나올 수 있음) 아래 KB 동기화 트리거 effect의 조건
  // (accountId === kbLink.linkedAccountId)을 못 만족해 자동 동기화가 전혀
  // 안 일어나고, 화면엔 옛 로컬 데이터만 보이거나 아예 비어 보인다 — 계좌를
  // 몇 번 옮기다 우연히 연동 계좌를 직접 고르면 그제서야 동기화가 도는 식으로
  // "고쳐졌다"고 느껴졌던 버그. 그래서 연동 계좌를 기본값으로 강제하되, 사용자가
  // 이미 계좌를 직접 골랐으면(아래 계좌 select의 onChange) 건드리지 않는다 —
  // 브로커를 바꿀 때마다(아래 계좌 목록 조회 effect) false로 리셋된다.
  const userPickedAccountRef = useRef(false);

  useEffect(() => {
    getKbLinkStatus()
      .then(setKbLink)
      .catch(() => {});
  }, []);

  // 배당금 화면과 같은 방식: 달러 거래를 원화로 환산해 보여주기 위한 환율.
  // 선택된 브로커와 무관하게 한 번만 가져온다(KIS만 보고 있어도 나중에
  // 토스로 전환할 수 있으므로) — getUsdKrwRate가 토스→한국수출입은행 순으로
  // 처리해준다(backend/CLAUDE.md의 "환율 조회" 절 참고).
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = manualFxRate ?? liveFxRate;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fx = await api.getFxRate().catch(() => ({ usdKrwRate: null }));
      if (cancelled) return;
      setManualFxRate(fx.usdKrwRate);
      const live = await api.getUsdKrwRate().catch(() => ({ rate: null }));
      if (!cancelled && live.rate) setLiveFxRate(live.midRate ?? live.rate);
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
        // 브로커가 바뀌면 "사용자가 계좌를 직접 골랐다"는 표시도 초기화한다 —
        // 아래 KB 연동 계좌 merge effect가 이 브로커 선택에 대해 다시 기본값을
        // (연동 계좌로) 정할 수 있게.
        userPickedAccountRef.current = false;
        // 브로커를 바꾸는 즉시 이전 브로커의 매매내역을 지운다 — 새 브로커의 계좌
        // 목록이 비어 있으면(CSV 전용 브로커에 아직 아무 것도 안 넣은 경우) 아래
        // 매매내역 조회 effect가 accountId===null이라 아예 안 돌아서, 이 reset이
        // 없으면 화면에 이전 브로커의 표가 그대로 남아있게 된다.
        setTrades([]);

        // "전체"는 계좌 개념이 없다(여러 브로커/계좌를 한 화면에서 합쳐서 봄) —
        // 계좌 목록 조회 자체를 건너뛴다. 차트/목록은 allTrades(마운트 시 이미
        // 받아온 로컬 저장소 전체)를 그대로 쓴다.
        if (selectedBroker === 'ALL') {
          setAccounts([]);
          return;
        }

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

  // KB증권의 API 연동 계좌를 계좌 목록에 합쳐 넣고, 기본 선택 계좌로 강제한다 —
  // Dashboard.tsx와 같은 이유(위 effect는 로컬 저장소에 이미 있는 accountId만
  // 모으므로, 아직 한 번도 동기화/CSV 가져오기를 안 한 최초 상태에서는 그 계좌를
  // 선택할 방법이 없다). **"기본 선택 계좌로 강제"가 핵심 — 그냥 null일 때만
  // 채우는 걸로는 부족하다.** KB는 종합위탁/IRP/연금저축처럼 계좌가 여러 개일 수
  // 있는데, 위 effect는 로컬 저장소에서 "먼저 눈에 띈" accountId를 기본값으로
  // 이미 골라놨을 수 있다(그 계좌가 연동 계좌가 아니면 흔함 — CSV 전용 계좌가
  // 먼저 등록돼 있는 경우가 많음). 그 상태로 두면 아래 KB 동기화 트리거 effect의
  // 조건(accountId === kbLink.linkedAccountId)을 못 만족해 자동 동기화가 전혀
  // 안 일어나고, 처음 들어왔을 때 매매내역이 안 보이거나 오래된 로컬 데이터만
  // 보인다 — 계좌를 몇 번 옮기다 우연히 연동 계좌를 직접 고르면 그제서야
  // 동기화가 도는 식으로 "고쳐졌다"고 느껴졌던 버그(실측 재현). 그래서 사용자가
  // 이미 계좌를 직접 고른 게 아니라면(`userPickedAccountRef`, 계좌 select의
  // onChange에서 세팅) 위 effect가 뭘 먼저 선택해뒀든 연동 계좌로 덮어써서
  // 기본값을 확정한다. `accounts`도 deps에 넣어야 한다 — 위 effect가 비동기라
  // 이 effect가 먼저 실행된 뒤 `setAccounts(accs)`로 통째로 덮어써버리면 방금
  // 추가한 연동 계좌가 사라지는데, `accounts`가 바뀔 때마다 다시 실행되게 해두면
  // 그 시점에 다시 채워 넣어 수렴한다.
  useEffect(() => {
    if (selectedBroker !== 'kb' || !kbLink.linkedAccountId) return;
    const linkedId = kbLink.linkedAccountId;
    setAccounts((prev) => (prev.some((a) => a.id === linkedId) ? prev : [...prev, { id: linkedId }]));
    if (!userPickedAccountRef.current) setAccountId(linkedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBroker, kbLink.linkedAccountId, accounts]);

  // KB증권 API 연동 계좌를 백그라운드에서 동기화한다 — 개별 KB 계좌 모드뿐
  // 아니라 "전체" 모드도 대상이다(allTrades에 그 계좌 데이터가 섞여 있으므로).
  // Dashboard.tsx와 같은 이유로 Toss/KIS 같은 60초 폴링은 안 하고, 화면에
  // 보일 때 한 번만 부른다. 기간은 Settings의 옛 수동 버튼과 같은 "올해 고정"
  // (매매내역 화면에 새 기간 선택 UI를 늘리지 않기 위함).
  async function triggerKbSync() {
    if (!kbLink.linkedAccountId) return;
    const linkedId = kbLink.linkedAccountId;
    const myRequestId = ++kbSyncRequestId.current;
    setKbSyncing(true);
    setKbSyncNotice(null);
    try {
      await api.syncKbTrades(`${CURRENT_YEAR}-01-01`, today(), linkedId);
      if (kbSyncRequestId.current !== myRequestId) return; // 그 사이 다른 브로커/계좌로 이동함
      await refreshAllTrades();
      if (selectedBroker === 'kb' && accountId === linkedId) {
        const stored = await api.listTradesStore({ broker: 'kb', accountId: linkedId });
        if (kbSyncRequestId.current === myRequestId) setTrades(stored.map(mapStoredTrade));
      }
    } catch (e) {
      if (kbSyncRequestId.current === myRequestId) {
        setKbSyncNotice(`KB증권 최신 매매내역을 가져오지 못했습니다: ${(e as Error).message}`);
      }
    } finally {
      if (kbSyncRequestId.current === myRequestId) setKbSyncing(false);
    }
  }

  useEffect(() => {
    if (!kbLink.configured || !kbLink.linkedAccountId) return;
    const relevant = selectedBroker === 'kb' ? accountId === kbLink.linkedAccountId : selectedBroker === 'ALL';
    if (!relevant) return;
    void triggerKbSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBroker, accountId, kbLink.configured, kbLink.linkedAccountId]);

  useEffect(() => {
    if (!selectedBroker || selectedBroker === 'ALL' || !accountId) return;
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
        t.name ?? '',
        t.side,
        String(t.quantity),
        String(t.price),
        String(t.amount),
        t.currency,
        t.executedAt,
        t.commission === null ? '' : String(t.commission),
        t.tax === null ? '' : String(t.tax),
        t.id,
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
      const iName = colIndex('name');
      const iSide = colIndex('side');
      const iQuantity = colIndex('quantity');
      const iPrice = colIndex('price');
      const iAmount = colIndex('amount');
      const iCurrency = colIndex('currency');
      const iExecutedAt = colIndex('executedAt');
      const iCommission = colIndex('commission');
      const iTax = colIndex('tax');
      const iId = colIndex('id');

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
          broker: (r[iBroker] ?? '').trim().toLowerCase() as BrokerId,
          accountId: (r[iAccountId] ?? '').trim(),
          symbol: (r[iSymbol] ?? '').trim(),
          name: iName !== -1 && (r[iName] ?? '').trim() ? r[iName].trim() : null,
          side: (r[iSide] ?? '').trim() as 'BUY' | 'SELL',
          quantity: Number((r[iQuantity] ?? '').trim()),
          price: Number((r[iPrice] ?? '').trim()),
          amount: Number((r[iAmount] ?? '').trim()),
          currency: (r[iCurrency] ?? '').trim(),
          executedAt: (r[iExecutedAt] ?? '').trim(),
          commission: iCommission !== -1 ? num(r[iCommission]) : null,
          tax: iTax !== -1 ? num(r[iTax]) : null,
          id: iId !== -1 && (r[iId] ?? '').trim() ? r[iId].trim() : undefined,
        }));

      const result = await api.importTradesStore(records);
      setImportResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // CSV 가져오기/Google Sheets 가져오기 공통 — "전체" 모드 데이터를 다시 받고,
  // 지금 보고 있는 브로커가 CSV 전용이면 브로커 재선택 없이 방금 가져온 데이터가
  // 바로 보이도록 계좌 목록/매매내역도 다시 읽는다.
  async function refreshAfterStoreImport() {
    await refreshAllTrades();
    if (selectedBroker && selectedBroker !== 'ALL' && !API_BROKER_IDS.includes(selectedBroker)) {
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
  }

  // Google Sheets 연동 — Settings.tsx에서 연결 여부만 확인하고, 실제 내보내기/
  // 가져오기는 여기서 실행한다(CSV 내보내기/가져오기와 같은 대상: trades-store
  // 전체, 브로커/계좌 필터 없음).
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
    // 내보내기/가져오기 둘 다 전체 교체다(Dividends.tsx와 같은 이유) — 어느
    // 한쪽에만 있는 최신 내용이 반대쪽으로 덮어써지며 사라질 수 있어 확인창을
    // 넣는다(실제로 시트에 직접 입력한 내용이 내보내기로 유실된 사례 있음).
    if (!window.confirm('Google Sheets의 Trades 탭 전체를 로컬 데이터로 덮어씁니다. 시트에 직접 입력했지만 아직 "가져오기"로 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.exportToGoogleSheet('trades');
      setGoogleSyncResult(`Google Sheets로 ${result.rowCount}건 내보냈습니다.`);
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  async function onImportFromGoogleSheet() {
    if (!window.confirm('Google Sheets의 Trades 탭 내용으로 수동 입력 계좌의 로컬 데이터를 전부 교체합니다(API·동기화 계좌는 실시간 조회/동기화 값을 그대로 둡니다). 시트에 실패하는 행이 하나라도 있으면 아무것도 바꾸지 않습니다. 로컬에서 직접 추가/수정했지만 아직 "내보내기"로 시트에 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.importFromGoogleSheet('trades');
      setGoogleSyncResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
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
    if (
      !addAccountId.trim() ||
      !addSymbol.trim() ||
      !Number.isFinite(quantityNum) ||
      quantityNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum < 0 ||
      !addExecutedAt
    ) {
      setAddError('계좌, 종목코드, 수량(양수), 단가(0 이상), 체결일을 입력해주세요.');
      return;
    }

    try {
      const accountIdTrimmed = addAccountId.trim();
      const result = await api.importTradesStore([
        {
          broker: addBroker,
          accountId: accountIdTrimmed,
          symbol: addSymbol.trim(),
          name: addName.trim() ? addName.trim() : null,
          side: addSide,
          quantity: quantityNum,
          price: priceNum,
          amount: quantityNum * priceNum,
          currency: addCurrency,
          executedAt: addExecutedAt,
          commission: addCommission.trim() ? Number(addCommission) : null,
          tax: addTax.trim() ? Number(addTax) : null,
        },
      ]);
      const addFailure = singleRowImportError(result);
      if (addFailure) {
        setAddError(addFailure);
        return;
      }

      setAddSymbol('');
      setAddName('');
      setAddQuantity('');
      setAddPrice('');
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

  function startEditTrade(t: DisplayTrade) {
    setEditingKey(tradeKey(t));
    setEditDraft({
      symbol: t.symbol,
      name: t.name ?? '',
      side: t.side,
      quantity: String(t.quantity),
      price: String(t.price),
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
  async function saveEditTrade(t: DisplayTrade) {
    if (!editDraft) return;
    const quantityNum = Number(editDraft.quantity);
    const priceNum = Number(editDraft.price);
    if (
      !editDraft.symbol.trim() ||
      !Number.isFinite(quantityNum) ||
      quantityNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum < 0 ||
      !editDraft.executedAt
    ) {
      setEditError('종목코드, 수량(양수), 단가(0 이상), 체결일을 입력해주세요.');
      return;
    }
    // 종목코드를 바꿨는데 종목명 칸은 그대로(수정 시작 때 채워진 옛 이름)면
    // 옛 이름을 직접 입력값으로 보내지 않고 비워서 백엔드가 새 코드로 다시
    // 조회하게 한다 — 안 그러면 옛 이름이 override로 저장되고, "종목명 일괄
    // 갱신"은 이름이 빈 행만 채우므로 영영 안 고쳐진다(실사례: 코드 오기입 수정).
    const symbolChanged = editDraft.symbol.trim().toUpperCase() !== t.symbol.toUpperCase();
    const nameUntouched = editDraft.name.trim() === (t.name ?? '').trim();
    const nameToSave = symbolChanged && nameUntouched ? '' : editDraft.name.trim();
    setEditSaving(true);
    setEditError(null);
    try {
      const result = await api.importTradesStore([
        {
          broker: t.broker,
          accountId: t.accountId,
          id: t.id,
          symbol: editDraft.symbol.trim(),
          name: nameToSave ? nameToSave : null,
          side: editDraft.side,
          quantity: quantityNum,
          price: priceNum,
          amount: quantityNum * priceNum,
          currency: editDraft.currency,
          executedAt: editDraft.executedAt,
          commission: editDraft.commission.trim() ? Number(editDraft.commission) : null,
          tax: editDraft.tax.trim() ? Number(editDraft.tax) : null,
        },
      ]);
      const editFailure = singleRowImportError(result);
      if (editFailure) {
        setEditError(editFailure);
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

  async function onDeleteTrade(t: DisplayTrade) {
    await api.deleteTradeStore(t.broker, t.accountId, t.id);
    await refreshAllTrades();
    if (selectedBroker === t.broker && accountId === t.accountId) {
      setTrades((prev) => prev.filter((x) => x.id !== t.id));
    }
  }

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

  const chartRows = useMemo<TradeSummaryBucket[]>(() => {
    if (viewMode === 'year') {
      const rows: TradeSummaryBucket[] = Array.from({ length: 12 }, (_, i) => ({
        label: String(i + 1).padStart(2, '0'),
        buyKrw: 0,
        buyUsd: 0,
        sellKrw: 0,
        sellUsd: 0,
      }));
      for (const t of periodTrades) {
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
  }, [periodTrades, visibleTrades, viewMode, year, month]);

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

  // 매매내역 목록(하단 표)은 별도 필터 없이 위쪽에서 고른 기간(연도/월)·
  // 브로커·계좌를 그대로 따라간다("전체"면 allTrades 기반 visibleTrades를,
  // 개별 브로커면 trades 기반 visibleTrades를 그대로) — 두 소스의 행 모양이
  // 달라서(TradeRecord엔 broker/accountId가 없음) DisplayTrade로 정규화한다.
  const displayTrades = useMemo<DisplayTrade[]>(() => {
    if (isAllMode) {
      return visibleTrades as StoredTrade[];
    }
    if (!selectedBroker || !accountId) return [];
    const broker = selectedBroker;
    return (visibleTrades as TradeRecord[]).map((t) => ({
      broker,
      accountId,
      id: t.id,
      symbol: t.symbol,
      name: t.name,
      side: t.side,
      quantity: t.quantity,
      price: t.price,
      amount: t.amount,
      currency: t.currency,
      commission: t.commission,
      tax: t.tax,
      executedAt: t.executedAt,
    }));
  }, [isAllMode, visibleTrades, selectedBroker, accountId]);

  const sortedTrades = useMemo(
    () => [...displayTrades].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)),
    [displayTrades]
  );

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

  const isKbSyncable =
    kbLink.configured &&
    !!kbLink.linkedAccountId &&
    ((selectedBroker === 'kb' && accountId === kbLink.linkedAccountId) || selectedBroker === 'ALL');

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
          <button
            className="ghost"
            onClick={onRefreshNames}
            disabled={refreshingNames}
            title="저장된 매매내역 중 종목명이 비어 있는 행만 토스→KIS→KB 순으로 조회해 채웁니다."
          >
            {refreshingNames ? '갱신 중...' : '종목명 일괄 갱신'}
          </button>
          {isKbSyncable && (
            <button className="ghost" onClick={triggerKbSync} disabled={kbSyncing}>
              {kbSyncing ? '동기화 중...' : '새로고침'}
            </button>
          )}
        </div>
      </div>

      {importResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {importResult}
        </div>
      )}
      {googleSyncResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {googleSyncResult}
        </div>
      )}
      {refreshNamesResult && (
        <div className="notice" style={{ fontSize: 13 }}>
          {refreshNamesResult}
        </div>
      )}
      {kbSyncing && (
        <div className="notice" style={{ fontSize: 13 }}>
          KB증권 최신 매매내역을 백그라운드에서 가져오는 중...
        </div>
      )}
      {kbSyncNotice && (
        <div className="notice text-critical" style={{ fontSize: 13 }}>
          {kbSyncNotice}
        </div>
      )}

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
            {configuredBrokers.map((b) => (
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
                userPickedAccountRef.current = true;
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
              <label>종목명 (선택)</label>
              <input
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="비우면 자동조회"
              />
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
              <label>체결금액 (자동계산)</label>
              <input
                type="text"
                value={formatAmount(
                  netTradeAmount(
                    computeAmount(addQuantity, addPrice),
                    addCommission.trim() ? Number(addCommission) : null,
                    addTax.trim() ? Number(addTax) : null
                  ),
                  addCurrency
                )}
                readOnly
                style={{ color: 'var(--text-muted)' }}
              />
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
              <th>일자</th>
              {isAllMode && <th>증권사</th>}
              {isAllMode && <th>계좌</th>}
              <th>종목</th>
              <th>구분</th>
              <th>수량</th>
              <th>단가</th>
              <th>수수료</th>
              <th>세금</th>
              <th title="체결금액에 수수료·세금을 더한 값입니다.">체결금액</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.length === 0 ? (
              <tr>
                <td colSpan={isAllMode ? 11 : 9} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {viewMode === 'year' ? `${year}년` : `${year}년 ${month}월`} 거래 내역이 없습니다.
                </td>
              </tr>
            ) : (
              pagedTrades.map((t) => {
                // KB 연동 계좌는 CSV 전용 브로커여도 동기화가 주인이다(backend
                // brokers/rowOwnership.ts) — 고쳐도 백엔드가 건너뛴다.
                const editable =
                  CSV_ONLY_BROKER_IDS.includes(t.broker) &&
                  !(t.broker === 'kb' && kbLink.configured && t.accountId === kbLink.linkedAccountId);
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
                      {isAllMode && <td>{BROKER_LABELS[t.broker]}</td>}
                      {isAllMode && (
                        <td>
                          {formatAccountOption(
                            { id: t.accountId },
                            findAccountLabel(accountLabels, t.broker, t.accountId)
                          )}
                        </td>
                      )}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <input
                            value={editDraft.symbol}
                            onChange={(e) => setEditDraft({ ...editDraft, symbol: e.target.value })}
                            style={{ width: 80 }}
                            placeholder="종목코드"
                          />
                          <input
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            style={{ width: 80 }}
                            placeholder="종목명 (선택)"
                          />
                        </div>
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
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editDraft.commission}
                          onChange={(e) => setEditDraft({ ...editDraft, commission: e.target.value })}
                          placeholder="선택"
                          style={{ width: 70 }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={editDraft.tax}
                          onChange={(e) => setEditDraft({ ...editDraft, tax: e.target.value })}
                          placeholder="선택"
                          style={{ width: 70 }}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <select
                            value={editDraft.currency}
                            onChange={(e) => setEditDraft({ ...editDraft, currency: e.target.value })}
                          >
                            <option value="KRW">원</option>
                            <option value="USD">USD</option>
                          </select>
                          <span style={{ color: 'var(--text-muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                            {formatAmount(
                              netTradeAmount(
                                computeAmount(editDraft.quantity, editDraft.price),
                                editDraft.commission.trim() ? Number(editDraft.commission) : null,
                                editDraft.tax.trim() ? Number(editDraft.tax) : null
                              ),
                              editDraft.currency
                            )}
                          </span>
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
                    {isAllMode && <td>{BROKER_LABELS[t.broker]}</td>}
                    {isAllMode && (
                      <td>
                        {formatAccountOption(
                          { id: t.accountId },
                          findAccountLabel(accountLabels, t.broker, t.accountId)
                        )}
                      </td>
                    )}
                    <td>
                      {t.name ? (
                        <>
                          <StockNameLink name={t.name} url={stockLinkFor(t.symbol, t.currency)} />{' '}
                          <span style={{ color: 'var(--text-muted)' }}>({t.symbol})</span>
                        </>
                      ) : (
                        <StockNameLink name={t.symbol} url={stockLinkFor(t.symbol, t.currency)} />
                      )}
                    </td>
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
                    <td>{t.commission === null ? '-' : formatAmount(t.commission, t.currency)}</td>
                    <td>{t.tax === null ? '-' : formatAmount(t.tax, t.currency)}</td>
                    <td title={`체결금액 ${formatAmount(t.amount, t.currency)}${t.commission ? ` + 수수료 ${formatAmount(t.commission, t.currency)}` : ''}${t.tax ? ` + 세금 ${formatAmount(t.tax, t.currency)}` : ''}`}>
                      {formatAmount(netTradeAmount(t.amount, t.commission, t.tax), t.currency)}
                    </td>
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
    </div>
  );
}
