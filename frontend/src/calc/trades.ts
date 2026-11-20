// 매매내역 계산(순수 함수) — Trades.tsx에서 옮겼다(2026-11-17, 테스트: frontend/test/trades.test.ts).
import type { BrokerId, StoredTrade, TradeRecord } from '../types';
import type { TradeSummaryBucket } from '../components/TradesChart';
import { krw, usdFmt } from '../format';
import { toKrw } from '../fx';
import { sortByText, sortByValue } from './sort';

/** 매매내역 목록(하단 표) 한 행의 공용 모양 — 개별 브로커 모드(TradeRecord, 위쪽
 *  select가 이미 broker/accountId를 알고 있음)와 전체보기 모드(StoredTrade,
 *  행마다 broker/accountId가 다름)를 같은 렌더링/수정/삭제 로직으로 다루기 위해
 *  둘 다 이 모양으로 정규화한다 — `displayTrades` 참고. */
export interface DisplayTrade {
  broker: BrokerId;
  accountId: string;
  id: string;
  symbol: string;
  name: string | null;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  amount: number;
  currency: string;
  commission: number | null;
  tax: number | null;
  executedAt: string;
}

export function mapStoredTrade(t: StoredTrade): TradeRecord {
  return {
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    amount: t.amount,
    currency: t.currency,
    commission: t.commission,
    tax: t.tax,
    executedAt: t.executedAt,
  };
}

export function tradeKey(t: DisplayTrade): string {
  return `${t.broker}|${t.accountId}|${t.id}`;
}

// 수동 입력(매매내역 추가)/인라인 수정 둘 다 체결금액을 따로 입력받지 않고
// 수량*단가로 계산한다 — CSV 전용 브로커는 브로커가 내려주는 별도 체결금액이
// 없어(사용자가 직접 기록하는 값) 수량/단가만 정확하면 체결금액은 항상 그 곱과
// 같아야 하고, 따로 입력받으면 두 값이 어긋날 위험만 생긴다. 입력칸이 아직 비어
// 있거나 숫자가 아니면 0을 보여준다(완성 전 중간 상태).
export function computeAmount(quantity: string, price: string): number {
  const q = Number(quantity);
  const p = Number(price);
  return Number.isFinite(q) && Number.isFinite(p) ? q * p : 0;
}

// 체결금액(amount)은 체결 그 자체의 금액(수량*단가)이고 수수료/세금은 별도
// 필드다 — 화면에 보여주는 "체결금액"은 수수료·세금을 더한 값으로 계산한다
// (매수/매도 구분 없이 항상 더함 — 표에서도, 매매내역 추가/인라인 수정의
// 자동계산 미리보기에서도 같은 공식을 쓴다). KIS는 이 두 필드를 아직 안
// 내려줘서(commission/tax 항상 null) 사실상 토스/KB증권/CSV·수동 입력 행에만
// 차이가 생긴다.
export function netTradeAmount(amount: number, commission: number | null, tax: number | null) {
  return amount + (commission ?? 0) + (tax ?? 0);
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function accumulate(row: TradeSummaryBucket, t: { side: 'BUY' | 'SELL'; currency: string; amount: number }) {
  const isUsd = t.currency === 'USD';
  if (t.side === 'BUY') {
    if (isUsd) row.buyUsd += t.amount;
    else row.buyKrw += t.amount;
  } else {
    if (isUsd) row.sellUsd += t.amount;
    else row.sellKrw += t.amount;
  }
}

// ---------------------------------------------------------------- 매매내역 화면 집계(2026-11-17 Trades.tsx에서 뺐다)

export type ViewMode = 'year' | 'month';

/** 표·폼의 금액 표시 — 달러는 $, 원화는 반올림한 원. */
export function formatTradeAmount(amount: number, currency: string) {
  return currency === 'USD' ? usdFmt.format(amount) : `${krw.format(Math.round(amount))}원`;
}

/**
 * 그래프 막대 — 연간 보기면 그 해 거래(periodTrades)를 12개월로, 월간 보기면 그 달 거래(visibleTrades)를 날짜 수만큼 일별로.
 * 원화·달러는 합치지 않고 따로 쌓는다(TradesChart가 패널을 나눔).
 */
export function tradeBuckets(
  periodTrades: TradeAmountLike[],
  visibleTrades: TradeAmountLike[],
  viewMode: ViewMode,
  year: number,
  month: number
): TradeSummaryBucket[] {
  const empty = (label: string): TradeSummaryBucket => ({ label, buyKrw: 0, buyUsd: 0, sellKrw: 0, sellUsd: 0 });
  if (viewMode === 'year') {
    const rows = Array.from({ length: 12 }, (_, i) => empty(String(i + 1).padStart(2, '0')));
    for (const t of periodTrades) {
      const monthIdx = Number(t.executedAt.slice(5, 7)) - 1;
      if (monthIdx < 0 || monthIdx > 11) continue;
      accumulate(rows[monthIdx], t);
    }
    return rows;
  }
  const numDays = daysInMonth(year, month);
  const rows = Array.from({ length: numDays }, (_, i) => empty(String(i + 1)));
  for (const t of visibleTrades) {
    const day = Number(t.executedAt.slice(8, 10));
    if (day < 1 || day > numDays) continue;
    accumulate(rows[day - 1], t);
  }
  return rows;
}

type TradeAmountLike = { side: 'BUY' | 'SELL'; currency: string; amount: number; executedAt: string };

/** 상단 타일 — 통화별 매수·매도 합계(원본 amount, 수수료·세금 제외)와 건수. */
export function tradeTotals(trades: TradeAmountLike[]) {
  let buyKrw = 0;
  let buyUsd = 0;
  let sellKrw = 0;
  let sellUsd = 0;
  let buyCount = 0;
  let sellCount = 0;
  for (const t of trades) {
    const isUsd = t.currency === 'USD';
    if (t.side === 'BUY') {
      buyCount += 1;
      if (isUsd) buyUsd += t.amount;
      else buyKrw += t.amount;
    } else {
      sellCount += 1;
      if (isUsd) sellUsd += t.amount;
      else sellKrw += t.amount;
    }
  }
  return { buyKrw, buyUsd, sellKrw, sellUsd, buyCount, sellCount };
}

/** 개별 브로커 모드의 TradeRecord(브로커·계좌 없음)를 목록이 쓰는 DisplayTrade로 — 위에서 고른 브로커·계좌를 채운다. */
export function toDisplayTrades(trades: TradeRecord[], broker: BrokerId, accountId: string): DisplayTrade[] {
  return trades.map((t) => ({
    broker,
    accountId,
    id: t.id,
    symbol: t.symbol,
    name: t.name,
    side: t.side,
    quantity: t.quantity,
    price: t.price,
    amount: t.amount,
    currency: t.currency,
    commission: t.commission,
    tax: t.tax,
    executedAt: t.executedAt,
  }));
}

export type TradeSortKey = 'date' | 'name' | 'amount';

/**
 * 매매내역 표 정렬(2026-11-20) — 일자(같은 날은 원래 순서), 종목(이름 가나다), 체결금액(수수료·세금 포함, 달러는 `fxRate`로 원화 환산 —
 * 환율이 없으면 달러 행은 맨 뒤). 비교는 calc/sort.ts.
 */
export function sortTrades<T extends DisplayTrade>(rows: T[], key: TradeSortKey, asc: boolean, fxRate: number | null): T[] {
  if (key === 'name') return sortByText(rows, (t) => t.name || t.symbol, asc);
  if (key === 'amount')
    return sortByValue(rows, (t) => toKrw(netTradeAmount(t.amount, t.commission, t.tax), t.currency, fxRate), asc);
  return sortByText(rows, (t) => t.executedAt, asc);
}
