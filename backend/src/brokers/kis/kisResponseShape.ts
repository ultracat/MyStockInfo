// KIS 응답 모양 — 증권사 공통 모듈(brokers/responseShape.ts)의 KIS용 이름. 2026-11-17 KIS용으로 먼저 만들었다가 전 증권사로 넓혔다.
// scripts/kis-live-check.cjs(--record)·test/kisVerification.test.ts가 이 이름을 쓴다.
import { checkDrift, describeResponse, mergeShapes, noteResponse, observeResponses, valueKind, type BlockShape, type ResponseShape } from '../responseShape';

export type KisBlockShape = BlockShape;
export type KisResponseShape = ResponseShape;
export { valueKind };

export const describeKisResponse = (body: Record<string, unknown>): KisResponseShape => describeResponse(body, 'kis');
export const mergeKisShapes = mergeShapes;

/** KIS 응답만 관찰한다. 해제 함수를 돌려준다. */
export function observeKisResponses(fn: (trId: string, body: Record<string, unknown>) => void): () => void {
  return observeResponses((broker, key, body) => broker === 'kis' && fn(key, body as Record<string, unknown>));
}

export const checkKisDrift = (trId: string, body: Record<string, unknown>): string[] => checkDrift('kis', trId, body);
export const noteKisResponse = (trId: string, body: Record<string, unknown>): void => noteResponse('kis', trId, body);
