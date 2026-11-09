import type { BrokerAdapter, BrokerId } from './types';
import { tossAdapter } from './toss/tossAdapter';
import { kisAdapter } from './kis/kisAdapter';
import { nhAdapter } from './nh/nhAdapter';

// KB증권/삼성증권/미래에셋증권은 여기 안 들어간다 — API 연동을 안 하기로 했고
// (사용자 요청), CSV로만 데이터를 관리한다(knownBrokers.ts의 `hasApiIntegration:
// false`, db/holdingsStore.ts·db/tradesStore.ts). 진짜 API 연동이 필요한
// 브로커만 여기 등록한다 — routes/frontend는 BrokerAdapter만 보고 짜여 있어서
// 새 API 연동 브로커를 추가하는 것도 어댑터+registry 등록+credentialFields만
// 채우면 된다.
const registry: Partial<Record<BrokerId, BrokerAdapter>> = {
  toss: tossAdapter,
  kis: kisAdapter,
  nh: nhAdapter,
};

export function getAdapter(broker: BrokerId): BrokerAdapter {
  const adapter = registry[broker];
  if (!adapter) {
    throw new Error(`지원하지 않는 증권사입니다: ${broker}`);
  }
  return adapter;
}

export function listAdapters(): BrokerAdapter[] {
  return Object.values(registry).filter((a): a is BrokerAdapter => Boolean(a));
}
