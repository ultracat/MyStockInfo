import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useWhenActive } from '../../pageActivity';
import type { UpcomingDividendsState } from '../../components/UpcomingDividends';

/**
 * 다가오는 배당 — 표(UpcomingDividends)와 "월별 배당금" 그래프의 흐린 예상 막대가 같이 쓴다. 백엔드가 일정을 파일에 저장해 두고
 * 하루 한 번 뒤에서 다시 받으므로 첫 응답은 바로 온다 — `refreshing`이면 5초 뒤 다시 불러 새 값으로 바꾼다. 새로고침 버튼은 `refresh=true`.
 */
export function useUpcomingDividends() {
  const [upcoming, setUpcoming] = useState<UpcomingDividendsState>({
    items: null, available: true, error: null, builtAt: null, refreshing: false,
  });
  const upcomingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const whenActive = useWhenActive();
  const upcomingAlive = useRef(true); // 화면을 떠난 뒤 늦게 온 응답이 다시 부르기를 예약하지 않게
  const loadUpcoming = useCallback((refresh = false) => {
    if (upcomingTimer.current) clearTimeout(upcomingTimer.current);
    if (refresh) setUpcoming((u) => ({ ...u, refreshing: true }));
    api
      .getUpcomingDividends(refresh, 12) // 12개월치를 한 번에 — 목록(이번 달)·12개월 예상·달력이 같은 일정을 쓴다
      .then((r) => {
        if (!upcomingAlive.current) return;
        setUpcoming({ items: r.items, available: r.available, error: null, builtAt: r.builtAt, refreshing: r.refreshing });
        // 숨겨진 동안은 다음 회차를 다시 보일 때로 미룬다(pageActivity.tsx)
        if (r.refreshing) upcomingTimer.current = setTimeout(() => whenActive('upcoming', () => loadUpcoming()), 5000);
      })
      .catch((e) => upcomingAlive.current && setUpcoming((u) => ({ ...u, error: (e as Error).message, refreshing: false })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    upcomingAlive.current = true;
    loadUpcoming();
    return () => {
      upcomingAlive.current = false;
      if (upcomingTimer.current) clearTimeout(upcomingTimer.current);
    };
  }, [loadUpcoming]);
  return { upcoming, loadUpcoming };
}
