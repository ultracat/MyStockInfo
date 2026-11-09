import type { HoldingPosition, TradeRecord } from '../types';
import type { CashFlowSummary, CashFlowYear } from '../toss/tossCashFlows';

// 키움 응답 → 앱 공통 모양. 순수 함수라 테스트(backend/test/kiwoomMappers.test.ts)가 공식 명세의 응답 예시로 직접 부른다.
// ⚠ 실키 미검증 — 필드 뜻은 kiwoom_api_spec.json 그대로, "⚠ 가정"으로 표시한 곳은 명세에 없는 해석이다.

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

/** "000000017598258"·"-00000000196888"·"+61.28"·"56,900"·"0.00"·숫자 모두 읽는다. 못 읽으면 0. */
export function kwNum(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const s = str(value).replace(/[,\s]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** 국내 종목코드 — 명세: "접두어 1자리 + 종목코드 6자리(A 주식 / J ELW / Q ETN)". 6자리로 맞춘다. */
export function kwSymbol(v: unknown): string {
  const s = str(v).toUpperCase();
  return /^[AJQ][0-9A-Z]{6}$/.test(s) ? s.slice(1) : s;
}

export function kwYmd(v: unknown): string {
  const s = str(v);
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

/** 계좌평가잔고(kt00018) 종목 → 보유. **같은 종목이 여러 줄**(현금·신용 잔고 등 — 공식 예시에도 삼성전자 두 줄)로 올 수
 *  있어 종목별로 합친다. 가격 필드는 부호(전일 대비 방향)가 붙어 올 수 있어 절댓값으로 쓴다. */
export function mapKiwoomDomesticPositions(items: Record<string, unknown>[]): HoldingPosition[] {
  const bySymbol = new Map<string, HoldingPosition>();
  for (const r of items) {
    const symbol = kwSymbol(r.stk_cd);
    const quantity = kwNum(r.rmnd_qty);
    if (!symbol || quantity <= 0) continue;
    const prev = bySymbol.get(symbol);
    const purchase = kwNum(r.pur_amt);
    const value = kwNum(r.evlt_amt);
    const pl = kwNum(r.evltv_prft);
    const fee = kwNum(r.sum_cmsn);
    const tax = kwNum(r.tax);
    const merged: HoldingPosition = prev
      ? {
          ...prev,
          quantity: prev.quantity + quantity,
          purchaseAmount: prev.purchaseAmount + purchase,
          marketValue: prev.marketValue + value,
          profitLossAmount: prev.profitLossAmount + pl,
          commission: (prev.commission ?? 0) + fee,
          tax: (prev.tax ?? 0) + tax,
        }
      : {
          symbol,
          name: str(r.stk_nm) || symbol,
          market: 'KR',
          currency: 'KRW',
          quantity,
          lastPrice: Math.abs(kwNum(r.cur_prc)),
          averagePurchasePrice: 0,
          purchaseAmount: purchase,
          marketValue: value,
          profitLossAmount: pl,
          profitLossRate: 0,
          commission: fee,
          tax,
        };
    merged.averagePurchasePrice = merged.quantity > 0 ? merged.purchaseAmount / merged.quantity : 0;
    merged.profitLossRate = merged.purchaseAmount > 0 ? merged.profitLossAmount / merged.purchaseAmount : 0;
    bySymbol.set(symbol, merged);
  }
  return [...bySymbol.values()];
}

/** 미국주식 원장잔고(ust21070) `result_list` → 보유(USD만). 수익률 `pl_rt`는 퍼센트. */
export function mapKiwoomUsPositions(items: Record<string, unknown>[]): HoldingPosition[] {
  const out: HoldingPosition[] = [];
  for (const r of items) {
    const quantity = kwNum(r.poss_qty) || kwNum(r.qty);
    const symbol = str(r.stk_cd).toUpperCase();
    const cur = str(r.crnc_code).toUpperCase() || 'USD';
    if (!symbol || quantity <= 0 || cur !== 'USD') continue;
    out.push({
      symbol,
      name: str(r.frgn_stk_nm) || symbol,
      market: 'US',
      currency: 'USD',
      quantity,
      lastPrice: kwNum(r.now_pric),
      averagePurchasePrice: kwNum(r.frgn_stk_book_uv),
      purchaseAmount: kwNum(r.frgn_stk_book_amt),
      marketValue: kwNum(r.evlt_amt),
      profitLossAmount: kwNum(r.pl_amt),
      profitLossRate: kwNum(r.pl_rt) / 100,
      commission: null,
      tax: null,
    });
  }
  return out;
}

/** 위탁종합거래내역(kt00015) 매수(tp 4)·매도(tp 5) → 체결. 방향은 요청 코드로 정해져 적요를 해석하지 않는다.
 *  id는 거래일 + 거래번호(`trde_no`, 9자리). 원화 줄은 국내, USD 줄은 미국 주식으로 본다(그 밖의 통화는 뺀다).
 *  ⚠ 가정: 해외 줄의 단가는 `trde_unit`("거래단가/환율" — 무엇이 오는지 불분명)을 쓰지 않고 외화 거래금액 ÷ 수량으로 구한다. */
export function mapKiwoomTrades(rows: Record<string, unknown>[], side: 'BUY' | 'SELL'): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const r of rows) {
    const date = kwYmd(r.trde_dt);
    const quantity = kwNum(r.trde_qty_jwa_cnt);
    const cur = str(r.crnc_cd).toUpperCase() || 'KRW';
    const rawSymbol = str(r.stk_cd);
    if (!date || quantity <= 0 || !rawSymbol || /취소|정정/.test(str(r.rmrk_nm))) continue;
    if (cur === 'KRW') {
      const fee = kwNum(r.cmsn);
      const tax = kwNum(r.trde_agri_tax);
      out.push({
        id: `kw-${str(r.trde_dt)}-${str(r.trde_no)}`,
        symbol: kwSymbol(rawSymbol),
        name: str(r.stk_nm) || null,
        side,
        quantity,
        price: kwNum(r.trde_unit),
        amount: kwNum(r.trde_amt),
        currency: 'KRW',
        commission: fee > 0 ? fee : null,
        tax: tax > 0 ? tax : null,
        executedAt: date,
      });
    } else if (cur === 'USD') {
      const amount = kwNum(r.fc_trde_amt);
      const fee = kwNum(r.fc_cmsn);
      const tax = kwNum(r.fc_trde_tax);
      out.push({
        id: `kw-${str(r.trde_dt)}-${str(r.trde_no)}`,
        symbol: kwSymbol(rawSymbol),
        name: str(r.stk_nm) || null,
        side,
        quantity,
        price: amount / quantity,
        amount,
        currency: 'USD',
        commission: fee > 0 ? fee : null,
        tax: tax > 0 ? tax : null,
        executedAt: date,
      });
    }
  }
  return out;
}

export interface KiwoomDividendCandidate {
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  /** 세후(실수령). */
  amount: number;
  tax: number;
  paidDate: string;
  kind: 'dividend' | 'etfDistribution';
}

/** 위탁종합거래내역 입금(tp 6) 중 배당·분배 적요(`rmrk_nm`) → 배당. 종목이 없는 줄·취소·정정은 뺀다.
 *  ⚠ 가정(적요 값 목록이 명세에 없음):
 *  - 원화: `exct_amt`(정산금액)가 계좌에 들어온 세후 금액, `incm_resi_tax`(소득/주민세)가 원천징수 세금.
 *    정산금액이 0이면 거래금액 − 세금.
 *  - 달러: `fc_exct_amt`(정산금액(외))가 세후, `frgn_pay_txam`(외국납부세액(외))이 현지 세금. 없으면 `fc_trde_amt`. */
export function classifyKiwoomDividends(rows: Record<string, unknown>[]): KiwoomDividendCandidate[] {
  const out: KiwoomDividendCandidate[] = [];
  for (const r of rows) {
    const summary = str(r.rmrk_nm);
    if (/취소|정정|출금/.test(summary)) continue;
    const kind = summary.includes('분배') ? 'etfDistribution' : summary.includes('배당') ? 'dividend' : null;
    const rawSymbol = str(r.stk_cd);
    const paidDate = kwYmd(r.trde_dt);
    if (!kind || !rawSymbol || !paidDate) continue;
    const cur = str(r.crnc_cd).toUpperCase() || 'KRW';
    if (cur === 'KRW') {
      const tax = Math.abs(kwNum(r.incm_resi_tax));
      const amount = Math.abs(kwNum(r.exct_amt)) || Math.abs(kwNum(r.trde_amt)) - tax;
      if (amount > 0) out.push({ symbol: kwSymbol(rawSymbol), name: str(r.stk_nm) || kwSymbol(rawSymbol), currency: 'KRW', amount, tax, paidDate, kind });
    } else if (cur === 'USD') {
      const tax = Math.abs(kwNum(r.frgn_pay_txam));
      const amount = Math.abs(kwNum(r.fc_exct_amt)) || Math.abs(kwNum(r.fc_trde_amt)) - tax;
      if (amount > 0) out.push({ symbol: kwSymbol(rawSymbol), name: str(r.stk_nm) || rawSymbol, currency: 'USD', amount, tax, paidDate, kind });
    }
  }
  return out;
}

const NOT_PRINCIPAL = /배당|분배|이자|이용료|환급|세금|세액|수수료|취소|정정|환전/;

/** 입출금 줄 하나의 방향 — 입출구분명(`io_tp_nm`)·적요에 "입금"/"출금". 배당·이자·세금·환전 등은 원금이 아니다(null). */
export function kiwoomFlowDirection(r: Record<string, unknown>): 'in' | 'out' | null {
  const io = str(r.io_tp_nm);
  const summary = str(r.rmrk_nm);
  if (NOT_PRINCIPAL.test(summary) || NOT_PRINCIPAL.test(io)) return null;
  for (const s of [io, summary]) {
    const inn = s.includes('입금');
    const out = s.includes('출금');
    if (inn !== out) return inn ? 'in' : 'out';
  }
  return null;
}

/** 입출금(tp 1) → 원금 요약(토스·NH와 같은 모양). 원화 줄만(달러 입출금은 환전으로 들어오는 게 보통이라 원금에서 뺀다).
 *  타사 입고 건수는 입출고(tp 2)의 "입고" 적요. ⚠ 가정: 금액은 거래금액(`trde_amt`), 없으면 정산금액. */
export function summarizeKiwoomCashFlows(rows: Record<string, unknown>[], transferRows: Record<string, unknown>[] = []): CashFlowSummary {
  const years = new Map<string, CashFlowYear>();
  const s: CashFlowSummary = {
    firstDate: null, depositKrw: 0, withdrawalKrw: 0, depositUsd: 0, withdrawalUsd: 0,
    netPrincipalKrw: 0, byYear: [], transferIn: 0, transferOut: 0,
  };
  for (const r of rows) {
    const cur = str(r.crnc_cd).toUpperCase() || 'KRW';
    const dir = kiwoomFlowDirection(r);
    const date = kwYmd(r.trde_dt);
    const amount = Math.abs(kwNum(r.trde_amt)) || Math.abs(kwNum(r.exct_amt));
    if (cur !== 'KRW' || !dir || !date || amount <= 0) continue;
    const y = date.slice(0, 4);
    const yr = years.get(y) ?? { year: y, depositKrw: 0, withdrawalKrw: 0, depositUsd: 0, withdrawalUsd: 0 };
    if (dir === 'in') {
      s.depositKrw += amount;
      yr.depositKrw += amount;
    } else {
      s.withdrawalKrw += amount;
      yr.withdrawalKrw += amount;
    }
    years.set(y, yr);
    if (!s.firstDate || date < s.firstDate) s.firstDate = date;
  }
  for (const r of transferRows) {
    const summary = str(r.rmrk_nm) + str(r.io_tp_nm);
    if (!str(r.stk_cd) || /취소|정정/.test(summary)) continue;
    if (summary.includes('입고')) s.transferIn++;
    else if (summary.includes('출고')) s.transferOut++;
  }
  s.netPrincipalKrw = s.depositKrw - s.withdrawalKrw;
  s.byYear = [...years.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
  return s;
}

/** 공식 실현손익 → 비교 카드 행(KIS와 같은 모양). 국내 ka10073: `tdy_sel_pl`은 수수료·세금 차감 후
 *  (공식 예시: 158200 − 97602.96 − 500 − 284 = 59813.04). */
export function mapKiwoomDomesticRealized(rows: Record<string, unknown>[]) {
  return rows
    .filter((r) => kwNum(r.cntr_qty) > 0)
    .map((r) => {
      const qty = kwNum(r.cntr_qty);
      return {
        date: kwYmd(r.dt),
        symbol: kwSymbol(r.stk_cd),
        name: str(r.stk_nm) || kwSymbol(r.stk_cd),
        quantity: qty,
        sellAmount: Math.abs(kwNum(r.cntr_pric)) * qty,
        buyAmount: kwNum(r.buy_uv) * qty,
        realized: kwNum(r.tdy_sel_pl),
        fee: kwNum(r.tdy_trde_cmsn),
        tax: kwNum(r.tdy_trde_tax),
      };
    });
}

/** 미국 ust21530(원화 기준 요청) → 비교 카드 행. `pl_amt`는 수수료·제세금 차감 손익으로 본다(⚠ 가정). */
export function mapKiwoomUsRealized(rows: Record<string, unknown>[]) {
  return rows
    .filter((r) => kwNum(r.sell_qty) > 0)
    .map((r) => ({
      date: kwYmd(r.sell_dt),
      symbol: str(r.stk_cd).toUpperCase(),
      name: str(r.frgn_stk_nm) || str(r.stk_cd),
      quantity: kwNum(r.sell_qty),
      sellAmount: kwNum(r.sell_amt),
      buyAmount: kwNum(r.buy_amt),
      realized: kwNum(r.pl_amt),
      fee: kwNum(r.cmsn_tax),
      tax: 0,
    }));
}
