export type BrokerId = 'toss' | 'kis' | 'kb' | 'samsung' | 'mirae';

export interface BrokerSummary {
  id: BrokerId;
  displayName: string;
  configured: boolean;
}

export interface BrokerAccount {
  id: string;
  accountNumber?: string;
  accountType?: string;
}

/** `(broker, accountId)` → 사람이 읽을 수 있는 별칭. Settings.tsx에서만 관리하고
 *  Dashboard.tsx/Trades.tsx/Dividends.tsx는 표시할 때 읽기만 한다. */
/** 종목별 외부 링크(사용자 입력분만 — 자동 링크는 `stockLinks.ts`가 계산). `url`이
 *  빈 문자열이면 "링크 없음"을 명시적으로 고른 것. */
export interface StockLinkEntry {
  symbol: string;
  url: string;
  updatedAt: string;
}

export interface AccountLabel {
  broker: BrokerId;
  accountId: string;
  label?: string;
  /** 표시용 계좌번호 — accountId가 사람이 읽는 번호가 아닌 토스증권(accountSeq)용. */
  accountNumber?: string;
}

export interface HoldingPosition {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  profitLossRate: number;
  commission: number | null;
  tax: number | null;
  /** CSV 가져오기에서만 채워진다(예: IRP 계좌의 "개인납입액"/"회사납입액") — 같은
   *  심볼이 한 계좌에 여러 행으로 있을 때 구분하는 자유 텍스트. */
  memo?: string | null;
  /** Dashboard.tsx의 "전체 계좌" 모드에서만 채워진다 — 여러 계좌의 포지션을 한 화면에
   *  합칠 때, 이 포지션이 어느 계좌 것인지 표시하기 위한 필드(서버 응답엔 없음). */
  accountId?: string;
}

export interface PortfolioOverview {
  broker: BrokerId;
  accountId: string;
  totalPurchaseAmountKrw: number;
  totalPurchaseAmountUsd: number | null;
  totalMarketValueKrw: number;
  totalMarketValueUsd: number | null;
  totalProfitLossKrw: number;
  totalProfitLossUsd: number | null;
  profitLossRate: number | null;
  /** 예수금(현금 보유분) — API 연동 브로커(토스/KIS)만 채워진다. 브로커 API가
   *  못 주거나 조회가 실패하면 null(Dashboard.tsx가 "정보 없음"으로 표시).
   *  CSV/Sheets 전용 브로커(KB/삼성/미래에셋)는 값을 알 방법이 없어 이 필드
   *  자체를 안 쓰고 화면에 "미지원"으로 고정 표시한다. */
  cashBalanceKrw: number | null;
  cashBalanceUsd: number | null;
  positions: HoldingPosition[];
}

/** 로컬 저장소(backend/src/db/holdingsStore.ts)에 저장된 보유종목 스냅샷 한 줄 —
 *  실시간 조회(`GET /api/holdings/:broker/:accountId`) 성공 시 write-through로
 *  갱신되거나, CSV 가져오기로 채워진다. */
export interface StoredHolding {
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  quantity: number;
  lastPrice: number;
  averagePurchasePrice: number;
  purchaseAmount: number;
  marketValue: number;
  profitLossAmount: number;
  profitLossRate: number;
  commission: number | null;
  tax: number | null;
  memo: string | null;
  updatedAt: string;
}

/** 로컬 저장소(backend/src/db/tradesStore.ts)에 저장된 매매내역 한 줄. */
/** CSV/Sheets 가져오기 응답 — backend `routes/importResult.ts`와 같은 모양. */
export interface ImportResult {
  added: number;
  failed: { row: number; error: string }[];
  /** API·동기화 계좌 행이라 건너뛴 수(실패 아님). */
  skipped: number;
  /** Sheets 가져오기에서 실패 행이 있어 아무것도 바꾸지 않았음. */
  aborted?: boolean;
}

export interface StoredTrade {
  broker: BrokerId;
  accountId: string;
  id: string;
  symbol: string;
  /** KIS/KB는 체결 내역 API가 종목명을 같이 내려줘서 자동으로 채워진다. 토스는
   *  체결 API에 종목명이 없어 백엔드가 stockNameResolver로 별도 조회해 채운다.
   *  CSV 가져오기는 name 컬럼이 있으면 그 값을, 없으면 같은 조회로 채운다. */
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

export type DividendCurrency = 'KRW' | 'USD';

export interface DividendRecord {
  id: string;
  broker: BrokerId;
  /** 브로커 안에서 계좌를 구분하기 위한 선택 필드(예: KB증권 한 곳에 여러 계좌가
   *  있는 경우) — 없으면 null. holdings-store/trades-store의 accountId와 같은
   *  문자열을 쓰면 그 화면들과도 같은 계좌로 매칭된다. */
  accountId: string | null;
  symbol: string;
  name: string;
  currency: DividendCurrency;
  /** Amount in `currency` — not converted (frontend converts USD rows to KRW for combined totals). */
  amount: number;
  paidDate: string;
  memo: string | null;
  /** 원천징수 세금(`currency` 기준, 모르면 null). `amount`는 세후 실수령액, 세전 = amount + tax. */
  tax: number | null;
}

/** POST /api/dividends/sync 응답의 증권사 하나 — backend/src/brokers/dividendSyncTypes.ts와 같은 모양.
 *  그 증권사 API 계좌의 배당 기록은 API 내용으로 통째로 교체된다. */
export interface DividendSyncResult {
  broker: BrokerId;
  added: number;
  removed: number;
  unchanged: number;
  total: number;
  byKind: { dividend: number; etfDistribution: number; taxRefund: number };
  skipped: number;
}

/** 토스 시장 정보 보조 기능(백엔드 src/marketInsights.ts) 응답들. */
export type MarketSession = 'day' | 'pre' | 'regular' | 'after' | 'closed';
export interface MarketStatus {
  session: MarketSession;
  holidayToday: boolean;
  nextBusinessDay: string | null;
}
export interface ActiveWarning {
  type: string;
  label: string;
  startDate: string | null;
  endDate: string | null;
}

/** 다가오는 배당(백엔드 upcomingDividends.ts) — 확정은 한국투자증권 계좌 권리, 예상은 예탁원 일정 × 보유 수량. */
export interface UpcomingDividend {
  status: 'confirmed' | 'estimated';
  broker: BrokerId;
  accountId: string;
  symbol: string;
  name: string;
  currency: 'KRW' | 'USD';
  payDate: string | null;
  recordDate: string | null;
  quantity: number;
  perShare: number | null;
  /** 세전. */
  grossAmount: number;
  tax: number | null;
  source: 'kis-account' | 'ksd-schedule';
}

/** 한국투자증권 기간별매매손익(TTTC8715R) 매도 한 줄 — 원. */
export interface KisRealizedRow {
  date: string;
  symbol: string;
  name: string;
  quantity: number;
  sellAmount: number;
  buyAmount: number;
  realized: number;
  fee: number;
  tax: number;
}

export interface MonthlySummaryRow {
  month: string;
  totalKrw: number;
  totalUsd: number;
  count: number;
}

// CSV 전용 브로커(KB/삼성/미래에셋)는 자격증명이 없어 이 응답에 값이 없을 수
// 있다 — Partial. 고정 필드 대신 BrokerId로 인덱싱할 수 있어야 해서 Record로 바꿈.
export type CredentialStatus = Partial<Record<BrokerId, boolean>>;

/** `GET /settings/secure-storage` — backend `secureStorage.ts`. `available`이 false면
 *  (키링 없는 Linux 등) 자격증명 저장과 Google 연결을 서버가 409로 거부한다. */
export interface SecureStorageStatus {
  available: boolean;
  message: string | null;
  linuxBackend: string | null;
  /** 평문이거나 약한 키로 저장돼 있을 수 있는 자격증명 — 해제 후 다시 입력해야 안전. */
  insecureBrokers: BrokerId[];
  insecureGoogle: boolean;
}

export interface ExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  midRate: number | null;
  asOf: string | null;
}

export interface CredentialFieldSpec {
  key: string;
  label: string;
  secret: boolean;
  placeholder?: string;
  /** "이 필드가 계좌 정보다" 표시 — Settings.tsx의 "증권사 연동 상태" 표가
   *  API 키 문자열까지 노출하지 않고 계좌번호류만 골라 보여주는 데 쓴다. */
  kind?: 'account';
}

export interface TradeRecord {
  id: string;
  symbol: string;
  /** Not every broker's execution-history API returns a display name (Toss's doesn't) — falls back to symbol in the UI. */
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

export interface StockInfo {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
}

/** ISA/연금저축/IRP처럼 매매차익에 일반 해외주식 양도소득세(22%)가 아니라
 *  완전히 다른 과세 체계가 적용되는 계좌 분류 — 저장 안 돼 있으면
 *  'GENERAL'(일반계좌)로 취급한다. `RealizedGains.tsx`에서만 쓴다. */
export type AccountTaxType = 'GENERAL' | 'ISA' | 'PENSION_SAVINGS' | 'IRP';

export interface AccountTaxTypeEntry {
  broker: BrokerId;
  accountId: string;
  taxType: AccountTaxType;
}

/** 보유하지 않은 종목을 가격만 추적하려고 등록해두는 목록 — `lastPrice`는
 *  저장되지 않고 조회할 때마다 서버가 라이브로 채워서 내려준다. */
export interface WatchlistEntry {
  symbol: string;
  name: string;
  market: string | null;
  currency: string | null;
  addedAt: string;
  lastPrice: number | null;
}

/** 하루 한 번(앱 진입 시) 기록되는 전체 브로커/계좌 합산 KRW 환산 총액 — 이
 *  기능을 쓰기 시작한 날부터만 쌓이는 실제 기록(과거 소급 불가). */
export interface SnapshotRecord {
  date: string;
  totalMarketValueKrw: number;
  totalPurchaseAmountKrw: number;
  totalProfitLossKrw: number;
}

export interface OssPackageInfo {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
  author: string | null;
  copyright: string | null;
  nodeVersion: string;
  electronVersion: string | null;
  chromeVersion: string | null;
  packages: OssPackageInfo[];
}

/** POST /api/backup/restore 응답 — secrets는 API 키·Google 연결을 어떻게 했는지
 *  (backend/src/backup.ts의 RestoreResult), restarting은 앱이 곧 스스로 다시 시작하는지. */
export interface RestoreBackupResult {
  restored: string[];
  skipped: string[];
  secrets: 'restored' | 'not-in-backup' | 'keyring-unavailable';
  restarting: boolean;
}
