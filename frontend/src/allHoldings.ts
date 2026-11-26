import { api } from './api';
import { API_BROKER_IDS, BROKER_LABELS } from './brokers';
import { loadUsdKrwRates } from './fxLoader';
import { effectiveRate } from './fx';
import { marketLabel } from './calc/portfolio';
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
 * 모든 증권사·계좌의 보유 종목을 모은다 — **대시보드·분석(`overview/overviewStore.ts`)·리밸런싱·보고서·배당수익률 카드가 모두 이 한 경로**(2026-11-18 —
 * 예전엔 대시보드가 같은 규칙을 따로 갖고 있어 고칠 때 두 곳을 맞춰야 했다): API 증권사는 계좌마다 실시간
 * 조회, CSV 전용(KB·삼성·미래에셋)은 로컬 저장소. 계좌 하나가 실패해도 나머지는 보여 준다. 모의투자 계좌는 받지 않는다(옵션 없이 부름).
 * 환율(수동 우선, fxLoader.ts)도 같이 받아 돌려준다 — 호출부가 원화로 합칠 때 쓴다.
 */
// 리밸런싱·보고서·배당수익률 카드가 각자 부르므로 진행 중인 요청을 같이 쓰고 30초 동안 결과를 재사용한다(새로고침이면 건너뜀) — 2026-11-17 UI 점검.
export interface AllHoldings {
  lines: HoldingLine[];
  /** 수동 우선 적용 환율(`effectiveRate`). */
  fxRate: number | null;
  /** 설정의 수동 환율·실시간 환율 따로(대시보드가 안내 문구에 씀). */
  manualFxRate: number | null;
  liveFxRate: number | null;
  /** 계좌 목록·보유 조회가 실패한 증권사 — 나머지는 그대로 보여 주고 화면이 알린다. */
  failedBrokers: BrokerId[];
  /**
   * 계좌 목록은 받았지만 그 계좌의 보유 조회만 실패한 것(2026-11-26) — 예전엔 조용히 빠져 대시보드 합계가 줄어든 채
   * 순자산 기록에 남았다. 증권사 전체가 실패하면 `failedBrokers`에만 들어간다.
   */
  failedAccounts: { broker: BrokerId; accountId: string }[];
  /** 보유는 받았지만 일부 시장(해외 잔고)만 못 받은 계좌 — 그 시장 종목이 합계에서 빠져 있다(PortfolioOverview.failedMarkets). */
  partialAccounts: { broker: BrokerId; accountId: string; markets: string[] }[];
}

/** 일부 증권사·계좌를 못 받았을 때 화면에 띄울 문구(합계에서 빠졌다는 안내) — 다 받았으면 null. */
export function holdingsFailureMessage(
  all: Pick<AllHoldings, 'failedBrokers' | 'failedAccounts'> & Partial<Pick<AllHoldings, 'partialAccounts'>>
): string | null {
  const parts = all.failedBrokers.map((b) => BROKER_LABELS[b]);
  const accountCounts = new Map<BrokerId, number>();
  for (const f of all.failedAccounts) accountCounts.set(f.broker, (accountCounts.get(f.broker) ?? 0) + 1);
  for (const [b, n] of accountCounts) parts.push(`${BROKER_LABELS[b]} 계좌 ${n}개`);
  // 해외 잔고만 실패한 계좌 — "토스증권 계좌 1개의 미국 잔고"(순자산 기록도 이 문구가 있으면 건너뛴다, overviewStore.ts)
  const partialCounts = new Map<string, { broker: BrokerId; markets: string; n: number }>();
  for (const p of all.partialAccounts ?? []) {
    const markets = p.markets.map(marketLabel).join('·');
    const key = `${p.broker}|${markets}`;
    const cur = partialCounts.get(key) ?? { broker: p.broker, markets, n: 0 };
    cur.n++;
    partialCounts.set(key, cur);
  }
  for (const { broker, markets, n } of partialCounts.values()) parts.push(`${BROKER_LABELS[broker]} 계좌 ${n}개의 ${markets} 잔고`);
  return parts.length ? `${parts.join('·')}를 불러오지 못해 합계에서 빠졌습니다.` : null;
}

let cached: { at: number; value: AllHoldings } | null = null;
let pending: Promise<AllHoldings> | null = null;

/** 테스트용 — 캐시를 비운다. */
export function resetAllHoldingsCache(): void {
  cached = null;
  pending = null;
}

/**
 * `forceRefresh`: 백엔드 캐시까지 건너뜀(새로고침 버튼). `skipCache`: 이 모듈의 30초 재사용만 건너뜀 — 데이터가 바뀐 뒤(CSV 가져오기 등)
 * 다시 받을 때. 진행 중인 받기가 있으면 그건 같이 기다린다(방금 시작한 받기는 바뀐 데이터를 이미 본다).
 */
export function loadAllHoldings(opts: { forceRefresh?: boolean; skipCache?: boolean } = {}): Promise<AllHoldings> {
  if (!opts.forceRefresh && !opts.skipCache && cached && Date.now() - cached.at < 30_000) return Promise.resolve(cached.value);
  if (pending && !opts.forceRefresh) return pending;
  pending = fetchAllHoldings({ forceRefresh: opts.forceRefresh })
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function fetchAllHoldings(opts: { forceRefresh?: boolean }): Promise<AllHoldings> {
  const [{ manual, live }, brokers] = await Promise.all([loadUsdKrwRates(opts), api.listBrokers()]);
  const lines: HoldingLine[] = [];
  const failedBrokers: BrokerId[] = [];
  const failedAccounts: { broker: BrokerId; accountId: string }[] = [];
  const partialAccounts: { broker: BrokerId; accountId: string; markets: string[] }[] = [];
  await Promise.all(
    brokers
      .filter((b) => b.configured)
      .map(async (b) => {
        const rows = API_BROKER_IDS.includes(b.id)
          ? await api
              .listAccounts(b.id, opts)
              .then((accounts) =>
                Promise.all(
                  accounts.map((a) =>
                    api.getPortfolio(b.id, a.id, opts).catch(() => {
                      failedAccounts.push({ broker: b.id, accountId: a.id });
                      return null;
                    })
                  )
                )
              )
              .then((ps) => {
                const got = ps.filter((p): p is NonNullable<typeof p> => p !== null);
                for (const p of got) if (p.failedMarkets?.length) partialAccounts.push({ broker: b.id, accountId: p.accountId, markets: p.failedMarkets });
                return got.flatMap((p) => p.positions.map((pos) => ({ ...pos, accountId: p.accountId })));
              })
              .catch(() => {
                failedBrokers.push(b.id);
                return [];
              })
          : await api.listHoldingsStore({ broker: b.id }).catch(() => {
              failedBrokers.push(b.id);
              return [];
            });
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
  return { lines, fxRate: effectiveRate(manual, live), manualFxRate: manual, liveFxRate: live, failedBrokers, failedAccounts, partialAccounts };
}
