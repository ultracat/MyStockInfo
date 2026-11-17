import { isTaxDeferredAccount } from './db/accountTaxTypes';
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
import { usMarketClosedDays } from './usMarketCalendar';
import { JsonStore } from './jsonStore';
import { getDataDir } from './paths';
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
//    - 둘을 예탁원 일정과 같은 모양으로 바꿔 `planSymbolDividends`에 넣는다(주기 추정까지 같은 규칙). 휴일은 NYSE 정기
//      휴장일 규칙(`usMarketCalendar.ts`)으로 반영한다 — 임시 휴장은 모른다. 금액은 세전(미국 원천징수 15% 전).
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

// ---- 저장된 일정 + 하루 한 번 갱신 --------------------------------------------------------------------------------------
// 종목마다 KIS를 여러 번 불러야 해서(실측 21종목 18초) 앱을 켤 때마다 처음부터 계산하면 배당금 화면이 오래 빈다
// (예전엔 메모리 6시간 캐시라 재시작하면 사라졌다). 그래서 **종목별 일정(예탁원·해외 권리 원본 줄)과 확정 건을 파일에 저장**하고
// (`upcoming-dividends.json`), 요청 때마다 **오늘 날짜·지금 보유 수량**으로 다시 계산한다(`itemsFromSnapshot`) —
// 결과(금액)를 통째로 저장하면 그날 산 종목·바뀐 수량이 다음 갱신까지 안 맞기 때문이다(사용자 결정 2026-11-16).
// - 저장일(한국 날짜)이 오늘이 아니면 저장본을 바로 주고 **백그라운드로 다시 받는다**(`refreshing: true` — 화면이 다시 부른다).
// - 저장본에 없는 보유 종목(새로 산 종목)만 그 자리에서 받아 더한다(같은 종목은 하루 한 번만 시도).
// - 새로고침(`refresh`)은 오늘 이미 받았어도 다시 받는다. 저장본이 아예 없거나 KIS 계좌가 바뀌었으면 기다려서 받는다.
// - 종목 하나·확정 조회가 실패하면 저장본의 이전 값을 그대로 둔다(일부 실패로 일정이 사라지지 않게).

type ScheduleRow = { record_date: string; per_sto_divi_amt: string; divi_pay_dt: string };

/** 저장 형식 — 저장하는 내용이 바뀌면 올린다. 다르면 저장본을 보여 주되 뒤에서 다시 받는다.
 *  2: 확정 건에 기준일 보유 수량·주당 금액(`cblc_qty`)을 넣음 — 1은 수량 0·주당 null이라 "수량 × 주당"이 비었다. */
const SNAPSHOT_VERSION = 2;

export interface UpcomingSnapshot {
  version?: number;
  /** 받은 날(한국 날짜) — 오늘이 아니면 다시 받는다. */
  builtDate: string;
  /** 받은 시각(ISO). */
  builtAt: string;
  /** 받을 때의 KIS 계좌 — 키·계좌가 바뀌면 확정 건이 다른 계좌 것이라 버린다. */
  kisAccountId: string;
  /** 확정 — KIS 계좌의 지급 예정 권리(받은 날 기준 지급일 > 그날). */
  confirmed: UpcomingDividend[];
  /** 국내휴장일(받은 날 기준 이번 달~다음 달 초). */
  krCalendar: BusinessDays;
  /** 국내 종목별 예탁원 일정 원본 줄. */
  kr: Record<string, ScheduleRow[]>;
  /** 미국 종목별 ICE+기간별권리를 합친 줄(`overseasScheduleRows`) — 배당 없는 종목은 빈 배열. */
  us: Record<string, ScheduleRow[]>;
}

export interface UpcomingDividendsResult {
  items: UpcomingDividend[];
  available: boolean;
  /** 지금 보여 주는 일정을 받은 시각(ISO) — 없으면 null. */
  builtAt: string | null;
  /** 백그라운드로 다시 받는 중 — 화면은 잠시 뒤 다시 부른다. */
  refreshing: boolean;
}

const snapshotStore = () => new JsonStore<UpcomingSnapshot | null>('upcoming-dividends.json', getDataDir(), null);

type HoldingRow = ReturnType<typeof listHoldings>[number];

function heldSymbols(holdings: HoldingRow[]): { kr: string[]; us: string[] } {
  const live = holdings.filter((h) => h.quantity > 0);
  return {
    kr: [...new Set(live.filter((h) => h.currency !== 'USD').map((h) => h.symbol))],
    us: [...new Set(live.filter((h) => h.currency === 'USD').map((h) => h.symbol))],
  };
}

function monthEndOf(today: string): string {
  return addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
}

/**
 * 저장된 일정 + 지금 보유 수량 → 화면 줄(순수 함수). 확정은 지급일 > 오늘만, 예상·추정은 `planSymbolDividends`를
 * 오늘 기준으로 다시 돌린다(이번 달 지급분까지). KIS 계좌에 확정 건이 있는 종목·기준월은 그 계좌엔 예상·추정을 안 만든다.
 */
export function itemsFromSnapshot(
  snap: Pick<UpcomingSnapshot, 'confirmed' | 'krCalendar' | 'kr' | 'us'>,
  holdings: HoldingRow[],
  today: string,
  kisAccountId: string
): UpcomingDividend[] {
  const monthEnd = monthEndOf(today);
  const items: UpcomingDividend[] = snap.confirmed.filter((c) => c.payDate !== null && c.payDate > today);
  const confirmedKeys = new Set(items.map((c) => `${c.symbol}:${(c.recordDate ?? c.payDate!).slice(0, 7)}`));

  const krPlans = new Map<string, PlannedDividend[]>();
  const usPlans = new Map<string, PlannedDividend[]>();
  const usCal = usMarketClosedDays(addDays(today, -420), addDays(today, 180));
  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const usd = h.currency === 'USD';
    const plans = usd ? usPlans : krPlans;
    if (!plans.has(h.symbol)) {
      const rows = (usd ? snap.us : snap.kr)[h.symbol];
      plans.set(h.symbol, rows ? planSymbolDividends(rows, today, monthEnd, usd ? usCal : snap.krCalendar) : []);
    }
    for (const p of plans.get(h.symbol)!) {
      if (!usd && h.broker === 'kis' && h.accountId === kisAccountId && confirmedKeys.has(`${h.symbol}:${p.recordDate.slice(0, 7)}`)) continue;
      items.push({
        status: p.status, broker: h.broker, accountId: h.accountId, symbol: h.symbol, name: h.name, currency: usd ? 'USD' : 'KRW',
        payDate: p.payDate, recordDate: p.recordDate, quantity: h.quantity, perShare: p.perShare,
        grossAmount: usd ? Math.round(p.perShare * h.quantity * 100) / 100 : Math.round(p.perShare * h.quantity),
        tax: null, source: usd ? (p.source === 'ksd-schedule' ? 'kis-overseas' : p.source) : p.source,
      });
    }
  }
  const key = (i: UpcomingDividend) => i.payDate ?? i.recordDate ?? '9999';
  return items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/** 1) 확정 — KIS 계좌의 지급 예정 권리. 실패하면 null(이전 값 유지). */
async function fetchConfirmed(today: string, kisAccountId: string): Promise<UpcomingDividend[] | null> {
  try {
    const rights = await fetchKisPeriodRights(addDays(today, -60), '2099-12-31');
    // ISA·연금저축·IRP는 세금을 떼지 않는다(kisDividendSync.ts) — API의 계산상 세금을 보여 주지 않는다.
    const taxDeferred = isTaxDeferredAccount('kis', kisAccountId);
    const out: UpcomingDividend[] = [];
    for (const r of rights) {
      const pay = parseKsdDate(r.cash_dfrm_dt);
      const gross = Number(r.last_alct_amt);
      if (!pay || pay <= today || !Number.isFinite(gross) || gross <= 0) continue;
      const tax = Number(r.tax_amt);
      const qty = Number(r.cblc_qty); // 기준일 잔고수량 — 없으면 수량·주당을 비워 둔다(화면은 "-")
      const hasQty = Number.isFinite(qty) && qty > 0;
      out.push({
        status: 'confirmed', broker: 'kis', accountId: kisAccountId, symbol: (r.shtn_pdno || r.pdno).trim(), name: r.prdt_name.trim(),
        currency: 'KRW', payDate: pay, recordDate: parseKsdDate(r.bass_dt), quantity: hasQty ? qty : 0,
        perShare: hasQty ? gross / qty : null, grossAmount: gross,
        tax: taxDeferred ? 0 : Number.isFinite(tax) ? tax : null, source: 'kis-account',
      });
    }
    return out;
  } catch (e) {
    console.warn(`[upcoming-dividends] 확정 배당 조회 실패 — 이전 값 유지: ${(e as Error).message}`);
    return null;
  }
}

/** 2)·3) 국내 — 종목마다 예탁원 일정을 지난 400일~앞으로 120일(기준일 기준). 실패한 종목은 결과에 없다. */
async function fetchKrRows(symbols: string[], today: string): Promise<Record<string, ScheduleRow[]>> {
  const out: Record<string, ScheduleRow[]> = {};
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        out[symbol] = await fetchKisDividendSchedule(addDays(today, -400), addDays(today, 120), symbol);
      } catch (e) {
        console.warn(`[upcoming-dividends] ${symbol} 배당일정 조회 실패: ${(e as Error).message}`);
      }
    })
  );
  return out;
}

/** 추정 날짜의 휴일 보정용 — 이번 달 1일부터 다음 달 10일 무렵까지(한 페이지 24일). 실패하면 null(주말만 반영). */
async function fetchKrCalendar(today: string): Promise<BusinessDays | null> {
  try {
    return await fetchKisBusinessDays(`${today.slice(0, 7)}-01`, addDays(monthEndOf(today), 10));
  } catch (e) {
    console.warn(`[upcoming-dividends] 휴장일 조회 실패 — 주말만 반영: ${(e as Error).message}`);
    return null;
  }
}

/** 4) 미국 — 종목마다 ICE 일정 + 기간별권리 주당 금액. 배당 없는 종목은 빈 배열, 실패한 종목은 결과에 없다. */
async function fetchUsRows(symbols: string[], today: string): Promise<Record<string, ScheduleRow[]>> {
  const out: Record<string, ScheduleRow[]> = {};
  const until = addDays(today, 120);
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        // ICE는 한 번에 50건까지라 기간을 짧게(지급 간격·발표된 일정용), 주당 중간값·주기는 기간별권리 400일로 본다.
        const ice = await fetchKisOverseasIceRights(symbol, addDays(today, -120), until);
        if (!ice.some((e) => (e.ca_title ?? '').includes('배당'))) {
          out[symbol] = []; // 배당 없는 종목 — 기간별권리 조회 생략
          return;
        }
        const rights = await fetchKisOverseasDividendRights(symbol, addDays(today, -400), until);
        out[symbol] = overseasScheduleRows(ice, rights);
      } catch (e) {
        console.warn(`[upcoming-dividends] ${symbol} 해외 배당 일정 조회 실패: ${(e as Error).message}`);
      }
    })
  );
  return out;
}

/** 지금 보유 종목만 남기고, 새로 받은 값이 없는 종목은 이전 값을 쓴다. */
function mergeRows(prev: Record<string, ScheduleRow[]> | undefined, next: Record<string, ScheduleRow[]>, keep: string[]) {
  const out: Record<string, ScheduleRow[]> = {};
  for (const s of keep) {
    const rows = next[s] ?? prev?.[s];
    if (rows) out[s] = rows;
  }
  return out;
}

let rebuildJob: Promise<void> | null = null;
let missingJob: Promise<void> | null = null;
/** 저장본에 없는 종목을 받다가 실패한 날 — 같은 날 요청마다 다시 시도해 화면이 느려지지 않게. */
const missingTried = new Map<string, string>();

/** 지금 보유 종목 전체를 다시 받아 저장한다(같은 시각에 두 번 돌지 않음). */
function startRebuild(): Promise<void> {
  if (rebuildJob) return rebuildJob;
  rebuildJob = (async () => {
    const today = todayKst();
    const kisAccountId = await getKisAccountId();
    const { kr, us } = heldSymbols(listHoldings());
    const [confirmed, krCalendar, krRows, usRows] = await Promise.all([
      fetchConfirmed(today, kisAccountId),
      kr.length ? fetchKrCalendar(today) : Promise.resolve({} as BusinessDays),
      fetchKrRows(kr, today),
      fetchUsRows(us, today),
    ]);
    const store = snapshotStore();
    const cur = store.read();
    const prev = cur && cur.kisAccountId === kisAccountId ? cur : null;
    // 받는 사이 보유가 바뀌었을 수 있다 — 지금 보유 기준으로 남긴다.
    const held = heldSymbols(listHoldings());
    store.write({
      version: SNAPSHOT_VERSION,
      builtDate: today,
      builtAt: new Date().toISOString(),
      kisAccountId,
      confirmed: confirmed ?? prev?.confirmed ?? [],
      krCalendar: krCalendar ?? prev?.krCalendar ?? {},
      kr: mergeRows(prev?.kr, krRows, held.kr),
      us: mergeRows(prev?.us, usRows, held.us),
    });
  })()
    .catch((e) => console.warn(`[upcoming-dividends] 다가오는 배당 갱신 실패: ${(e as Error).message}`))
    .finally(() => {
      rebuildJob = null;
    });
  return rebuildJob;
}

/** 저장본에 없는 보유 종목만 받아 더한다(그날 새로 산 종목). */
function fetchMissing(kr: string[], us: string[], today: string): Promise<void> {
  if (missingJob) return missingJob;
  for (const s of kr) missingTried.set(`kr:${s}`, today);
  for (const s of us) missingTried.set(`us:${s}`, today);
  missingJob = (async () => {
    const [krRows, usRows] = await Promise.all([fetchKrRows(kr, today), fetchUsRows(us, today)]);
    snapshotStore().update((cur) =>
      cur ? { ...cur, kr: { ...cur.kr, ...krRows }, us: { ...cur.us, ...usRows } } : cur
    );
  })()
    .catch((e) => console.warn(`[upcoming-dividends] 새 종목 배당 일정 조회 실패: ${(e as Error).message}`))
    .finally(() => {
      missingJob = null;
    });
  return missingJob;
}

export async function getUpcomingDividends(opts: { refresh?: boolean } = {}): Promise<UpcomingDividendsResult> {
  if (!isKisConfigured()) return { items: [], available: false, builtAt: null, refreshing: false };
  const today = todayKst();
  const kisAccountId = await getKisAccountId();
  const usable = () => {
    const s = snapshotStore().read();
    return s && s.kisAccountId === kisAccountId ? s : null;
  };

  let snap = usable();
  if (!snap) {
    await startRebuild(); // 처음(또는 KIS 계좌가 바뀜) — 보여 줄 게 없으니 기다린다
    snap = usable();
  } else if (opts.refresh || snap.builtDate !== today || snap.version !== SNAPSHOT_VERSION) {
    void startRebuild(); // 저장본을 먼저 보여 주고 뒤에서 다시 받는다
  }

  const holdings = listHoldings();
  if (snap && !rebuildJob) {
    const held = heldSymbols(holdings);
    const kr = held.kr.filter((s) => !(s in snap!.kr) && missingTried.get(`kr:${s}`) !== today);
    const us = held.us.filter((s) => !(s in snap!.us) && missingTried.get(`us:${s}`) !== today);
    if (kr.length || us.length) {
      await fetchMissing(kr, us, today);
      snap = usable();
    }
  }

  return {
    items: snap ? itemsFromSnapshot(snap, holdings, today, kisAccountId) : [],
    available: true,
    builtAt: snap?.builtAt ?? null,
    refreshing: rebuildJob !== null,
  };
}
