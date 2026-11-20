// 한국투자증권 해외 주식(미국, 계좌) — 잔고·체결·기간 손익·배당 일정(ICE·기간별 권리). 공통부는 kisCore.ts.
import { RateLimiter } from '../rateLimiter';
import { getDataDir } from '../../paths';
import { JsonStore } from '../../jsonStore';
import { PORTFOLIO_TTL_MS, withCache } from '../responseCache';
import type { FetchOpts } from '../types';
import { KisEnvelope, KisParams, KisRow, MAX_PAGES, kisDailyCcldLimiter, kisGet, kisLimiter, requireCredentials } from './kisCore';
import type { KisResponses } from './kisSpec.gen';
import { kstToday } from './kisDomestic';
import { asRows } from './kisStockDetail';
// ---------------------------------------------------------------- 해외주식(미국, 계좌)
// 공식 예제 examples_llm/overseas_stock/{inquire_present_balance,inquire_ccnl,inquire_period_profit}(2026-11-09 확인).
// **미국(USD)만** 다룬다 — 이 앱의 통화 모델이 KRW/USD뿐이라 홍콩·중국·일본·베트남은 넣지 않는다.
// ⚠ 실데이터 검증 전: 연동 계좌에 해외 보유·거래가 없어(2026-11-09) 요청 형식(rt_cd 0, 빈 결과)까지만 확인했다.
// 필드 매핑은 공식 예제의 COLUMN_MAPPING 그대로다 — 해외 거래가 생기면 화면 숫자를 증권사 앱과 대조할 것.

/** FK200/NK200 + `tr_cont`로 끝까지 받는다(해외 계좌 TR 공통 연속조회 방식). `pick`이 페이지마다 행을 꺼낸다. */
async function fetchAllPages200<T extends 'TTTS3035R' | 'TTTS3039R', R>(
  path: string,
  trId: T,
  params: KisParams<T>,
  pick: (res: KisEnvelope & KisResponses[T]) => R | R[] | undefined,
  limiter: RateLimiter = kisLimiter
): Promise<{ rows: R[] }> {
  const rows: R[] = [];
  const seen = new Set<string>();
  let fk = '';
  let nk = '';
  let trCont = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await kisGet(path, trId, { ...params, CTX_AREA_FK200: fk, CTX_AREA_NK200: nk } as KisParams<T>, trCont, limiter, 5);
    rows.push(...asRows(pick(res)));
    if (res.trCont !== 'M' && res.trCont !== 'F') return { rows };
    const ctx = res as unknown as Record<string, unknown>;
    fk = String(ctx.ctx_area_fk200 ?? '').trim();
    nk = String(ctx.ctx_area_nk200 ?? '').trim();
    // 이미 받은 연속조회 키로 되돌아오면 멈춘다(NH·토스와 같은 방어).
    if (seen.has(nk)) return { rows };
    seen.add(nk);
    trCont = 'N';
  }
  // 상한에서 조용히 끊지 않는다 — 잘린 목록으로 저장소를 갱신하지 않게(NH·키움·토스와 같은 원칙).
  throw new Error(`한국투자증권 연속조회가 ${MAX_PAGES}페이지를 넘어 끝까지 받지 못했습니다: ${trId}`);
}

export interface KisOverseasPosition {
  symbol: string;
  name: string;
  quantity: number;
  averagePurchasePrice: number;
  lastPrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  /** 소수 비율(0.15 = 15%) — 국내 잔고와 같은 관례로 100으로 나눈다. */
  profitLossRate: number;
}

const n0 = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 해외주식 체결기준현재잔고(`CTRP6504R`, 미국·외화 기준) — 보유 종목(output1) + 달러 예수금(output2의
 *  `frcr_dncl_amt_2` 외화예수금액, 통화코드 USD 줄). 잔고(`TTTS3012R`)와 달리 예수금까지 한 번에 준다. */
async function fetchKisOverseasBalanceUncached(): Promise<{ positions: KisOverseasPosition[]; cashUsd: number | null }> {
  const creds = await requireCredentials();
  const res = await kisGet('/uapi/overseas-stock/v1/trading/inquire-present-balance', 'CTRP6504R', {
    CANO: creds.accountNumber,
    ACNT_PRDT_CD: creds.accountProductCode,
    WCRC_FRCR_DVSN_CD: '02',
    NATN_CD: '840',
    TR_MKET_CD: '00',
    INQR_DVSN_CD: '00',
  });
  const positions = asRows(res.output1)
    .filter((p) => n0(p.cblc_qty13) > 0 && (!p.buy_crcy_cd || p.buy_crcy_cd === 'USD'))
    .map((p) => ({
      symbol: String(p.pdno ?? '').trim(),
      // ⚠ 공식 예제의 이 TR 응답 필드엔 종목명이 없다(국가명·시장명뿐, kis-catalog.json) — 오면 쓰고 없으면 티커.
      //   해외 보유가 생기면 kis:record로 실제 필드를 확인할 것(2026-11-17 kis:verify가 짚음).
      name: String((p as { prdt_name?: string }).prdt_name ?? p.pdno ?? '').trim(),
      quantity: n0(p.cblc_qty13),
      averagePurchasePrice: n0(p.avg_unpr3),
      lastPrice: n0(p.ovrs_now_pric1),
      purchaseAmount: n0(p.frcr_pchs_amt),
      marketValue: n0(p.frcr_evlu_amt2),
      profitLossAmount: n0(p.evlu_pfls_amt2),
      profitLossRate: n0(p.evlu_pfls_rt1) / 100,
    }));
  const usdRow = asRows(res.output2).find((r) => (r.crcy_cd ?? '').trim() === 'USD');
  return { positions, cashUsd: usdRow ? n0(usdRow.frcr_dncl_amt_2) : null };
}

export function fetchKisOverseasBalance(opts: FetchOpts = {}) {
  return withCache('kis:overseas-balance', PORTFOLIO_TTL_MS, fetchKisOverseasBalanceUncached, opts);
}

export interface KisOverseasTrade {
  id: string;
  date: string;
  symbol: string;
  name: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
}

/** 해외주식 주문체결내역(`TTTS3035R`, 미국 전체 `NASD`, 체결만) — 날짜는 **현지 주문일**(`ord_dt`). 체결수량 0인
 *  줄(거부·미체결)은 뺀다. 매매내역 1tps 리미터를 같이 쓴다. */
export async function fetchKisOverseasTrades(from: string, to: string, opts: FetchOpts = {}): Promise<KisOverseasTrade[]> {
  return withCache(
    `kis:overseas-trades:${from}:${to}`,
    PORTFOLIO_TTL_MS,
    async () => {
      const creds = await requireCredentials();
      const { rows } = await fetchAllPages200(
        '/uapi/overseas-stock/v1/trading/inquire-ccnl',
        'TTTS3035R',
        {
          CANO: creds.accountNumber,
          ACNT_PRDT_CD: creds.accountProductCode,
          PDNO: '%',
          ORD_STRT_DT: from.replace(/-/g, ''),
          ORD_END_DT: to.replace(/-/g, ''),
          SLL_BUY_DVSN: '00',
          CCLD_NCCS_DVSN: '01',
          OVRS_EXCG_CD: 'NASD',
          SORT_SQN: 'DS',
          ORD_DT: '',
          ORD_GNO_BRNO: '',
          ODNO: '',
        },
        (res) => res.output, // 공식 예제: 이 TR은 output 하나
        kisDailyCcldLimiter
      );
      return rows
        .filter((r) => n0(r.ft_ccld_qty) > 0 && (!r.tr_crcy_cd || r.tr_crcy_cd === 'USD'))
        .map((r) => {
          const d = String(r.ord_dt ?? '');
          return {
            // 국내 주문번호와 겹칠 수 있어 접두어를 붙인다(매매내역 저장소는 id로 upsert).
            id: `ovrs-${d}-${String(r.odno ?? '').trim()}`,
            date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
            symbol: String(r.pdno ?? '').trim(),
            name: String(r.prdt_name ?? r.pdno ?? '').trim(),
            side: r.sll_buy_dvsn_cd === '02' ? 'BUY' : 'SELL',
            quantity: n0(r.ft_ccld_qty),
            price: n0(r.ft_ccld_unpr3),
            amount: n0(r.ft_ccld_amt3),
          };
        });
    },
    opts
  );
}

/** 해외주식 기간손익(`TTTS3039R`, 미국 `NASD`, **원화 기준** `WCRC_FRCR_DVSN_CD=02`) — 매도 한 줄씩. 실현손익 화면의
 *  공식 값 비교용(앱 추정치도 원화라 바로 비교된다). `ovrs_rlzt_pfls_amt`는 제비용 차감 손익. */
export async function fetchKisOverseasPeriodProfit(from: string, to: string): Promise<KisRow<'TTTS3039R', 'output1'>[]> {
  const creds = await requireCredentials();
  const { rows } = await fetchAllPages200(
    '/uapi/overseas-stock/v1/trading/inquire-period-profit',
    'TTTS3039R',
    {
      CANO: creds.accountNumber,
      ACNT_PRDT_CD: creds.accountProductCode,
      OVRS_EXCG_CD: 'NASD',
      NATN_CD: '',
      CRCY_CD: 'USD',
      PDNO: '',
      INQR_STRT_DT: from.replace(/-/g, ''),
      INQR_END_DT: to.replace(/-/g, ''),
      WCRC_FRCR_DVSN_CD: '02',
    },
    (res) => res.output1,
    kisDailyCcldLimiter
  );
  return rows;
}

// --- 해외주식 배당 일정(다가오는 배당, upcomingDividends.ts) ---

/** 해외주식 권리종합(`HHDFS78330900`, `overseas-price/v1/quotations/rights-by-ice`, 공식 예제
 *  `examples_llm/overseas_stock/rights_by_ice` 확인, 2026-11-16 실측) 한 행 — ICE 제공 권리 일정. **발표된 미래 배당이
 *  미리 들어온다**(O·SCHD는 한 달 뒤 지급분, 주간 분배 ETF는 그달 말까지). **주당 금액 필드는 없다.** 날짜는 YYYYMMDD,
 *  권리유형은 한글 `ca_title`(실측: 현금배당·공개매수·티커변경). 한 번에 최대 50건만 온다(400일 범위의 주간 분배 ETF가
 *  50건에서 잘렸다) — 기간을 짧게 잡는다. */
export type KisOverseasIceRight = KisRow<'HHDFS78330900', 'output1'>;

export async function fetchKisOverseasIceRights(symbol: string, from: string, to: string): Promise<KisOverseasIceRight[]> {
  const res = await kisGet('/uapi/overseas-price/v1/quotations/rights-by-ice', 'HHDFS78330900', {
    NCOD: 'US',
    SYMB: symbol,
    ST_YMD: from.replace(/-/g, ''),
    ED_YMD: to.replace(/-/g, ''),
  });
  return asRows(res.output1);
}

/** 해외주식 기간별권리조회(`CTRGT011R`, `overseas-price/v1/quotations/period-rights`, 공식 예제
 *  `examples_llm/overseas_stock/period_rights`) 한 행. `alct_frcr_unpr`=주당 배당(외화), `acpl_bass_dt`=현지 기준일,
 *  `rght_type_cd` 03=배당, `dfnt_yn`=확정 여부(N이면 바뀔 수 있음). **배당은 기준일 무렵에야 등록된다**(2026-11-16 실측 —
 *  ICE에 이미 있는 11월 말 기준일 건이 아직 없었다). */
export type KisOverseasPeriodRight = KisRow<'CTRGT011R', 'output'>;

/** 미국 거래소 상품유형코드 — `CTRGT011R`은 `PDNO`만 주면 "조회된 자료가 없습니다"(`KIER2520`)이고 이 코드를 같이 줘야
 *  한다(2026-11-16 실측: 나스닥 종목 512, 뉴욕 513, NYSE Arca ETF 529 — Arca ETF가 아멕스 코드로 나온다). */
export const US_PRODUCT_TYPE_CODES = ['512', '513', '529'] as const; // 나스닥 · 뉴욕 · 아멕스

async function fetchKisOverseasPeriodRightsFor(
  symbol: string,
  productTypeCode: string,
  from: string,
  to: string
): Promise<KisOverseasPeriodRight[]> {
  const rows: KisOverseasPeriodRight[] = [];
  let fk = '';
  let nk = '';
  let trCont = '';
  for (let page = 0; page < 10; page++) {
    const res = await kisGet(
      '/uapi/overseas-price/v1/quotations/period-rights',
      'CTRGT011R',
      {
        RGHT_TYPE_CD: '%%',
        INQR_DVSN_CD: '02', // 현지기준일
        INQR_STRT_DT: from.replace(/-/g, ''),
        INQR_END_DT: to.replace(/-/g, ''),
        PDNO: symbol,
        PRDT_TYPE_CD: productTypeCode,
        CTX_AREA_NK50: nk,
        CTX_AREA_FK50: fk,
      },
      trCont
    );
    rows.push(...asRows(res.output));
    if (res.trCont !== 'M' && res.trCont !== 'F') break;
    const ctx = res as unknown as Record<string, unknown>;
    fk = String(ctx.ctx_area_fk50 ?? '').trim();
    nk = String(ctx.ctx_area_nk50 ?? '').trim();
    trCont = 'N';
  }
  return rows;
}

/** 종목 → 맞는 상품유형코드(못 찾았으면 null). 앱이 종목의 거래소를 모르므로 512→513→529 순서로 찾아 저장한다. */
interface StoredOverseasProductTypes {
  [symbol: string]: { code: string | null; checkedOn: string };
}
const productTypeStore = () =>
  new JsonStore<StoredOverseasProductTypes>('kis-overseas-product-types.json', getDataDir(), {});
/** 못 찾은 종목은 이 기간 동안 다시 찾지 않는다(배당이 없는 종목마다 3번씩 부르지 않게). */
const PRODUCT_TYPE_MISS_RETRY_DAYS = 7;

/**
 * 한 미국 종목의 배당 권리(`from`~`to`, 현지 기준일) — 저장된 상품유형코드가 있으면 그것으로, 없으면 512→513→529 순서로
 * 결과가 나오는 코드를 찾아 저장한다. 저장된 코드로 0건이면(거래소 이전 등) 다시 찾는다.
 */
export async function fetchKisOverseasDividendRights(symbol: string, from: string, to: string): Promise<KisOverseasPeriodRight[]> {
  const today = kstToday();
  const saved = productTypeStore().read()[symbol];
  const remember = (code: string | null) =>
    productTypeStore().update((m) => ({ ...m, [symbol]: { code, checkedOn: today } }));

  if (saved?.code) {
    const rows = await fetchKisOverseasPeriodRightsFor(symbol, saved.code, from, to);
    if (rows.length) return rows;
  } else if (saved && Date.parse(today) - Date.parse(saved.checkedOn) < PRODUCT_TYPE_MISS_RETRY_DAYS * 864e5) {
    return [];
  }
  for (const code of US_PRODUCT_TYPE_CODES) {
    if (code === saved?.code) continue;
    const rows = await fetchKisOverseasPeriodRightsFor(symbol, code, from, to);
    if (rows.length) {
      remember(code);
      return rows;
    }
  }
  remember(null);
  return [];
}

/** 해외주식 현재가상세(`HHDFS76200200`, `overseas-price/v1/quotations/price-detail`, 공식 예제 `examples_llm/overseas_stock/price_detail`)
 *  한 행 — 관심종목 상세의 미국 종목 정보(PER·PBR·EPS·BPS·시가총액·52주 고저, 2026-11-19). 계좌 무관 시세 TR. */
export type KisOverseasPriceDetail = KisRow<'HHDFS76200200', 'output'>;

/** 거래소 코드는 종목코드만으로 모르니 나스닥 → 뉴욕 → 아멕스 순서로 시도한다(현재가가 비어 있으면 다음 거래소). 10분 캐시. 못 찾으면 null. */
export async function fetchKisOverseasPriceDetail(symbol: string): Promise<KisOverseasPriceDetail | null> {
  return withCache(`kis:overseasDetail:${symbol}`, 10 * 60 * 1000, async () => {
    for (const EXCD of ['NAS', 'NYS', 'AMS']) {
      const res = await kisGet('/uapi/overseas-price/v1/quotations/price-detail', 'HHDFS76200200', { AUTH: '', EXCD, SYMB: symbol });
      const row = asRows(res.output)[0];
      if (row && Number(row.last) > 0) return row;
    }
    return null;
  });
}
