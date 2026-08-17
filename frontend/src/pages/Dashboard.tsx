import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, BrokerAccount, BrokerId, BrokerSummary, PortfolioOverview, StoredHolding } from '../types';
import HoldingsTable from '../components/HoldingsTable';
import { formatKrw, krw, usdFmt } from '../format';
import { downloadCsv, parseCsv } from '../csv';
import { API_BROKER_IDS } from '../brokers';
import { accountLabelKey, formatAccountOption } from '../accountLabels';

const SMALL_LINE = { fontSize: 12, fontWeight: 400 as const, color: 'var(--text-muted)', marginTop: 2 };

// 1분마다 자동 새로고침 — 보유종목 조회(ASSET/kisLimiter)는 초당 4~5건 한도라 분당
// 한 번은 여유가 매우 크다(backend/CLAUDE.md 참고). 수동 새로고침 버튼은 이 자동
// 갱신과 별개로 그때그때 강제 조회할 수 있게 하되, 너무 잦은 클릭이 레이트리밋을
// 건드리지 않도록 쿨다운을 둔다.
const AUTO_REFRESH_MS = 60_000;
const MANUAL_REFRESH_COOLDOWN_MS = 10_000;

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
}: {
  label: string;
  krwAmount: number;
  usdAmount: number | null;
  hasUsd: boolean;
  fxRate: number | null;
  signed?: boolean;
}) {
  const sign = (v: number) => (signed && v >= 0 ? '+' : '');
  const fmt = (v: number) => `${sign(v)}${formatKrw(v)}`;
  const tone = (v: number) => (signed ? (v >= 0 ? 'text-good' : 'text-critical') : '');

  if (!hasUsd) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        <div className={`value ${tone(krwAmount)}`}>{fmt(krwAmount)}</div>
      </div>
    );
  }

  const usd = usdAmount ?? 0;
  const totalKrw = krwAmount + (fxRate ? usd * fxRate : 0);
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div style={SMALL_LINE}>{fmt(krwAmount)}</div>
      <div style={SMALL_LINE}>
        {sign(usd)}
        {usdFmt.format(usd)}
      </div>
      <div className={`value ${tone(totalKrw)}`} style={{ marginTop: 2 }}>
        {fxRate ? fmt(totalKrw) : '환율 미적용'}
      </div>
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

  const configuredBrokers = brokers.filter((b) => b.configured);

  // 계좌 별칭은 Settings.tsx에서만 관리하고 여기선 읽기만 한다 — 마운트 시 한 번만
  // 불러오면 충분(브로커/계좌를 바꿔도 라벨 목록 자체는 안 바뀜).
  useEffect(() => {
    api.listAccountLabels().then(setAccountLabels).catch(() => {});
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
        setManualFxRate(null);
        setLiveFxRate(null);

        // CSV 전용 브로커(KB/삼성/미래에셋)는 listAccounts API 자체가 없다 — 로컬
        // 저장소에 실제로 CSV로 넣어둔 (broker, accountId) 쌍의 accountId를 모아
        // 계좌 목록처럼 쓴다(새 백엔드 엔드포인트 불필요, 이미 있는 조회로 충분).
        const accs = API_BROKER_IDS.includes(selectedBroker)
          ? await api.listAccounts(selectedBroker)
          : await api
              .listHoldingsStore({ broker: selectedBroker })
              .then((rows) => Array.from(new Set(rows.map((r) => r.accountId))).map((id) => ({ id })));
        if (cancelled) return;
        setAccounts(accs);
        if (accs.length > 0) setAccountId(accs[0].id);

        // Only Toss publishes GET /api/v1/exchange-rate today — other
        // brokers' getExchangeRate is unset server-side (404), and their
        // holdings so far are KRW-only anyway, so this is skippable.
        if (selectedBroker === 'toss') {
          const fx = await api.getFxRate();
          if (cancelled) return;
          setManualFxRate(fx.usdKrwRate);

          // Non-fatal: live rate is a nice-to-have (falls back to the
          // manual rate above, or to excluding USD positions from weight).
          try {
            const live = await api.getExchangeRate('toss', 'USD', 'KRW');
            if (!cancelled) setLiveFxRate(live.midRate ?? live.rate);
          } catch {
            // ignore
          }
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
          await loadStoredPortfolio(selectedBroker, accountId);
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
        const data = await api.getPortfolio(selectedBroker!, accountId!, opts);
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
    const interval = setInterval(() => fetchPortfolio(), AUTO_REFRESH_MS);

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
      const data = await api.getPortfolio(selectedBroker, accountId, { forceRefresh: true });
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
      setImportResult(
        result.failed.length > 0
          ? `${result.added}건 추가됨 (실패 ${result.failed.length}건: ${result.failed
              .map((f) => `${f.row}행 - ${f.error}`)
              .join('; ')})`
          : `${result.added}건 추가됨`
      );

      // 지금 보고 있는 브로커가 CSV 전용이면, 브로커 재선택 없이 방금 가져온
      // 데이터가 바로 보이도록 계좌 목록/포트폴리오를 다시 읽는다.
      if (selectedBroker && !API_BROKER_IDS.includes(selectedBroker)) {
        const rows = await api.listHoldingsStore({ broker: selectedBroker });
        const ids = Array.from(new Set(rows.map((r) => r.accountId)));
        setAccounts(ids.map((id) => ({ id })));
        const nextAccountId = accountId && ids.includes(accountId) ? accountId : (ids[0] ?? null);
        setAccountId(nextAccountId);
        if (nextAccountId) await loadStoredPortfolio(selectedBroker, nextAccountId);
        else setPortfolio(null);
      }
    } catch (e) {
      setImportResult((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  // A manually-entered rate (Settings) always overrides the live one, in
  // case the user wants to pin a specific rate; otherwise fall back to
  // Toss's GET /api/v1/exchange-rate (USD->KRW mid rate).
  const effectiveFxRate = manualFxRate ?? liveFxRate;

  // 개별 타일의 금액(예: 손익금액이 우연히 0)이 아니라 포트폴리오가 실제로 달러
  // 투자금을 갖고 있는지로 판단 — AmountTile/RateTile 문서 주석 참고.
  const hasUsdHoldings = !!portfolio?.totalPurchaseAmountUsd;

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

    return portfolio.positions.map((p, i) => ({
      ...p,
      weight: convertedValues[i] === null || total === 0 ? null : (convertedValues[i] as number) / total,
    }));
  }, [portfolio, effectiveFxRate]);

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title">보유 종목</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="ghost" onClick={onExportCsv}>
            CSV 내보내기 (전체)
          </button>
          <button className="ghost" onClick={onImportClick} disabled={importing}>
            {importing ? '가져오는 중...' : 'CSV 가져오기'}
          </button>
          <input ref={fileInputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onImportFile} />
          {isCurrentBrokerApi && (
            <button className="ghost" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? '새로고침 중...' : '새로고침'}
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

          <div className="summary-row">
            <AmountTile
              label="총 매입금액"
              krwAmount={portfolio.totalPurchaseAmountKrw}
              usdAmount={portfolio.totalPurchaseAmountUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
            />
            <AmountTile
              label="총 평가금액"
              krwAmount={portfolio.totalMarketValueKrw}
              usdAmount={portfolio.totalMarketValueUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
            />
            <AmountTile
              label="총 손익금액"
              krwAmount={portfolio.totalProfitLossKrw}
              usdAmount={portfolio.totalProfitLossUsd}
              hasUsd={hasUsdHoldings}
              fxRate={effectiveFxRate}
              signed
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

          <div className="card">
            <HoldingsTable rows={rows} />
          </div>
        </>
      )}
    </div>
  );
}
