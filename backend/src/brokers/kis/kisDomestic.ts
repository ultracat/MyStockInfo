// 한국투자증권 국내 주식(계좌) — 잔고·기간별 권리·기간 실현손익·휴장일·배당 일정·체결 내역·현재가·종목명. 공통부는 kisCore.ts.
import { shapeForLog } from '../../logRedact';
import { getDataDir } from '../../paths';
import { JsonStore } from '../../jsonStore';
import { DEFAULT_TTL_MS, PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';
import { KisAccountSummary, KisDailyCcldItem, KisHoldingItem, KisRow, MAX_PAGES, kisDailyCcldLimiter, kisGet, requireCredentials } from './kisCore';
import { asRows } from './kisStockDetail';
async function fetchKisBalanceUncached(): Promise<{ items: KisHoldingItem[]; summary: KisAccountSummary }> {
  const creds = await requireCredentials();

  const data = await kisGet('/uapi/domestic-stock/v1/trading/inquire-balance', 'TTTC8434R', {
    CANO: creds.accountNumber,
    ACNT_PRDT_CD: creds.accountProductCode,
    AFHR_FLPR_YN: 'N',
    OFL_YN: '',
    INQR_DVSN: '01',
    UNPR_DVSN: '01',
    FUND_STTL_ICLD_YN: 'N',
    FNCG_AMT_AUTO_RDPT_YN: 'N',
    PRCS_DVSN: '00',
    CTX_AREA_FK100: '',
    CTX_AREA_NK100: '',
  });

  const items: KisHoldingItem[] = asRows(data.output1);
  const summary: KisAccountSummary | undefined = asRows(data.output2)[0];

  if (!summary || typeof summary !== 'object') {
    console.error('[kis] Unexpected inquire-balance response shape:', shapeForLog(data));
    throw new Error(
      '한국투자증권 잔고 조회 응답 형식이 예상과 다릅니다. 백엔드를 실행한 터미널에 원본 응답을 출력했습니다.'
    );
  }

  return { items, summary };
}

export async function fetchKisBalance(
  opts: FetchOpts = {}
): Promise<{ items: KisHoldingItem[]; summary: KisAccountSummary }> {
  // Concurrent callers for the same key (e.g. React StrictMode's dev-mode
  // double-invoked effect firing two real requests a moment apart) are
  // coalesced onto one in-flight call by withCache itself — see
  // brokers/responseCache.ts.
  return withCache('kis:balance', PORTFOLIO_TTL_MS, fetchKisBalanceUncached, opts);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmd(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

/** 기간별계좌권리현황조회(`CTRGA011R`, `GET /uapi/domestic-stock/v1/trading/period-rights`, 공식 예제
 *  `examples_llm/domestic_stock/period_rights/period_rights.py` 확인 2026-11-09) 한 행 — 배당 동기화에 쓰는
 *  필드만. 금액은 문자열(원). `rght_type_cd`는 실측상 `03`=주식 배당, `32`=ETF 분배금(코드표는 문서에 없음).
 *  `last_alct_amt`=최종배정금액(세전), `tax_amt`=세금, `cash_dfrm_dt`=현금지급일(미래면 지급 예정). */
export type KisPeriodRight = KisRow<'CTRGA011R', 'output'>;

/** 이 앱이 쓰는 KIS 계좌 id(`CANO-상품코드`) — kisAdapter의 계좌 목록과 같은 형식. */
export async function getKisAccountId(): Promise<string> {
  const creds = await requireCredentials();
  return `${creds.accountNumber}-${creds.accountProductCode}`;
}

/** 계좌의 권리 내역 전체(기본 2000-01-01부터) — 25건씩 연속조회(`tr_cont` M/F)로 끝까지 받는다.
 *  긴 기간을 한 번에 조회해도 된다(실측 2026-11-09). 매매내역 TR과 같은 1tps 리미터를 쓴다. */
export async function fetchKisPeriodRights(from = '2000-01-01', to = '2099-12-31'): Promise<KisPeriodRight[]> {
  const creds = await requireCredentials();
  const items: KisPeriodRight[] = [];
  let fk100 = '';
  let nk100 = '';
  let trCont = '';
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/trading/period-rights',
      'CTRGA011R',
      {
        INQR_DVSN: '03',
        CANO: creds.accountNumber,
        ACNT_PRDT_CD: creds.accountProductCode,
        INQR_STRT_DT: from.replace(/-/g, ''),
        INQR_END_DT: to.replace(/-/g, ''),
        CUST_RNCNO25: '',
        HMID: '',
        RGHT_TYPE_CD: '',
        PDNO: '',
        PRDT_TYPE_CD: '',
        CTX_AREA_FK100: fk100,
        CTX_AREA_NK100: nk100,
      },
      trCont,
      kisDailyCcldLimiter,
      5
    );
    items.push(...asRows(res.output));
    if (res.trCont !== 'M' && res.trCont !== 'F') return items;
    fk100 = String(res.ctx_area_fk100 ?? '');
    nk100 = String(res.ctx_area_nk100 ?? '');
    if (seen.has(nk100)) return items; // 같은 연속조회 키로 되돌아오면 멈춘다
    seen.add(nk100);
    trCont = 'N';
  }
  // 배당 동기화가 이 목록으로 기록을 통째로 교체한다 — 잘린 목록이면 기존 배당이 지워지므로 조용히 끊지 않는다.
  throw new Error(`한국투자증권 권리현황이 ${MAX_PAGES}페이지를 넘어 끝까지 받지 못했습니다`);
}

/** 기간별매매손익현황조회(`TTTC8715R`, `inquire-period-trade-profit`, 공식 예제 확인 2026-11-09) 한 행 — 매도 체결별
 *  증권사가 계산한 실현손익. 금액은 문자열(원). 국내주식만. */
export type KisTradeProfitRow = KisRow<'TTTC8715R', 'output1'>;

/** 기간 내 국내 매도 실현손익 전체(50건씩 연속조회). 합계(output2)는 쓰지 않고 행을 더해 쓴다(페이지가 나뉘어서). */
export async function fetchKisPeriodTradeProfit(from: string, to: string): Promise<KisTradeProfitRow[]> {
  const creds = await requireCredentials();
  const rows: KisTradeProfitRow[] = [];
  let fk100 = '';
  let nk100 = '';
  let trCont = '';
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/trading/inquire-period-trade-profit',
      'TTTC8715R',
      {
        CANO: creds.accountNumber,
        ACNT_PRDT_CD: creds.accountProductCode,
        SORT_DVSN: '01',
        INQR_STRT_DT: from.replace(/-/g, ''),
        INQR_END_DT: to.replace(/-/g, ''),
        CBLC_DVSN: '00',
        PDNO: '',
        CTX_AREA_FK100: fk100,
        CTX_AREA_NK100: nk100,
      },
      trCont,
      kisDailyCcldLimiter,
      5
    );
    rows.push(...asRows(res.output1));
    if (res.trCont !== 'M' && res.trCont !== 'F') return rows;
    fk100 = String(res.ctx_area_fk100 ?? '');
    nk100 = String(res.ctx_area_nk100 ?? '');
    if (seen.has(nk100)) return rows;
    seen.add(nk100);
    trCont = 'N';
  }
  throw new Error(`한국투자증권 기간 실현손익이 ${MAX_PAGES}페이지를 넘어 끝까지 받지 못했습니다`);
}

/** 국내휴장일조회 저장 — 공식 예제가 "원장 서비스와 연관돼 가급적 **1일 1회** 호출"을 요청해서 디스크에 하루 단위로 둔다. */
interface StoredKisHolidays {
  fetchedOn: string;
  /** YYYY-MM-DD → 영업일(`bzdy_yn === 'Y'`) 여부. */
  days: Record<string, boolean>;
}
const holidayStore = () => new JsonStore<StoredKisHolidays | null>('kis-holidays.json', getDataDir(), null);
export const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/**
 * 국내휴장일조회(`CTCA0903R`, `quotations/chk-holiday`) — `from`부터 `to`까지 날짜별 영업일 여부.
 * 한 페이지 24일(2026-11-10 실측), 연속조회는 본문 `ctx_area_nk`/`ctx_area_fk` + `tr_cont` N. 오늘 받은 저장분이
 * 범위를 덮으면 다시 부르지 않는다. 필드 `bzdy_yn`(영업일)·`tr_day_yn`·`opnd_yn`(개장일)·`sttl_day_yn`(결제일).
 */
export async function fetchKisBusinessDays(from: string, to: string): Promise<Record<string, boolean>> {
  const today = kstToday();
  const saved = holidayStore().read();
  if (saved && saved.fetchedOn === today && from in saved.days && to in saved.days) return saved.days;

  const days: Record<string, boolean> = {};
  let fk = '';
  let nk = '';
  let trCont = '';
  for (let page = 0; page < 10; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/quotations/chk-holiday',
      'CTCA0903R',
      { BASS_DT: from.replace(/-/g, ''), CTX_AREA_FK: fk, CTX_AREA_NK: nk },
      trCont
    );
    const rows = asRows(res.output);
    for (const r of rows) {
      const m = /^(\d{4})(\d{2})(\d{2})$/.exec(r.bass_dt ?? '');
      if (m) days[`${m[1]}-${m[2]}-${m[3]}`] = r.bzdy_yn === 'Y';
    }
    const last = Object.keys(days).sort().pop();
    if ((last && last >= to) || (res.trCont !== 'M' && res.trCont !== 'F')) break;
    fk = String(res.ctx_area_fk ?? '');
    nk = String(res.ctx_area_nk ?? '');
    trCont = 'N';
  }
  holidayStore().write({ fetchedOn: today, days });
  return days;
}

/** 예탁원정보 배당일정(`HHKDB669102C0`, `ksdinfo/dividend`) — **시장 전체**(계좌 무관) 국내 배당 일정.
 *  `per_sto_divi_amt`=주당 배당금(원, 미정이면 0), `record_date`=기준일(YYYYMMDD), `divi_pay_dt`=지급일(YYYY/MM/DD, 미정이면 빈 값). */
export type KisDividendScheduleRow = KisRow<'HHKDB669102C0', 'output1'>;

/** `from`~`to`는 **기준일(record_date)** 범위다(2026-11-10 실측 — 오늘부터 조회하면 가장 이른 기준일이 오늘).
 *  `symbol`을 주면 그 종목만(시장 전체는 앞으로 일정이 듬성듬성 등록돼 있어 보유 종목별 조회가 정확하다).
 *  `divi_pay_dt`는 `YYYY/MM/DD`(빗금)로 온다(실측) — `record_date`는 `YYYYMMDD`. 연속조회는 공식 예제처럼 `tr_cont` M → N. */
export async function fetchKisDividendSchedule(from: string, to: string, symbol = ''): Promise<KisDividendScheduleRow[]> {
  const rows: KisDividendScheduleRow[] = [];
  let trCont = '';
  for (let page = 0; page < 10; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/ksdinfo/dividend',
      'HHKDB669102C0',
      { CTS: '', GB1: '0', F_DT: from.replace(/-/g, ''), T_DT: to.replace(/-/g, ''), SHT_CD: symbol, HIGH_GB: '' },
      trCont
    );
    rows.push(...asRows(res.output1));
    if (res.trCont !== 'M' && res.trCont !== 'F') break;
    trCont = 'N';
  }
  return rows;
}

/** Fetches every page of one 주식일별주문체결조회 query (single TR/date range), following `ctx_area_fk100`/`nk100` until `tr_cont` stops being 'M'/'F'. */
async function fetchDailyCcldAllPages(
  trId: 'TTTC0081R' | 'CTSC9215R',
  base: Record<string, string>
): Promise<KisDailyCcldItem[]> {
  const items: KisDailyCcldItem[] = [];
  let fk100 = '';
  let nk100 = '';
  let trCont = '';

  // 같은 연속조회 키로 되돌아오면 멈추고(무한 반복 방지), 상한(MAX_PAGES)에 닿으면 던진다 — 조용히 끊으면 매매내역이 빠진 채 저장된다.
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await kisGet(
      '/uapi/domestic-stock/v1/trading/inquire-daily-ccld',
      trId,
      { ...base, CTX_AREA_FK100: fk100, CTX_AREA_NK100: nk100 },
      trCont,
      kisDailyCcldLimiter,
      5
    );

    items.push(...asRows(res.output1));

    if (res.trCont !== 'M' && res.trCont !== 'F') return items;
    fk100 = String(res.ctx_area_fk100 ?? '');
    nk100 = String(res.ctx_area_nk100 ?? '');
    if (seen.has(nk100)) return items;
    seen.add(nk100);
    trCont = 'N';
  }
  throw new Error(`한국투자증권 체결 내역이 ${MAX_PAGES}페이지를 넘어 끝까지 받지 못했습니다(${trId})`);
}

async function fetchKisTradeHistoryUncached(from: string, to: string): Promise<KisDailyCcldItem[]> {
  const creds = await requireCredentials();
  const fromDate = parseYmd(from);
  const toDate = parseYmd(to);
  if (fromDate > toDate) return [];

  const base = {
    CANO: creds.accountNumber,
    ACNT_PRDT_CD: creds.accountProductCode,
    SLL_BUY_DVSN_CD: '00', // 전체
    PDNO: '',
    CCLD_DVSN: '01', // 체결만
    INQR_DVSN: '00', // 역순
    INQR_DVSN_3: '00', // 전체
    ORD_GNO_BRNO: '',
    ODNO: '',
    INQR_DVSN_1: '',
    EXCG_ID_DVSN_CD: 'ALL',
  };

  // 이 TR은 실전계좌 기준으로 "3개월 이내"(TTTC0081R)와 "3개월 이전"(CTSC9215R)이
  // 서로 다른 TR_ID로 나뉘어 있다(examples_llm/domestic_stock/inquire_daily_ccld/
  // inquire_daily_ccld.py, checked 2026-08-14) — 조회기간이 그 경계를 걸치면
  // 두 TR을 각각 필요한 구간만큼만 호출해서 합친다.
  const splitDate = new Date();
  splitDate.setMonth(splitDate.getMonth() - 3);

  const items: KisDailyCcldItem[] = [];

  if (fromDate < splitDate) {
    const beforeEndDate = toDate < splitDate ? toDate : new Date(splitDate.getTime() - 24 * 60 * 60 * 1000);
    if (beforeEndDate >= fromDate) {
      items.push(
        ...(await fetchDailyCcldAllPages('CTSC9215R', {
          ...base,
          INQR_STRT_DT: ymd(fromDate),
          INQR_END_DT: ymd(beforeEndDate),
        }))
      );
    }
  }

  if (toDate >= splitDate) {
    const innerStartDate = fromDate > splitDate ? fromDate : splitDate;
    if (toDate >= innerStartDate) {
      items.push(
        ...(await fetchDailyCcldAllPages('TTTC0081R', {
          ...base,
          INQR_STRT_DT: ymd(innerStartDate),
          INQR_END_DT: ymd(toDate),
        }))
      );
    }
  }

  return items;
}

export async function fetchKisTradeHistory(
  from: string,
  to: string,
  opts: FetchOpts = {}
): Promise<KisDailyCcldItem[]> {
  return withCache(`kis:trades:${from}:${to}`, DEFAULT_TTL_MS, () => fetchKisTradeHistoryUncached(from, to), opts);
}

/**
 * 국내주식 현재가 시세(`inquire-price`, TR `FHKST01010100`, 공식 예제
 * examples_llm/domestic_stock/inquire_price/inquire_price.py 확인, checked
 * 2026-08-17) — `inquire-balance`처럼 계좌 보유종목이 아니라 임의 종목코드의
 * 공개 시세를 조회하는 API라 CANO가 필요 없다. 보유종목 CSV 가져오기에서
 * 토스 미연동일 때의 현재가 대체 조회로 쓴다(`stockNameResolver.ts`의
 * `resolveStockPrices`). **해외주식은 지원 안 함** — KIS의 해외 현재가
 * API(`/uapi/overseas-price/v1/quotations/price`)는 거래소코드(EXCD, 예:
 * NAS/NYS)가 필수인데 이 앱은 그 정보를 안 받고 있어서(CSV에 통화만 있고
 * 거래소는 없음) 임의로 추측해 넣지 않는다 — 국내(KR) 6자리 종목코드만 지원.
 * `output`(단수) 키를 쓰는 TR이라 `output1`이 아니라 `output`을 읽는다(위
 * `KisEnvelope` 주석 참고).
 */
export async function fetchKisDomesticPrice(symbol: string, opts: FetchOpts = {}): Promise<number | null> {
  return withCache(
    `kis:price:${symbol}`,
    DEFAULT_TTL_MS,
    async () => {
      const res = await kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', {
        FID_COND_MRKT_DIV_CODE: 'J',
        FID_INPUT_ISCD: symbol,
      });
      const output = asRows(res.output)[0];
      if (!output) return null;
      const price = Number(output.stck_prpr);
      return Number.isFinite(price) ? price : null;
    },
    opts
  );
}

/**
 * 주식기본조회(`search-stock-info`, TR `CTPF1002R`, 공식 예제
 * examples_llm/domestic_stock/search_stock_info/search_stock_info.py +
 * chk_search_stock_info.py의 COLUMN_MAPPING 확인, checked 2026-08-17) — 종목코드로
 * 종목명(`prdt_name`)을 조회하는 마스터데이터 API(계좌 무관). `inquire-price`의
 * `output`엔 종목명이 없어서(`bstp_kor_isnm`은 업종명이지 종목명이 아님) 이 TR이
 * 따로 필요했다. `stockNameResolver.ts`의 `resolveStockNames`가 토스 미연동/조회
 * 실패 시 대체 조회로 쓴다(토스 → KIS → KB 순서 중 2번째). **국내(KR) 6자리
 * 종목코드만 지원**(`PRDT_TYPE_CD: '300'` = 주식/ETF/ETN/ELW) — 해외 종목은 이
 * TR로 조회 안 함(`fetchKisDomesticPrice`와 같은 이유).
 */
export async function fetchKisStockName(symbol: string): Promise<string | null> {
  const res = await kisGet('/uapi/domestic-stock/v1/quotations/search-stock-info', 'CTPF1002R', {
    PRDT_TYPE_CD: '300',
    PDNO: symbol,
  });
  const output = asRows(res.output)[0];
  if (!output) return null;
  const name = String(output.prdt_name ?? '').trim();
  return name || null;
}
