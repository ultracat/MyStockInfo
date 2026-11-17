// 분석 카드 계산 — 환율 효과 분해(대시보드), ETF 포함 실질 보유 비중(대시보드), 종목별 배당수익률(배당금 화면).
// 순수 함수, 테스트 frontend/test/insights.test.ts.
import type { DividendRecord, StoredTrade } from '../types';

// ---- 1) 달러 자산 손익 = 주가 효과 + 환율 효과 ------------------------------------------------------------------------------
// 원화 손익 = 수량×(지금가×지금환율) − 매입금액(달러)×매입환율 를 둘로 나눈다:
//   주가 효과 = 수량×(지금가 − 평단가)×지금환율       (달러로 번 것을 지금 환율로)
//   환율 효과 = 매입금액(달러)×(지금환율 − 매입환율)  (원금을 달러로 들고 있어서 생긴 것)
// 매입환율은 매매내역의 매수 달(月) 평균 환율로 이동평균한 값 — 매매내역으로 재구성한 수량이 지금 보유와 1% 넘게 다르면(내역이 다 없으면)
// 그 종목은 매입환율을 모른다고 보고 뺀다.

export interface FxEffectHolding {
  symbol: string;
  name: string;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  purchaseAmount: number;
}

export interface FxEffectRow {
  symbol: string;
  name: string;
  costUsd: number;
  valueUsd: number;
  purchaseFx: number;
  priceEffectKrw: number;
  fxEffectKrw: number;
  totalKrw: number;
}

/** 매매내역(달러)을 이동평균으로 다시 굴려 종목별 {수량, 달러 원가, 원화 원가}. */
export function usdCostBasis(trades: StoredTrade[], rateFor: (month: string) => number | null): Map<string, { qty: number; costUsd: number; costKrw: number; missingRate: boolean }> {
  const out = new Map<string, { qty: number; costUsd: number; costKrw: number; missingRate: boolean }>();
  const sorted = trades.filter((t) => t.currency === 'USD').sort((a, b) => (a.executedAt < b.executedAt ? -1 : 1));
  for (const t of sorted) {
    const cur = out.get(t.symbol) ?? { qty: 0, costUsd: 0, costKrw: 0, missingRate: false };
    if (t.side === 'BUY') {
      const rate = rateFor(t.executedAt.slice(0, 7));
      if (!rate) cur.missingRate = true;
      cur.qty += t.quantity;
      cur.costUsd += t.amount;
      cur.costKrw += t.amount * (rate ?? 0);
    } else if (cur.qty > 0) {
      const sold = Math.min(t.quantity, cur.qty);
      const ratio = sold / cur.qty;
      cur.costUsd -= cur.costUsd * ratio;
      cur.costKrw -= cur.costKrw * ratio;
      cur.qty -= sold;
    }
    out.set(t.symbol, cur);
  }
  return out;
}

export function fxEffect(
  holdings: FxEffectHolding[],
  trades: StoredTrade[],
  rateFor: (month: string) => number | null,
  currentFx: number | null
): { rows: FxEffectRow[]; unknown: string[] } {
  if (!currentFx) return { rows: [], unknown: [] };
  const bySymbol = new Map<string, { name: string; qty: number; costUsd: number; lastPrice: number }>();
  for (const h of holdings) {
    if (h.currency !== 'USD' || h.quantity <= 0) continue;
    const cur = bySymbol.get(h.symbol) ?? { name: h.name, qty: 0, costUsd: 0, lastPrice: h.lastPrice };
    cur.qty += h.quantity;
    cur.costUsd += h.purchaseAmount;
    bySymbol.set(h.symbol, cur);
  }
  const basis = usdCostBasis(trades, rateFor);
  const rows: FxEffectRow[] = [];
  const unknown: string[] = [];
  for (const [symbol, h] of bySymbol) {
    const b = basis.get(symbol);
    if (!b || b.missingRate || b.costUsd <= 0 || Math.abs(b.qty - h.qty) > h.qty * 0.01) {
      unknown.push(symbol);
      continue;
    }
    const purchaseFx = b.costKrw / b.costUsd;
    const valueUsd = h.qty * h.lastPrice;
    const priceEffectKrw = (valueUsd - h.costUsd) * currentFx;
    const fxEffectKrw = h.costUsd * (currentFx - purchaseFx);
    rows.push({
      symbol, name: h.name, costUsd: h.costUsd, valueUsd, purchaseFx,
      priceEffectKrw: Math.round(priceEffectKrw), fxEffectKrw: Math.round(fxEffectKrw), totalKrw: Math.round(priceEffectKrw + fxEffectKrw),
    });
  }
  rows.sort((a, b) => Math.abs(b.totalKrw) - Math.abs(a.totalKrw));
  return { rows, unknown };
}

// ---- 2) ETF 포함 실질 보유 비중 ----------------------------------------------------------------------------------------------
// 보유 국내 ETF의 구성 종목(상위 30, 비중 %)으로 ETF 평가금액을 나눠 같은 종목의 직접 보유와 합친다. 상위 30 밖·현금 등은 "ETF 기타"로.

export interface LookThroughRow {
  symbol: string;
  name: string;
  directKrw: number;
  viaEtfKrw: number;
  totalKrw: number;
  pct: number;
  /** 이 종목을 담은 보유 ETF(코드). */
  etfs: string[];
}

export function lookThrough(
  holdingsKrw: Array<{ symbol: string; name: string; valueKrw: number }>,
  etfs: Record<string, Array<{ symbol: string; name: string; weight: number }>>
): { rows: LookThroughRow[]; etfOtherKrw: number; totalKrw: number } {
  const map = new Map<string, LookThroughRow>();
  const row = (symbol: string, name: string) => {
    const r = map.get(symbol) ?? { symbol, name, directKrw: 0, viaEtfKrw: 0, totalKrw: 0, pct: 0, etfs: [] };
    map.set(symbol, r);
    return r;
  };
  let etfOtherKrw = 0;
  let totalKrw = 0;
  for (const h of holdingsKrw) {
    totalKrw += h.valueKrw;
    const comps = etfs[h.symbol];
    if (!comps?.length) {
      row(h.symbol, h.name).directKrw += h.valueKrw;
      continue;
    }
    const sum = comps.reduce((s, c) => s + c.weight, 0);
    const scale = sum > 100 ? 100 / sum : 1; // 합이 100을 넘으면(레버리지·선물 등) 비례로 줄인다
    for (const c of comps) {
      const r = row(c.symbol, c.name);
      r.viaEtfKrw += (h.valueKrw * c.weight * scale) / 100;
      if (!r.etfs.includes(h.symbol)) r.etfs.push(h.symbol);
    }
    etfOtherKrw += h.valueKrw * Math.max(0, 1 - (sum * scale) / 100);
  }
  const rows = [...map.values()]
    .map((r) => ({ ...r, directKrw: Math.round(r.directKrw), viaEtfKrw: Math.round(r.viaEtfKrw), totalKrw: Math.round(r.directKrw + r.viaEtfKrw) }))
    .map((r) => ({ ...r, pct: totalKrw > 0 ? (r.totalKrw / totalKrw) * 100 : 0 }))
    .sort((a, b) => b.totalKrw - a.totalKrw);
  return { rows, etfOtherKrw: Math.round(etfOtherKrw), totalKrw: Math.round(totalKrw) };
}

// ---- 3) 종목별 배당수익률 ----------------------------------------------------------------------------------------------------
// 최근 12개월 받은 배당(세전 = 기록 금액 + 세금)을 매입금액(YOC, 내 원가 기준)과 평가금액(지금 시가 기준)으로 나눈다. 그 전 12개월과 비교해
// 증가율. 모든 계좌 합산, 지금 보유 중인 종목만. 달러는 지급 달 평균 환율·현재 환율.

export interface DividendYieldRow {
  symbol: string;
  name: string;
  trailingKrw: number;
  priorKrw: number;
  costKrw: number;
  valueKrw: number;
  yoc: number | null;
  currentYield: number | null;
  growth: number | null;
}

const shiftYmd = (today: string, months: number) => {
  const idx = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + months;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}${today.slice(7)}`;
};

export function dividendYields(
  holdingsKrw: Array<{ symbol: string; name: string; costKrw: number; valueKrw: number }>,
  dividends: DividendRecord[],
  rateFor: (month: string) => number | null,
  today: string
): DividendYieldRow[] {
  const yearAgo = shiftYmd(today, -12);
  const twoYearsAgo = shiftYmd(today, -24);
  const held = new Map<string, { name: string; costKrw: number; valueKrw: number }>();
  for (const h of holdingsKrw) {
    const cur = held.get(h.symbol) ?? { name: h.name, costKrw: 0, valueKrw: 0 };
    cur.costKrw += h.costKrw;
    cur.valueKrw += h.valueKrw;
    held.set(h.symbol, cur);
  }
  const trailing = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const d of dividends) {
    if (!held.has(d.symbol) || d.paidDate > today || d.paidDate <= twoYearsAgo) continue;
    const rate = d.currency === 'USD' ? rateFor(d.paidDate.slice(0, 7)) : 1;
    if (!rate) continue;
    const gross = (d.amount + (d.tax ?? 0)) * rate;
    const bucket = d.paidDate > yearAgo ? trailing : prior;
    bucket.set(d.symbol, (bucket.get(d.symbol) ?? 0) + gross);
  }
  return [...held.entries()]
    .filter(([s]) => trailing.has(s) || prior.has(s))
    .map(([symbol, h]) => {
      const t = Math.round(trailing.get(symbol) ?? 0);
      const p = Math.round(prior.get(symbol) ?? 0);
      return {
        symbol, name: h.name, trailingKrw: t, priorKrw: p, costKrw: Math.round(h.costKrw), valueKrw: Math.round(h.valueKrw),
        yoc: h.costKrw > 0 ? (t / h.costKrw) * 100 : null,
        currentYield: h.valueKrw > 0 ? (t / h.valueKrw) * 100 : null,
        growth: p > 0 ? ((t - p) / p) * 100 : null,
      };
    })
    .sort((a, b) => b.trailingKrw - a.trailingKrw);
}
