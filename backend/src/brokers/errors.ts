import type { Response } from 'express';

/** Shared shape of TossApiError / KisApiError (and any future broker's). */
export interface BrokerApiError extends Error {
  status: number;
  body: string;
}

function isBrokerApiError(err: unknown): err is BrokerApiError {
  return (
    err instanceof Error &&
    typeof (err as Partial<BrokerApiError>).status === 'number' &&
    typeof (err as Partial<BrokerApiError>).body === 'string'
  );
}

/** Common error-to-HTTP-response mapping for broker adapter route handlers. */
export function handleBrokerApiError(err: unknown, res: Response): void {
  if (isBrokerApiError(err)) {
    console.error(`[broker] ${err.message} (status ${err.status}):`, err.body);
    res.status(502).json({ error: err.message, detail: err.body });
    return;
  }
  res.status(500).json({ error: (err as Error).message });
}
