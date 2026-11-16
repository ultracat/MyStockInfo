import { useEffect, useState } from 'react';
import { api } from '../../api';
import { API_BROKER_IDS } from '../../brokers';
import { buildAvgCostMap, type BrokerInvested, type BrokerSymbolCost } from '../../calc/dividends';
import type { BrokerId, StoredTrade } from '../../types';

/**
 * 증권사별 투자금(총 매입금액) — 배당 DB에는 없어 증권사 API(또는 CSV 전용 브로커의 로컬 보유종목)에서 계좌별로 받아 합산한다.
 * 같은 조회에서 종목별 평단가(avgCostByBroker)와 매매내역(tradesByBroker)도 받아 둔다 — 연도를 바꿀 때 서버를 다시 안 묻고
 * "그 해 말 기준 투자금"을 클라이언트에서 재구성하는 재료(calc/dividends.ts의 investedAsOf). `reload()`는 화면을 다시 볼 때 —
 * 이전 값을 둔 채 뒤에서 다시 받는다(첫 로딩만 "불러오는 중").
 */
export function useInvestedByBroker() {
  const [investedByBroker, setInvestedByBroker] = useState<Partial<Record<BrokerId, BrokerInvested>>>({});
  const [investedErrors, setInvestedErrors] = useState<Partial<Record<BrokerId, string>>>({});
  const [investedLoading, setInvestedLoading] = useState(true);
  const [avgCostByBroker, setAvgCostByBroker] = useState<Partial<Record<BrokerId, Map<string, BrokerSymbolCost>>>>({});
  const [tradesByBroker, setTradesByBroker] = useState<Partial<Record<BrokerId, StoredTrade[]>>>({});

  // 0 = 첫 로딩("불러오는 중" 표시), 1부터는 화면을 다시 볼 때 뒤에서 다시 받기(이전 값을 둔 채 바꾼다).
  const [investedReload, setInvestedReload] = useState(0);
  useEffect(() => {
    // 투자금(총 매입금액)은 배당 DB에는 없어 증권사 API에서 직접 계좌별로
    // 조회해 합산한다. 브로커 하나가 실패해도(미연동/레이트리밋 등) 나머지는
    // 계속 보여야 하므로 개별 try/catch로 감싼다 — backend/CLAUDE.md의 목록형
    // 엔드포인트 방침과 동일한 이유. 같은 조회에서 종목별 평단가와 매매내역도
    // 같이 받아둔다(avgCostByBroker/tradesByBroker) — "연도별 투자금 재구성"이
    // 연도를 바꿀 때마다 서버를 다시 안 묻고 클라이언트에서 즉시 계산하기 위함.
    let cancelled = false;

    void (async () => {
      if (investedReload === 0) setInvestedLoading(true);
      const brokers = await api.listBrokers().catch(() => []);
      if (cancelled) return;
      const configured = brokers.filter((b) => b.configured);

      const results = await Promise.all(
        configured.map(async (b) => {
          try {
            const tradesPromise = api.listTradesStore({ broker: b.id });
            // 먼저 시작해 두고 아래에서 기다린다 — 그 사이 계좌 조회가 실패해 이 Promise를 기다리지 않게 되면, 이것의 실패가
            // 처리 안 된 오류로 남는다. 처리된 것으로 표시만 해 둔다(실패 자체는 아래 await에서 그대로 catch로 간다).
            tradesPromise.catch(() => undefined);

            if (API_BROKER_IDS.includes(b.id)) {
              const accounts = await api.listAccounts(b.id);
              const portfolios = await Promise.all(accounts.map((a) => api.getPortfolio(b.id, a.id)));
              const totalKrw = portfolios.reduce((sum, p) => sum + p.totalPurchaseAmountKrw, 0);
              const totalUsd = portfolios.reduce((sum, p) => sum + (p.totalPurchaseAmountUsd ?? 0), 0);
              const avgCosts = buildAvgCostMap(portfolios.flatMap((p) => p.positions));
              const trades = await tradesPromise;
              return {
                id: b.id,
                invested: { krw: totalKrw, usd: totalUsd } as BrokerInvested | null,
                avgCosts,
                trades,
                error: null as string | null,
              };
            }

            // CSV 전용 브로커(KB/삼성/미래에셋)는 라이브 API가 없다 — 유일한
            // 투자금 소스는 로컬 저장소(holdings-store, CSV로 가져온 실제
            // 보유종목)라 그 매입금액을 통화별로 합산한다(Dashboard.tsx의
            // buildPortfolioFromStored와 같은 집계 방식).
            const holdings = await api.listHoldingsStore({ broker: b.id });
            const totalKrw = holdings.filter((h) => h.currency !== 'USD').reduce((sum, h) => sum + h.purchaseAmount, 0);
            const totalUsd = holdings.filter((h) => h.currency === 'USD').reduce((sum, h) => sum + h.purchaseAmount, 0);
            const avgCosts = buildAvgCostMap(holdings);
            const trades = await tradesPromise;
            return {
              id: b.id,
              invested: { krw: totalKrw, usd: totalUsd } as BrokerInvested | null,
              avgCosts,
              trades,
              error: null as string | null,
            };
          } catch (e) {
            return { id: b.id, invested: null, avgCosts: null, trades: [] as StoredTrade[], error: (e as Error).message };
          }
        })
      );
      if (cancelled) return;

      const invested: Partial<Record<BrokerId, BrokerInvested>> = {};
      const errors: Partial<Record<BrokerId, string>> = {};
      const avgCosts: Partial<Record<BrokerId, Map<string, BrokerSymbolCost>>> = {};
      const trades: Partial<Record<BrokerId, StoredTrade[]>> = {};
      for (const r of results) {
        if (r.invested !== null) invested[r.id] = r.invested;
        if (r.error) errors[r.id] = r.error;
        if (r.avgCosts) avgCosts[r.id] = r.avgCosts;
        trades[r.id] = r.trades;
      }
      setInvestedByBroker(invested);
      setInvestedErrors(errors);
      setAvgCostByBroker(avgCosts);
      setTradesByBroker(trades);
      setInvestedLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [investedReload]);

  return {
    investedByBroker,
    investedErrors,
    investedLoading,
    avgCostByBroker,
    tradesByBroker,
    reload: () => setInvestedReload((n) => n + 1),
  };
}
