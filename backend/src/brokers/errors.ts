import { redactText } from '../logRedact';
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
    console.error(`[broker] ${redactText(err.message)} (status ${err.status}):`, redactText(err.body));
    // 응답에도 server.ts 전역 오류 처리기와 같은 가리기를 건다 — 증권사 오류 본문엔 계좌번호·금액 같은 긴 숫자열이
    // 섞여 올 수 있고, 화면·스크린샷에 그대로 보이면 안 된다(2026-11-19 보안 리뷰와 같은 기준).
    res.status(502).json({ error: redactText(err.message), detail: redactText(err.body) });
    return;
  }
  res.status(500).json({ error: err instanceof Error ? redactText(err.message) : '알 수 없는 서버 오류가 발생했습니다.' });
}
