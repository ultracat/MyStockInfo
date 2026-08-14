import type {
  BrokerAccount,
  BrokerId,
  BrokerSummary,
  CredentialFieldSpec,
  CredentialStatus,
  DividendRecord,
  ExchangeRate,
  PortfolioOverview,
  TradeRecord,
} from './types';

const BASE_URL = 'http://127.0.0.1:4317/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
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
  listAccounts: (broker: BrokerId, opts?: { forceRefresh?: boolean }) =>
    request<BrokerAccount[]>(`/accounts/${broker}${opts?.forceRefresh ? '?refresh=true' : ''}`),
  // Backend caches broker API responses for 5s (see backend's
  // brokers/responseCache.ts) — forceRefresh bypasses that, for the
  // Dashboard's refresh button.
  getPortfolio: (broker: BrokerId, accountId: string, opts?: { forceRefresh?: boolean }) =>
    request<PortfolioOverview>(`/holdings/${broker}/${accountId}${opts?.forceRefresh ? '?refresh=true' : ''}`),

  getCredentialStatus: () => request<CredentialStatus>('/settings/credentials'),
  getCredentialFields: () => request<Record<BrokerId, CredentialFieldSpec[]>>('/settings/credential-fields'),
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

  listDividends: () => request<DividendRecord[]>('/dividends'),
  addDividend: (input: Omit<DividendRecord, 'id'>) =>
    request<DividendRecord>('/dividends', { method: 'POST', body: JSON.stringify(input) }),
  deleteDividend: (id: string) => request<void>(`/dividends/${id}`, { method: 'DELETE' }),

  getTradeHistory: (broker: BrokerId, accountId: string, from: string, to: string, opts?: { forceRefresh?: boolean }) =>
    request<TradeRecord[]>(
      `/trades/${broker}/${accountId}?from=${from}&to=${to}${opts?.forceRefresh ? '&refresh=true' : ''}`
    ),
};
