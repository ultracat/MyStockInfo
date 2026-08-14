import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { BrokerAccount, BrokerId, BrokerSummary, PortfolioOverview } from '../types';
import HoldingsTable from '../components/HoldingsTable';

function formatKrw(value: number) {
  return `${new Intl.NumberFormat('ko-KR').format(Math.round(value))}원`;
}

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * 원화 전용이면 기존과 동일하게 한 줄만 보여준다. 달러 보유분이 있으면(현재는
 * 토스의 해외주식 계좌만 해당) Dividends.tsx의 "증권사별 배당금 총계"와 같은
 * 방식으로 원화/달러/합계(환산) 3줄로 나눠 보여준다 — 환율은 이 화면에서 이미
 * 비중(weight) 계산에 쓰던 effectiveFxRate(설정 수동 입력 > 토스 실시간 환율)를
 * 그대로 재사용한다.
 */
function AmountTile({
  label,
  krwAmount,
  usdAmount,
  fxRate,
}: {
  label: string;
  krwAmount: number;
  usdAmount: number | null;
  fxRate: number | null;
}) {
  if (!usdAmount) {
    return (
      <div className="stat-tile">
        <div className="label">{label}</div>
        <div className="value">{formatKrw(krwAmount)}</div>
      </div>
    );
  }

  const totalKrw = krwAmount + (fxRate ? usdAmount * fxRate : 0);
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{formatKrw(krwAmount)}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{usdFmt.format(usdAmount)}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
        합계(환산) {fxRate ? formatKrw(totalKrw) : '환율 미적용'}
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
          fxRate={effectiveFxRate}
        />
        <AmountTile
          label="총 평가금액"
          krwAmount={portfolio.totalMarketValueKrw}
          usdAmount={portfolio.totalMarketValueUsd}
          fxRate={effectiveFxRate}
        />
        <div className="stat-tile">
          <div className="label">총 손익금액</div>
          <div className={`value ${portfolio.totalProfitLossKrw >= 0 ? 'text-good' : 'text-critical'}`}>
            {portfolio.totalProfitLossKrw >= 0 ? '+' : ''}
            {formatKrw(portfolio.totalProfitLossKrw)}
          </div>
        </div>
        <div className="stat-tile">
          <div className="label">손익률</div>
          <div className={`value ${(portfolio.profitLossRate ?? 0) >= 0 ? 'text-good' : 'text-critical'}`}>
            {portfolio.profitLossRate === null
              ? '-'
              : `${portfolio.profitLossRate >= 0 ? '+' : ''}${(portfolio.profitLossRate * 100).toFixed(2)}%`}
          </div>
        </div>
      </div>

      <div className="card">
        <HoldingsTable rows={rows} />
      </div>
    </div>
  );
}
