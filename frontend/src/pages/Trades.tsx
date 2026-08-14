import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { BrokerAccount, BrokerId, BrokerSummary, TradeRecord } from '../types';
import TradesChart, { type MonthlyTradeSummary } from '../components/TradesChart';

const krw = new Intl.NumberFormat('ko-KR');
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

function formatAmount(amount: number, currency: string) {
  return currency === 'USD' ? usdFmt.format(amount) : `${krw.format(Math.round(amount))}원`;
}

export default function Trades() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brokers, setBrokers] = useState<BrokerSummary[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<BrokerId | null>(null);
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [trades, setTrades] = useState<TradeRecord[]>([]);

  const configuredBrokers = brokers.filter((b) => b.configured);

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
        const accs = await api.listAccounts(selectedBroker);
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
        const today = new Date().toISOString().slice(0, 10);
        const from = `${year}-01-01`;
        const to = year === CURRENT_YEAR ? today : `${year}-12-31`;
        const data = await api.getTradeHistory(selectedBroker, accountId, from, to);
        if (!cancelled) setTrades(data);
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

  const monthlyRows = useMemo<MonthlyTradeSummary[]>(() => {
    const rows: MonthlyTradeSummary[] = Array.from({ length: 12 }, (_, i) => ({
      month: `${year}-${String(i + 1).padStart(2, '0')}`,
      buyKrw: 0,
      buyUsd: 0,
      sellKrw: 0,
      sellUsd: 0,
    }));
    for (const t of trades) {
      const monthIdx = Number(t.executedAt.slice(5, 7)) - 1;
      if (monthIdx < 0 || monthIdx > 11) continue;
      const row = rows[monthIdx];
      const isUsd = t.currency === 'USD';
      if (t.side === 'BUY') {
        if (isUsd) row.buyUsd += t.amount;
        else row.buyKrw += t.amount;
      } else {
        if (isUsd) row.sellUsd += t.amount;
        else row.sellKrw += t.amount;
      }
    }
    return rows;
  }, [trades, year]);

  const totals = useMemo(() => {
    let buyKrw = 0;
    let buyUsd = 0;
    let sellKrw = 0;
    let sellUsd = 0;
    let buyCount = 0;
    let sellCount = 0;
    for (const t of trades) {
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
  }, [trades]);

  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => (a.executedAt < b.executedAt ? 1 : -1)),
    [trades]
  );

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
      <h2 className="page-title">매매내역</h2>

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
                  {a.accountNumber ?? a.id} ({a.accountType})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-row">
          <label>연도</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEAR_OPTIONS.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        </div>
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
        <h3 style={{ marginTop: 0 }}>{year}년 월별 매수/매도</h3>
        <TradesChart rows={monthlyRows} fxRate={effectiveFxRate} />
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>일자</th>
              <th>종목</th>
              <th>구분</th>
              <th>수량</th>
              <th>단가</th>
              <th>체결금액</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {year}년 거래 내역이 없습니다.
                </td>
              </tr>
            ) : (
              sortedTrades.map((t) => (
                <tr key={t.id}>
                  <td>{t.executedAt}</td>
                  <td>{t.name ? `${t.name} (${t.symbol})` : t.symbol}</td>
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
