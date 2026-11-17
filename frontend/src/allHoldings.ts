import { api } from './api';
import { API_BROKER_IDS } from './brokers';
import { loadUsdKrwRates } from './fxLoader';
import { effectiveRate } from './fx';
import type { BrokerId } from './types';

/** 모든 증권사·계좌의 보유 한 줄(원래 통화 기준) — 리밸런싱·보고서가 쓴다. */
export interface HoldingLine {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
}

/**
 * 모든 증권사·계좌의 보유 종목을 모은다 — 대시보드(`overview/useOverviewData.ts`의 loadAll)와 같은 경로: API 증권사는 계좌마다 실시간
 * 조회, CSV 전용(KB·삼성·미래에셋)은 로컬 저장소. 계좌 하나가 실패해도 나머지는 보여 준다. 모의투자 계좌는 받지 않는다(옵션 없이 부름).
 * 환율(수동 우선, fxLoader.ts)도 같이 받아 돌려준다 — 호출부가 원화로 합칠 때 쓴다.
 */
// 리밸런싱·보고서·배당수익률 카드가 각자 부르므로 진행 중인 요청을 같이 쓰고 30초 동안 결과를 재사용한다(새로고침이면 건너뜀) — 2026-11-17 UI 점검.
let cached: { at: number; value: { lines: HoldingLine[]; fxRate: number | null } } | null = null;
let pending: Promise<{ lines: HoldingLine[]; fxRate: number | null }> | null = null;

export function loadAllHoldings(opts: { forceRefresh?: boolean } = {}): Promise<{ lines: HoldingLine[]; fxRate: number | null }> {
  if (!opts.forceRefresh && cached && Date.now() - cached.at < 30_000) return Promise.resolve(cached.value);
  if (pending && !opts.forceRefresh) return pending;
  pending = fetchAllHoldings(opts)
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function fetchAllHoldings(opts: { forceRefresh?: boolean }): Promise<{ lines: HoldingLine[]; fxRate: number | null }> {
  const [{ manual, live }, brokers] = await Promise.all([loadUsdKrwRates(opts), api.listBrokers()]);
  const lines: HoldingLine[] = [];
  await Promise.all(
    brokers
      .filter((b) => b.configured)
      .map(async (b) => {
        const rows = API_BROKER_IDS.includes(b.id)
          ? await api
              .listAccounts(b.id, opts)
              .then((accounts) => Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id, opts).catch(() => null))))
              .then((ps) =>
                ps.filter((p): p is NonNullable<typeof p> => p !== null).flatMap((p) => p.positions.map((pos) => ({ ...pos, accountId: p.accountId })))
              )
              .catch(() => [])
          : await api.listHoldingsStore({ broker: b.id }).catch(() => []);
        for (const r of rows) {
          lines.push({
            broker: b.id,
            accountId: r.accountId ?? '',
            symbol: r.symbol,
            name: r.name,
            currency: r.currency,
            quantity: r.quantity,
            lastPrice: r.lastPrice,
            purchaseAmount: r.purchaseAmount,
            marketValue: r.marketValue,
            profitLossAmount: r.profitLossAmount,
          });
        }
      })
  );
  return { lines, fxRate: effectiveRate(manual, live) };
}
