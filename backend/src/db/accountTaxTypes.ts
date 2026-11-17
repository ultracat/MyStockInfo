import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId } from '../brokers/types';

/** ISA/연금저축/IRP처럼 매매차익에 일반 해외주식 양도소득세(22%)가 아니라
 *  완전히 다른 과세 체계가 적용되는 계좌를 표시해두는 분류 — 저장 안 돼
 *  있으면 'GENERAL'(일반계좌)로 취급한다. `routes/realizedGains` 같은 전용
 *  저장소/엔드포인트는 없다 — `RealizedGains.tsx`가 유일한 소비처라 CRUD
 *  라우트만 둔다(계좌 라벨처럼 여러 화면이 공유하는 메타데이터가 아님).
 *
 *  - `ISA`: 개인종합자산관리계좌 — 손익통산 + 비과세 한도 이후 9.9% 분리과세
 *    (일반 양도소득세 22%와 무관한 별도 규정이라 이 계산에서 제외).
 *  - `PENSION_SAVINGS`(연금저축)/`IRP`(개인형퇴직연금): 매도 시점엔 과세되지
 *    않고(세액이연) 나중에 연금/퇴직소득으로 인출할 때 별도 세율이 적용된다 —
 *    둘 다 "지금 매도해도 양도소득세가 안 붙는다"는 점에서 이 계산 제외 처리는
 *    동일하다.
 */
export type AccountTaxType = 'GENERAL' | 'ISA' | 'PENSION_SAVINGS' | 'IRP';

export interface AccountTaxTypeEntry {
  broker: BrokerId;
  accountId: string;
  taxType: AccountTaxType;
}

function store() {
  return new JsonStore<AccountTaxTypeEntry[]>('account-tax-types.json', getDataDir(), []);
}

export function listAccountTaxTypes(): AccountTaxTypeEntry[] {
  return store().read();
}

/** 배당에 세금을 **바로 떼지 않는** 계좌인가 — ISA(만기·해지 때 손익통산 후 과세)·연금저축·IRP(인출 때 과세)는 계좌 안에서 받은
 *  배당·분배금이 원천징수 없이 그대로 들어온다. KIS 권리현황(CTRGA011R)은 이런 계좌에도 계산상 세금(`tax_amt`)을 주는데 실제로는
 *  떼지 않는다(2026-11-17 사용자 ISA 계좌로 확인 — 세전 분배금이 그대로 입금, API는 계산상 세금을 줌). 배당 동기화가 이걸 보고
 *  세전 금액을 그대로 실수령으로, 세금은 0으로 적는다. */
export function isTaxDeferredAccount(broker: BrokerId, accountId: string): boolean {
  const t = store().read().find((e) => e.broker === broker && e.accountId === accountId)?.taxType;
  return t === 'ISA' || t === 'PENSION_SAVINGS' || t === 'IRP';
}

export function upsertAccountTaxType(broker: BrokerId, accountId: string, taxType: AccountTaxType): AccountTaxTypeEntry {
  const entry: AccountTaxTypeEntry = { broker, accountId, taxType };
  store().update((current) => {
    const idx = current.findIndex((a) => a.broker === broker && a.accountId === accountId);
    if (idx === -1) return [...current, entry];
    const next = [...current];
    next[idx] = entry;
    return next;
  });
  return entry;
}

/** GENERAL로 되돌린다 — 저장소에서 그냥 지운다(기본값이 GENERAL이라 엔트리가
 *  없는 것과 같은 의미). */
export function deleteAccountTaxType(broker: BrokerId, accountId: string): boolean {
  let removed = false;
  store().update((current) => {
    const next = current.filter((a) => !(a.broker === broker && a.accountId === accountId));
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}
