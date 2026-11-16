// 보유종목 합산(순수 함수) — Dashboard.tsx에서 옮겼다(2026-11-17, 테스트: frontend/test/portfolio.test.ts).
import { findAccountLabel, formatAccountOption } from '../accountLabels';
import { groupDividendsByAccountSymbol } from '../dividendMatch';
import type { AccountLabel, BrokerId, DividendRecord, HoldingPosition, PortfolioOverview, StoredHolding } from '../types';

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

// ---------------------------------------------------------------- 보유 종목 표 행(2026-11-17 Dashboard.tsx에서 뺐다)

/**
 * 보유 종목 표의 행 — 포지션에 비중(weight), 배당 포함 손익용 배당(dividendAmount), "전체 계좌" 모드의 계좌 이름(accountLabel)을
 * 붙인다. 비중은 원화 기준(달러는 fxRate, 환율이 없으면 null — 조용히 틀린 숫자를 보여주지 않는다).
 *
 * 배당은 **이 계좌의 이 종목**에서 받은 것만(다른 계좌의 같은 종목은 "종목별 수익" 화면 몫). 포지션의 계좌는 "전체 계좌"
 * 모드면 mergePortfolios가 붙인 p.accountId, 개별 계좌 모드면 `selectedAccountId`. 배당 기록 쪽 계좌 매칭은 dividendMatch.ts
 * (대시보드와 공용). IRP처럼 같은 계좌의 같은 종목이 memo로 여러 행이면 수량 비율로 나눠 붙인다(통째로 더하면 이중 집계).
 * 배당은 포지션 통화로 맞춘다 — 통화가 같으면 그대로, 다르면 fxRate로, 환율이 없으면 null("환율 미적용").
 */
export function holdingRows(
  portfolio: PortfolioOverview,
  opts: {
    broker: BrokerId | null;
    /** 지금 고른 계좌(ALL_ACCOUNTS일 수 있음). */
    selectedAccountId: string | null;
    /** 그 증권사 계좌가 하나뿐이면 그 id — 계좌가 빈 배당 기록을 그 계좌 것으로 본다. */
    soleAccountId: string | null;
    dividends: DividendRecord[];
    accountLabels: AccountLabel[];
    fxRate: number | null;
  }
) {
  const { broker, selectedAccountId, soleAccountId, accountLabels, fxRate } = opts;
  const convertedValues = portfolio.positions.map((p) => {
    if (p.currency === 'KRW' || p.currency === null) return p.marketValue;
    if (p.currency === 'USD' && fxRate) return p.marketValue * fxRate;
    return null;
  });
  const total = convertedValues.reduce((sum: number, v) => sum + (v ?? 0), 0);

  const accountOf = (p: HoldingPosition) => p.accountId ?? (selectedAccountId !== ALL_ACCOUNTS ? selectedAccountId : null);
  const grouped = groupDividendsByAccountSymbol(
    broker ? opts.dividends.filter((d) => d.broker === broker) : [],
    accountLabels,
    () => soleAccountId
  );
  const divSums = new Map<string, { krw: number; usd: number }>();
  for (const [gk, list] of grouped) {
    const sum = { krw: 0, usd: 0 };
    for (const d of list) {
      if (d.currency === 'USD') sum.usd += d.amount;
      else sum.krw += d.amount;
    }
    // 키에서 broker를 떼고 "계좌|종목"만 남긴다 — 이 화면은 브로커가 하나뿐이라.
    divSums.set(gk.slice(gk.indexOf('|') + 1), sum);
  }
  const qtyByKey = new Map<string, { qty: number; count: number }>();
  for (const p of portfolio.positions) {
    const key = `${accountOf(p)}|${p.symbol}`;
    const e = qtyByKey.get(key) ?? { qty: 0, count: 0 };
    e.qty += p.quantity;
    e.count += 1;
    qtyByKey.set(key, e);
  }
  function dividendFor(p: HoldingPosition): number | null {
    const key = `${accountOf(p)}|${p.symbol}`;
    const sum = divSums.get(key);
    if (!sum) return 0;
    const g = qtyByKey.get(key)!;
    const share = g.count === 1 ? 1 : g.qty > 0 ? p.quantity / g.qty : 1 / g.count;
    if (p.currency === 'USD') {
      if (sum.krw === 0) return sum.usd * share;
      return fxRate ? (sum.usd + sum.krw / fxRate) * share : null;
    }
    if (sum.usd === 0) return sum.krw * share;
    return fxRate ? (sum.krw + sum.usd * fxRate) * share : null;
  }

  return portfolio.positions.map((p, i) => ({
    ...p,
    dividendAmount: dividendFor(p),
    weight: convertedValues[i] === null || total === 0 ? null : (convertedValues[i] as number) / total,
    // "전체 계좌" 모드(mergePortfolios가 채운 p.accountId)에서만 값이 붙는다 — HoldingsTable이 이 필드가 하나라도 있으면 "계좌" 열을 보여준다.
    accountLabel: p.accountId
      ? formatAccountOption({ id: p.accountId }, broker ? findAccountLabel(accountLabels, broker, p.accountId) : undefined)
      : undefined,
  }));
}

/** "총 손익금액(배당 포함)" 카드 — 표의 dividendAmount(포지션 통화 기준)를 통화별로 더한다(카드와 표가 어긋나지 않게 다시 집계하지 않음). */
export function dividendTotals(rows: { currency: string | null; dividendAmount: number | null }[]) {
  let krwSum = 0;
  let usdSum = 0;
  let unconverted = false;
  for (const r of rows) {
    if (r.dividendAmount === null) unconverted = true;
    else if (r.currency === 'USD') usdSum += r.dividendAmount;
    else krwSum += r.dividendAmount;
  }
  return { krw: krwSum, usd: usdSum, unconverted };
}
