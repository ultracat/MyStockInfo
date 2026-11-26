import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { effectiveRate } from '../../fx';
import { loadUsdKrwRates } from '../../fxLoader';
import { RESUME_REFRESH_MS, useResumeRefresh } from '../../pageActivity';
import type { AccountLabel, BrokerAccount, BrokerId, BrokerSummary, StoredTrade, TradeRecord } from '../../types';
import { mapStoredTrade, type DisplayTrade } from '../../calc/trades';
import { API_BROKER_IDS } from '../../brokers';
import { getKbLinkStatus, type KbLinkStatus } from '../../kbSync';
import { currentYear, localToday } from '../../format';

/** 위쪽 증권사 select의 값 — 개별 브로커 하나 또는 "전체"(여러 브로커/계좌를
 *  한 화면에서 합쳐서 봄, 계좌 개념 없음). */
export type BrokerSelection = 'ALL' | BrokerId;

/**
 * 매매내역 데이터 — 증권사·계좌 선택과 그 매매내역(개별 모드는 연도 단위 조회), "전체" 모드의 로컬 저장소 전체(allTrades),
 * KB증권 백그라운드 동기화, 환율. Trades.tsx에서 2026-11-17 뺐다(로직 그대로). 카드가 데이터를 바꾼 뒤 화면을 맞추는 경로도
 * 여기 둔다(refreshAfter*) — 경로마다 다시 읽는 범위가 달라서(가져오기·추가·수정·삭제·종목명 갱신) 각각 그대로 옮겼다.
 */
export function useTradesData(year: number) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<BrokerSummary[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<BrokerSelection | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);

  // 지금 화면의 선택(증권사·계좌·연도) — 늦게 온 비동기 응답(KB 동기화·다시 보일 때 갱신)이 그 사이 다른 증권사·계좌로
  // 옮긴 화면을 덮어쓰지 않게, 응답을 반영하기 직전에 이 ref와 요청 때의 선택을 비교한다(클로저는 요청 때 값을 붙잡고 있다).
  const selectionRef = useRef({ broker: selectedBroker, accountId, year });
  selectionRef.current = { broker: selectedBroker, accountId, year };
  const isSelected = (broker: BrokerSelection | null, accId: string | null, yr?: number) =>
    selectionRef.current.broker === broker &&
    selectionRef.current.accountId === accId &&
    (yr === undefined || selectionRef.current.year === yr);

  // "전체" 모드(selectedBroker === 'ALL')의 유일한 데이터 소스 — 로컬 저장소
  // 전체(trades-store, 모든 브로커/계좌)를 받아온다. 로컬 저장소는 write-through
  // 캐시라 API 브로커는 실제로 한 번 라이브 조회한 적 있는 연도만 여기 나타난다
  // (CSV 내보내기(전체)가 이미 같은 전제로 동작함) — 완전성보다 "여러 증권사를
  // 한 표에서 훑어보고 CSV 전용 계좌는 바로 고칠 수 있게" 하는 게 목적이라
  // 허용 가능한 트레이드오프. CSV 가져오기/수동 추가/수정/삭제가 성공할 때마다
  // 다시 불러와 최신 상태를 유지한다(개별 브로커 모드 여부와 무관하게 항상 갱신 —
  // 나중에 "전체"로 전환해도 바로 최신 데이터를 보게 하기 위함).
  const [allTrades, setAllTrades] = useState<StoredTrade[]>([]);

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
  const effectiveFxRate = effectiveRate(manualFxRate, liveFxRate);

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
    void (async () => {
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
          ? await api.listAccounts(selectedBroker, { includePaper: true })
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
      await api.syncKbTrades(`${currentYear()}-01-01`, localToday(), linkedId);
      if (kbSyncRequestId.current !== myRequestId) return; // 그 사이 다른 KB 동기화가 시작됨
      await refreshAllTrades();
      // 지금 선택을 ref로 본다 — 이 함수가 만들어질 때의 selectedBroker/accountId는 동기화를 기다리는 사이 바뀌었을 수 있다.
      if (isSelected('kb', linkedId)) {
        const stored = await api.listTradesStore({ broker: 'kb', accountId: linkedId });
        if (kbSyncRequestId.current === myRequestId && isSelected('kb', linkedId)) setTrades(stored.map(mapStoredTrade));
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
    void (async () => {
      try {
        setLoading(true);
        setError(null);
        if (API_BROKER_IDS.includes(selectedBroker)) {
          const from = `${year}-01-01`;
          const to = year === currentYear() ? localToday() : `${year}-12-31`;
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

  // 메뉴를 옮겼다 돌아오면 지금 화면(선택한 증권사·계좌·연도·표)을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx).
  // 선택을 초기화하는 위 effect들은 다시 돌리지 않는다. 실패하면 이전 값을 유지한다.
  useResumeRefresh(async ({ dataChanged }) => {
    refreshAllTrades().catch(() => {});
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
    if (dataChanged) api.listBrokers().then(setBrokers).catch(() => {});
    if (!selectedBroker || selectedBroker === 'ALL' || !accountId) return;
    const broker = selectedBroker;
    const accId = accountId;
    const yr = year;
    try {
      // 응답을 기다리는 사이 다른 증권사·계좌·연도로 옮겼으면 버린다(selectionRef).
      if (API_BROKER_IDS.includes(broker)) {
        const to = yr === currentYear() ? localToday() : `${yr}-12-31`;
        const data = await api.getTradeHistory(broker, accId, `${yr}-01-01`, to);
        if (isSelected(broker, accId, yr)) setTrades(data);
      } else {
        const data = (await api.listTradesStore({ broker, accountId: accId })).map(mapStoredTrade);
        if (isSelected(broker, accId, yr)) setTrades(data);
      }
    } catch {
      // 이전 화면 유지
    }
  }, RESUME_REFRESH_MS);

  // ---- 카드가 저장소를 바꾼 뒤 화면을 맞추는 경로(예전 Trades.tsx의 각 핸들러 뒷부분 그대로)

  // 종목명 일괄 갱신 뒤 — 지금 보고 있는 화면이 CSV 전용 브로커의 개별 계좌 모드면 그 목록도 바로 다시 읽는다(CSV 가져오기 성공
  // 후와 같은 패턴) — API 브로커는 다음 실시간 조회 때 이미 자동으로 채워지므로 여기서 더 손댈 게 없다.
  async function refreshAfterNames() {
    await refreshAllTrades();
      if (selectedBroker && selectedBroker !== 'ALL' && !API_BROKER_IDS.includes(selectedBroker) && accountId) {
        const stored = await api.listTradesStore({ broker: selectedBroker, accountId });
        setTrades(stored.map(mapStoredTrade));
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

  // 수동 추가 뒤 — 지금 보고 있는 화면이 방금 추가한 브로커와 같으면 계좌 목록/매매내역을 바로 다시 읽어서 화면 전환 없이
  // 반영한다(CSV 가져오기와 같은 패턴).
  async function refreshAfterAdd(addBroker: BrokerId, accountIdTrimmed: string) {
    await refreshAllTrades();
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
  }

  // 인라인 수정 뒤 — 지금 보고 있는 화면(위쪽 차트/스탯 기준 브로커·계좌)이 이 행과 같으면 거기도 바로 반영한다.
  async function refreshAfterEdit(t: DisplayTrade) {
    await refreshAllTrades();
      if (selectedBroker === t.broker && accountId === t.accountId) {
        const stored = await api.listTradesStore({ broker: t.broker, accountId: t.accountId });
        setTrades(stored.map(mapStoredTrade));
      }
  }

  async function refreshAfterDelete(t: DisplayTrade) {
    await refreshAllTrades();
    if (selectedBroker === t.broker && accountId === t.accountId) {
      setTrades((prev) => prev.filter((x) => x.id !== t.id));
    }
  }

  const isKbSyncable =
    kbLink.configured &&
    !!kbLink.linkedAccountId &&
    ((selectedBroker === 'kb' && accountId === kbLink.linkedAccountId) || selectedBroker === 'ALL');

  return {
    loading,
    error,
    configuredBrokers,
    selectedBroker,
    setSelectedBroker,
    accounts,
    accountId,
    setAccountId,
    userPickedAccountRef,
    accountLabels,
    trades,
    allTrades,
    effectiveFxRate,
    kbSyncing,
    kbSyncNotice,
    isKbSyncable,
    kbLinkedAccountId: kbLink.configured ? kbLink.linkedAccountId : null,
    triggerKbSync,
    refreshAllTrades,
    refreshAfterNames,
    refreshAfterStoreImport,
    refreshAfterAdd,
    refreshAfterEdit,
    refreshAfterDelete,
  };
}
