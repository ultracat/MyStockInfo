// 연말 절세 도우미(실현손익 화면) — 순수 함수, 테스트 frontend/test/analysis.test.ts.
//
// 해외 상장 주식 양도소득세는 그해(결제일 기준) 손익을 합쳐 250만원 공제 후 22%다. 그래서 연말 전에
// ① 평가손실 종목을 팔면 이익과 상계돼 세금이 준다(손실 확정 — 한국엔 미국식 wash sale 규칙이 없어 다시 사도 된다),
// ② 올해 순이익이 공제보다 적으면 남은 공제만큼 평가이익을 세금 없이 실현할 수 있다(취득가를 높여 두는 효과).
// 대상은 일반 계좌의 해외 상장(통화가 원화가 아닌) 보유뿐 — ISA·연금과 국내 상장(국내 상장 해외 ETF 포함, 배당소득 과세)은 뺀다.
// 평가손익은 원화 환산 근사(지금 환율 × 달러 평가손익)라 실제 신고액(취득일 환율 기준)과 다를 수 있다.
import { TAX_FREE_ALLOWANCE_KRW, TAX_RATE } from './realizedGains';

export interface YearEndHolding {
  broker: string;
  accountId: string;
  symbol: string;
  name: string;
  currency: string | null;
  /** 원래 통화 평가손익. */
  profitLossAmount: number;
}

export interface YearEndPlan {
  realizedKrw: number;
  taxNowKrw: number;
  /** 세금 없이 더 실현할 수 있는 이익(공제 − 순이익, 순손실이면 그만큼 더 큼). */
  taxFreeRoomKrw: number;
  losers: Array<{ symbol: string; name: string; lossKrw: number }>;
  gainers: Array<{ symbol: string; name: string; gainKrw: number }>;
  /** 손실 종목을 모두 팔면 줄어드는 세금. */
  harvestSavingKrw: number;
  totalLossKrw: number;
}

export function yearEndPlan(
  realizedOverseasKrw: number,
  holdings: YearEndHolding[],
  isGeneral: (broker: string, accountId: string) => boolean,
  usdRate: number | null
): YearEndPlan {
  const bySymbol = new Map<string, { name: string; krw: number }>();
  for (const h of holdings) {
    if (!h.currency || h.currency === 'KRW' || !isGeneral(h.broker, h.accountId)) continue;
    const rate = h.currency === 'USD' ? usdRate : null;
    if (!rate) continue;
    const cur = bySymbol.get(h.symbol) ?? { name: h.name, krw: 0 };
    cur.krw += h.profitLossAmount * rate;
    bySymbol.set(h.symbol, cur);
  }
  const all = [...bySymbol.entries()].map(([symbol, v]) => ({ symbol, name: v.name, krw: Math.round(v.krw) }));
  const losers = all.filter((x) => x.krw < 0).map((x) => ({ symbol: x.symbol, name: x.name, lossKrw: -x.krw })).sort((a, b) => b.lossKrw - a.lossKrw);
  const gainers = all.filter((x) => x.krw > 0).map((x) => ({ symbol: x.symbol, name: x.name, gainKrw: x.krw })).sort((a, b) => b.gainKrw - a.gainKrw);
  const tax = (gain: number) => Math.round(Math.max(0, gain - TAX_FREE_ALLOWANCE_KRW) * TAX_RATE);
  const totalLossKrw = losers.reduce((s, x) => s + x.lossKrw, 0);
  const taxNowKrw = tax(realizedOverseasKrw);
  return {
    realizedKrw: Math.round(realizedOverseasKrw),
    taxNowKrw,
    taxFreeRoomKrw: Math.max(0, Math.round(TAX_FREE_ALLOWANCE_KRW - realizedOverseasKrw)),
    losers,
    gainers,
    harvestSavingKrw: taxNowKrw - tax(realizedOverseasKrw - totalLossKrw),
    totalLossKrw,
  };
}
