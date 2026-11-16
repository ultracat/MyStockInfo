// 보유종목 합산(순수 함수) — Dashboard.tsx에서 옮겼다(2026-11-17, 테스트: frontend/test/portfolio.test.ts).
import type { BrokerId, HoldingPosition, PortfolioOverview, StoredHolding } from '../types';

/** 계좌 select의 특수값 — "이 브로커의 계좌를 전부 합쳐서 한 화면에 보여준다"는
 *  뜻이다(KB증권처럼 한 브로커에 계좌가 여러 개인 경우를 위함). 실제 accountId와
 *  충돌하지 않도록 사람이 입력할 리 없는 문자열로 뒀다. */
export const ALL_ACCOUNTS = '__ALL_ACCOUNTS__';

export function buildPortfolioFromStored(broker: BrokerId, accountId: string, rows: StoredHolding[]): PortfolioOverview {
  let purchaseKrw = 0;
  let purchaseUsd = 0;
  let marketKrw = 0;
  let marketUsd = 0;
  let plKrw = 0;
  let plUsd = 0;

  for (const r of rows) {
    if (r.currency === 'USD') {
      purchaseUsd += r.purchaseAmount;
      marketUsd += r.marketValue;
      plUsd += r.profitLossAmount;
    } else {
      purchaseKrw += r.purchaseAmount;
      marketKrw += r.marketValue;
      plKrw += r.profitLossAmount;
    }
  }

  const hasUsd = purchaseUsd !== 0 || marketUsd !== 0;

  return {
    broker,
    accountId,
    totalPurchaseAmountKrw: purchaseKrw,
    totalPurchaseAmountUsd: hasUsd ? purchaseUsd : null,
    totalMarketValueKrw: marketKrw,
    totalMarketValueUsd: hasUsd ? marketUsd : null,
    totalProfitLossKrw: plKrw,
    totalProfitLossUsd: hasUsd ? plUsd : null,
    profitLossRate: purchaseKrw > 0 ? plKrw / purchaseKrw : null,
    // CSV/Sheets 전용 브로커는 예수금을 알 방법이 없다 — 항상 null(화면에
    // "미지원"으로 고정 표시, AmountTile 대신 렌더링 분기 참고).
    cashBalanceKrw: null,
    cashBalanceUsd: null,
    positions: rows.map((r) => ({
      symbol: r.symbol,
      name: r.name,
      market: r.market,
      currency: r.currency,
      quantity: r.quantity,
      lastPrice: r.lastPrice,
      averagePurchasePrice: r.averagePurchasePrice,
      purchaseAmount: r.purchaseAmount,
      marketValue: r.marketValue,
      profitLossAmount: r.profitLossAmount,
      profitLossRate: r.profitLossRate,
      commission: r.commission,
      tax: r.tax,
      memo: r.memo,
    })),
  };
}

/** "전체 계좌" 모드 전용 — 계좌별로 이미 만들어진 PortfolioOverview 여러 개를 하나로
 *  합친다. 금액/손익은 통화별로 그대로 더하고(각 overview가 이미 hasUsd 여부를 KRW/USD
 *  로 나눠 갖고 있음), 포지션은 이어붙이되 어느 계좌에서 왔는지 `accountId`를 남겨서
 *  HoldingsTable이 "계좌" 열로 구분해 보여줄 수 있게 한다. */
export function mergePortfolios(
  broker: BrokerId,
  parts: { accountId: string; overview: PortfolioOverview }[]
): PortfolioOverview {
  let purchaseKrw = 0;
  let marketKrw = 0;
  let plKrw = 0;
  let purchaseUsd = 0;
  let marketUsd = 0;
  let plUsd = 0;
  let hasUsd = false;
  // 예수금은 계좌마다 있을 수도 없을 수도 있다(CSV 전용 계좌 중 아직 수동
  // 입력을 안 한 경우) — 하나라도 값이 있으면 나머지는 0으로 취급해 더하고,
  // 전부 없으면(null) "정보 없음"으로 남겨 사용자가 값이 아예 없다는 걸 알게 한다.
  let cashKrw: number | null = null;
  let cashUsd: number | null = null;
  const positions: HoldingPosition[] = [];

  for (const { accountId, overview } of parts) {
    purchaseKrw += overview.totalPurchaseAmountKrw;
    marketKrw += overview.totalMarketValueKrw;
    plKrw += overview.totalProfitLossKrw;
    if (overview.totalPurchaseAmountUsd !== null || overview.totalMarketValueUsd !== null) {
      hasUsd = true;
      purchaseUsd += overview.totalPurchaseAmountUsd ?? 0;
      marketUsd += overview.totalMarketValueUsd ?? 0;
      plUsd += overview.totalProfitLossUsd ?? 0;
    }
    if (overview.cashBalanceKrw !== null) cashKrw = (cashKrw ?? 0) + overview.cashBalanceKrw;
    if (overview.cashBalanceUsd !== null) cashUsd = (cashUsd ?? 0) + overview.cashBalanceUsd;
    for (const p of overview.positions) positions.push({ ...p, accountId });
  }

  return {
    broker,
    accountId: ALL_ACCOUNTS,
    totalPurchaseAmountKrw: purchaseKrw,
    totalPurchaseAmountUsd: hasUsd ? purchaseUsd : null,
    totalMarketValueKrw: marketKrw,
    totalMarketValueUsd: hasUsd ? marketUsd : null,
    totalProfitLossKrw: plKrw,
    totalProfitLossUsd: hasUsd ? plUsd : null,
    profitLossRate: purchaseKrw > 0 ? plKrw / purchaseKrw : null,
    cashBalanceKrw: cashKrw,
    cashBalanceUsd: cashUsd,
    positions,
  };
}
