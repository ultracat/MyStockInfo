// 한국투자증권 종목 상세(국내, 계좌 무관 시세 참조) — 재무비율·투자의견·뉴스·ETF 시세·구성종목. 공통부는 kisCore.ts.
import { withCache } from '../responseCache';
import { kisGet } from './kisCore';
// ---------------------------------------------------------------- 종목 상세(국내, 계좌 무관 시세 참조)
// 관심종목 상세가 쓴다 — 전부 공식 예제 examples_llm/domestic_stock/{finance_financial_ratio,invest_opinion,news_title},
// examples_llm/etfetn/{inquire_price,inquire_component_stock_price} 기준(2026-11-09 확인). 국내 6자리 코드만.
// 자주 안 바뀌는 값이라 길게 캐시한다(재무 1일, 투자의견·ETF 구성 6시간, 뉴스 10분).

export const asRows = (v: unknown): Record<string, string>[] =>
  Array.isArray(v) ? (v as Record<string, string>[]) : v && typeof v === 'object' ? [v as Record<string, string>] : [];

/** 재무비율(연간, `FHKST66430300`) — 결산년월·매출/영업이익/순이익 증가율·ROE·EPS·BPS·부채비율. 최신순. */
export async function fetchKisFinancialRatio(symbol: string): Promise<Record<string, string>[]> {
  return withCache(`kis:fin-ratio:${symbol}`, 24 * 3600_000, async () => {
    const res = await kisGet('/uapi/domestic-stock/v1/finance/financial-ratio', 'FHKST66430300', {
      FID_DIV_CLS_CODE: '0',
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: symbol,
    });
    return asRows(res.output);
  });
}

/** 증권사 투자의견(`FHKST663300C0`, 기간 YYYY-MM-DD) — 날짜·의견·직전 의견·목표가·증권사(`mbcr_name`). */
export async function fetchKisInvestOpinion(symbol: string, from: string, to: string): Promise<Record<string, string>[]> {
  return withCache(`kis:opinion:${symbol}:${from}:${to}`, 6 * 3600_000, async () => {
    const res = await kisGet('/uapi/domestic-stock/v1/quotations/invest-opinion', 'FHKST663300C0', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_COND_SCR_DIV_CODE: '16633',
      FID_INPUT_ISCD: symbol,
      FID_INPUT_DATE_1: `00${from.replace(/-/g, '')}`,
      FID_INPUT_DATE_2: `00${to.replace(/-/g, '')}`,
    });
    return asRows(res.output);
  });
}

/** 시황·공시 제목(`FHKST01011800`) — 그 종목이 등록된 최신 뉴스/공시 제목(첫 페이지만). */
export async function fetchKisNewsTitles(symbol: string): Promise<Record<string, string>[]> {
  return withCache(`kis:news:${symbol}`, 10 * 60_000, async () => {
    const res = await kisGet('/uapi/domestic-stock/v1/quotations/news-title', 'FHKST01011800', {
      FID_NEWS_OFER_ENTP_CODE: '',
      FID_COND_MRKT_CLS_CODE: '',
      FID_INPUT_ISCD: symbol,
      FID_TITL_CNTT: '',
      FID_INPUT_DATE_1: '',
      FID_INPUT_HOUR_1: '',
      FID_RANK_SORT_CLS_CODE: '',
      FID_INPUT_SRNO: '',
    });
    return asRows(res.output);
  });
}

/** ETF/ETN 현재가(`FHPST02400000`) — NAV·추적오차율·순자산·구성 종목 수·배당 주기. ETF가 아니면 빈 값이 온다. */
export async function fetchKisEtfPrice(symbol: string): Promise<Record<string, string> | null> {
  return withCache(`kis:etf-price:${symbol}`, 60_000, async () => {
    const res = await kisGet('/uapi/etfetn/v1/quotations/inquire-price', 'FHPST02400000', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: symbol,
    });
    return asRows(res.output)[0] ?? null;
  });
}

/** ETF 구성종목시세(`FHKST121600C0`) — output1 = ETF 요약(NAV 등), output2 = 구성 종목(코드·이름·비중·평가금액). */
export async function fetchKisEtfComponents(
  symbol: string
): Promise<{ summary: Record<string, string> | null; components: Record<string, string>[] }> {
  return withCache(`kis:etf-components:${symbol}`, 6 * 3600_000, async () => {
    const res = await kisGet('/uapi/etfetn/v1/quotations/inquire-component-stock-price', 'FHKST121600C0', {
      FID_COND_MRKT_DIV_CODE: 'J',
      FID_INPUT_ISCD: symbol,
      FID_COND_SCR_DIV_CODE: '11216',
    });
    return { summary: asRows(res.output1)[0] ?? null, components: asRows(res.output2) };
  });
}
