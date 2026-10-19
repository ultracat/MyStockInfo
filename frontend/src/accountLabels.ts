import type { AccountLabel, AccountTaxType, BrokerAccount, BrokerId } from './types';

/** ISA/연금저축/IRP 표시 문구 — Settings.tsx("계좌 별칭" 표의 "세금 유형" 열,
 *  관리 UI 전체)와 RealizedGains.tsx(일반계좌만 세액 계산에 포함) 둘 다 같은
 *  표기를 써야 해서 여기 한 곳에 둔다. */
export const TAX_TYPE_LABELS: Record<AccountTaxType, string> = {
  GENERAL: '일반계좌',
  ISA: 'ISA',
  PENSION_SAVINGS: '연금저축',
  IRP: 'IRP',
};
export const TAX_TYPE_OPTIONS: AccountTaxType[] = ['GENERAL', 'ISA', 'PENSION_SAVINGS', 'IRP'];

/** Dashboard.tsx/Trades.tsx/Dividends.tsx가 라벨 맵을 만들 때 공통으로 쓰는 키
 *  조합 — accountId 자체는 브로커 간에 겹칠 수 있어서(우연히 같은 문자열) broker도
 *  같이 묶는다. */
export function accountLabelKey(broker: BrokerId, accountId: string): string {
  return `${broker}:${accountId}`;
}

export function findAccountLabel(
  labels: AccountLabel[],
  broker: BrokerId,
  accountId: string
): AccountLabel | undefined {
  return labels.find((l) => l.broker === broker && l.accountId === accountId);
}

/** 화면에 보여줄 계좌번호 — 설정에서 직접 입력한 표시용 번호 > API가 준
 *  accountNumber > accountId 순. 토스증권은 accountId가 Open API용 accountSeq
 *  ("1")라 사용자가 표시용 번호를 입력하지 않으면 "1"이 그대로 보인다. */
export function displayAccountNumber(account: BrokerAccount, entry?: AccountLabel): string {
  return entry?.accountNumber || account.accountNumber || account.id;
}

/** 계좌 select 옵션에 보여줄 텍스트를 만든다 — 라벨이 있으면 "라벨 · 계좌번호"로,
 *  없으면 계좌번호만. `accountType`은 있을 때만 괄호를 붙인다(CSV 전용 브로커의
 *  로컬 저장소에서 만든 계좌는 accountType이 없어서, 예전엔 이 자리에 그냥
 *  "(undefined)"가 그대로 찍히는 버그가 있었다). */
export function formatAccountOption(account: BrokerAccount, entry?: AccountLabel): string {
  const base = displayAccountNumber(account, entry);
  const withType = account.accountType ? `${base} (${account.accountType})` : base;
  return entry?.label ? `${entry.label} · ${withType}` : withType;
}
