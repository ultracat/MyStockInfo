// 매매내역 계산(순수 함수) — Trades.tsx에서 옮겼다(2026-11-17, 테스트: frontend/test/trades.test.ts).
import type { BrokerId, StoredTrade, TradeRecord } from '../types';
import type { TradeSummaryBucket } from '../components/TradesChart';

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
