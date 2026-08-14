import type { BrokerAdapter, BrokerId } from './types';
import { tossAdapter } from './toss/tossAdapter';
import { kisAdapter } from './kis/kisAdapter';

// Add kbAdapter here once that integration is built — routes and the
// frontend are written against BrokerAdapter, not broker specifics, so
// plugging in a new broker is just adding an entry here.
const registry: Partial<Record<BrokerId, BrokerAdapter>> = {
  toss: tossAdapter,
  kis: kisAdapter,
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
