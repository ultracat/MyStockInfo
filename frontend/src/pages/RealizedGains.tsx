import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { AccountLabel, AccountTaxType, AccountTaxTypeEntry, BrokerId, DividendRecord, StoredTrade } from '../types';
import { BROKER_LABELS, BROKER_ORDER } from '../brokers';
import { accountLabelKey, findAccountLabel, formatAccountOption } from '../accountLabels';
import { krw } from '../format';

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

// 해외주식 양도소득세의 기본공제/세율 — 매년 바뀔 수 있는 값이라 "참고용
// 추정치"라는 캡션과 함께만 쓴다(공식 세무 자료 대체 아님).
const TAX_FREE_ALLOWANCE_KRW = 2_500_000;
const TAX_RATE = 0.22;
// 금융소득종합과세 기준 — 이자+배당소득이 연 이 금액을 넘으면 초과분이 다른
// 종합소득과 합산돼 누진세율로 과세된다(그 이하는 원천징수 15.4%로 끝).
const FINANCIAL_INCOME_THRESHOLD_KRW = 20_000_000;

interface RealizedSale {
  date: string;
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string | null;
  quantity: number;
  /** 거래 통화 — 해외주식 양도소득세(22%)는 해외 상장 종목에만 해당해서, 국내
   *  상장(KRW) 매도와 가르는 기준으로 쓴다. */
  currency: string;
  proceedsKrw: number;
  costKrw: number;
  gainKrw: number;
}

function formatKrwValue(v: number): string {
  return `${krw.format(Math.round(v))}원`;
}

/**
 * 매도 건별 실현손익 — 이동평균법(원가를 종목별로 누적하다 매도마다 평균단가 ×
 * 매도수량만큼 덜어냄)으로 계산한다. 과거 Overview.tsx에 있다가(지금은 수량만
 * 재구성하는 방식으로 바뀜) 지워진 "BUY는 원가에 더하고 SELL은 그 시점
 * 평균단가만큼 뺀다" 로직을 되살려, 이번엔 원가(KRW 환산 누적)까지 추적하고
 * 매도마다 실현손익을 기록으로 남긴다.
 *
 * **환율은 월평균을 쓴다**(일자별 정확한 환율이 아님) — 이 프로젝트가 배당금
 * 환산에 이미 월평균 환율을 공식 채택해둔 것과 같은 결정(`backend/CLAUDE.md`의
 * "배당금 월평균 환율" 절 참고). 정확한 세법은 거래 당일 환율을 요구하지만,
 * 이 화면은 "참고용 추정치"이지 공식 세무 자료가 아니므로 기존 결정과
 * 일관되게 월평균을 그대로 재사용한다.
 *
 * **ISA/연금저축/IRP 계좌는 일반 양도소득세(22%) 계산에서 제외한다** — 이
 * 계좌들은 매도차익에 완전히 다른 과세 체계(ISA는 손익통산+비과세 한도 후
 * 9.9% 분리과세, 연금저축/IRP는 매도 시점엔 과세이연되고 나중에 연금/퇴직
 * 소득으로 인출할 때 별도 세율)가 적용돼서, 이 둘을 섞어 22%를 적용하면
 * 완전히 틀린 숫자가 나온다. 계좌별 분류는 `account-tax-types.json`
 * (`backend/CLAUDE.md`의 "계좌별 세금 유형" 절 참고)에 저장하고 기본값은
 * GENERAL(일반계좌)이다.
 *
 * **22% 계산은 해외 상장 종목(통화가 KRW가 아닌 거래)만 대상이다** — 국내 상장
 * 종목은 해외주식 양도소득세 대상이 아니다: 국내 주식·국내 주식형 ETF 매매차익은
 * (대주주가 아니면) 비과세이고, 국내 상장 해외·기타 ETF 매매차익은 매도 시
 * 배당소득으로 15.4% 원천징수돼 이미 끝난다. 예전엔 통화 구분 없이 일반계좌
 * 매도를 전부 합산해 22%를 매겨서, 국내 ETF 차익에 세금을 이중으로 잡거나 국내
 * 손실로 해외 이익을 상계하는 틀린 숫자가 나왔다. 국내 상장분은 종목 정보만으로
 * 비과세/배당소득과세를 정확히 가를 수 없어 별도 카드에 안내와 함께만 보여준다.
 *
 * **배당금은 양도소득과 다른 소득(배당소득)이라 22% 계산에 넣지 않는다**(서로
 * 손익통산 불가, 250만원 공제도 없음) — 대신 "배당소득" 카드에 연간 합계와
 * 금융소득종합과세 기준(연 2,000만원) 대비 비율을 따로 보여준다.
 */
export default function RealizedGains() {
  const [allTrades, setAllTrades] = useState<StoredTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [manualFxRate, setManualFxRate] = useState<number | null>(null);
  const [liveFxRate, setLiveFxRate] = useState<number | null>(null);
  const effectiveFxRate = manualFxRate ?? liveFxRate;
  const [monthlyAvgFxRates, setMonthlyAvgFxRates] = useState<
    Record<string, { rate: number; sampleCount: number } | null>
  >({});

  const [allDividends, setAllDividends] = useState<DividendRecord[]>([]);
  const [accountLabels, setAccountLabels] = useState<AccountLabel[]>([]);
  const [taxTypes, setTaxTypes] = useState<AccountTaxTypeEntry[]>([]);

  const [year, setYear] = useState(CURRENT_YEAR);
  const [broker, setBroker] = useState<'ALL' | BrokerId>('ALL');

  useEffect(() => {
    (async () => {
      try {
        setAllTrades(await api.listTradesStore());
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    api
      .listDividends()
      .then(setAllDividends)
      .catch(() => {});
    api
      .listAccountLabels()
      .then(setAccountLabels)
      .catch(() => {});
    api
      .listAccountTaxTypes()
      .then(setTaxTypes)
      .catch(() => {});
  }, []);

  // Dividends.tsx와 같은 패턴 — 수동/실시간 환율을 합쳐 effectiveFxRate로 쓴다
  // (월평균을 못 구한 달의 최종 폴백).
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

  // 달러 거래/배당이 걸쳐 있는 달들의 평균 환율을 한 번에 조회한다(Dividends.tsx와
  // 동일한 effect 패턴) — 백엔드가 달마다 강하게 캐싱해서 반복 호출이 비싸지 않다.
  useEffect(() => {
    let cancelled = false;
    const months = [
      ...new Set([
        ...allTrades.filter((t) => t.currency === 'USD').map((t) => t.executedAt.slice(0, 7)),
        ...allDividends.filter((d) => d.currency === 'USD').map((d) => d.paidDate.slice(0, 7)),
      ]),
    ];
    if (months.length === 0) {
      setMonthlyAvgFxRates({});
      return;
    }
    api
      .getMonthlyAvgUsdKrwRates(months)
      .then((rates) => {
        if (!cancelled) setMonthlyAvgFxRates(rates);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allTrades, allDividends]);

  function monthlyRateFor(month: string): number | null {
    return monthlyAvgFxRates[month]?.rate ?? effectiveFxRate;
  }

  const taxTypeByAccount = useMemo(() => {
    const m = new Map<string, AccountTaxType>();
    for (const t of taxTypes) m.set(accountLabelKey(t.broker, t.accountId), t.taxType);
    return m;
  }, [taxTypes]);

  function taxTypeFor(b: BrokerId, accountId: string): AccountTaxType {
    return taxTypeByAccount.get(accountLabelKey(b, accountId)) ?? 'GENERAL';
  }


  const { sales, excludedSymbols } = useMemo(() => {
    const bySymbol = new Map<string, StoredTrade[]>();
    for (const t of allTrades) {
      if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
      bySymbol.get(t.symbol)!.push(t);
    }

    const results: RealizedSale[] = [];
    const excluded: string[] = [];

    for (const [symbol, symTrades] of bySymbol) {
      const sorted = [...symTrades].sort((a, b) =>
        a.executedAt < b.executedAt ? -1 : a.executedAt > b.executedAt ? 1 : 0
      );

      // 이 종목의 모든 달러 거래가 환산 가능한지 먼저 확인한다 — 하나라도
      // 못 구하면(월평균도 없고 effectiveFxRate도 없음) 이 종목 전체를 계산에서
      // 뺀다(일부 거래만 반영하면 원가 추적 자체가 깨져서 숫자가 틀어짐).
      const canCompute = sorted.every(
        (t) => t.currency !== 'USD' || monthlyRateFor(t.executedAt.slice(0, 7)) !== null
      );
      if (!canCompute) {
        excluded.push(symbol);
        continue;
      }

      let qty = 0;
      let totalCostKrw = 0;

      for (const t of sorted) {
        const rate = t.currency === 'USD' ? monthlyRateFor(t.executedAt.slice(0, 7))! : 1;
        const grossKrw = t.amount * rate;
        const feeKrw = ((t.commission ?? 0) + (t.tax ?? 0)) * rate;

        if (t.side === 'BUY') {
          qty += t.quantity;
          totalCostKrw += grossKrw + feeKrw; // 매수 부대비용은 취득원가에 가산
          continue;
        }

        // SELL — 매수 기록 없이(또는 수량이 모자라게) 매도만 있으면 그만큼은
        // 원가를 알 수 없다. 로컬 매매내역이 다 안 모여있을 수 있다는, 이 앱
        // 여러 화면에 이미 있는 한계와 같은 이유 — 있는 수량만큼만 반영한다.
        if (qty <= 0) continue;
        const soldQty = Math.min(t.quantity, qty);
        const soldFraction = soldQty / t.quantity;
        const avgCost = totalCostKrw / qty;
        const costKrw = avgCost * soldQty;
        const proceedsKrw = grossKrw * soldFraction - feeKrw * soldFraction; // 매도 부대비용은 양도가액에서 차감
        results.push({
          date: t.executedAt,
          broker: t.broker,
          accountId: t.accountId,
          symbol,
          name: t.name,
          quantity: soldQty,
          currency: t.currency,
          proceedsKrw,
          costKrw,
          gainKrw: proceedsKrw - costKrw,
        });
        qty -= soldQty;
        totalCostKrw -= costKrw;
      }
    }

    results.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { sales: results, excludedSymbols: excluded.sort() };
  }, [allTrades, monthlyAvgFxRates, effectiveFxRate]);

  const yearSales = useMemo(
    () => sales.filter((s) => s.date.slice(0, 4) === String(year) && (broker === 'ALL' || s.broker === broker)),
    [sales, year, broker]
  );
  const generalSales = useMemo(
    () => yearSales.filter((s) => taxTypeFor(s.broker, s.accountId) === 'GENERAL'),
    [yearSales, taxTypeByAccount]
  );
  const taxAdvantagedSales = useMemo(
    () => yearSales.filter((s) => taxTypeFor(s.broker, s.accountId) !== 'GENERAL'),
    [yearSales, taxTypeByAccount]
  );

  const overseasSales = useMemo(() => generalSales.filter((s) => s.currency !== 'KRW'), [generalSales]);
  const domesticSales = useMemo(() => generalSales.filter((s) => s.currency === 'KRW'), [generalSales]);

  const totalGainKrw = overseasSales.reduce((sum, s) => sum + s.gainKrw, 0);
  const estimatedTaxKrw = Math.max(0, totalGainKrw - TAX_FREE_ALLOWANCE_KRW) * TAX_RATE;
  const domesticGainKrw = domesticSales.reduce((sum, s) => sum + s.gainKrw, 0);

  // 배당 기록의 accountId는 사용자가 직접 적는 자유 문자열이라, 토스처럼 내부
  // accountId("1")와 화면 표시 계좌번호가 다른 계좌는 표시 번호로 적혀 있을 수
  // 있다 — 세금 유형(내부 accountId 기준)을 찾기 전에 표시 번호를 되돌린다.
  function dividendTaxType(d: DividendRecord): AccountTaxType {
    if (!d.accountId) return 'GENERAL';
    const byNumber = accountLabels.find((l) => l.broker === d.broker && l.accountNumber === d.accountId);
    return taxTypeFor(d.broker, byNumber ? byNumber.accountId : d.accountId);
  }

  const dividendSummary = useMemo(() => {
    const rows = allDividends.filter(
      (d) =>
        d.paidDate.slice(0, 4) === String(year) &&
        (broker === 'ALL' || d.broker === broker) &&
        dividendTaxType(d) === 'GENERAL'
    );
    let krwTotal = 0;
    let usdTotal = 0;
    let convertedKrw = 0;
    let unconvertedCount = 0;
    const byBroker = new Map<BrokerId, { krw: number; usd: number; totalKrw: number; count: number }>();
    for (const d of rows) {
      const entry = byBroker.get(d.broker) ?? { krw: 0, usd: 0, totalKrw: 0, count: 0 };
      entry.count += 1;
      if (d.currency === 'USD') {
        usdTotal += d.amount;
        entry.usd += d.amount;
        const rate = monthlyRateFor(d.paidDate.slice(0, 7));
        if (rate === null) {
          unconvertedCount += 1;
        } else {
          convertedKrw += d.amount * rate;
          entry.totalKrw += d.amount * rate;
        }
      } else {
        krwTotal += d.amount;
        entry.krw += d.amount;
        convertedKrw += d.amount;
        entry.totalKrw += d.amount;
      }
      byBroker.set(d.broker, entry);
    }
    const brokerRows = BROKER_ORDER.filter((b) => byBroker.has(b)).map((b) => ({ broker: b, ...byBroker.get(b)! }));
    return { count: rows.length, krwTotal, usdTotal, convertedKrw, unconvertedCount, brokerRows };
  }, [allDividends, year, broker, taxTypeByAccount, accountLabels, monthlyAvgFxRates, effectiveFxRate]);
  const dividendRatio = dividendSummary.convertedKrw / FINANCIAL_INCOME_THRESHOLD_KRW;

  function accountDisplay(b: BrokerId, accountId: string): string {
    return formatAccountOption({ id: accountId }, findAccountLabel(accountLabels, b, accountId));
  }

  // 특정 증권사를 골랐으면 모든 행이 같은 값이라 증권사/계좌 컬럼 자체가
  // 불필요하다 — Trades.tsx의 "전체" 모드에서만 증권사/계좌 컬럼을 보여주는
  // 기존 패턴과 동일. 계좌정보 + 종목명 때문에 나머지(수량/금액/손익) 숫자를
  // 보려고 매번 가로 스크롤해야 한다는 피드백으로 추가했다.
  const isAllMode = broker === 'ALL';

  function renderSalesTable(rows: RealizedSale[]) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>일자</th>
              {isAllMode && <th>증권사</th>}
              {isAllMode && <th>계좌</th>}
              <th>종목</th>
              <th>수량</th>
              <th>매도금액</th>
              <th>취득금액</th>
              <th>손익</th>
              <th>수익률</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, idx) => (
              <tr key={`${s.broker}:${s.accountId}:${s.symbol}:${s.date}:${idx}`}>
                <td>{s.date}</td>
                {isAllMode && <td>{BROKER_LABELS[s.broker]}</td>}
                {isAllMode && (
                  <td>
                    <span className="cell-name-truncate" title={accountDisplay(s.broker, s.accountId)}>
                      {accountDisplay(s.broker, s.accountId)}
                    </span>
                  </td>
                )}
                <td>
                  {s.name ? (
                    <>
                      <span className="cell-name-truncate" title={s.name}>
                        {s.name}
                      </span>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>({s.symbol})</span>
                    </>
                  ) : (
                    s.symbol
                  )}
                </td>
                <td>{s.quantity}</td>
                <td>{formatKrwValue(s.proceedsKrw)}</td>
                <td>{formatKrwValue(s.costKrw)}</td>
                <td className={s.gainKrw >= 0 ? 'text-good' : 'text-critical'}>
                  {s.gainKrw >= 0 ? '+' : ''}
                  {formatKrwValue(s.gainKrw)}
                </td>
                <td className={s.gainKrw >= 0 ? 'text-good' : 'text-critical'}>
                  {s.costKrw > 0 ? `${s.gainKrw >= 0 ? '+' : ''}${((s.gainKrw / s.costKrw) * 100).toFixed(2)}%` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (loading) return <p style={{ color: 'var(--text-muted)' }}>불러오는 중...</p>;

  return (
    <div>
      <h2 className="page-title">실현손익</h2>
      {error && <p className="text-critical">{error}</p>}
      {message && <p className="text-good">{message}</p>}

      <p className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        매도 거래를 이동평균법으로 계산한 <strong>참고용 추정치</strong>입니다 — 환율은 거래
        당일이 아니라 <strong>그 달의 평균 환율</strong>을 쓰고, 로컬에 매수 기록이 없는
        매도분은 원가를 알 수 없어 그만큼 제외됩니다. 실제 세금 신고는 증권사가 발급하는
        공식 자료나 세무 전문가를 통해 꼭 확인해주세요.
      </p>

      {excludedSymbols.length > 0 && (
        <p className="card text-critical" style={{ fontSize: 13 }}>
          환율 정보를 구하지 못해 계산에서 제외된 종목: {excludedSymbols.join(', ')} — 설정에서
          수동 환율을 입력하면 다시 계산됩니다.
        </p>
      )}

      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        계좌별 세금 유형(ISA/연금저축/IRP)은 설정 화면의 "계좌 별칭 · 세금 유형"에서
        지정합니다.
      </p>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>연도</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>증권사</label>
            <select value={broker} onChange={(e) => setBroker(e.target.value as 'ALL' | BrokerId)}>
              <option value="ALL">전체</option>
              {BROKER_ORDER.map((id) => (
                <option key={id} value={id}>
                  {BROKER_LABELS[id]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <h3 style={{ marginTop: 0 }}>해외주식 양도소득 (22% 대상)</h3>
        <div className="summary-row">
          <div className="stat-tile">
            <div className="label">{year}년 해외 상장 종목 실현손익(일반계좌)</div>
            <div className={`value ${totalGainKrw >= 0 ? 'text-good' : 'text-critical'}`}>
              {totalGainKrw >= 0 ? '+' : ''}
              {formatKrwValue(totalGainKrw)}
            </div>
          </div>
          <div className="stat-tile">
            <div className="label">추정 세액(참고용)</div>
            <div className="value">{formatKrwValue(estimatedTaxKrw)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              기본공제 250만원 적용 후 22% — 참고용 추정치, 일반계좌의 해외 상장 종목만 포함
            </div>
          </div>
        </div>

        {overseasSales.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{year}년에 일반계좌에서 실현된 해외 상장 종목 매도 기록이 없습니다.</p>
        ) : (
          renderSalesTable(overseasSales)
        )}
      </div>

      {domesticSales.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>국내 상장 종목 매도 (22% 대상 아님)</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
            위 양도소득세 계산에 포함되지 않습니다. 국내 주식·국내 주식형 ETF(예: KODEX 코스피100)의
            매매차익은 대주주가 아니면 <strong>비과세</strong>이고, 국내 상장 해외·기타 ETF(예: 미국 지수
            추종 ETF, 커버드콜 ETF)의 매매차익은 매도할 때 <strong>배당소득으로 15.4% 원천징수</strong>돼
            이미 과세가 끝납니다(아래 금융소득종합과세 기준에도 합산됨). 종목별 구분은 이 화면이 판단하지
            못하므로 증권사 자료로 확인해주세요.
          </p>
          <div className="summary-row">
            <div className="stat-tile">
              <div className="label">{year}년 국내 상장 종목 실현손익(일반계좌)</div>
              <div className={`value ${domesticGainKrw >= 0 ? 'text-good' : 'text-critical'}`}>
                {domesticGainKrw >= 0 ? '+' : ''}
                {formatKrwValue(domesticGainKrw)}
              </div>
            </div>
          </div>
          {renderSalesTable(domesticSales)}
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>배당소득</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          배당금은 매매차익과 다른 소득(배당소득)이라 위 양도소득세에 합산되지 않고, 지급될 때
          원천징수(국내 15.4%, 미국 주식은 현지 15%)로 끝납니다. 다만 이자·배당소득이 연{' '}
          {formatKrwValue(FINANCIAL_INCOME_THRESHOLD_KRW)}을 넘으면 초과분이 금융소득종합과세 대상이
          됩니다. 배당금 화면에 입력한 금액 기준이며(세전 금액으로 입력해야 기준과 정확히 비교됨),
          달러 배당은 지급월 평균 환율로 환산합니다. ISA/연금저축/IRP 계좌 배당과, 위 "국내 상장
          종목 매도"의 해외·기타 ETF 매매차익(배당소득으로 과세)은 포함하지 않습니다.
        </p>
        <div className="summary-row">
          <div className="stat-tile">
            <div className="label">{year}년 배당소득 합계(일반계좌, 원화 환산)</div>
            <div className="value">{formatKrwValue(dividendSummary.convertedKrw)}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {dividendSummary.count}건 · 원화 {formatKrwValue(dividendSummary.krwTotal)} · 달러 $
              {dividendSummary.usdTotal.toFixed(2)}
              {dividendSummary.unconvertedCount > 0 && ` · 환율 미적용 ${dividendSummary.unconvertedCount}건 제외`}
            </div>
          </div>
          <div className="stat-tile">
            <div className="label">금융소득종합과세 기준 대비</div>
            <div className={`value ${dividendRatio >= 1 ? 'text-critical' : ''}`}>
              {(dividendRatio * 100).toFixed(1)}%
            </div>
            <div
              role="meter"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(Math.min(dividendRatio, 1) * 100)}
              aria-label="금융소득종합과세 기준 대비 배당소득"
              style={{ height: 6, borderRadius: 3, background: 'var(--gridline)', marginTop: 8, overflow: 'hidden' }}
            >
              <div
                style={{
                  width: `${Math.min(dividendRatio, 1) * 100}%`,
                  height: '100%',
                  background: dividendRatio >= 1 ? 'var(--critical)' : 'var(--series-1)',
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {dividendRatio >= 1
                ? `기준 초과 ${formatKrwValue(dividendSummary.convertedKrw - FINANCIAL_INCOME_THRESHOLD_KRW)} — 종합과세 대상`
                : `기준까지 ${formatKrwValue(FINANCIAL_INCOME_THRESHOLD_KRW - dividendSummary.convertedKrw)} 남음 (이자소득 별도)`}
            </div>
          </div>
        </div>
        {dividendSummary.brokerRows.length > 0 ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>증권사</th>
                  <th>건수</th>
                  <th>원화</th>
                  <th>달러</th>
                  <th>합계(환산)</th>
                </tr>
              </thead>
              <tbody>
                {dividendSummary.brokerRows.map((r) => (
                  <tr key={r.broker}>
                    <td>{BROKER_LABELS[r.broker]}</td>
                    <td>{r.count}</td>
                    <td>{formatKrwValue(r.krw)}</td>
                    <td>${r.usd.toFixed(2)}</td>
                    <td>{formatKrwValue(r.totalKrw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>{year}년 일반계좌 배당 기록이 없습니다.</p>
        )}
      </div>

      {taxAdvantagedSales.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>세제혜택 계좌 매도 내역(ISA/연금저축/IRP)</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
            위 실현손익 합계·추정 세액·배당소득에는 포함되지 않습니다 — 이 계좌들은 각자 다른 과세
            체계(ISA는 손익통산 후 비과세 한도 초과분만 9.9% 분리과세, 연금저축/IRP는 매도
            시점엔 과세되지 않고 나중에 연금·퇴직소득으로 인출할 때 과세)가 적용됩니다.
          </p>
          {renderSalesTable(taxAdvantagedSales)}
        </div>
      )}
    </div>
  );
}
