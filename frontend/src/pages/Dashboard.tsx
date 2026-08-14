import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { BrokerAccount, BrokerId, BrokerSummary, PortfolioOverview } from '../types';
import HoldingsTable from '../components/HoldingsTable';

function formatKrw(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(Math.round(value))}원`;
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const SMALL_LINE = { fontSize: 12, fontWeight: 400 as const, color: 'var(--text-muted)', marginTop: 2 };

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

  const configuredBrokers = brokers.filter((b) => b.configured);

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

        const accs = await api.listAccounts(selectedBroker);
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

  useEffect(() => {
    if (!selectedBroker || !accountId) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await api.getPortfolio(selectedBroker, accountId);
        if (!cancelled) setPortfolio(data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBroker, accountId]);

  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    if (!selectedBroker || !accountId) return;
    setRefreshing(true);
    setError(null);
    try {
      // Deliberately NOT forceRefresh: without it, this still goes through
      // the backend's 5s response cache (see backend/src/brokers/responseCache.ts).
      // A forced bypass here reproduced the exact StrictMode-double-fetch
      // problem the cache exists to prevent — a user clicking refresh more
      // than once within a few seconds (or a stray double-click) would fire
      // a second real KIS call and immediately re-trip EGW00201. Respecting
      // the cache means "refresh" reflects data at most 5s old, which is
      // close enough for a portfolio view and safe to click repeatedly.
      const data = await api.getPortfolio(selectedBroker, accountId);
      setPortfolio(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
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

  if (loading && !portfolio) return <p>불러오는 중...</p>;
  if (error)
    return (
      <p className="notice text-critical" style={{ whiteSpace: 'pre-wrap' }}>
        {error}
      </p>
    );
  if (!portfolio) return null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="page-title">보유 종목</h2>
        <button className="ghost" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? '새로고침 중...' : '새로고침'}
        </button>
      </div>

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
                {a.accountNumber ?? a.id} ({a.accountType})
              </option>
            ))}
          </select>
        </div>
      )}

      {hasUnconvertedUsd && (
        <div className="notice">
          USD 종목이 있지만 환율을 가져오지 못해 비중(%) 계산에서 제외됩니다. 설정 화면에서 USD/KRW 환율을
          직접 입력하시거나, 토스증권 연동 상태를 확인해주세요.
        </div>
      )}

      {!hasUnconvertedUsd && effectiveFxRate && portfolio.positions.some((p) => p.currency === 'USD') && (
        <div className="notice">
          USD 종목 비중 계산에 적용된 환율: 1 USD = {new Intl.NumberFormat('ko-KR').format(Math.round(effectiveFxRate))}원
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
    </div>
  );
}
