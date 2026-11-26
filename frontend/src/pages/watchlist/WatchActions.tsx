import { useEffect, useState } from 'react';
import { api } from '../../api';
import { holdingsFailureMessage, loadAllHoldings } from '../../allHoldings';
import { krw, qtyFmt } from '../../format';
import { effectiveRate, toKrw } from '../../fx';
import { loadUsdKrwRates } from '../../fxLoader';
import { whatIfBuy, type WhatIf } from '../../calc/watchDetail';
import type { WatchlistEntry } from '../../types';

// 관심종목 상세의 입력이 있는 칸("만약 지금 산다면"·메모) — 2026-11-26 WatchDetail.tsx에서 옮겼다(동작 그대로).

/** 만약 지금 산다면 — 금액으로 살 수 있는 주수와, 산 뒤 내 전체 평가금액에서의 비중(loadAllHoldings). */
export function WhatIfSection({ last, currency }: { last: number | null; currency: string | null }) {
  const usd = currency === 'USD';
  const [amount, setAmount] = useState('');
  const [whatIf, setWhatIf] = useState<{ result: WhatIf | null; note: string | null } | null>(null);
  const [whatIfBusy, setWhatIfBusy] = useState(false);
  const runWhatIf = async () => {
    const amt = Number(amount.replace(/,/g, ''));
    if (!(amt > 0) || !last) return setWhatIf({ result: null, note: '금액을 0보다 크게 입력하세요.' });
    setWhatIfBusy(true);
    try {
      const rates = await loadUsdKrwRates();
      const fx = effectiveRate(rates.manual, rates.live);
      const priceKrw = toKrw(last, currency, fx);
      if (priceKrw === null) return setWhatIf({ result: null, note: '환율을 구하지 못해 달러 가격을 원화로 바꿀 수 없습니다.' });
      const all = await loadAllHoldings().catch(() => null);
      let total: number | null = null;
      if (all) {
        total = 0;
        for (const l of all.lines) {
          const v = toKrw(l.marketValue, l.currency, all.fxRate);
          if (v === null) {
            total = null;
            break;
          }
          total += v;
        }
      }
      // 증권사 전체뿐 아니라 계좌 하나만 실패해도 합계가 줄어 비중이 크게 나온다(allHoldings.ts failedAccounts).
      const failed = all && holdingsFailureMessage(all) ? ' 일부 증권사·계좌 보유를 불러오지 못해 비중은 그만큼 크게 나옵니다.' : '';
      setWhatIf({ result: whatIfBuy(amt, priceKrw, total), note: (total === null ? '내 전체 평가금액을 구하지 못해 비중은 빼고 보여 줍니다.' : '') + failed || null });
    } finally {
      setWhatIfBusy(false);
    }
  };

  return (
    <>
      <h4 style={{ margin: '20px 0 8px' }}>만약 지금 산다면</h4>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="watch-whatif" style={{ fontSize: 13 }}>
          금액(원)
        </label>
        <input id="watch-whatif" inputMode="numeric" value={amount} placeholder="예: 1000000" onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} />
        <button type="button" className="ghost" disabled={whatIfBusy || !amount.trim()} onClick={() => void runWhatIf()}>
          {whatIfBusy ? '계산 중...' : '계산'}
        </button>
      </div>
      {whatIf && (
        <p style={{ fontSize: 13, margin: '6px 0 0' }}>
          {whatIf.result && (
            <>
              지금 가격으로 <b>{qtyFmt.format(whatIf.result.shares)}주</b>({krw.format(Math.round(whatIf.result.costKrw))}원, 남는 돈 {krw.format(Math.round(whatIf.result.leftoverKrw))}원)
              {whatIf.result.weight !== null && (
                <>
                  {' '}
                  · 산 뒤 내 전체 평가금액에서 <b>{(whatIf.result.weight * 100).toFixed(1)}%</b>
                </>
              )}
              {usd && ' · 달러 가격은 지금 환율로 바꿨습니다(수수료·환전 비용 제외)'}
            </>
          )}
          {whatIf.note && <span style={{ color: 'var(--text-muted)' }}> {whatIf.note}</span>}
        </p>
      )}
    </>
  );
}

/** 관심종목 메모 — 저장하면 위 화면(Watchlist.tsx)의 목록 항목도 바꾼다. */
export function WatchMemo({ entry, onEntryChange }: { entry: WatchlistEntry; onEntryChange: (e: WatchlistEntry) => void }) {
  const { symbol } = entry;
  const [memo, setMemo] = useState(entry.memo ?? '');
  const [memoMsg, setMemoMsg] = useState<string | null>(null);
  useEffect(() => {
    setMemo(entry.memo ?? '');
    setMemoMsg(null);
  }, [symbol, entry.memo]);
  const saveMemo = async () => {
    try {
      onEntryChange({ ...entry, ...(await api.setWatchlistMemo(symbol, memo.trim() || null)) });
      setMemoMsg('저장했습니다.');
    } catch (e) {
      setMemoMsg((e as Error).message);
    }
  };

  return (
    <>
      <h4 style={{ margin: '20px 0 8px' }}>메모</h4>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="관심을 둔 이유, 사려는 가격·조건 등"
        style={{ width: '100%', boxSizing: 'border-box', font: 'inherit' }}
        aria-label="관심종목 메모"
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button type="button" className="ghost" disabled={memo.trim() === (entry.memo ?? '')} onClick={() => void saveMemo()}>
          메모 저장
        </button>
        {memoMsg && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{memoMsg}</span>}
      </div>
    </>
  );
}
