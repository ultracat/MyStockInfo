// 관심종목 목록 표 정렬(순수 함수, 테스트: frontend/test/sort.test.ts) — 2026-11-20.
import { sortByText, sortByValue } from './sort';

export type WatchSortKey = 'added' | 'name' | 'change' | 'target';

interface WatchRow {
  symbol: string;
  name: string;
  lastPrice: number | null;
  changeRate?: number | null;
}
interface Target {
  above: number | null;
  below: number | null;
}

/** 가장 가까운 목표가까지 남은 비율(0 이하 = 이미 닿음). 목표가 없거나 가격을 모르면 null. */
export function targetGap(price: number | null, t: Target | undefined): number | null {
  if (price === null || price <= 0 || !t) return null;
  const gaps = [t.above !== null ? (t.above - price) / price : null, t.below !== null ? (price - t.below) / price : null].filter(
    (g): g is number => g !== null
  );
  return gaps.length ? Math.min(...gaps) : null;
}

/** 'added'는 등록 순서 그대로(기본). 목표가는 "가장 가까운 목표까지 남은 %"가 작은 순서가 기본이라 asc로 부른다. */
export function sortWatchRows<T extends WatchRow>(rows: T[], key: WatchSortKey, asc: boolean, targetOf: (symbol: string) => Target | undefined): T[] {
  switch (key) {
    case 'name':
      return sortByText(rows, (r) => r.name || r.symbol, asc);
    case 'change':
      return sortByValue(rows, (r) => r.changeRate ?? null, asc);
    case 'target':
      return sortByValue(rows, (r) => targetGap(r.lastPrice, targetOf(r.symbol)), asc);
    case 'added':
    default:
      return rows;
  }
}
