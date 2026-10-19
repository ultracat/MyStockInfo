import { getDataDir } from '../paths';
import { JsonStore } from '../jsonStore';
import type { BrokerId } from '../brokers/types';

// (broker, accountId) → 사람이 읽을 수 있는 별칭/표시용 계좌번호. CSV 전용 브로커(KB/삼성/
// 미래에셋)는 실시간 계좌 목록 API가 없어 accountId가 사용자가 CSV/수동 입력에
// 적어넣은 raw 문자열 그대로다("123-45-678901") — Dashboard.tsx/Trades.tsx/
// Dividends.tsx가 계좌를 보여줄 때 이 라벨이 있으면 같이 보여준다(관리는
// Settings.tsx 한 곳에서만, 세 화면은 읽기 전용으로 소비).
//
// `accountNumber`는 accountId가 사람이 읽는 계좌번호가 아닌 브로커(토스증권 —
// accountId가 Open API용 accountSeq라 "1" 같은 값)를 위한 표시용 계좌번호다.
// accountId 자체는 API 호출 키라 바꿀 수 없으므로 화면에 보여줄 때만 대신 쓴다.
// label/accountNumber 둘 중 하나만 있어도 되고, 둘 다 비면 엔트리를 지운다.
export interface AccountLabel {
  broker: BrokerId;
  accountId: string;
  label?: string;
  accountNumber?: string;
}

function store() {
  return new JsonStore<AccountLabel[]>('accountLabels.json', getDataDir(), []);
}

export function listAccountLabels(broker?: BrokerId): AccountLabel[] {
  const all = store().read();
  return broker ? all.filter((a) => a.broker === broker) : all;
}

export function upsertAccountLabel(
  broker: BrokerId,
  accountId: string,
  fields: { label?: string; accountNumber?: string }
): AccountLabel {
  const entry: AccountLabel = { broker, accountId };
  if (fields.label) entry.label = fields.label;
  if (fields.accountNumber) entry.accountNumber = fields.accountNumber;
  store().update((current) => {
    const idx = current.findIndex((a) => a.broker === broker && a.accountId === accountId);
    if (idx === -1) return [...current, entry];
    const next = [...current];
    next[idx] = entry;
    return next;
  });
  return entry;
}

export function deleteAccountLabel(broker: BrokerId, accountId: string): boolean {
  let removed = false;
  store().update((current) => {
    const next = current.filter((a) => !(a.broker === broker && a.accountId === accountId));
    removed = next.length !== current.length;
    return next;
  });
  return removed;
}
