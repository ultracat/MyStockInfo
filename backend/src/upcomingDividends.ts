import {
  fetchKisDividendSchedule,
  fetchKisPeriodRights,
  getKisAccountId,
  isKisConfigured,
} from './brokers/kis/kisClient';
import { listHoldings } from './db/holdingsStore';
import { withCache } from './brokers/responseCache';
import { todayKst } from './marketInsights';
import type { BrokerId } from './brokers/types';

// 다가오는 배당 — 한국투자증권 API로 만든다(토스는 지급 예정 정보를 주지 않는다). 세 종류:
// 1) **확정(KIS 계좌)**: 기간별계좌권리현황(`CTRGA011R`)의 현금지급일이 오늘 이후인 건 — 금액·세금이 정확하다.
// 2) **예상(국내)**: 모든 증권사의 국내 보유 종목 × 예탁원 배당일정(`HHKDB669102C0`, 시장 전체)의 주당 배당금(세전).
//    KIS 계좌에 이미 확정 건이 있는 종목은 그 계좌에 대해서는 예상을 만들지 않는다.
// 해외 배당 예상은 만들지 않는다 — 해외 기간별권리(`CTRGT011R`)는 종목을 지정하면 자료가 없다고 하고(AAPL 등,
// 2026-11-09 실측), 종목 없이 받으면 배당이 기준일 무렵에야 등록돼 앞으로 90일 일정이 거의 없다(1건). 지급일 필드도 없다.
// 보유 수량은 로컬 보유종목 저장소(토스·KIS는 실시간 조회 때 write-through, CSV 증권사는 가져온 값) 기준이다.

export interface UpcomingDividend {
  status: 'confirmed' | 'estimated';
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  /** 지급일(알면 — 예탁원 일정은 미정이면 빈 값). */
  payDate: string | null;
  /** 기준일(배당 받을 권리가 정해지는 날). */
  recordDate: string | null;
  quantity: number;
  perShare: number | null;
  /** 세전 금액. */
  grossAmount: number;
  /** 확정 건만 — 원천징수 세금. */
  tax: number | null;
  source: 'kis-account' | 'ksd-schedule';
}

function ymd(s: string): string | null {
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}

export async function getUpcomingDividends(): Promise<{ items: UpcomingDividend[]; available: boolean }> {
  if (!isKisConfigured()) return { items: [], available: false };
  return withCache('upcoming-dividends', 6 * 3600_000, async () => ({ items: await build(), available: true }));
}

async function build(): Promise<UpcomingDividend[]> {
  const today = todayKst();
  const until = addDays(today, 120);
  const items: UpcomingDividend[] = [];
  const kisAccountId = getKisAccountId();

  // 1) 확정 — KIS 계좌
  const rights = await fetchKisPeriodRights(addDays(today, -60), '2099-12-31').catch(() => []);
  const confirmedSymbols = new Set<string>();
  for (const r of rights) {
    const pay = ymd(r.cash_dfrm_dt);
    const gross = Number(r.last_alct_amt);
    if (!pay || pay <= today || !Number.isFinite(gross) || gross <= 0) continue;
    const tax = Number(r.tax_amt);
    const symbol = (r.shtn_pdno || r.pdno).trim();
    confirmedSymbols.add(symbol);
    items.push({
      status: 'confirmed', broker: 'kis', accountId: kisAccountId, symbol, name: r.prdt_name.trim(), currency: 'KRW',
      payDate: pay, recordDate: ymd(r.bass_dt), quantity: 0, perShare: null, grossAmount: gross,
      tax: Number.isFinite(tax) ? tax : null, source: 'kis-account',
    });
  }

  const holdings = listHoldings().filter((h) => h.quantity > 0);

  // 2) 예상 — 국내(예탁원 배당일정, 시장 전체 한 번 호출)
  const schedule = await fetchKisDividendSchedule(today, until).catch(() => []);
  const bySymbol = new Map<string, typeof schedule>();
  for (const s of schedule) {
    if (!(Number(s.per_sto_divi_amt) > 0)) continue;
    bySymbol.set(s.sht_cd, [...(bySymbol.get(s.sht_cd) ?? []), s]);
  }
  for (const h of holdings) {
    if (h.currency === 'USD') continue;
    const rows = bySymbol.get(h.symbol);
    if (!rows) continue;
    if (h.broker === 'kis' && h.accountId === kisAccountId && confirmedSymbols.has(h.symbol)) continue;
    for (const s of rows) {
      const per = Number(s.per_sto_divi_amt);
      items.push({
        status: 'estimated', broker: h.broker, accountId: h.accountId, symbol: h.symbol, name: h.name, currency: 'KRW',
        payDate: ymd(s.divi_pay_dt), recordDate: ymd(s.record_date), quantity: h.quantity, perShare: per,
        grossAmount: Math.round(per * h.quantity), tax: null, source: 'ksd-schedule',
      });
    }
  }

  const key = (i: UpcomingDividend) => i.payDate ?? i.recordDate ?? '9999';
  return items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
