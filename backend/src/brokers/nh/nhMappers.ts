import type { HoldingPosition, TradeRecord } from '../types';

// NH 응답 → 앱 공통 모양. 네트워크·자격증명과 무관한 순수 함수라 테스트(backend/test/nhMappers.test.ts)가 직접 부른다.
// 필드 뜻은 www.nhplug.com/openapi-docs/{krstock,gbstock,common}/openapi.json 명세 그대로다.

/** 명세 타입은 number지만 문자열(앞자리 0·쉼표·부호 포함)로 와도 읽는다. 못 읽으면 0. */
export function nhNum(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const s = value.replace(/[,\s]/g, '');
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

export function nhYmd(v: unknown): string {
  const s = str(v);
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

/** 국내 종목코드 — HTS 계열은 `A005930`처럼 접두어를 붙여 주기도 해서 떼어 낸다(6자리 코드만). */
export function nhDomesticSymbol(v: unknown): string {
  const s = str(v).toUpperCase();
  return /^A[0-9A-Z]{6}$/.test(s) ? s.slice(1) : s;
}

/** 국내 잔고 `Output_1` 한 줄. 수익률 `pft_rt`는 퍼센트 숫자라 100으로 나눈다(앱 관례: 소수 비율).
 *  매입금액 필드가 따로 없어 평가금액 − 평가손익으로 구한다(증권사가 계산한 두 값의 차라 수수료 처리도 증권사 기준). */
export function mapNhDomesticPosition(r: Record<string, unknown>): HoldingPosition {
  const quantity = nhNum(r.itg_bnc_qty);
  const marketValue = nhNum(r.eal_amt);
  const profitLossAmount = nhNum(r.eal_pls_amt);
  return {
    symbol: nhDomesticSymbol(r.iem_cd),
    name: str(r.iem_nm) || nhDomesticSymbol(r.iem_cd),
    market: 'KR',
    currency: 'KRW',
    quantity,
    lastPrice: nhNum(r.now_pr),
    averagePurchasePrice: nhNum(r.phs_pr),
    purchaseAmount: marketValue - profitLossAmount,
    marketValue,
    profitLossAmount,
    profitLossRate: nhNum(r.pft_rt) / 100,
    commission: null,
    tax: null,
  };
}

/** 해외 잔고 `Output_1` 한 줄(미국·USD). 외화(`fc_*`) 필드만 쓴다 — 원화 환산은 앱이 환율로 따로 한다. */
export function mapNhOverseasPosition(r: Record<string, unknown>): HoldingPosition {
  const avg = nhNum(r.fc_avg_phs_pr) || nhNum(r.fc_phs_uit_pr);
  return {
    symbol: str(r.iem_cd).toUpperCase(),
    name: str(r.iem_nm) || str(r.iem_cd),
    market: 'US',
    currency: 'USD',
    quantity: nhNum(r.cns_bse_bnc_qty),
    lastPrice: nhNum(r.fc_sec_end_pr),
    averagePurchasePrice: avg,
    purchaseAmount: nhNum(r.fc_abk_amt),
    marketValue: nhNum(r.fc_eal_amt),
    profitLossAmount: nhNum(r.fc_eal_pls_amt),
    profitLossRate: nhNum(r.eal_pft_rt) / 100,
    commission: null,
    tax: null,
  };
}

/** 종합거래내역 적요(`sps_cd_krl_anm`)로 매수/매도를 가른다.
 *  ⚠ 가정: 명세에 적요 값 목록이 없다 — "장내매수"·"코스닥매도"처럼 매수/매도 낱말이 들어간다고 본다. 둘 다 없거나
 *  둘 다 있으면(예: "매수매도정정") 버린다. 입고/출고·대체는 매매가 아니라 0건. */
export function nhTradeSide(summary: unknown): 'BUY' | 'SELL' | null {
  const s = str(summary);
  const buy = s.includes('매수');
  const sell = s.includes('매도');
  if (buy === sell) return null;
  return buy ? 'BUY' : 'SELL';
}

/** 국내 매매(종합거래내역 `act_trd_dtl_cd=03`) → 체결 기록. 체결 번호가 없어 id는 (거래일, 종목, 방향, 그날 순번)으로
 *  만든다 — 같은 기간을 다시 받아도 API가 같은 순서(거래일자순)로 주는 한 같은 id가 나온다(매매내역 저장소는 id로 upsert). */
export function mapNhDomesticTrades(rows: Record<string, unknown>[]): TradeRecord[] {
  const seq = new Map<string, number>();
  const out: TradeRecord[] = [];
  for (const r of rows) {
    const side = nhTradeSide(r.sps_cd_krl_anm);
    const symbol = nhDomesticSymbol(r.iem_cd);
    const quantity = nhNum(r.trd_qty);
    const date = nhYmd(r.trd_dt);
    if (!side || !symbol || quantity <= 0 || !date) continue;
    const cur = str(r.cur_cd).toUpperCase() || 'KRW';
    if (cur !== 'KRW') continue; // 해외 주식 매매는 해외 일별거래내역에서 따로 받는다
    const key = `${date}-${symbol}-${side}`;
    const n = (seq.get(key) ?? 0) + 1;
    seq.set(key, n);
    const fee = nhNum(r.trd_orn_fee);
    const tax = nhNum(r.tax_sum);
    out.push({
      id: `nh-${key}-${n}`,
      symbol,
      name: str(r.iem_nm) || null,
      side,
      quantity,
      price: nhNum(r.trd_uit_pr),
      amount: nhNum(r.trd_amt),
      currency: 'KRW',
      commission: fee > 0 ? fee : null,
      tax: tax > 0 ? tax : null,
      executedAt: date,
    });
  }
  return out;
}

/** 해외 매수/매도(일별거래내역 `act_trd_cfc_cd=05/06`) → 체결 기록. 방향은 요청 코드로 정해져 적요를 해석하지 않는다.
 *  달러가 아닌 통화(통화코드명에 USD/달러가 없음)는 뺀다. */
export function mapNhOverseasTrades(rows: Record<string, unknown>[], side: 'BUY' | 'SELL'): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const r of rows) {
    const symbol = (str(r.iem_cd) || str(r.oss_iem_cd)).toUpperCase();
    const quantity = nhNum(r.trd_qty);
    const date = nhYmd(r.trd_dt);
    const curName = str(r.cur_cd_nm);
    if (!symbol || quantity <= 0 || !date) continue;
    if (curName && !/USD|달러/i.test(curName)) continue;
    out.push({
      id: `nh-ovrs-${str(r.trd_dt)}-${str(r.trd_sno)}`,
      symbol,
      name: str(r.iem_krl_nm) || str(r.oss_iem_nm) || null,
      side,
      quantity,
      price: nhNum(r.trd_uit_pr),
      amount: nhNum(r.fc_trd_amt),
      currency: 'USD',
      commission: null,
      tax: null,
      executedAt: date,
    });
  }
  return out;
}
