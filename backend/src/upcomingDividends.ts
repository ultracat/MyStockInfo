import {
  fetchKisBusinessDays,
  fetchKisDividendSchedule,
  fetchKisOverseasDividendRights,
  fetchKisOverseasIceRights,
  fetchKisPeriodRights,
  getKisAccountId,
  isKisConfigured,
} from './brokers/kis/kisClient';
import { listHoldings } from './db/holdingsStore';
import { withCache } from './brokers/responseCache';
import { todayKst } from './marketInsights';
import type { BrokerId } from './brokers/types';
import type { KisOverseasIceRight, KisOverseasPeriodRight } from './brokers/kis/kisClient';

// 다가오는 배당 — 한국투자증권 API로 만든다(토스는 지급 예정 정보를 주지 않는다). 네 종류:
// 확정은 앞으로 120일, 예상·추정은 **이번 달 지급분까지만** 보여 준다(사용자 결정 — 줄이 너무 많아서).
// 1) **확정(KIS 계좌)**: 기간별계좌권리현황(`CTRGA011R`)의 현금지급일이 오늘 이후인 건 — 금액·세금이 정확하다.
// 2) **예상(국내)**: 모든 증권사의 국내 보유 종목 × 예탁원 배당일정(`HHKDB669102C0`)의 주당 배당금(세전).
//    **보유 종목마다 종목코드로** 지난 400일~앞으로 120일을 조회한다 — 시장 전체 조회는 앞으로의 일정이 기준일 직전에야
//    등록돼 듬성듬성했다(2026-11-10 실측: 120일 57건, 그중 27건 금액 미정, 매달 분배 ETF는 기준일 3일 전에도 없음).
//    조회 기간은 기준일 기준이라, 기준일은 지났고 지급만 남은 건은 지급일(> 오늘)로 거른다.
// 3) **추정(지난 일정)**: 예탁원에 아직 없는 다음 배당을 지난 일정으로 만든다 — 기준일 간격이 매달·분기·반기·연 단위로
//    일정하면 마지막 기준일에 그 주기를 더하고, 주당 금액은 **최근 12회의 중간값**(사용자 결정 — 가끔 두 배로 나오는
//    달이 있어 최근 1회는 튄다). 예탁원에 일정은 있는데 금액이 미정(0)인 건도 같은 중간값으로 추정한다.
//    **휴일 반영**(국내휴장일조회 `CTCA0903R`, 하루 1회 저장): 기준일은 그 종목의 "매달 며칠"(지난 기준일의 일자 중간값,
//    전부 말일 무렵이면 말일)이 휴일이면 **직전 영업일**(실측: 15일이 토요일이면 14일), 지급일은 기준일에서 지난 일정의
//    **영업일 간격 중간값**만큼 뒤(실측: 매달 분배 ETF는 2영업일 — 설 연휴엔 달력상 7일). 휴장일 정보가 없는 날짜(과거·
//    조회 실패)는 주말만 쉬는 날로 본다.
//    KIS 계좌에 이미 확정 건이 있는 종목·달은 그 계좌에 대해서는 예상·추정을 만들지 않는다.
// 4) **해외(미국, 달러)**: 모든 증권사의 USD 보유 종목마다 두 TR을 합친다(2026-11-16 실측).
//    - 날짜 = 해외주식 권리종합(`HHDFS78330900`, ICE) — 발표된 미래 배당의 기준일·지급일이 미리 들어온다. 금액은 없다.
//    - 주당 금액 = 해외 기간별권리(`CTRGT011R`) — **상품유형코드(512/513/529)를 같이 줘야** 종목별로 나온다(예전엔 PDNO만 줘서
//      "자료 없음"이었다). 배당이 기준일 무렵에야 등록돼, 발표만 된 건은 금액이 없다 → 최근 12회 중간값(추정).
//    - 둘을 예탁원 일정과 같은 모양으로 바꿔 `planSymbolDividends`에 넣는다(주기 추정까지 같은 규칙). 미국 휴장일은 모르므로
//      추정 날짜는 주말만 반영한다. 금액은 세전(미국 원천징수 15% 전).
// 보유 수량은 로컬 보유종목 저장소(토스·KIS는 실시간 조회 때 write-through, CSV 증권사는 가져온 값) 기준이다.

export interface UpcomingDividend {
  /** confirmed = KIS 계좌 확정, estimated = 예탁원 일정의 주당 금액, projected = 지난 일정으로 추정. */
  status: 'confirmed' | 'estimated' | 'projected';
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
  /** kis-overseas = ICE 일정 + 해외 기간별권리의 주당 금액(미국). */
  source: 'kis-account' | 'ksd-schedule' | 'kis-overseas' | 'history';
}

/** YYYYMMDD · YYYY/MM/DD · YYYY-MM-DD → YYYY-MM-DD. 예탁원 일정은 기준일이 YYYYMMDD, 지급일이 YYYY/MM/DD로 온다(실측). */
export function parseKsdDate(s: string | null | undefined): string | null {
  const m = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})$/.exec((s ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/** 그 달에 없는 날(31일 등)은 말일로. */
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** 날짜 → 영업일 여부(국내휴장일조회 결과). 없는 날짜는 주말만 쉬는 날로 본다. */
export type BusinessDays = Record<string, boolean>;

function isBusinessDay(date: string, cal: BusinessDays): boolean {
  if (date in cal) return cal[date];
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
}

function previousBusinessDay(date: string, cal: BusinessDays): string {
  let d = date;
  for (let i = 0; i < 15 && !isBusinessDay(d, cal); i++) d = addDays(d, -1);
  return d;
}

function addBusinessDays(date: string, n: number, cal: BusinessDays): string {
  let d = date;
  for (let c = 0, i = 0; c < n && i < n * 3 + 30; i++) {
    d = addDays(d, 1);
    if (isBusinessDay(d, cal)) c++;
  }
  return d;
}

/** a 다음 날부터 b까지의 영업일 수. */
function businessDaysBetween(a: string, b: string, cal: BusinessDays): number {
  let n = 0;
  for (let d = addDays(a, 1), i = 0; d <= b && i < 400; d = addDays(d, 1), i++) if (isBusinessDay(d, cal)) n++;
  return n;
}

function lastDayOfMonth(monthStart: string): string {
  return addDays(addMonths(monthStart, 1), -1);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 기준일 간격(일)의 중간값 → 주기(개월). 일정하지 않으면 null. */
function cadenceMonths(gapDays: number): number | null {
  if (gapDays >= 25 && gapDays <= 35) return 1;
  if (gapDays >= 80 && gapDays <= 100) return 3;
  if (gapDays >= 170 && gapDays <= 200) return 6;
  if (gapDays >= 350 && gapDays <= 380) return 12;
  return null;
}

export interface PlannedDividend {
  status: 'estimated' | 'projected';
  source: 'ksd-schedule' | 'history';
  recordDate: string;
  payDate: string | null;
  perShare: number;
}

/**
 * 한 종목의 예탁원 일정(지난 400일~앞으로)으로 `today` 뒤에 지급될 배당을 만든다 — 위 2)·3).
 * 지급 예정 판정: 지급일이 있으면 지급일 > 오늘, 없으면 기준일 ≥ 오늘. `until`(지급일, 없으면 기준일) 이후는 뺀다.
 */
export function planSymbolDividends(
  rows: Array<{ record_date: string; per_sto_divi_amt: string; divi_pay_dt: string }>,
  today: string,
  until: string,
  cal: BusinessDays = {}
): PlannedDividend[] {
  const byRecord = new Map<string, { recordDate: string; payDate: string | null; perShare: number }>();
  for (const r of rows) {
    const recordDate = parseKsdDate(r.record_date);
    if (!recordDate) continue;
    const per = Number(r.per_sto_divi_amt);
    const ev = { recordDate, payDate: parseKsdDate(r.divi_pay_dt), perShare: Number.isFinite(per) && per > 0 ? per : 0 };
    const prev = byRecord.get(recordDate);
    if (!prev || (!prev.perShare && ev.perShare)) byRecord.set(recordDate, ev); // 같은 기준일 중복은 금액 있는 쪽
  }
  const events = [...byRecord.values()].sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1));
  const known = events.filter((e) => e.perShare > 0);
  const medianPer = median(known.slice(-12).map((e) => e.perShare));
  const payGapRaw = median(events.filter((e) => e.payDate).map((e) => businessDaysBetween(e.recordDate, e.payDate!, cal)));
  const payGap = payGapRaw === null ? null : Math.round(payGapRaw);
  const upcoming = (recordDate: string, payDate: string | null) =>
    (payDate ? payDate > today : recordDate >= today) && (payDate ?? recordDate) <= until;

  const out: PlannedDividend[] = [];
  for (const e of events) {
    if (!upcoming(e.recordDate, e.payDate)) continue;
    if (e.perShare > 0) out.push({ status: 'estimated', source: 'ksd-schedule', ...e });
    else if (medianPer !== null) out.push({ status: 'projected', source: 'history', ...e, perShare: medianPer });
  }

  // 예탁원에 아직 없는 다음 배당 — 주기가 일정하고(매달·분기는 3회, 반기·연은 2회 이상) 최근까지 이어진 종목만.
  const step = medianPer !== null && known.length >= 2
    ? cadenceMonths(median(known.slice(1).map((e, i) => daysBetween(known[i].recordDate, e.recordDate)))!)
    : null;
  if (step !== null && (step >= 6 || known.length >= 3) && events.length) {
    const last = events[events.length - 1].recordDate; // 금액 미정 일정까지 포함한 마지막 기준일
    // "매달 며칠" — 휴일로 앞당겨진 날이 섞여도 중간값은 원래 일자. 최근 기준일이 전부 말일 3일 안이면 말일 기준.
    const recent = known.slice(-12).map((e) => e.recordDate);
    const monthEndAnchored = recent.every((d) => daysBetween(d, lastDayOfMonth(`${d.slice(0, 7)}-01`)) <= 3);
    const anchorDay = Math.round(median(recent.map((d) => Number(d.slice(8, 10))))!);
    if (last >= addMonths(today, -2 * step)) {
      for (let k = 1; k <= 24; k++) {
        const monthStart = addMonths(`${last.slice(0, 7)}-01`, k * step);
        const monthLast = lastDayOfMonth(monthStart);
        const nominal = monthEndAnchored ? monthLast : `${monthStart.slice(0, 8)}${String(Math.min(anchorDay, Number(monthLast.slice(8)))).padStart(2, '0')}`;
        const recordDate = previousBusinessDay(nominal, cal);
        if (recordDate > until) break;
        const payDate = payGap !== null ? addBusinessDays(recordDate, payGap, cal) : null;
        if (upcoming(recordDate, payDate)) out.push({ status: 'projected', source: 'history', recordDate, payDate, perShare: medianPer! });
      }
    }
  }
  return out;
}

/**
 * 미국 종목의 ICE 일정(`HHDFS78330900`)과 기간별권리(`CTRGT011R`)를 예탁원 일정 모양으로 합친다 — `planSymbolDividends` 입력.
 * ICE의 현금배당은 기준일(없으면 배당락일)로 기간별권리의 주당 금액(배당 `03`, 0보다 큰 것)을 붙이고(없으면 0 = 금액 미정),
 * ICE 범위 밖의 지난 권리는 지급일 없이 더한다 — 주당 중간값·주기 추정에 쓰인다.
 */
export function overseasScheduleRows(
  ice: KisOverseasIceRight[],
  rights: KisOverseasPeriodRight[]
): Array<{ record_date: string; per_sto_divi_amt: string; divi_pay_dt: string }> {
  const perByRecord = new Map<string, number>();
  for (const r of rights) {
    const record = parseKsdDate(r.acpl_bass_dt);
    const per = Number(r.alct_frcr_unpr);
    if (r.rght_type_cd !== '03' || !record || !(per > 0) || (r.crcy_cd && r.crcy_cd !== 'USD')) continue;
    perByRecord.set(record, per);
  }
  const rows: Array<{ record_date: string; per_sto_divi_amt: string; divi_pay_dt: string }> = [];
  const seen = new Set<string>();
  for (const e of ice) {
    if (!(e.ca_title ?? '').includes('배당')) continue;
    const record = parseKsdDate(e.record_dt) ?? parseKsdDate(e.div_lock_dt);
    if (!record || seen.has(record)) continue;
    seen.add(record);
    rows.push({ record_date: record, per_sto_divi_amt: String(perByRecord.get(record) ?? 0), divi_pay_dt: e.pay_dt ?? '' });
  }
  for (const [record, per] of perByRecord) {
    if (!seen.has(record)) rows.push({ record_date: record, per_sto_divi_amt: String(per), divi_pay_dt: '' });
  }
  return rows;
}

export async function getUpcomingDividends(): Promise<{ items: UpcomingDividend[]; available: boolean }> {
  if (!isKisConfigured()) return { items: [], available: false };
  return withCache('upcoming-dividends', 6 * 3600_000, async () => ({ items: await build(), available: true }));
}

async function build(): Promise<UpcomingDividend[]> {
  const today = todayKst();
  const until = addDays(today, 120);
  // 예상·추정은 **이번 달 지급분까지만**(사용자 결정 2026-11-10 — 120일을 다 보이면 매달 지급 종목 × 계좌 수만큼 줄이 너무 많다).
  // 확정은 그대로 120일. 지급일이 없는 예상 건은 기준일로 판단한다.
  const monthEnd = addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
  const items: UpcomingDividend[] = [];
  const kisAccountId = getKisAccountId();

  // 1) 확정 — KIS 계좌
  const rights = await fetchKisPeriodRights(addDays(today, -60), '2099-12-31').catch(() => []);
  const confirmedKeys = new Set<string>(); // `${종목}:${기준월}` — 같은 달 예상·추정을 그 계좌에서 뺀다
  for (const r of rights) {
    const pay = parseKsdDate(r.cash_dfrm_dt);
    const gross = Number(r.last_alct_amt);
    if (!pay || pay <= today || !Number.isFinite(gross) || gross <= 0) continue;
    const tax = Number(r.tax_amt);
    const symbol = (r.shtn_pdno || r.pdno).trim();
    confirmedKeys.add(`${symbol}:${(parseKsdDate(r.bass_dt) ?? pay).slice(0, 7)}`);
    items.push({
      status: 'confirmed', broker: 'kis', accountId: kisAccountId, symbol, name: r.prdt_name.trim(), currency: 'KRW',
      payDate: pay, recordDate: parseKsdDate(r.bass_dt), quantity: 0, perShare: null, grossAmount: gross,
      tax: Number.isFinite(tax) ? tax : null, source: 'kis-account',
    });
  }

  const holdings = listHoldings().filter((h) => h.quantity > 0 && h.currency !== 'USD');

  // 2)·3) 예상·추정 — 보유 종목마다 예탁원 일정을 지난 400일~앞으로 120일(기준일 기준)로 조회
  const symbols = [...new Set(holdings.map((h) => h.symbol))];
  // 추정 날짜의 휴일 보정용 — 이번 달 1일부터 다음 달 10일 무렵까지(한 페이지 24일). 실패하면 주말만 반영.
  const cal = symbols.length
    ? await fetchKisBusinessDays(`${today.slice(0, 7)}-01`, addDays(monthEnd, 10)).catch((e) => {
        console.warn(`[upcoming-dividends] 휴장일 조회 실패 — 주말만 반영: ${(e as Error).message}`);
        return {} as BusinessDays;
      })
    : {};
  const plans = new Map<string, PlannedDividend[]>();
  await Promise.all(
    symbols.map(async (symbol) => {
      const rows = await fetchKisDividendSchedule(addDays(today, -400), until, symbol).catch((e) => {
        console.warn(`[upcoming-dividends] ${symbol} 배당일정 조회 실패: ${(e as Error).message}`);
        return [];
      });
      plans.set(symbol, planSymbolDividends(rows, today, monthEnd, cal));
    })
  );
  for (const h of holdings) {
    for (const p of plans.get(h.symbol) ?? []) {
      if (h.broker === 'kis' && h.accountId === kisAccountId && confirmedKeys.has(`${h.symbol}:${p.recordDate.slice(0, 7)}`)) continue;
      items.push({
        status: p.status, broker: h.broker, accountId: h.accountId, symbol: h.symbol, name: h.name, currency: 'KRW',
        payDate: p.payDate, recordDate: p.recordDate, quantity: h.quantity, perShare: p.perShare,
        grossAmount: Math.round(p.perShare * h.quantity), tax: null, source: p.source,
      });
    }
  }

  // 4) 해외(미국) — USD 보유 종목마다 ICE 일정 + 기간별권리 주당 금액. 해외가 실패해도 국내는 그대로 보여 준다.
  const usdHoldings = listHoldings().filter((h) => h.quantity > 0 && h.currency === 'USD');
  const usPlans = new Map<string, PlannedDividend[]>();
  await Promise.all(
    [...new Set(usdHoldings.map((h) => h.symbol))].map(async (symbol) => {
      try {
        // ICE는 한 번에 50건까지라 기간을 짧게(지급 간격·발표된 일정용), 주당 중간값·주기는 기간별권리 400일로 본다.
        const ice = await fetchKisOverseasIceRights(symbol, addDays(today, -120), until);
        if (!ice.some((e) => (e.ca_title ?? '').includes('배당'))) return; // 배당 없는 종목 — 기간별권리 조회 생략
        const rights = await fetchKisOverseasDividendRights(symbol, addDays(today, -400), until);
        usPlans.set(symbol, planSymbolDividends(overseasScheduleRows(ice, rights), today, monthEnd));
      } catch (e) {
        console.warn(`[upcoming-dividends] ${symbol} 해외 배당 일정 조회 실패: ${(e as Error).message}`);
      }
    })
  );
  for (const h of usdHoldings) {
    for (const p of usPlans.get(h.symbol) ?? []) {
      items.push({
        status: p.status, broker: h.broker, accountId: h.accountId, symbol: h.symbol, name: h.name, currency: 'USD',
        payDate: p.payDate, recordDate: p.recordDate, quantity: h.quantity, perShare: p.perShare,
        grossAmount: Math.round(p.perShare * h.quantity * 100) / 100, tax: null,
        source: p.source === 'ksd-schedule' ? 'kis-overseas' : p.source,
      });
    }
  }

  const key = (i: UpcomingDividend) => i.payDate ?? i.recordDate ?? '9999';
  return items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
