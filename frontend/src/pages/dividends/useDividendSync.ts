import { useEffect, useState } from 'react';
import { api } from '../../api';
import { BROKER_LABELS } from '../../brokers';
import { markDataChanged } from '../../pageActivity';
import type { BrokerId } from '../../types';

/**
 * 배당 동기화(토스·한국투자·NH·키움). API로 배당을 받을 수 있는 증권사는 그 계좌 배당 기록을 **API 내용으로 통째로 교체**한다
 * (백엔드 brokers/<증권사>/…DividendSync.ts). 화면에 들어오면 백그라운드로 한 번 돌고, 버튼으로 다시 돌릴 수 있다. 그 증권사 행은 직접
 * 추가·수정·삭제를 막는다(isRowSyncOwned — 백엔드도 409로 막는다). `refresh`는 바뀐 게 있을 때 배당 기록을 다시 읽는 함수.
 */
export function useDividendSync(refresh: () => Promise<void>) {
  const [syncOwnedBrokers, setSyncOwnedBrokers] = useState<Set<BrokerId>>(new Set());
  const [dividendSyncing, setDividendSyncing] = useState(false);
  const [dividendSyncNotice, setDividendSyncNotice] = useState<string | null>(null);

  async function runDividendSync(manual: boolean) {
    setDividendSyncing(true);
    if (manual) setDividendSyncNotice(null);
    try {
      const { results, errors } = await api.syncDividends();
      const changed = results.filter((r) => r.added > 0 || r.removed > 0);
      const parts = changed.map(
        (r) => `${BROKER_LABELS[r.broker]} 추가 ${r.added}건${r.removed ? ` · 삭제 ${r.removed}건` : ''}`
      );
      const errs = errors.map((e) => `${BROKER_LABELS[e.broker]} 실패: ${e.error}`);
      if (changed.length > 0) {
        await refresh();
        markDataChanged(); // 대시보드·보유 종목의 배당 합계도 다음에 보일 때 다시 읽게
      }
      if (parts.length > 0 || errs.length > 0) setDividendSyncNotice(['배당 동기화', ...parts, ...errs].join(' — '));
      else if (manual) setDividendSyncNotice('배당 동기화: 이미 최신입니다.');
    } catch (e) {
      setDividendSyncNotice(`배당 동기화 실패: ${(e as Error).message}`);
    } finally {
      setDividendSyncing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    api
      .listBrokers()
      .then((brokers) => {
        const owned = new Set(
          brokers.filter((b) => (b.id === 'toss' || b.id === 'kis' || b.id === 'nh' || b.id === 'kiwoom' || b.id === 'ls' || b.id === 'db') && b.configured).map((b) => b.id)
        );
        if (cancelled || owned.size === 0) return;
        setSyncOwnedBrokers(owned);
        void runDividendSync(false);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 한 행이 API 동기화 소유인가 — 한국투자증권은 국내(원화) 배당만 API로 오므로 **달러 배당은 직접 입력**한다
  // (백엔드 rowOwnership.ts의 isDividendSyncOwned와 같은 규칙).
  const isRowSyncOwned = (b: BrokerId, cur: string) => syncOwnedBrokers.has(b) && !(b === 'kis' && cur === 'USD');

  return { syncOwnedBrokers, dividendSyncing, dividendSyncNotice, runDividendSync, isRowSyncOwned };
}
