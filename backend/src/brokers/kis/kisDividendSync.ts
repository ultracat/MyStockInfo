import { fetchKisPeriodRights, getKisAccountId, type KisPeriodRight } from './kisClient';
import { replaceSyncedDividends, type NewDividendInput } from '../../db/dividends';
import type { DividendSyncKind, DividendSyncResult } from '../dividendSyncTypes';

// 한국투자증권 배당 동기화 — 기간별계좌권리현황조회(`CTRGA011R`)로 계좌의 국내 배당·ETF 분배금을 받아
// **API 우선으로 로컬에 덮어쓴다**(토스와 같은 원칙, tossDividendSync.ts 참고). 해외 배당을 계좌 기준으로
// 주는 KIS API는 없다(2026-11-09 조사) — 이 앱의 KIS 연동이 원래 국내 계좌 전용이기도 하다.
//
// 2026-11-09 사용자 기록 68건과 대조한 결과(66건 정확히 일치, 나머지 2건은 입력 실수):
// - `last_alct_amt`는 **세전**, `tax_amt`가 원천징수 세금 → 저장 금액(세후) = 세전 − 세금.
//   (사용자는 KIS 배당을 세전으로 적어 왔다 — 세금이 있는 15건이 전부 세전과 일치.)
// - 날짜는 `cash_dfrm_dt`(현금지급일). **지급일이 오늘 이후인 건은 지급 예정이라 넣지 않는다.**
// - `rght_type_cd` 실측값: `03` 주식 배당, `32` ETF 분배금. 다른 권리(유상증자 등)는 배정금액이 0이라 걸러진다.

export interface KisDividendCandidate {
  symbol: string;
  name: string;
  /** 세후(실수령). */
  amount: number;
  tax: number;
  paidDate: string;
  kind: DividendSyncKind;
}

function ymd(s: string): string {
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '';
}

/** 권리 내역 → 배당 후보. `today`(KST, YYYY-MM-DD) 이후 지급 예정 건과 현금 배정이 없는 권리는 뺀다. */
export function classifyKisRights(rows: KisPeriodRight[], today: string): { candidates: KisDividendCandidate[]; upcoming: number } {
  const candidates: KisDividendCandidate[] = [];
  let upcoming = 0;
  for (const r of rows) {
    const gross = Number(r.last_alct_amt);
    const paidDate = ymd(r.cash_dfrm_dt);
    if (!Number.isFinite(gross) || gross <= 0 || !paidDate) continue;
    if (paidDate > today) { upcoming++; continue; }
    const taxRaw = Number(r.tax_amt);
    const tax = Number.isFinite(taxRaw) && taxRaw > 0 ? taxRaw : 0;
    candidates.push({
      symbol: (r.shtn_pdno || r.pdno).trim(),
      name: (r.prdt_name || '').trim(),
      amount: gross - tax,
      tax,
      paidDate,
      kind: r.rght_type_cd === '32' ? 'etfDistribution' : 'dividend',
    });
  }
  return { candidates, upcoming };
}

function todayKst(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}

let inFlight: Promise<DividendSyncResult> | null = null;

export function syncKisDividends(): Promise<DividendSyncResult> {
  if (!inFlight) inFlight = runSync().finally(() => { inFlight = null; });
  return inFlight;
}

async function runSync(): Promise<DividendSyncResult> {
  const accountId = getKisAccountId();
  const rows = await fetchKisPeriodRights();
  const { candidates, upcoming } = classifyKisRights(rows, todayKst());

  const inputs: NewDividendInput[] = candidates.map((c) => ({
    broker: 'kis',
    accountId,
    symbol: c.symbol,
    name: c.name || c.symbol,
    currency: 'KRW',
    amount: c.amount,
    tax: c.tax,
    paidDate: c.paidDate,
    memo: null,
  }));
  // 이 앱의 KIS 연동은 계좌 하나(자격증명의 CANO+상품코드)다. 계좌 칸이 빈 KIS 기록도 그 계좌 것으로 본다.
  const r = replaceSyncedDividends('kis', (id) => id === null || id === accountId, inputs);
  const byKind: Record<DividendSyncKind, number> = { dividend: 0, etfDistribution: 0, taxRefund: 0 };
  for (const c of candidates) byKind[c.kind]++;
  return { broker: 'kis', ...r, total: inputs.length, byKind, skipped: upcoming };
}
