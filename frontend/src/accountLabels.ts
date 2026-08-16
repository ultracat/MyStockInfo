import type { BrokerAccount, BrokerId } from './types';

/** Dashboard.tsx/Trades.tsx/Dividends.tsx가 라벨 맵을 만들 때 공통으로 쓰는 키
 *  조합 — accountId 자체는 브로커 간에 겹칠 수 있어서(우연히 같은 문자열) broker도
 *  같이 묶는다. */
export function accountLabelKey(broker: BrokerId, accountId: string): string {
  return `${broker}:${accountId}`;
}

/** 계좌 select 옵션에 보여줄 텍스트를 만든다 — 라벨이 있으면 "라벨 · 계좌번호"로,
 *  없으면 계좌번호만. `accountType`은 있을 때만 괄호를 붙인다(CSV 전용 브로커의
 *  로컬 저장소에서 만든 계좌는 accountType이 없어서, 예전엔 이 자리에 그냥
 *  "(undefined)"가 그대로 찍히는 버그가 있었다). */
export function formatAccountOption(account: BrokerAccount, label?: string): string {
  const base = account.accountNumber ?? account.id;
  const withType = account.accountType ? `${base} (${account.accountType})` : base;
  return label ? `${label} · ${withType}` : withType;
}
