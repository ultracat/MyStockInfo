import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type {
  AccountLabel,
  BrokerAccount,
  BrokerId,
  BrokerSummary,
  DividendRecord,
  HoldingPosition,
  PortfolioOverview,
  StoredHolding,
} from '../types';
import HoldingsTable from '../components/HoldingsTable';
import PurchaseMarketTile from '../components/PurchaseMarketTile';
import PrincipalCard from '../components/PrincipalCard';
import { formatKrw, krw, usdFmt } from '../format';
import { downloadCsv, parseCsv } from '../csv';
import { formatImportResult } from '../importResult';
import { API_BROKER_IDS } from '../brokers';
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import { groupDividendsByAccountSymbol } from '../dividendMatch';
import { useStockLinkResolver } from '../components/StockNameLink';
import { getKbLinkStatus, type KbLinkStatus } from '../kbSync';
import { anyMarketOpen, describeMarket, useMarketStatus, useStockWarnings } from '../marketInsights';

const SMALL_LINE = { fontSize: 12, fontWeight: 400 as const, color: 'var(--text-muted)', marginTop: 2 };

// 1분마다 자동 새로고침 — 보유종목 조회(ASSET/kisLimiter)는 초당 4~5건 한도라 분당
// 한 번은 여유가 매우 크다(backend/CLAUDE.md 참고). 수동 새로고침 버튼은 이 자동
// 갱신과 별개로 그때그때 강제 조회할 수 있게 하되, 너무 잦은 클릭이 레이트리밋을
// 건드리지 않도록 쿨다운을 둔다.
const AUTO_REFRESH_MS = 60_000;
const MANUAL_REFRESH_COOLDOWN_MS = 10_000;

/** 계좌 select의 특수값 — "이 브로커의 계좌를 전부 합쳐서 한 화면에 보여준다"는
 *  뜻이다(KB증권처럼 한 브로커에 계좌가 여러 개인 경우를 위함). 실제 accountId와
 *  충돌하지 않도록 사람이 입력할 리 없는 문자열로 뒀다. */
const ALL_ACCOUNTS = '__ALL_ACCOUNTS__';

// CSV 전용 브로커(KB/삼성/미래에셋 — API 연동 없이 CSV로만 데이터 관리, frontend/
// brokers.ts의 API_BROKER_IDS 참고)는 라이브 PortfolioOverview가 없다 — 로컬
// 저장소(holdings-store)에 쌓인 행으로 그 자리에서 합성한다. 필드 하나하나를
// 그대로 합산하기만 하면 되므로(홀딩스토어 자체가 이미 통화별 매입/평가/손익을
// 갖고 있음), AmountTile/RateTile/HoldingsTable은 API 브로커용과 완전히 동일하게
// 재사용된다 — 이 함수가 만드는 모양만 맞으면 그 아래 렌더링은 손댈 필요가 없다.
function buildPortfolioFromStored(broker: BrokerId, accountId: string, rows: StoredHolding[]): PortfolioOverview {
  let purchaseKrw = 0;
  let purchaseUsd = 0;
  let marketKrw = 0;
  let marketUsd = 0;
  let plKrw = 0;
  let plUsd = 0;

  for (const r of rows) {
    if (r.currency === 'USD') {
      purchaseUsd += r.purchaseAmount;
      marketUsd += r.marketValue;
      plUsd += r.profitLossAmount;
    } else {
      purchaseKrw += r.purchaseAmount;
      marketKrw += r.marketValue;
      plKrw += r.profitLossAmount;
    }
  }

  const hasUsd = purchaseUsd !== 0 || marketUsd !== 0;

  return {
    broker,
    accountId,
    totalPurchaseAmountKrw: purchaseKrw,
    totalPurchaseAmountUsd: hasUsd ? purchaseUsd : null,
    totalMarketValueKrw: marketKrw,
    totalMarketValueUsd: hasUsd ? marketUsd : null,
    totalProfitLossKrw: plKrw,
    totalProfitLossUsd: hasUsd ? plUsd : null,
    profitLossRate: purchaseKrw > 0 ? plKrw / purchaseKrw : null,
    // CSV/Sheets 전용 브로커는 예수금을 알 방법이 없다 — 항상 null(화면에
    // "미지원"으로 고정 표시, AmountTile 대신 렌더링 분기 참고).
    cashBalanceKrw: null,
    cashBalanceUsd: null,
    positions: rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      market: r.market,
      currency: r.currency,
      quantity: r.quantity,
      lastPrice: r.lastPrice,
      averagePurchasePrice: r.averagePurchasePrice,
      purchaseAmount: r.purchaseAmount,
      marketValue: r.marketValue,
      profitLossAmount: r.profitLossAmount,
      profitLossRate: r.profitLossRate,
      commission: r.commission,
      tax: r.tax,
      memo: r.memo,
    })),
  };
}

/** "전체 계좌" 모드 전용 — 계좌별로 이미 만들어진 PortfolioOverview 여러 개를 하나로
 *  합친다. 금액/손익은 통화별로 그대로 더하고(각 overview가 이미 hasUsd 여부를 KRW/USD
 *  로 나눠 갖고 있음), 포지션은 이어붙이되 어느 계좌에서 왔는지 `accountId`를 남겨서
 *  HoldingsTable이 "계좌" 열로 구분해 보여줄 수 있게 한다. */
function mergePortfolios(
  broker: BrokerId,
  parts: { accountId: string; overview: PortfolioOverview }[]
): PortfolioOverview {
  let purchaseKrw = 0;
  let marketKrw = 0;
  let plKrw = 0;
  let purchaseUsd = 0;
  let marketUsd = 0;
  let plUsd = 0;
  let hasUsd = false;
  // 예수금은 계좌마다 있을 수도 없을 수도 있다(CSV 전용 계좌 중 아직 수동
  // 입력을 안 한 경우) — 하나라도 값이 있으면 나머지는 0으로 취급해 더하고,
  // 전부 없으면(null) "정보 없음"으로 남겨 사용자가 값이 아예 없다는 걸 알게 한다.
  let cashKrw: number | null = null;
  let cashUsd: number | null = null;
  const positions: HoldingPosition[] = [];

  for (const { accountId, overview } of parts) {
    purchaseKrw += overview.totalPurchaseAmountKrw;
    marketKrw += overview.totalMarketValueKrw;
    plKrw += overview.totalProfitLossKrw;
    if (overview.totalPurchaseAmountUsd !== null || overview.totalMarketValueUsd !== null) {
      hasUsd = true;
      purchaseUsd += overview.totalPurchaseAmountUsd ?? 0;
      marketUsd += overview.totalMarketValueUsd ?? 0;
      plUsd += overview.totalProfitLossUsd ?? 0;
    }
    if (overview.cashBalanceKrw !== null) cashKrw = (cashKrw ?? 0) + overview.cashBalanceKrw;
    if (overview.cashBalanceUsd !== null) cashUsd = (cashUsd ?? 0) + overview.cashBalanceUsd;
    for (const p of overview.positions) positions.push({ ...p, accountId });
  }

  return {
    broker,
    accountId: ALL_ACCOUNTS,
    totalPurchaseAmountKrw: purchaseKrw,
    totalPurchaseAmountUsd: hasUsd ? purchaseUsd : null,
    totalMarketValueKrw: marketKrw,
    totalMarketValueUsd: hasUsd ? marketUsd : null,
    totalProfitLossKrw: plKrw,
    totalProfitLossUsd: hasUsd ? plUsd : null,
    profitLossRate: purchaseKrw > 0 ? plKrw / purchaseKrw : null,
    cashBalanceKrw: cashKrw,
    cashBalanceUsd: cashUsd,
    positions,
  };
}

const HOLDINGS_CSV_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'quantity',
  'averagePurchasePrice',
  'lastPrice',
  'purchaseAmount',
  'marketValue',
  'profitLossAmount',
  'profitLossRate',
  'commission',
  'tax',
  'currency',
  'market',
  'memo',
];

/**
 * 원화 전용이면 기존과 동일하게 한 줄만 보여준다. 달러 보유분이 섞여 있을 때만(현재는
 * 토스의 해외주식 계좌만 해당) 원화/달러/합계(환산) 3줄로 나눠 보여준다 — 굵은 글씨는
 * 합계(환산) 한 줄에만 쓰고, 원화/달러 개별 줄은 작은 글씨로 내린다. `hasUsd`는 이
 * 타일 하나의 금액(예: 손익금액 0원)이 아니라 포트폴리오 전체가 달러 보유분을
 * 갖고 있는지로 판단해서 넘겨받는다 — 그래야 예컨대 손익금액이 우연히 0이어도
 * 3줄 구조가 깨지지 않는다. 환율은 이 화면에서 이미 비중(weight) 계산에 쓰던
 * effectiveFxRate(설정 수동 입력 > 토스 실시간 환율)를 그대로 재사용한다.
 */
function AmountTile({
  label,
  krwAmount,
  usdAmount,
  hasUsd,
  fxRate,
  signed = false,
  note,
}: {
  label: string;
  /** null이면 "아직 데이터가 없다"는 뜻(예: 예수금을 한 번도 입력/조회 못한
   *  CSV 전용 계좌) — 0원과 구분해 "정보 없음"으로 보여준다. */
  krwAmount: number | null;
  usdAmount: number | null;
  hasUsd: boolean;
  fxRate: number | null;
  signed?: boolean;
  /** 카드 맨 아래 작은 안내 한 줄(예: 일부 배당 환율 미적용). */
  note?: string;
}) {
  const noteLine = note ? <div style={SMALL_LINE}>{note}</div> : null;
  const sign = (v: number) => (signed && v >= 0 ? '+' : '');
  const fmt = (v: number) => `${sign(v)}${formatKrw(v)}`;
  const tone = (v: number) => (signed ? (v >= 0 ? 'text-good' : 'text-critical') : '');

  if (!hasUsd) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        {krwAmount === null ? (
          <div className="value" style={{ color: 'var(--text-muted)' }}>
            정보 없음
          </div>
        ) : (
          <div className={`value ${tone(krwAmount)}`}>{fmt(krwAmount)}</div>
        )}
        {noteLine}
      </div>
    );
  }

  const usd = usdAmount ?? 0;
  const totalKrw = (krwAmount ?? 0) + (fxRate ? usd * fxRate : 0);
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div style={SMALL_LINE}>{fmt(krwAmount ?? 0)}</div>
      <div style={SMALL_LINE}>
        {sign(usd)}
        {usdFmt.format(usd)}
      </div>
      <div className={`value ${tone(totalKrw)}`} style={{ marginTop: 2 }}>
        {fxRate ? fmt(totalKrw) : '환율 미적용'}
      </div>
      {noteLine}
    </div>
  );
}

/**
 * 손익률은 브로커가 이미 계산해서 내려주는 단일 값(`fallbackRate`)이 있어서
 * 원화 전용일 땐 그걸 그대로 보여준다. 달러가 섞여 있으면 원화/달러 손익률은
 * 통화가 같은 금액끼리 나눈 값이라 환율이 없어도 정확하지만(각 통화 내에서의
 * 순수 수익률), 합계 손익률은 두 통화를 하나로 합쳐야 하므로 AmountTile의
 * "합계(환산)"와 같은 effectiveFxRate로 직접 계산한다 — 브로커가 주는
 * fallbackRate를 재사용하지 않는 이유는, 그러면 이 화면의 다른 합계(환산) 금액
 * 타일들과 다른 환율 가정을 쓰게 되어 숫자가 서로 안 맞을 수 있기 때문.
 */
function RateTile({
  label,
  krwPl,
  krwInvested,
  usdPl,
  usdInvested,
  hasUsd,
  fxRate,
  fallbackRate,
}: {
  label: string;
  krwPl: number;
  krwInvested: number;
  usdPl: number | null;
  usdInvested: number | null;
  hasUsd: boolean;
  fxRate: number | null;
  fallbackRate: number | null;
}) {
  const fmt = (r: number | null) => (r === null ? '-' : `${r >= 0 ? '+' : ''}${(r * 100).toFixed(2)}%`);
  const tone = (r: number | null) => ((r ?? 0) >= 0 ? 'text-good' : 'text-critical');

  if (!hasUsd) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        <div className={`value ${tone(fallbackRate)}`}>{fmt(fallbackRate)}</div>
      </div>
    );
  }

  const krwRate = krwInvested > 0 ? krwPl / krwInvested : null;
  const usdRate = usdInvested && usdInvested > 0 ? (usdPl ?? 0) / usdInvested : null;
  const investedTotalKrw = krwInvested + (fxRate ? (usdInvested ?? 0) * fxRate : 0);
  const plTotalKrw = krwPl + (fxRate ? (usdPl ?? 0) * fxRate : 0);
  const totalRate = fxRate && investedTotalKrw > 0 ? plTotalKrw / investedTotalKrw : null;

  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div style={SMALL_LINE}>{fmt(krwRate)}</div>
      <div style={SMALL_LINE}>{fmt(usdRate)}</div>
      <div className={`value ${tone(totalRate)}`} style={{ marginTop: 2 }}>
        {fxRate ? fmt(totalRate) : '환율 미적용'}
      </div>
    </div>
  );
}

export default function Dashboard() {
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
  // 종목명 클릭 시 열 외부 링크 — "종목 링크" 화면에서 관리, 여기선 읽기만.
  const stockLinkFor = useStockLinkResolver();

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

  // "배당 포함 손익금액" 열용 배당 기록 — 로컬 JSON 하나라 가볍다. 다른 화면(배당금)에서
  // 기록을 고친 뒤 돌아오면 이 화면이 다시 마운트되므로, 마운트 + 브로커 변경 시점에만
  // 다시 읽는다(1분 자동 새로고침에는 안 얹음 — 배당 기록은 라이브 데이터가 아님).
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
          const fx = await api.getFxRate();
          if (cancelled) return;
          setManualFxRate(fx.usdKrwRate);

          // Non-fatal: live rate is a nice-to-have (falls back to the
          // manual rate above, or to excluding USD positions from weight).
          // getUsdKrwRate는 토스→한국수출입은행 순으로 시도하고(backend/CLAUDE.md
          // 참고) 실패해도 예외 없이 {rate:null}을 준다.
          const live = await api.getUsdKrwRate();
          if (!cancelled && live.rate) setLiveFxRate(live.midRate ?? live.rate);
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
  async function loadStoredPortfolio(broker: BrokerId, accId: string) {
    const rows = await api.listHoldingsStore({ broker, accountId: accId });
    setPortfolio(buildPortfolioFromStored(broker, accId, rows));
    setLastFetchedAt(Date.now());
  }

  // "전체 계좌"(CSV 전용 브로커) — 로컬 저장소 전체를 한 번에 받아 계좌별로 묶은 뒤
  // buildPortfolioFromStored로 각각 만들고 mergePortfolios로 합친다.
  async function loadStoredPortfolioAll(broker: BrokerId) {
    const rows = await api.listHoldingsStore({ broker });
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
  }

  // "전체 계좌"(API 브로커) — 계좌마다 실시간 조회를 병렬로 호출해 합친다. 계좌 수가
  // 몇 개뿐이라(KB증권 기준 3개) 초당 4~5건 한도에 걸릴 걱정은 없다.
  async function loadLivePortfolioAll(broker: BrokerId, opts?: { forceRefresh?: boolean }): Promise<PortfolioOverview> {
    // 모의투자 계좌(NH)는 "전체 계좌" 합계에 넣지 않는다 — 실제 자산이 아니다.
    const parts = await Promise.all(
      accounts
        .filter((a) => !a.paper)
        .map(async (a) => ({ accountId: a.id, overview: await api.getPortfolio(broker, a.id, opts) }))
    );
    return mergePortfolios(broker, parts);
  }

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
      if (kbSyncRequestId.current !== myRequestId) return; // 그 사이 다른 브로커/계좌로 이동함
      if (accountId === ALL_ACCOUNTS) await loadStoredPortfolioAll('kb');
      else if (accountId === linkedId) await loadStoredPortfolio('kb', linkedId);
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

  useEffect(() => {
    if (!selectedBroker || !accountId) return;
    let cancelled = false;

    // CSV 전용 브로커는 폴링할 라이브 소스가 없다 — 한 번만 로컬 저장소를 읽고
    // 인터벌을 안 돌린다.
    if (!API_BROKER_IDS.includes(selectedBroker)) {
      (async () => {
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

    fetchPortfolio();
    const interval = setInterval(() => {
      if (marketOpenRef.current) fetchPortfolio();
    }, AUTO_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedBroker, accountId]);

  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);

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
    try {
      const data =
        accountId === ALL_ACCOUNTS
          ? await loadLivePortfolioAll(selectedBroker, { forceRefresh: true })
          : await api.getPortfolio(selectedBroker, accountId, { forceRefresh: true });
      setPortfolio(data);
      setLastFetchedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  // 로컬 저장소(holdings-store)는 실시간 조회가 성공할 때마다 write-through로
  // 갱신되고, CSV로도 채울 수 있다(API 연동이 없는 KB증권 등) — 내보내기는 현재
  // 화면의 브로커/계좌 하나가 아니라 저장소에 쌓인 전체를 대상으로 한다(여러
  // 브로커/계좌를 한 파일로 오가려는 용도).
  async function onExportCsv() {
    const holdings = await api.listHoldingsStore();
    const rows: string[][] = [
      HOLDINGS_CSV_HEADER,
      ...holdings.map((h) => [
        h.broker,
        h.accountId,
        h.symbol,
        String(h.quantity),
        String(h.averagePurchasePrice),
        String(h.lastPrice),
        String(h.purchaseAmount),
        String(h.marketValue),
        String(h.profitLossAmount),
        String(h.profitLossRate),
        h.commission === null ? '' : String(h.commission),
        h.tax === null ? '' : String(h.tax),
        h.currency ?? '',
        h.market ?? '',
        h.memo ?? '',
      ]),
    ];
    downloadCsv(`holdings-${new Date().toISOString().slice(0, 10)}.csv`, rows);
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
      const iQuantity = colIndex('quantity');
      const iAvgPrice = colIndex('averagePurchasePrice');
      const iLastPrice = colIndex('lastPrice');
      const iPurchaseAmount = colIndex('purchaseAmount');
      const iMarketValue = colIndex('marketValue');
      const iProfitLossAmount = colIndex('profitLossAmount');
      const iProfitLossRate = colIndex('profitLossRate');
      const iCommission = colIndex('commission');
      const iTax = colIndex('tax');
      const iCurrency = colIndex('currency');
      const iMarket = colIndex('market');
      const iMemo = colIndex('memo');

      if ([iBroker, iAccountId, iSymbol, iQuantity, iAvgPrice, iCurrency].some((i) => i === -1)) {
        setImportResult(
          `CSV 헤더가 올바르지 않습니다. 최소 broker,accountId,symbol,quantity,averagePurchasePrice,currency 컬럼이 필요합니다.`
        );
        return;
      }

      const num = (v: string | undefined) => {
        const trimmed = (v ?? '').trim();
        return trimmed === '' ? undefined : Number(trimmed);
      };

      const records = dataRows
        .filter((r) => r.some((v) => v.trim() !== ''))
        .map((r) => ({
          broker: (r[iBroker] ?? '').trim().toLowerCase() as BrokerId,
          accountId: (r[iAccountId] ?? '').trim(),
          symbol: (r[iSymbol] ?? '').trim(),
          quantity: Number((r[iQuantity] ?? '').trim()),
          averagePurchasePrice: Number((r[iAvgPrice] ?? '').trim()),
          lastPrice: iLastPrice !== -1 ? num(r[iLastPrice]) : undefined,
          purchaseAmount: iPurchaseAmount !== -1 ? num(r[iPurchaseAmount]) : undefined,
          marketValue: iMarketValue !== -1 ? num(r[iMarketValue]) : undefined,
          profitLossAmount: iProfitLossAmount !== -1 ? num(r[iProfitLossAmount]) : undefined,
          profitLossRate: iProfitLossRate !== -1 ? num(r[iProfitLossRate]) : undefined,
          commission: iCommission !== -1 ? (num(r[iCommission]) ?? null) : null,
          tax: iTax !== -1 ? (num(r[iTax]) ?? null) : null,
          currency: (r[iCurrency] ?? '').trim() as 'KRW' | 'USD',
          market: iMarket !== -1 && (r[iMarket] ?? '').trim() ? r[iMarket].trim() : null,
          memo: iMemo !== -1 && (r[iMemo] ?? '').trim() ? r[iMemo].trim() : null,
        }));

      const result = await api.importHoldingsStore(records);
      setImportResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
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

  // Google Sheets 연동 — Settings.tsx에서 연결 여부만 확인하고, 실제 내보내기/
  // 가져오기는 여기서 실행한다(CSV 내보내기/가져오기와 같은 대상: holdings-store
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
    if (!window.confirm('Google Sheets의 Holdings 탭 전체를 로컬 데이터로 덮어씁니다. 시트에 직접 입력했지만 아직 "가져오기"로 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.exportToGoogleSheet('holdings');
      setGoogleSyncResult(`Google Sheets로 ${result.rowCount}건 내보냈습니다.`);
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  async function onImportFromGoogleSheet() {
    if (!window.confirm('Google Sheets의 Holdings 탭 내용으로 수동 입력 계좌의 로컬 데이터를 전부 교체합니다(API·동기화 계좌는 실시간 조회/동기화 값을 그대로 둡니다). 시트에 실패하는 행이 하나라도 있으면 아무것도 바꾸지 않습니다. 로컬에서 직접 추가/수정했지만 아직 "내보내기"로 시트에 반영하지 않은 내용이 있다면 사라집니다. 계속할까요?')) {
      return;
    }
    setGoogleSyncing(true);
    setGoogleSyncResult(null);
    try {
      const result = await api.importFromGoogleSheet('holdings');
      setGoogleSyncResult(formatImportResult(result));
      await refreshAfterStoreImport();
    } catch (e) {
      setGoogleSyncResult((e as Error).message);
    } finally {
      setGoogleSyncing(false);
    }
  }

  // A manually-entered rate (Settings) always overrides the live one, in
  // case the user wants to pin a specific rate; otherwise fall back to
  // Toss's GET /api/v1/exchange-rate (USD->KRW mid rate).
  const effectiveFxRate = manualFxRate ?? liveFxRate;

  // 개별 타일의 금액(예: 손익금액이 우연히 0)이 아니라 포트폴리오가 실제로 달러
  // 투자금을 갖고 있는지로 판단 — AmountTile/RateTile 문서 주석 참고.
  const hasUsdHoldings = !!portfolio?.totalPurchaseAmountUsd;
  // 예수금은 보유종목과 통화 보유 여부가 다를 수 있어(예: 원화만 보유 중인데
  // 예수금엔 소액 달러가 남아있는 경우) 별도로 판단한다.
  const hasUsdCash = !!portfolio?.cashBalanceUsd;

  // 보유 종목의 매수 유의사항(토스) — 종목 목록이 바뀔 때만 다시 묻는다.
  const warningsBySymbol = useStockWarnings(portfolio?.positions.map((p) => p.symbol) ?? []);

  const rows = useMemo(() => {
    if (!portfolio) return [];

    // Blend positions into a common KRW basis for portfolio weight: KRW
    // positions convert 1:1, USD positions use effectiveFxRate. Positions
    // we still can't convert get a null weight rather than a silently
    // wrong number.
    const convertedValues = portfolio.positions.map((p) => {
      if (p.currency === 'KRW' || p.currency === null) return p.marketValue;
      if (p.currency === 'USD' && effectiveFxRate) return p.marketValue * effectiveFxRate;
      return null;
    });
    const total = convertedValues.reduce((sum: number, v) => sum + (v ?? 0), 0);

    // ---- "배당 포함 손익금액" — 이 계좌의 이 종목에서 받은 배당만 더한다(다른 계좌의
    // 같은 종목 배당은 섞지 않음 — 그건 "종목별 수익" 화면 몫). 포지션의 계좌는
    // "전체 계좌" 모드면 mergePortfolios가 붙인 p.accountId, 개별 계좌 모드면 지금
    // 선택된 accountId다. 배당 기록 쪽 계좌 매칭 규칙은 dividendMatch.ts(대시보드와 공용).
    const accountOf = (p: HoldingPosition) => p.accountId ?? (accountId !== ALL_ACCOUNTS ? accountId : null);
    const soleAccountId = accounts.length === 1 ? accounts[0].id : null;
    const grouped = groupDividendsByAccountSymbol(
      selectedBroker ? dividends.filter((d) => d.broker === selectedBroker) : [],
      accountLabels,
      () => soleAccountId
    );
    const divSums = new Map<string, { krw: number; usd: number }>();
    for (const [gk, list] of grouped) {
      const sum = { krw: 0, usd: 0 };
      for (const d of list) {
        if (d.currency === 'USD') sum.usd += d.amount;
        else sum.krw += d.amount;
      }
      // 키에서 broker를 떼고 "계좌|종목"만 남긴다 — 이 화면은 브로커가 하나뿐이라.
      divSums.set(gk.slice(gk.indexOf('|') + 1), sum);
    }
    // IRP처럼 같은 계좌의 같은 종목이 memo("개인납입"/"회사납입")로 여러 행이면, 그
    // 종목 배당을 행마다 통째로 더하면 이중 집계가 된다 — 수량 비율로 나눠 붙인다.
    const qtyByKey = new Map<string, { qty: number; count: number }>();
    for (const p of portfolio.positions) {
      const key = `${accountOf(p)}|${p.symbol}`;
      const e = qtyByKey.get(key) ?? { qty: 0, count: 0 };
      e.qty += p.quantity;
      e.count += 1;
      qtyByKey.set(key, e);
    }
    // 배당은 포지션 통화로 맞춰 더한다(표가 원화 종목은 원, 달러 종목은 USD로 보여줌).
    // 통화가 같으면 환율 없이 그대로, 다르면 effectiveFxRate로 환산하고 환율이 없으면
    // null("환율 미적용") — 조용히 틀린 숫자를 보여주지 않는다(이 앱 공통 규칙).
    function dividendFor(p: HoldingPosition): number | null {
      const key = `${accountOf(p)}|${p.symbol}`;
      const sum = divSums.get(key);
      if (!sum) return 0;
      const g = qtyByKey.get(key)!;
      const share = g.count === 1 ? 1 : g.qty > 0 ? p.quantity / g.qty : 1 / g.count;
      if (p.currency === 'USD') {
        if (sum.krw === 0) return sum.usd * share;
        return effectiveFxRate ? (sum.usd + sum.krw / effectiveFxRate) * share : null;
      }
      if (sum.usd === 0) return sum.krw * share;
      return effectiveFxRate ? (sum.krw + sum.usd * effectiveFxRate) * share : null;
    }

    return portfolio.positions.map((p, i) => ({
      ...p,
      dividendAmount: dividendFor(p),
      weight: convertedValues[i] === null || total === 0 ? null : (convertedValues[i] as number) / total,
      // "전체 계좌" 모드(mergePortfolios가 채운 p.accountId)에서만 값이 붙는다 —
      // HoldingsTable이 이 필드가 하나라도 있으면 "계좌" 열을 보여준다.
      accountLabel: p.accountId
        ? formatAccountOption(
            { id: p.accountId },
            selectedBroker
              ? findAccountLabel(accountLabels, selectedBroker, p.accountId)
              : undefined
          )
        : undefined,
      externalUrl: stockLinkFor(p.symbol, p.currency) ?? undefined,
      warnings: warningsBySymbol[p.symbol],
    }));
  }, [portfolio, effectiveFxRate, accountLabels, selectedBroker, stockLinkFor, dividends, accounts, accountId, warningsBySymbol]);

  // "총 손익금액(배당 포함)" 카드 — 표의 "배당 포함 손익금액" 열과 같은 값(rows의
  // dividendAmount, 포지션 통화 기준)을 통화별로 더한다. 카드와 표 합계가 어긋나지
  // 않도록 배당을 따로 다시 집계하지 않는다.
  const dividendTotals = useMemo(() => {
    let krwSum = 0;
    let usdSum = 0;
    let unconverted = false;
    for (const r of rows) {
      if (r.dividendAmount === null) unconverted = true;
      else if (r.currency === 'USD') usdSum += r.dividendAmount;
      else krwSum += r.dividendAmount;
    }
    return { krw: krwSum, usd: usdSum, unconverted };
  }, [rows]);

  const hasUnconvertedUsd = portfolio?.positions.some((p) => p.currency === 'USD') && !effectiveFxRate;

  // 브로커/계좌를 아직 하나도 못 골랐을 때만(최초 로딩) 전체 화면을 스피너로
  // 막는다 — CSV 전용 브로커는 저장된 데이터가 없어도 헤더의 CSV 가져오기
  // 버튼까지 같이 사라지면 안 되므로, `!portfolio`로는 더 이상 막지 않는다
  // (예전엔 `if (!portfolio) return null`이라 빈 화면이 됐음).
  if (loading && brokers.length === 0) return <p>불러오는 중...</p>;
  if (error)
    return (
      <p className="notice text-critical" style={{ whiteSpace: 'pre-wrap' }}>
        {error}
      </p>
    );

  const isCurrentBrokerApi = !!selectedBroker && API_BROKER_IDS.includes(selectedBroker);
  const isKbSyncable =
    selectedBroker === 'kb' &&
    kbLink.configured &&
    !!kbLink.linkedAccountId &&
    (accountId === kbLink.linkedAccountId || accountId === ALL_ACCOUNTS);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">보유 종목</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={onExportCsv}>
            CSV 내보내기 (전체)
          </button>
          <button
            className="ghost"
            onClick={onImportClick}
            disabled={importing}
            title="CSV에 포함된 계좌(broker+accountId)의 기존 보유 종목을 전부 덮어씁니다."
          >
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
          {isCurrentBrokerApi && (marketStatus.kr || marketStatus.us) && (
            <span
              style={{ fontSize: 12, color: 'var(--text-muted)' }}
              title={anyMarketOpen(marketStatus) ? '1분마다 자동 새로고침합니다' : '장이 모두 닫혀 있어 자동 새로고침을 쉽니다'}
            >
              {[describeMarket('국내', marketStatus.kr), describeMarket('미국', marketStatus.us)].filter(Boolean).join(' · ')}
            </span>
          )}
          {isCurrentBrokerApi && (
            <button className="ghost" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? '새로고침 중...' : '새로고침'}
            </button>
          )}
          {isKbSyncable && (
            <button className="ghost" onClick={triggerKbSync} disabled={kbSyncing}>
              {kbSyncing ? '동기화 중...' : '새로고침'}
            </button>
          )}
        </div>
      </div>

      {refreshNotice && (
        <div className="notice" style={{ fontSize: 13 }}>
          {refreshNotice}
        </div>
      )}
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
      {kbSyncing && (
        <div className="notice" style={{ fontSize: 13 }}>
          KB증권 최신 데이터를 백그라운드에서 가져오는 중...
        </div>
      )}
      {kbSyncNotice && (
        <div className="notice text-critical" style={{ fontSize: 13 }}>
          {kbSyncNotice}
        </div>
      )}

      {configuredBrokers.length > 1 && (
        <div className="form-row">
          <label>증권사</label>
          <select
            value={selectedBroker ?? ''}
            onChange={(e) => {
              // Reset accountId in the same commit as selectedBroker, not in
              // effect2's async body: otherwise there's a render where
              // selectedBroker is already the new broker but accountId still
              // holds the old broker's id (effect2 hasn't reset it yet), and
              // effect3 (deps [selectedBroker, accountId]) fires with that
              // mismatched pair — e.g. calling Toss's /api/v1/holdings with a
              // KIS account id as the accountSeq, which Toss correctly
              // rejects as account-not-found. The request then gets cancelled
              // before its (harmless but confusing) error reaches the UI, so
              // it only shows up as a backend log line.
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
          <select
            value={accountId ?? ''}
            onChange={(e) => {
              userPickedAccountRef.current = true;
              setAccountId(e.target.value);
            }}
          >
            <option value={ALL_ACCOUNTS}>
              {accounts.some((a) => a.paper) ? '전체 계좌 (모의투자 제외)' : '전체 계좌'}
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {formatAccountOption(
                  a,
                  selectedBroker
                    ? findAccountLabel(accountLabels, selectedBroker, a.id)
                    : undefined
                )}
              </option>
            ))}
          </select>
        </div>
      )}

      {accounts.find((a) => a.id === accountId)?.paper && (
        <div className="notice">
          모의투자 계좌입니다 — 가상 자산이라 대시보드·종목별 수익·배당·실현손익 합계와 순자산 기록에는 넣지 않고, 이
          화면과 매매내역에서만 보여줍니다.
        </div>
      )}

      {!portfolio && !loading && (
        <div className="notice">
          {isCurrentBrokerApi
            ? '표시할 데이터가 없습니다.'
            : '저장된 데이터가 없습니다 — 위의 "CSV 가져오기"로 보유종목을 등록해주세요.'}
        </div>
      )}

      {portfolio && (
        <>
          {hasUnconvertedUsd && (
            <div className="notice">
              USD 종목이 있지만 환율을 가져오지 못해 비중(%) 계산에서 제외됩니다. 설정 화면에서 USD/KRW 환율을
              직접 입력하시거나, 토스증권 연동 상태를 확인해주세요.
            </div>
          )}

          {!hasUnconvertedUsd && effectiveFxRate && portfolio.positions.some((p) => p.currency === 'USD') && (
            <div className="notice">
              USD 종목 비중 계산에 적용된 환율: 1 USD = {krw.format(Math.round(effectiveFxRate))}원
              {manualFxRate ? ' (설정에서 직접 입력)' : ' (토스증권 실시간 조회)'}
            </div>
          )}

          {isCurrentBrokerApi && selectedBroker === 'toss' && portfolio.cashBalanceKrw !== null && (
            <div className="notice" style={{ fontSize: 13 }}>
              토스증권 예수금은 "매수 가능 금액"(미수 미발생 기준) API로 조회한 값이라, 매도 후 정산 전인
              금액이 있으면 실제 예수금과 약간 다를 수 있습니다.
            </div>
          )}

          <div className="summary-row">
            {isCurrentBrokerApi ? (
              <AmountTile
                label="예수금"
                krwAmount={portfolio.cashBalanceKrw}
                usdAmount={portfolio.cashBalanceUsd}
                hasUsd={hasUsdCash}
                fxRate={effectiveFxRate}
              />
            ) : (
              // KB/삼성/미래에셋(CSV·Google Sheets로 관리하는 브로커)은 예수금을 알
              // 방법이 없다(KB는 SWQM2302 TR 권한 미부여, 삼성/미래에셋은 API 자체가
              // 없음, backend/CLAUDE.md의 "계좌별 예수금" 절 참고) — 값을 추정하거나
              // 수동 입력을 받는 대신 "미지원"으로 고정 표시한다.
              <div className="stat-tile">
                <div className="label">예수금</div>
                <div className="value" style={{ color: 'var(--text-muted)' }}>
                  미지원
                </div>
              </div>
            )}
            <PurchaseMarketTile
              purchase={{ krw: portfolio.totalPurchaseAmountKrw, usd: portfolio.totalPurchaseAmountUsd }}
              market={{ krw: portfolio.totalMarketValueKrw, usd: portfolio.totalMarketValueUsd }}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
            />
            <AmountTile
              label="총 손익금액 (배당 제외)"
              krwAmount={portfolio.totalProfitLossKrw}
              usdAmount={portfolio.totalProfitLossUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              signed
            />
            <AmountTile
              label="총 손익금액 (배당 포함)"
              krwAmount={portfolio.totalProfitLossKrw + dividendTotals.krw}
              usdAmount={(portfolio.totalProfitLossUsd ?? 0) + dividendTotals.usd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              signed
              note={dividendTotals.unconverted ? '일부 배당은 환율이 없어 빠짐' : undefined}
            />
            <RateTile
              label="손익률"
              krwPl={portfolio.totalProfitLossKrw}
              krwInvested={portfolio.totalPurchaseAmountKrw}
              usdPl={portfolio.totalProfitLossUsd}
              usdInvested={portfolio.totalPurchaseAmountUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              fallbackRate={portfolio.profitLossRate}
            />
          </div>

          {/* 입금 기준 원금 — 입출금 내역 API가 있는 토스·NH·키움만(한투·KB는 없음). 모의투자 계좌는 원금 개념이 없어 뺀다. */}
          {isCurrentBrokerApi &&
            (selectedBroker === 'toss' || selectedBroker === 'nh' || selectedBroker === 'kiwoom') &&
            accountId &&
            !accounts.find((a) => a.id === accountId)?.paper && (
            <PrincipalCard
              key={selectedBroker}
              broker={selectedBroker}
              portfolio={portfolio}
              accountSeqs={accountId === ALL_ACCOUNTS ? accounts.filter((a) => !a.paper).map((a) => a.id) : [accountId]}
              fxRate={effectiveFxRate}
            />
          )}

          <div className="card">
            <HoldingsTable rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
