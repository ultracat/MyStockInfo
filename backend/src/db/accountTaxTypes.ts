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
