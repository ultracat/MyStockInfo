import { KNOWN_BROKERS } from './knownBrokers';
import { getKbLinkedAccountId, isKbConfigured } from './kb/kbClient';
import type { BrokerId } from './types';

/** holdings.json/trades.json의 행은 두 종류다 — (1) 실시간 조회(write-through)와
 *  KB 동기화가 브로커 API로부터 다시 채우는 **미러**, (2) CSV/Sheets 가져오기와
 *  수동 입력만이 유일한 원본인 **수동 행**. 예전엔 가져오기가 둘을 구분 없이
 *  덮어써서, 같은 체결이 import UUID와 브로커 id로 두 번 저장되거나(2026-10-19
 *  중복 사고) Sheets 가져오기가 API 계좌 행까지 지웠다.
 *
 *  규칙: true인 (broker, accountId)는 **실시간 조회·동기화만 쓴다** — CSV/Sheets
 *  가져오기는 그 행을 건너뛰고(skipped), Sheets 전체 교체도 기존 행을 그대로 둔다.
 *  내보내기(CSV/Sheets)는 이 구분 없이 전부 내보낸다.
 *  - 토스/KIS(`hasApiIntegration`): 계좌 전부
 *  - KB: 자격증명에 등록된 연동 계좌 하나만(나머지 KB 계좌 — IRP/연금저축 등 — 는
 *    API로 못 읽어서 수동 행이다, routes/kb.ts 참고) */
export function isSyncOwned(broker: BrokerId, accountId: string): boolean {
  if (KNOWN_BROKERS.some((b) => b.id === broker && b.hasApiIntegration)) return true;
  if (broker === 'kb') return isKbConfigured() && getKbLinkedAccountId() === accountId;
  return false;
}
