import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { BrokerId, DividendCurrency, DividendRecord, MonthlySummaryRow } from '../types';
import DividendsChart from '../components/DividendsChart';

const today = () => new Date().toISOString().slice(0, 10);

const BROKER_LABELS: Record<BrokerId, string> = { toss: '토스증권', kis: '한국투자증권', kb: 'KB증권' };
const BROKER_ORDER: BrokerId[] = ['toss', 'kis', 'kb'];
const krw = new Intl.NumberFormat('ko-KR');
const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

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
  const [summary, setSummary] = useState<MonthlySummaryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [broker, setBroker] = useState<BrokerId>('toss');
  const [currency, setCurrency] = useState<DividendCurrency>('KRW');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [paidDate, setPaidDate] = useState(today());
  const [memo, setMemo] = useState('');

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
    const [r, s] = await Promise.all([api.listDividends(), api.monthlyDividendSummary()]);
    setRecords(r);
    setSummary(s);
  }

  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

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
            const accounts = await api.listAccounts(b.id);
            const portfolios = await Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id)));
            const totalKrw = portfolios.reduce((sum, p) => sum + p.totalPurchaseAmountKrw, 0);
            const totalUsd = portfolios.reduce((sum, p) => sum + (p.totalPurchaseAmountUsd ?? 0), 0);
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
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function onDelete(id: string) {
    await api.deleteDividend(id);
    await refresh();
  }

  const brokerDividendTotals = useMemo(() => {
    const byBroker = new Map<BrokerId, { krw: number; usd: number }>();
    for (const r of records) {
      const existing = byBroker.get(r.broker) ?? { krw: 0, usd: 0 };
      if (r.currency === 'USD') existing.usd += r.amount;
      else existing.krw += r.amount;
      byBroker.set(r.broker, existing);
    }
    return byBroker;
  }, [records]);

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

  return (
    <div>
      <h2 className="page-title">배당금</h2>
      <div className="notice">
        토스증권/한국투자증권 Open API 모두 "내 계좌에 실제로 입금된 배당금" 내역을 조회하는 API는
        제공하지 않아 (한국투자증권은 종목별 배당 일정/배당률 같은 공개 시세 데이터는 있지만, 개인
        계좌의 배당 지급 내역은 없습니다), 배당금은 지급 시 직접 입력해 관리합니다.
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>월별 배당금</h3>
        <DividendsChart rows={summary} fxRate={effectiveFxRate} />
      </div>

      <div className="card">
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
                  <td style={line.muted ? { color: 'var(--text-muted)', fontSize: 12 } : undefined}>{line.label}</td>
                  <td>{line.invested}</td>
                  <td>{line.dividend}</td>
                  <td>{line.yieldText}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                <option value="toss">토스증권</option>
                <option value="kis">한국투자증권</option>
              </select>
            </div>
            <div className="form-row">
              <label>종목코드</label>
              <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="예: AAPL, 005930" />
            </div>
            <div className="form-row">
              <label>종목명</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 애플" />
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
        <table>
          <thead>
            <tr>
              <th>지급일</th>
              <th>증권사</th>
              <th>종목</th>
              <th>배당금</th>
              <th>메모</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>{r.paidDate}</td>
                <td>{BROKER_LABELS[r.broker]}</td>
                <td>
                  {r.name} ({r.symbol})
                </td>
                <td>{r.currency === 'USD' ? usdFmt.format(r.amount) : `${krw.format(r.amount)}원`}</td>
                <td>{r.memo ?? '-'}</td>
                <td>
                  <button className="ghost" onClick={() => onDelete(r.id)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
