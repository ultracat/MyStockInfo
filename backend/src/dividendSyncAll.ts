// 배당 동기화 한 번(키가 있는 증권사 전부) — 배당금 화면(`POST /api/dividends/sync`)과 배당 입금 알림의 백그라운드 동기화(alerts.ts)가 같이 쓴다.
// 증권사별로 따로 돌아 한쪽이 실패해도 나머지는 반영된다. 동기화 전후 기록을 비교해 **새로 생긴 배당 기록**을 돌려준다(알림용) —
// 같은 내용의 기록은 id를 이어받으므로(replaceSyncedDividends) id가 처음 보이는 것만 새 기록이다.
import { isTossConfigured } from './brokers/toss/tossClient';
import { syncTossDividends } from './brokers/toss/tossDividendSync';
import { syncKisDividends } from './brokers/kis/kisDividendSync';
import { isKisConfigured } from './brokers/kis/kisClient';
import { syncNhDividends } from './brokers/nh/nhDividendSync';
import { isNhConfigured } from './brokers/nh/nhClient';
import { syncKiwoomDividends } from './brokers/kiwoom/kiwoomDividendSync';
import { isKiwoomConfigured } from './brokers/kiwoom/kiwoomClient';
import { syncLsDividends } from './brokers/ls/lsDividendSync';
import { isLsConfigured } from './brokers/ls/lsClient';
import { syncDbDividends } from './brokers/db/dbDividendSync';
import { isDbConfigured } from './brokers/db/dbClient';
import type { DividendSyncResult } from './brokers/dividendSyncTypes';
import type { BrokerId } from './brokers/types';
import { listDividends, type DividendRecord } from './db/dividends';

export interface DividendSyncAllResult {
  results: DividendSyncResult[];
  errors: Array<{ broker: BrokerId; error: string }>;
  /** 이번 동기화로 새로 생긴 기록(알림용). */
  added: DividendRecord[];
}

let running: Promise<DividendSyncAllResult> | null = null;
const listeners = new Set<(added: DividendRecord[]) => void>();

/** 새 배당 기록이 생길 때마다 불린다(alerts.ts가 알림을 띄운다). 해제 함수를 돌려준다. */
export function onDividendsAdded(fn: (added: DividendRecord[]) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 동시에 두 번 돌지 않게 진행 중인 것을 공유한다(화면 진입 동기화와 백그라운드 동기화가 겹칠 수 있다). */
export function syncAllDividends(): Promise<DividendSyncAllResult> {
  if (running) return running;
  running = (async () => {
    const before = new Set(listDividends().map((d) => d.id));
    const jobs: Array<{ broker: BrokerId; run: () => Promise<DividendSyncResult> }> = [];
    if (isTossConfigured()) jobs.push({ broker: 'toss', run: syncTossDividends });
    if (isKisConfigured()) jobs.push({ broker: 'kis', run: syncKisDividends });
    if (isNhConfigured()) jobs.push({ broker: 'nh', run: syncNhDividends });
    if (isKiwoomConfigured()) jobs.push({ broker: 'kiwoom', run: syncKiwoomDividends });
    if (isLsConfigured()) jobs.push({ broker: 'ls', run: syncLsDividends });
    if (isDbConfigured()) jobs.push({ broker: 'db', run: syncDbDividends });
    const settled = await Promise.allSettled(jobs.map((j) => j.run()));
    const results: DividendSyncResult[] = [];
    const errors: Array<{ broker: BrokerId; error: string }> = [];
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') results.push(s.value);
      else errors.push({ broker: jobs[i].broker, error: (s.reason as Error)?.message ?? String(s.reason) });
    });
    const added = listDividends().filter((d) => !before.has(d.id));
    if (added.length) for (const fn of listeners) fn(added);
    return { results, errors, added };
  })().finally(() => {
    running = null;
  });
  return running;
}
