import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { effectiveRate } from '../../fx';
import { loadUsdKrwRates } from '../../fxLoader';
import { ALL_ACCOUNTS, buildPortfolioFromStored, mergePortfolios } from '../../calc/portfolio';
import { RESUME_REFRESH_MS, usePageActive, useResumeRefresh } from '../../pageActivity';
import type { AccountLabel, BrokerAccount, BrokerId, BrokerSummary, DividendRecord, PortfolioOverview, StoredHolding } from '../../types';
import { API_BROKER_IDS } from '../../brokers';
import { getKbLinkStatus, type KbLinkStatus } from '../../kbSync';
import { anyMarketOpen, useMarketStatus } from '../../marketInsights';

// 1분마다 자동 새로고침 — 보유종목 조회(ASSET/kisLimiter)는 초당 4~5건 한도라 분당
// 한 번은 여유가 매우 크다(backend/CLAUDE.md 참고). 수동 새로고침 버튼은 이 자동
// 갱신과 별개로 그때그때 강제 조회할 수 있게 하되, 너무 잦은 클릭이 레이트리밋을
// 건드리지 않도록 쿨다운을 둔다.
const AUTO_REFRESH_MS = 60_000;
const MANUAL_REFRESH_COOLDOWN_MS = 10_000;

/**
 * 보유 종목 데이터 — 증권사·계좌 선택, 포트폴리오(API는 실시간 + 1분 자동 새로고침, CSV 전용은 로컬 저장소로 합성), "전체 계좌"
 * 합치기, KB 백그라운드 동기화, 환율, 배당 기록·계좌 별칭, 수동 새로고침(쿨다운). Dashboard.tsx에서 2026-11-17 뺐다(로직 그대로).
 */
export function useHoldings() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<BrokerSummary[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<BrokerId | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioOverview | null>(null);
  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);

  // 지금 화면의 선택(증권사·계좌) — 늦게 온 비동기 응답(KB 동기화·로컬 저장소 읽기·다시 보일 때 갱신·수동 새로고침)이
  // 그 사이 다른 증권사·계좌로 옮긴 화면을 덮어쓰지 않게, 반영하기 직전에 요청 때의 선택과 비교한다.
  // kbSyncRequestId는 KB 동기화끼리의 순서만 가린다 — 클로저가 붙잡은 옛 selectedBroker/accountId까지는 못 막는다.
  const selectionRef = useRef({ broker: selectedBroker, accountId });
  selectionRef.current = { broker: selectedBroker, accountId };
  const isSelected = useCallback(
    (broker: BrokerId | null, accId: string | null) => selectionRef.current.broker === broker && selectionRef.current.accountId === accId,
    []
  );

  // 국내·미국 장 상태(토스 장 운영 정보) — 둘 다 닫혀 있으면 1분 자동 새로고침을 쉰다(시세가 안 움직여서
  // 호출만 낭비). 인터벌 콜백이 최신 값을 보도록 ref로 들고 있는다. 토스 미연동이면 anyMarketOpen이 true라 예전과 같다.
  const marketStatus = useMarketStatus();
  const marketOpenRef = useRef(true);
  marketOpenRef.current = anyMarketOpen(marketStatus);

  const configuredBrokers = brokers.filter((b) => b.configured);

  // 계좌 별칭은 Settings.tsx에서만 관리하고 여기선 읽기만 한다 — 마운트 시 한 번만
  // 불러오면 충분(브로커/계좌를 바꿔도 라벨 목록 자체는 안 바뀜).
  useEffect(() => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
  }, []);

  // "배당 포함 손익금액" 열용 배당 기록 — 로컬 JSON 하나라 가볍다. 마운트·브로커 변경 때 읽고, 다른 화면(배당금)에서
  // 기록을 고친 뒤 돌아오면 아래 resume 갱신(pageActivity.tsx)이 다시 읽는다(1분 자동 새로고침에는 안 얹음 — 라이브 데이터가 아님).
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  useEffect(() => {
    api.listDividends().then(setDividends).catch(() => {});
  }, [selectedBroker]);

  // KB증권 Open API 연동 상태 — appKey/appSecret이 계좌 하나에 고정 바인딩돼
  // 있어(kbSync.ts 참고) "연동 여부"와 "그 계좌가 로컬 accountId로 뭔지"만
  // 마운트 시 한 번 불러둔다. 아래에서 그 계좌가 화면에 보일 때 백그라운드
  // 동기화를 트리거하는 데 쓴다.
  const [kbLink, setKbLink] = useState<KbLinkStatus>({ configured: false, linkedAccountId: null });
  const [kbSyncing, setKbSyncing] = useState(false);
  const [kbSyncNotice, setKbSyncNotice] = useState<string | null>(null);
  const kbSyncRequestId = useRef(0);
  // KB는 종합위탁계좌/IRP/연금저축처럼 계좌가 여러 개일 수 있는데, 그 중
  // 실시간 API로 연동된 건 하나뿐이다(kbLink.linkedAccountId). 아래 계좌 목록
  // 조회 effect는 로컬 저장소에서 "먼저 눈에 띈" accountId를 기본값으로
  // 고르는데, 그게 연동 계좌가 아니면(흔한 경우) KB 동기화 트리거 effect의
  // 조건(accountId === kbLink.linkedAccountId)을 못 만족해 자동 동기화가 전혀
  // 안 일어난다 — 그래서 연동 계좌를 기본값으로 강제하되, 사용자가 이미 계좌를
  // 직접 골랐으면(아래 계좌 select의 onChange) 건드리지 않는다. 브로커를 바꿀
  // 때마다 false로 리셋된다(Trades.tsx와 같은 패턴).
  const userPickedAccountRef = useRef(false);

  useEffect(() => {
    getKbLinkStatus()
      .then(setKbLink)
      .catch(() => {});
  }, []);

  useEffect(() => {
    // React StrictMode double-invokes effects in dev — this only suppresses
    // the discarded run's setState calls, it does NOT stop its request from
    // firing (the async body already runs to its first await before this
    // cleanup can flip `cancelled`). Rate-limit-sensitive brokers (KIS) dedupe
    // the actual duplicate request backend-side instead — see
    // brokers/kis/kisClient.ts's `inFlightBalance`.
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
        setPortfolio(null);
        setAccountId(null);
        // 브로커가 바뀌면 "사용자가 계좌를 직접 골랐다"는 표시도 초기화한다 —
        // 아래 KB 연동 계좌 merge effect가 이 브로커 선택에 대해 다시 기본값을
        // (연동 계좌로) 정할 수 있게.
        userPickedAccountRef.current = false;
        setManualFxRate(null);
        setLiveFxRate(null);

        // CSV 전용 브로커(KB/삼성/미래에셋)는 listAccounts API 자체가 없다 — 로컬
        // 저장소에 실제로 CSV로 넣어둔 (broker, accountId) 쌍의 accountId를 모아
        // 계좌 목록처럼 쓴다(새 백엔드 엔드포인트 불필요, 이미 있는 조회로 충분).
        const accs = API_BROKER_IDS.includes(selectedBroker)
          ? await api.listAccounts(selectedBroker, { includePaper: true })
          : await api
              .listHoldingsStore({ broker: selectedBroker })
              .then((rows) => Array.from(new Set(rows.map((r) => r.accountId))).map((id) => ({ id })));
        if (cancelled) return;
        setAccounts(accs);
        if (accs.length > 0) setAccountId(accs[0].id);

        // 달러 보유분은 토스뿐 아니라 한국투자증권(미국 주식)·CSV 계좌(통화 컬럼 USD)에도 있을 수 있어서
        // 모든 증권사에서 환율을 조회한다(예전엔 토스만 — 다른 증권사의 달러 종목이 "환율 미적용"이 됐다).
        // 환율 조회 자체는 토스 연동 여부와 무관하게 getUsdKrwRate가 토스→수출입은행 순으로 처리한다(아래).
        {
          // 수동·실시간을 동시에(fxLoader.ts — 던지지 않음). 실시간이 없으면 수동 환율, 그것도 없으면 달러 종목은 비중에서 빠진다.
          const { manual, live } = await loadUsdKrwRates();
          if (cancelled) return;
          setManualFxRate(manual);
          if (live !== null) setLiveFxRate(live);
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
  }, [selectedBroker]);

  // KB증권의 API 연동 계좌를 계좌 목록에 합쳐 넣고, 기본 선택 계좌로 강제한다.
  // **"기본 선택 계좌로 강제"가 핵심 — 그냥 null일 때만 채우는 걸로는 부족하다.**
  // 위 effect는 로컬 저장소에 이미 있는 accountId 중 "먼저 눈에 띈" 것을 이미
  // 기본값으로 골라놨을 수 있는데(KB는 종합위탁/IRP/연금저축처럼 계좌가 여러 개일
  // 수 있고, 그 계좌가 연동 계좌가 아니면 흔함 — CSV 전용 계좌가 먼저 등록돼 있는
  // 경우가 많음), 그 상태로 두면 아래 KB 동기화 트리거 effect의 조건
  // (accountId === kbLink.linkedAccountId)을 못 만족해 자동 동기화가 전혀 안
  // 일어나고, 처음 들어왔을 때 보유종목이 안 보이거나 오래된 로컬 데이터만
  // 보인다 — 계좌를 몇 번 옮기다 우연히 연동 계좌를 직접 고르면 그제서야
  // 동기화가 도는 식으로 "고쳐졌다"고 느껴졌던 버그(Trades.tsx에서 실측 재현,
  // 같은 구조라 여기도 동일하게 있었음). 그래서 사용자가 이미 계좌를 직접 고른
  // 게 아니라면(`userPickedAccountRef`, 계좌 select의 onChange에서 세팅) 위
  // effect가 뭘 먼저 선택해뒀든 연동 계좌로 덮어써서 기본값을 확정한다.
  // `accounts`도 deps에 넣어야 한다 — 위 effect가 비동기(로컬 저장소 조회)라 이
  // effect가 먼저 실행되고 난 뒤에 `setAccounts(accs)`로 통째로 덮어써버리면
  // 방금 추가한 연동 계좌가 사라지는데, `accounts`가 바뀔 때마다 다시 실행되게
  // 해두면 그 시점에 다시 채워 넣어 자연스럽게 수렴한다(이미 들어있으면 그대로
  // 반환해 무한 루프 없음).
  useEffect(() => {
    if (selectedBroker !== 'kb' || !kbLink.linkedAccountId) return;
    const linkedId = kbLink.linkedAccountId;
    setAccounts((prev) => (prev.some((a) => a.id === linkedId) ? prev : [...prev, { id: linkedId }]));
    if (!userPickedAccountRef.current) setAccountId(linkedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBroker, kbLink.linkedAccountId, accounts]);

  // 초기 조회 + 1분마다 자동 새로고침을 한 effect에서 같이 관리한다 — 둘 다 같은
  // "이 브로커/계좌의 최신 스냅샷을 받아온다"는 동작이라 별도 effect로 나누면
  // fetchPortfolio 로직이 중복된다. lastFetchedAt은 실제로 라이브 호출이 성공한
  // 시각을 기록해서, 수동 새로고침 버튼의 쿨다운 판단 기준으로도 같이 쓴다.
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  // CSV 전용 브로커는 로컬 저장소를 그 자리에서 PortfolioOverview 모양으로 합성한다
  // (buildPortfolioFromStored) — CSV 가져오기 성공 직후에도 재선택 없이 화면을
  // 갱신하려고 effect 밖에서도 부를 수 있게 함수로 뺐다.
  // 한 번만 만든다(선택은 ref로 본다) — 아래 조회 effect의 의존성에 넣어도 다시 돌지 않게.
  const loadStoredPortfolio = useCallback(
    async (broker: BrokerId, accId: string) => {
      const rows = await api.listHoldingsStore({ broker, accountId: accId });
      if (!isSelected(broker, accId)) return; // 읽는 사이 다른 증권사·계좌로 옮겼다
      setPortfolio(buildPortfolioFromStored(broker, accId, rows));
      setLastFetchedAt(Date.now());
    },
    [isSelected]
  );

  // "전체 계좌"(CSV 전용 브로커) — 로컬 저장소 전체를 한 번에 받아 계좌별로 묶은 뒤
  // buildPortfolioFromStored로 각각 만들고 mergePortfolios로 합친다.
  const loadStoredPortfolioAll = useCallback(
    async (broker: BrokerId) => {
      const rows = await api.listHoldingsStore({ broker });
      if (!isSelected(broker, ALL_ACCOUNTS)) return; // 읽는 사이 다른 증권사·계좌로 옮겼다
      const byAccount = new Map<string, StoredHolding[]>();
      for (const r of rows) {
        if (!byAccount.has(r.accountId)) byAccount.set(r.accountId, []);
        byAccount.get(r.accountId)!.push(r);
      }
      const parts = Array.from(byAccount.entries()).map(([accId, accRows]) => ({
        accountId: accId,
        overview: buildPortfolioFromStored(broker, accId, accRows),
      }));
      setPortfolio(mergePortfolios(broker, parts));
      setLastFetchedAt(Date.now());
    },
    [isSelected]
  );

  // "전체 계좌"(API 브로커) — 계좌마다 실시간 조회를 병렬로 호출해 합친다. 계좌 수가
  // 몇 개뿐이라(KB증권 기준 3개) 초당 4~5건 한도에 걸릴 걱정은 없다.
  // 계좌 목록은 ref로 읽는다 — 1분 자동 새로고침 타이머(아래 effect)가 만들어질 때의 계좌 목록을 붙잡고 있지 않게
  // (예전엔 함수가 렌더마다 새로 만들어져 타이머가 옛 목록으로 합계를 냈다). 함수는 한 번만 만든다.
  const accountsRef = useRef(accounts);
  accountsRef.current = accounts;
  const loadLivePortfolioAll = useCallback(
    async (broker: BrokerId, opts?: { forceRefresh?: boolean }): Promise<PortfolioOverview> => {
      // 모의투자 계좌(NH)는 "전체 계좌" 합계에 넣지 않는다 — 실제 자산이 아니다.
      const parts = await Promise.all(
        accountsRef.current
          .filter((a) => !a.paper)
          .map(async (a) => ({ accountId: a.id, overview: await api.getPortfolio(broker, a.id, opts) }))
      );
      return mergePortfolios(broker, parts);
    },
    []
  );

  // KB증권 API 연동 계좌를 백그라운드에서 동기화한다 — 화면은 이미 로컬
  // 저장소로 즉시 그려져 있으므로(위 CSV 전용 브로커 분기), 이건 그 위에
  // "최신 데이터가 도착하면 조용히 갱신"만 얹는다(로딩 스피너로 막지 않음).
  // Toss/KIS처럼 60초 폴링은 안 한다 — KB rate limit이 공식 문서에 없어
  // 보수적으로 잡아둔 상태라(backend/CLAUDE.md), 그 계좌가 화면에 보일 때
  // 한 번만 부르고 나머지는 수동 새로고침 버튼에 맡긴다.
  async function triggerKbSync() {
    if (!kbLink.linkedAccountId) return;
    const linkedId = kbLink.linkedAccountId;
    const myRequestId = ++kbSyncRequestId.current;
    setKbSyncing(true);
    setKbSyncNotice(null);
    try {
      await api.syncKbHoldings(linkedId);
      if (kbSyncRequestId.current !== myRequestId) return; // 그 사이 다른 KB 동기화가 시작됨
      // 지금 선택을 ref로 본다 — 동기화를 기다리는 사이 다른 증권사·계좌로 옮겼으면 아무것도 안 그린다.
      if (isSelected('kb', ALL_ACCOUNTS)) await loadStoredPortfolioAll('kb');
      else if (isSelected('kb', linkedId)) await loadStoredPortfolio('kb', linkedId);
    } catch (e) {
      if (kbSyncRequestId.current === myRequestId) {
        setKbSyncNotice(`KB증권 최신 데이터를 가져오지 못했습니다: ${(e as Error).message}`);
      }
    } finally {
      if (kbSyncRequestId.current === myRequestId) setKbSyncing(false);
    }
  }

  useEffect(() => {
    if (selectedBroker !== 'kb' || !kbLink.configured || !kbLink.linkedAccountId) return;
    if (accountId !== kbLink.linkedAccountId && accountId !== ALL_ACCOUNTS) return;
    void triggerKbSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBroker, accountId, kbLink.configured, kbLink.linkedAccountId]);

  // 숨겨진 동안(pageActivity.tsx) 1분 자동 새로고침을 건너뛴다 — 다시 보일 때 아래 resume 갱신이 한 번 받는다.
  const pageActive = usePageActive();
  const pageActiveRef = useRef(pageActive);
  pageActiveRef.current = pageActive;

  useEffect(() => {
    if (!selectedBroker || !accountId) return;
    let cancelled = false;

    // CSV 전용 브로커는 폴링할 라이브 소스가 없다 — 한 번만 로컬 저장소를 읽고
    // 인터벌을 안 돌린다.
    if (!API_BROKER_IDS.includes(selectedBroker)) {
      void (async () => {
        try {
          setLoading(true);
          setError(null);
          if (accountId === ALL_ACCOUNTS) {
            await loadStoredPortfolioAll(selectedBroker);
          } else {
            await loadStoredPortfolio(selectedBroker, accountId);
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
    }

    async function fetchPortfolio(opts?: { forceRefresh?: boolean }) {
      try {
        setLoading(true);
        setError(null);
        const data =
          accountId === ALL_ACCOUNTS
            ? await loadLivePortfolioAll(selectedBroker!, opts)
            : await api.getPortfolio(selectedBroker!, accountId!, opts);
        if (cancelled) return;
        setPortfolio(data);
        setLastFetchedAt(Date.now());
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchPortfolio();
    const interval = setInterval(() => {
      if (marketOpenRef.current && pageActiveRef.current) void fetchPortfolio();
    }, AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedBroker, accountId, loadLivePortfolioAll, loadStoredPortfolio, loadStoredPortfolioAll]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

  // 메뉴를 옮겼다 돌아오면 지금 화면(선택한 증권사·계좌·표)을 그대로 둔 채 뒤에서 다시 받는다(pageActivity.tsx).
  // 선택을 초기화하는 위 effect들은 다시 돌리지 않는다. 실패하면 이전 값을 유지한다.
  const markRefreshed = useResumeRefresh(async ({ dataChanged }) => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
    api.listDividends().then(setDividends).catch(() => {});
    try {
      if (dataChanged) {
        // 설정에서 키를 등록·해제했거나 CSV를 가져왔을 수 있다 — 증권사·계좌 목록만 맞춘다(지금 선택은 남아 있으면 유지).
        const list = await api.listBrokers();
        setBrokers(list);
        if (!selectedBroker) {
          const first = list.find((b) => b.configured);
          if (first) {
            setError(null);
            setSelectedBroker(first.id);
          }
          return; // 위 effect 체인이 처음부터 불러온다
        }
        if (!API_BROKER_IDS.includes(selectedBroker)) {
          const ids = Array.from(new Set((await api.listHoldingsStore({ broker: selectedBroker })).map((r) => r.accountId)));
          setAccounts((prev) => {
            const linked = prev.filter((a) => a.id === kbLink.linkedAccountId && !ids.includes(a.id));
            return [...ids.map((id) => ({ id })), ...linked];
          });
          if (accountId && accountId !== ALL_ACCOUNTS && !ids.includes(accountId) && accountId !== kbLink.linkedAccountId) {
            setAccountId(ids[0] ?? null); // 지금 계좌가 사라졌다 — 아래 조회 effect가 새 계좌로 다시 받는다
            return;
          }
        }
      }
      // 위 await 사이에 선택이 바뀌었을 수 있다 — 클로저 값이 아니라 지금 선택(ref)으로 받고, 받는 사이 또 바뀌면 버린다.
      const { broker, accountId: accId } = selectionRef.current;
      if (!broker || !accId) return;
      if (!API_BROKER_IDS.includes(broker)) {
        if (accId === ALL_ACCOUNTS) await loadStoredPortfolioAll(broker);
        else await loadStoredPortfolio(broker, accId);
      } else {
        const data = accId === ALL_ACCOUNTS ? await loadLivePortfolioAll(broker) : await api.getPortfolio(broker, accId);
        if (!isSelected(broker, accId)) return;
        setPortfolio(data);
        setLastFetchedAt(Date.now());
      }
    } catch {
      // 이전 화면 유지
    }
  }, RESUME_REFRESH_MS);
  // 자동·수동 새로고침으로 이미 받았으면 그때부터 간격을 다시 센다.
  useEffect(() => {
    if (lastFetchedAt !== null) markRefreshed();
  }, [lastFetchedAt, markRefreshed]);

  async function handleRefresh() {
    if (!selectedBroker || !accountId) return;
    setRefreshNotice(null);

    // API 호출 제한 보호용 쿨다운 — 직전 라이브 조회(초기 로드/자동 갱신/이전 수동
    // 새로고침 무엇이든)로부터 MANUAL_REFRESH_COOLDOWN_MS가 안 지났으면 강제
    // 재조회를 하지 않는다. 예전엔 이 버튼이 아예 forceRefresh를 안 넘겨서 항상
    // 5초 캐시를 타게 했는데(StrictMode 이중요청이 KIS 레이트리밋을 건드린 전례
    // 때문), 이제는 진짜로 강제 갱신하되 그 문제를 이 쿨다운으로 대신 막는다.
    if (lastFetchedAt !== null) {
      const elapsed = Date.now() - lastFetchedAt;
      if (elapsed < MANUAL_REFRESH_COOLDOWN_MS) {
        const waitSec = Math.ceil((MANUAL_REFRESH_COOLDOWN_MS - elapsed) / 1000);
        setRefreshNotice(`API 호출 제한 보호를 위해 ${waitSec}초 후 다시 시도해주세요.`);
        return;
      }
    }

    setRefreshing(true);
    setError(null);
    const broker = selectedBroker;
    const accId = accountId;
    try {
      const data =
        accId === ALL_ACCOUNTS
          ? await loadLivePortfolioAll(broker, { forceRefresh: true })
          : await api.getPortfolio(broker, accId, { forceRefresh: true });
      if (!isSelected(broker, accId)) return; // 받는 사이 다른 증권사·계좌로 옮겼다
      setPortfolio(data);
      setLastFetchedAt(Date.now());
    } catch (e) {
      if (isSelected(broker, accId)) setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  // CSV 가져오기/Google Sheets 가져오기 공통 — 지금 보고 있는 브로커가 CSV
  // 전용이면, 브로커 재선택 없이 방금 가져온 데이터가 바로 보이도록 계좌 목록/
  // 포트폴리오를 다시 읽는다. "전체 계좌"를 보고 있었으면 그 선택을 유지한 채로
  // 다시 합쳐서 보여준다.
  async function refreshAfterStoreImport() {
    if (selectedBroker && !API_BROKER_IDS.includes(selectedBroker)) {
      const rows = await api.listHoldingsStore({ broker: selectedBroker });
      const ids = Array.from(new Set(rows.map((r) => r.accountId)));
      setAccounts(ids.map((id) => ({ id })));
      if (accountId === ALL_ACCOUNTS) {
        if (ids.length > 0) await loadStoredPortfolioAll(selectedBroker);
        else setPortfolio(null);
      } else {
        const nextAccountId = accountId && ids.includes(accountId) ? accountId : (ids[0] ?? null);
        setAccountId(nextAccountId);
        if (nextAccountId) await loadStoredPortfolio(selectedBroker, nextAccountId);
        else setPortfolio(null);
      }
    }
  }

  // A manually-entered rate (Settings) always overrides the live one, in
  // case the user wants to pin a specific rate; otherwise fall back to
  // Toss's GET /api/v1/exchange-rate (USD->KRW mid rate).
  const effectiveFxRate = effectiveRate(manualFxRate, liveFxRate);

  const isCurrentBrokerApi = !!selectedBroker && API_BROKER_IDS.includes(selectedBroker);
  const isKbSyncable =
    selectedBroker === 'kb' &&
    kbLink.configured &&
    !!kbLink.linkedAccountId &&
    (accountId === kbLink.linkedAccountId || accountId === ALL_ACCOUNTS);

  return {
    loading,
    error,
    brokers,
    configuredBrokers,
    selectedBroker,
    setSelectedBroker,
    accounts,
    accountId,
    setAccountId,
    userPickedAccountRef,
    portfolio,
    manualFxRate,
    effectiveFxRate,
    accountLabels,
    dividends,
    marketStatus,
    isCurrentBrokerApi,
    isKbSyncable,
    kbSyncing,
    kbSyncNotice,
    triggerKbSync,
    refreshing,
    refreshNotice,
    handleRefresh,
    refreshAfterStoreImport,
  };
}
