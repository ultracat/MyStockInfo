import type {
  AccountLabel,
  AccountTaxType,
  AccountTaxTypeEntry,
  AppInfo,
  BrokerAccount,
  BrokerId,
  BrokerSummary,
  CredentialFieldSpec,
  CredentialStatus,
  DividendRecord,
  ExchangeRate,
  ImportResult,
  RestoreBackupResult,
  SecureStorageStatus,
  PortfolioOverview,
  StockInfo,
  StockLinkEntry,
  SnapshotRecord,
  StoredHolding,
  StoredTrade,
  DividendSyncResult,
  MarketStatus,
  ActiveWarning,
  KisRealizedRow,
  KisStockDetail,
  TossAccountCashFlows,
  UpcomingDividend,
  TradeRecord,
  WatchlistEntry,
} from './types';

// 백엔드가 `/api/*` 요청마다 요구하는 실행별 토큰과, 백엔드가 실제로 뜬 포트 —
// Electron 메인이 창을 열 때 URL 해시(`#token=...&port=...`)로 넘긴다
// (electron/src/main.ts). 새로고침(⌘R)해도 해시가 그대로 남아서 다시 읽힌다.
// 포트는 4317이 기본이지만 다른 프로그램이 쓰고 있으면 메인이 빈 포트로 옮기므로
// 여기 하드코딩하지 않는다(해시에 없으면 — 브라우저로 직접 연 dev 화면 등 — 4317).
const HASH_PARAMS = new URLSearchParams(window.location.hash.slice(1));
const BACKEND_PORT = Number(HASH_PARAMS.get('port')) || 4317;
const BASE_URL = `http://127.0.0.1:${BACKEND_PORT}/api`;
const API_TOKEN = HASH_PARAMS.get('token') ?? '';
const AUTH_HEADER = { Authorization: `Bearer ${API_TOKEN}` };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.error ?? `요청 실패: ${res.status}`;
    throw new Error(body.detail ? `${message}\n\n[상세] ${body.detail}` : message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listBrokers: () => request<BrokerSummary[]>('/accounts'),
  // includePaper: 모의투자 계좌도(NH) — 보유·매매 화면의 계좌 선택에만. 합계를 내는 화면(대시보드·종목별 수익·배당)은
  // 실전 계좌만 받는다.
  listAccounts: (broker: BrokerId, opts?: { forceRefresh?: boolean; includePaper?: boolean }) => {
    const q = new URLSearchParams();
    if (opts?.forceRefresh) q.set('refresh', 'true');
    if (opts?.includePaper) q.set('paper', 'true');
    const qs = q.toString();
    return request<BrokerAccount[]>(`/accounts/${broker}${qs ? `?${qs}` : ''}`);
  },
  // Backend caches broker API responses for 5s (see backend's
  // brokers/responseCache.ts) — forceRefresh bypasses that, for the
  // Dashboard's refresh button.
  getPortfolio: (broker: BrokerId, accountId: string, opts?: { forceRefresh?: boolean }) =>
    request<PortfolioOverview>(`/holdings/${broker}/${accountId}${opts?.forceRefresh ? '?refresh=true' : ''}`),

  getCredentialStatus: () => request<CredentialStatus>('/settings/credentials'),
  getSecureStorageStatus: () => request<SecureStorageStatus>('/settings/secure-storage'),
  getCredentialFields: () => request<Record<BrokerId, CredentialFieldSpec[]>>('/settings/credential-fields'),
  // "증권사 연동 상태" 표에 계좌번호 같은 비밀 아닌 입력값을 보여주기 위한 조회 —
  // secret:true인 필드(appSecret 등)는 서버가 애초에 응답에서 뺀다.
  getCredentialInfo: () => request<Partial<Record<BrokerId, Record<string, string>>>>('/settings/credential-info'),
  setCredential: (broker: BrokerId, fields: Record<string, string>) =>
    request<void>(`/settings/credentials/${broker}`, {
      method: 'POST',
      body: JSON.stringify({ fields }),
    }),
  clearCredential: (broker: BrokerId) =>
    request<void>(`/settings/credentials/${broker}`, { method: 'DELETE' }),

  getFxRate: () => request<{ usdKrwRate: number | null }>('/settings/fx-rate'),
  setFxRate: (usdKrwRate: number | null) =>
    request<{ usdKrwRate: number | null }>('/settings/fx-rate', {
      method: 'POST',
      body: JSON.stringify({ usdKrwRate }),
    }),
  getExchangeRate: (broker: BrokerId, base: string, quote: string, opts?: { forceRefresh?: boolean }) =>
    request<ExchangeRate>(
      `/market-info/${broker}/exchange-rate?base=${base}&quote=${quote}${opts?.forceRefresh ? '&refresh=true' : ''}`
    ),
  // 브로커 무관 USD/KRW 환율 — 백엔드가 토스→한국수출입은행 순으로 시도한다
  // (backend/CLAUDE.md의 "환율 조회" 절 참고). 실패해도 예외를 안 던지고
  // `{rate: null}`을 응답하므로 호출부는 .catch() 없이 `live?.rate`만 확인하면 된다.
  getUsdKrwRate: (opts?: { forceRefresh?: boolean }) =>
    request<{ rate: number | null; midRate?: number | null; asOf?: string | null; source?: 'toss' | 'eximbank' }>(
      `/market-info/exchange-rate/usd-krw${opts?.forceRefresh ? '?refresh=true' : ''}`
    ),
  // 종목별 월별 종가(토스 일봉 기반) — 토스 미연동이거나 그 종목/달을 못 찾으면
  // 그 심볼의 배열이 비어있거나 일부 달만 채워진다(backend/CLAUDE.md의
  // "월별 종가 조회" 절 참고). 호출부가 오늘 현재가로 대체하는 fallback을 갖고
  // 있어서 이 호출 자체는 절대 던지지 않는다.
  // months: 'all'이면 상장 초기까지(백엔드 최대 50년) — 관심종목 "전체 기간" 보기.
  getMonthlyClosePrices: (symbols: string[], months: number | 'all' = 12) =>
    request<Record<string, { month: string; closePrice: number; currency: string }[]>>(
      `/market-info/monthly-close-prices?symbols=${encodeURIComponent(symbols.join(','))}&months=${months}`
    ),
  // 월별 USD/KRW 평균 환율(한국수출입은행 영업일 매매기준율 평균) — 토스는
  // 과거 환율을 지원하지 않아 이 조회의 유일한 소스다. 배당금처럼 특정 날짜에
  // 귀속되는 달러 금액을 "오늘 환율"이 아니라 "그 달 평균 환율"로 환산하는 데
  // 쓴다(backend/CLAUDE.md의 "월별 종가 조회" 절 인근 참고). 그 달을 못 구했으면
  // 해당 키가 null이고, 호출부가 effectiveFxRate(오늘/수동 환율)로 대체한다.
  getMonthlyAvgUsdKrwRates: (months: string[]) =>
    request<Record<string, { rate: number; sampleCount: number } | null>>(
      `/market-info/exchange-rate/monthly-avg?months=${encodeURIComponent(months.join(','))}`
    ),

  listDividends: () => request<DividendRecord[]>('/dividends'),
  addDividend: (input: Omit<DividendRecord, 'id'>) =>
    request<DividendRecord>('/dividends', { method: 'POST', body: JSON.stringify(input) }),
  updateDividend: (id: string, input: Omit<DividendRecord, 'id'>) =>
    request<DividendRecord>(`/dividends/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  deleteDividend: (id: string) => request<void>(`/dividends/${id}`, { method: 'DELETE' }),
  refreshDividendNames: () =>
    request<{ updated: number; resolved: number; failed: string[] }>('/dividends/refresh-names', {
      method: 'POST',
    }),
  // 배당 동기화 — 토스·한국투자증권(키가 있을 때)의 계좌 배당 기록을 API 내용으로 통째로 교체한다.
  syncDividends: () =>
    request<{ results: DividendSyncResult[]; errors: Array<{ broker: BrokerId; error: string }> }>('/dividends/sync', {
      method: 'POST',
    }),
  importDividends: (records: Omit<DividendRecord, 'id' | 'name'>[]) =>
    request<ImportResult>('/dividends/import', {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),

  getTradeHistory: (broker: BrokerId, accountId: string, from: string, to: string, opts?: { forceRefresh?: boolean }) =>
    request<TradeRecord[]>(
      `/trades/${broker}/${accountId}?from=${from}&to=${to}${opts?.forceRefresh ? '&refresh=true' : ''}`
    ),

  getStockInfo: (symbol: string) => request<StockInfo>(`/stock-info/${encodeURIComponent(symbol)}`),

  // 로컬 저장소(write-through로 실시간 조회 성공 시마다 갱신되거나, CSV 가져오기로
  // 채워짐) — CSV 내보내기, API 연동이 없는 브로커(KB증권 등)의 데이터 확인용.
  listHoldingsStore: (filter?: { broker?: BrokerId; accountId?: string }) =>
    request<StoredHolding[]>(
      `/holdings-store${
        filter?.broker || filter?.accountId
          ? `?${new URLSearchParams({ ...(filter.broker ? { broker: filter.broker } : {}), ...(filter.accountId ? { accountId: filter.accountId } : {}) })}`
          : ''
      }`
    ),
  importHoldingsStore: (
    records: {
      broker: BrokerId;
      accountId: string;
      symbol: string;
      currency: 'KRW' | 'USD';
      quantity: number;
      averagePurchasePrice: number;
      lastPrice?: number;
      purchaseAmount?: number;
      marketValue?: number;
      profitLossAmount?: number;
      profitLossRate?: number;
      commission?: number | null;
      tax?: number | null;
      market?: string | null;
      memo?: string | null;
    }[]
  ) =>
    request<ImportResult>('/holdings-store/import', {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),

  listTradesStore: (filter?: { broker?: BrokerId; accountId?: string }) =>
    request<StoredTrade[]>(
      `/trades-store${
        filter?.broker || filter?.accountId
          ? `?${new URLSearchParams({ ...(filter.broker ? { broker: filter.broker } : {}), ...(filter.accountId ? { accountId: filter.accountId } : {}) })}`
          : ''
      }`
    ),
  importTradesStore: (
    records: {
      broker: BrokerId;
      accountId: string;
      id?: string;
      symbol: string;
      name?: string | null;
      side: 'BUY' | 'SELL';
      quantity: number;
      price: number;
      amount: number;
      currency: string;
      commission?: number | null;
      tax?: number | null;
      executedAt: string;
    }[]
  ) =>
    request<ImportResult>('/trades-store/import', {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),
  deleteTradeStore: (broker: BrokerId, accountId: string, id: string) =>
    request<void>(`/trades-store/${broker}/${encodeURIComponent(accountId)}/${id}`, { method: 'DELETE' }),
  refreshTradeNames: () =>
    request<{ updated: number; resolved: number; failed: string[] }>('/trades-store/refresh-names', {
      method: 'POST',
    }),

  // (broker, accountId) → 사람이 읽을 수 있는 별칭. 관리는 Settings.tsx에서만
  // 하고, Dashboard.tsx/Trades.tsx/Dividends.tsx는 읽기만 한다.
  listAccountLabels: (broker?: BrokerId) =>
    request<AccountLabel[]>(`/account-labels${broker ? `?broker=${broker}` : ''}`),
  upsertAccountLabel: (broker: BrokerId, accountId: string, fields: { label?: string; accountNumber?: string }) =>
    request<AccountLabel>(`/account-labels/${broker}/${encodeURIComponent(accountId)}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    }),
  deleteAccountLabel: (broker: BrokerId, accountId: string) =>
    request<void>(`/account-labels/${broker}/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),

  // KB증권 Open API는 appKey/appSecret 자체가 계좌 하나에 이미 묶여 있어(계좌
  // 목록 조회 API가 없음, backend/CLAUDE.md 참고) 다른 브로커처럼 별도 실시간
  // 조회 화면 경로가 없다 — "지금 연결된 계좌"를 로컬 저장소(holdings-store/
  // trades-store)로 동기화하는 액션만 제공한다. accountId는 보통 안 넘긴다 —
  // Settings의 KB 자격증명 세 번째 필드(계좌번호)로 미리 등록해둔 값을 백엔드가
  // 기본으로 쓴다(routes/kb.ts). 다른 계좌로 한 번만 동기화하고 싶을 때만 넘긴다.
  // 토스 시장 정보 보조 기능 — 토스 미연동이면 빈 결과(화면은 이 정보 없이 동작).
  getMarketStatus: () => request<{ kr: MarketStatus | null; us: MarketStatus | null }>('/market-info/market-status'),
  getStockWarnings: (symbols: string[]) =>
    request<{ bySymbol: Record<string, ActiveWarning[]> }>(
      `/market-info/warnings?symbols=${encodeURIComponent(symbols.join(','))}`
    ),
  getIndexMonthly: (months: number) =>
    request<Record<string, Array<{ month: string; close: number }>>>(`/market-info/index-monthly?months=${months}`),
  getSectors: (symbols: string[]) =>
    request<{
      bySymbol: Record<string, string[]>;
      /** 종목별 섹터 배분(합 1, sector null = 분류 못 한 몫) — ETF는 구성종목·토스 ETF 분류로 채운다. */
      weights: Record<string, Array<{ sector: string | null; weight: number }>>;
      sources: Record<string, 'stock' | 'preferred' | 'etf-components' | 'etf-sector'>;
      date: string | null;
      /** 토스 ETF 분류표를 백그라운드로 만드는 중(약 2분) — 잠시 뒤 다시 부르면 채워진다. */
      etfPending: boolean;
    }>(
      `/market-info/sectors?symbols=${encodeURIComponent(symbols.join(','))}`
    ),
  // 한국투자증권 키가 있어야 한다 — 없으면 upcoming은 available:false, realized는 409.
  getUpcomingDividends: () => request<{ items: UpcomingDividend[]; available: boolean }>('/dividends/upcoming'),
  getKisRealized: (from: string, to: string) =>
    request<{ accountId: string; rows: KisRealizedRow[]; overseasRows: KisRealizedRow[] | null }>(`/kis/realized?from=${from}&to=${to}`),
  getKisStockDetail: (symbol: string) => request<KisStockDetail>(`/kis/stock-detail/${encodeURIComponent(symbol)}`),
  getTossCashFlows: (opts?: { forceRefresh?: boolean }) =>
    request<TossAccountCashFlows[]>(`/toss/cash-flows${opts?.forceRefresh ? '?refresh=true' : ''}`),
  // NH투자증권 — 공식 국내 실현손익(종목별 기간 합계, 실전 계좌 전부)과 입금 기준 원금(토스와 같은 모양).
  getNhRealized: (from: string, to: string) =>
    request<{ accountIds: string[]; rows: KisRealizedRow[]; overseasRows: KisRealizedRow[] | null }>(`/nh/realized?from=${from}&to=${to}`),
  getNhCashFlows: (opts?: { forceRefresh?: boolean }) =>
    request<TossAccountCashFlows[]>(`/nh/cash-flows${opts?.forceRefresh ? '?refresh=true' : ''}`),
  syncKbHoldings: (accountId?: string) =>
    request<{ synced: number; accountId: string }>('/kb/sync-holdings', {
      method: 'POST',
      body: JSON.stringify({ accountId }),
    }),
  syncKbTrades: (from: string, to: string, accountId?: string) =>
    request<{ synced: number; accountId: string }>('/kb/sync-trades', {
      method: 'POST',
      body: JSON.stringify({ accountId, from, to }),
    }),

  // Google Sheets 연동 — Client ID/Secret은 앱 빌드에 미리 박혀 있어(백엔드
  // google/clientConfig.ts, 일반 사용자는 입력 UI 자체가 없음) Settings.tsx는
  // 계정 연결/해제 상태만 관리하고, Dashboard.tsx/Trades.tsx/Dividends.tsx가
  // 각자의 데이터 종류로 export/import 버튼을 낸다. `connect()`는 시스템
  // 브라우저에서 로그인 플로우를 시작만 시키고 즉시 응답하므로, 완료 여부는
  // `getGoogleStatus()`를 폴링해서 확인한다(connectStatus:
  // 'idle'|'waiting'|'connected'|'error').
  getGoogleStatus: () =>
    request<{
      hasClientCredentials: boolean;
      connected: boolean;
      email: string | null;
      spreadsheetUrl: string | null;
      connectStatus: 'idle' | 'waiting' | 'connected' | 'error';
      connectError: string | null;
    }>('/google/status'),
  connectGoogle: () => request<{ started: boolean }>('/google/connect', { method: 'POST' }),
  disconnectGoogle: () => request<void>('/google/disconnect', { method: 'POST' }),
  exportToGoogleSheet: (dataType: 'holdings' | 'trades' | 'dividends') =>
    request<{ spreadsheetUrl: string; rowCount: number }>(`/google/sync/${dataType}/export`, { method: 'POST' }),
  importFromGoogleSheet: (dataType: 'holdings' | 'trades' | 'dividends') =>
    request<ImportResult>(`/google/sync/${dataType}/import`, {
      method: 'POST',
    }),

  getAppInfo: () => request<AppInfo>('/about'),

  // 보유하지 않은 종목을 가격만 추적하는 관심종목 — lastPrice는 조회할 때마다
  // 서버가 라이브로 채워서 내려준다(저장 안 함).
  // 종목별 외부 링크 — 사용자가 직접 입력한 값만 서버에 있다(자동 링크는
  // stockLinks.ts가 계산). url ''은 "링크 없음", 삭제하면 자동 링크로 돌아간다.
  listStockLinks: () => request<StockLinkEntry[]>('/stock-links'),
  saveStockLink: (symbol: string, url: string) =>
    request<StockLinkEntry>(`/stock-links/${encodeURIComponent(symbol)}`, {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),
  deleteStockLink: (symbol: string) =>
    request<void>(`/stock-links/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),

  listWatchlist: () => request<WatchlistEntry[]>('/watchlist'),
  addWatchlist: (symbol: string) =>
    request<WatchlistEntry>('/watchlist', { method: 'POST', body: JSON.stringify({ symbol }) }),
  removeWatchlist: (symbol: string) =>
    request<void>(`/watchlist/${encodeURIComponent(symbol)}`, { method: 'DELETE' }),

  // 하루 한 번(Overview.tsx 진입 시) 이미 계산된 합산 총액을 그대로 저장 —
  // 서버는 집계를 다시 하지 않고 upsert만 한다(backend/CLAUDE.md의
  // "일별 자산 스냅샷" 절 참고). 실패해도 화면에 영향 없게 호출부가 await 없이 부른다.
  capturePortfolioSnapshot: (record: SnapshotRecord) =>
    request<SnapshotRecord>('/portfolio-snapshots', { method: 'POST', body: JSON.stringify(record) }),
  listPortfolioSnapshots: () => request<SnapshotRecord[]>('/portfolio-snapshots'),

  // 데이터 폴더를 묶은 zip — 응답이 JSON이 아니라 바이너리라 request<T>
  // 헬퍼(항상 .json()을 기대)를 거치지 않고 직접 fetch해서 Blob으로 받는다.
  // password를 주면 API 키·Google 연결을 그 비밀번호로 암호화해 함께 넣는다
  // (backend/CLAUDE.md의 "백업/복원" 절). URL에 남지 않게 body로 보낸다.
  downloadBackup: async (password?: string): Promise<Blob> => {
    const res = await fetch(`${BASE_URL}/backup`, {
      method: 'POST',
      headers: { ...AUTH_HEADER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password ?? '' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `백업 다운로드 실패: ${res.status}`);
    }
    return res.blob();
  },
  // zip을 base64로 감싸 보통 JSON body로 보낸다(이 앱이 전부 JSON body만 쓰는
  // 관례 유지 — backend/CLAUDE.md의 "백업/복원" 절 참고).
  restoreBackup: (zipBase64: string, password?: string) =>
    request<RestoreBackupResult>('/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ zipBase64, password: password ?? '' }),
    }),

  // ISA/연금저축/IRP 계좌 분류 — RealizedGains.tsx 전용(backend/CLAUDE.md의
  // "계좌별 세금 유형" 절 참고).
  listAccountTaxTypes: () => request<AccountTaxTypeEntry[]>('/account-tax-types'),
  upsertAccountTaxType: (broker: BrokerId, accountId: string, taxType: AccountTaxType) =>
    request<AccountTaxTypeEntry>(`/account-tax-types/${broker}/${encodeURIComponent(accountId)}`, {
      method: 'PUT',
      body: JSON.stringify({ taxType }),
    }),
  deleteAccountTaxType: (broker: BrokerId, accountId: string) =>
    request<void>(`/account-tax-types/${broker}/${encodeURIComponent(accountId)}`, { method: 'DELETE' }),
};
