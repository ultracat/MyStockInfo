// 프론트엔드의 HOLDINGS_CSV_HEADER(Dashboard.tsx)/TRADES_CSV_HEADER(Trades.tsx)/
// DIVIDEND_CSV_HEADER(Dividends.tsx)와 컬럼 이름·순서를 그대로 맞춘다 — CSV
// export/import와 같은 모양이어야 두 경로를 오가며 데이터를 옮길 수 있다.
// 프론트/백엔드가 별도 워크스페이스라 상수를 공유할 수 없어 값만 동일하게 둔다.

export const HOLDINGS_SHEET_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'quantity',
  'averagePurchasePrice',
  'lastPrice',
  'purchaseAmount',
  'marketValue',
  'profitLossAmount',
  'profitLossRate',
  'commission',
  'tax',
  'currency',
  'market',
  'memo',
];

export const TRADES_SHEET_HEADER = [
  'broker',
  'accountId',
  'symbol',
  'name',
  'side',
  'quantity',
  'price',
  'amount',
  'currency',
  'executedAt',
  'commission',
  'tax',
  // 맨 뒤에 둔다 — 가져오기는 헤더 이름으로 컬럼을 찾으므로 이 컬럼이 없는
  // 예전 시트도 그대로 읽힌다(db/tradesStore.ts의 "중복 방지" 참고).
  'id',
];

export const DIVIDENDS_SHEET_HEADER = ['broker', 'accountId', 'symbol', 'currency', 'amount', 'paidDate', 'memo'];

export type SheetDataType = 'holdings' | 'trades' | 'dividends';

export const SHEET_DATA_TYPES: SheetDataType[] = ['holdings', 'trades', 'dividends'];

export const SHEET_TAB_TITLES: Record<SheetDataType, string> = {
  holdings: 'Holdings',
  trades: 'Trades',
  dividends: 'Dividends',
};
