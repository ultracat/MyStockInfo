import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

// 화면(페이지) 유지 — App.tsx는 한 번 연 페이지를 지우지 않고 숨겨 둔다(메뉴를 옮겨도 데이터·필터·스크롤이 남고, 돌아오면 바로 보인다).
// 그래서 페이지는 "지금 보이는가"를 알아야 한다 — 숨겨진 동안 타이머·폴링을 멈추고, 다시 보일 때 이전 데이터를 그대로 둔 채
// 뒤에서 갱신한다(사용자 요청 2026-11-16: "이전 데이터를 먼저 보여주고 업데이트되면 보여주는 방식").
//
// - `usePageActive()` — 지금 보이는가. **메뉴에서 고른 화면이면서 창도 보일 때**(`document.visibilityState === 'visible'`)만 참이다
//   (2026-11-26) — 예전엔 창을 최소화·가려도 고른 화면이면 참이라 1분 자동 새로고침·장 상태 폴링이 계속 돌았다. 창이 다시 보이면
//   다른 화면 전환과 똑같이 `useResumeRefresh`가 간격이 지났을 때 한 번 갱신하고 `useWhenActive`가 미룬 일을 돌린다.
// - `useResumeRefresh(fn, minIntervalMs)` — 다시 보일 때 마지막 갱신에서 `minIntervalMs`가 지났거나 **데이터가 바뀌었으면**
//   `fn`을 부른다. `fn`은 화면을 비우지 말고(로딩 표시·`setX(null)` 없이) 새 값이 오면 바꾸기만 해야 한다.
// - `useWhenActive()` — 숨겨진 동안 예약된 일(폴링 다음 회차 등)을 다시 보일 때까지 미룬다.
// - `markDataChanged()` — 저장·가져오기·설정 변경처럼 다른 화면의 데이터가 바뀌는 일. api.ts가 사용자 동작(쓰기 요청)마다 부른다.
//   숨겨진 화면은 다음에 보일 때 간격과 상관없이 갱신한다. 그 변경을 한(보이는) 화면은 이미 스스로 반영했다고 본다.

/** 다시 보일 때 갱신 간격 — 백엔드 보유종목 캐시(30초, PORTFOLIO_TTL_MS)와 같게. 메뉴를 빠르게 오갈 때 증권사 API를 매번 치지 않는다. */
export const RESUME_REFRESH_MS = 30_000;
/** 무거운 갱신(배당 동기화처럼 증권사 거래내역을 통째로 다시 받는 일)의 간격. */
export const HEAVY_RESUME_REFRESH_MS = 10 * 60_000;

const PageActiveContext = createContext(true);

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
}
const getDocumentVisible = () => document.visibilityState === 'visible';

/** 창(문서)이 보이는가 — 최소화·다른 창에 완전히 가림·화면 잠금이면 false. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, getDocumentVisible, () => true);
}

export function PageActivity({ active, children }: { active: boolean; children: ReactNode }) {
  const visible = useDocumentVisible();
  return <PageActiveContext.Provider value={active && visible}>{children}</PageActiveContext.Provider>;
}

export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}

let dataVersion = 0;
const dataListeners = new Set<(v: number) => void>();

/** 다른 화면이 다시 읽어야 할 만큼 데이터가 바뀌었다. */
export function markDataChanged(): void {
  dataVersion++;
  for (const l of dataListeners) l(dataVersion);
}

export interface ResumeInfo {
  /** 숨겨진 동안 데이터가 바뀌었다(시간 간격 때문이 아니라). */
  dataChanged: boolean;
}

/**
 * 다시 보일 때 갱신. 처음 마운트할 때는 부르지 않는다(페이지의 원래 첫 로딩이 그 일을 한다).
 * 돌려주는 `markRefreshed()`는 페이지가 다른 경로(자동 새로고침·수동 새로고침)로 이미 새로 받았을 때 불러 간격을 다시 센다.
 */
export function useResumeRefresh(fn: (info: ResumeInfo) => void | Promise<void>, minIntervalMs: number): () => void {
  const active = usePageActive();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const activeRef = useRef(active);
  const lastRun = useRef(Date.now());
  const seenVersion = useRef(dataVersion);

  useEffect(() => {
    const onChange = (v: number) => {
      if (activeRef.current) seenVersion.current = v; // 보이는 화면이 한 변경 — 스스로 반영했다
    };
    dataListeners.add(onChange);
    return () => {
      dataListeners.delete(onChange);
    };
  }, []);

  useEffect(() => {
    const wasActive = activeRef.current;
    activeRef.current = active;
    if (!active || wasActive) return;
    const dataChanged = seenVersion.current !== dataVersion;
    if (!dataChanged && Date.now() - lastRun.current < minIntervalMs) return;
    lastRun.current = Date.now();
    seenVersion.current = dataVersion;
    void Promise.resolve(fnRef.current({ dataChanged })).catch(() => {});
  }, [active, minIntervalMs]);

  return useCallback(() => {
    lastRun.current = Date.now();
  }, []);
}

/**
 * 숨겨진 동안은 미뤘다가 다시 보일 때 실행한다(같은 `key`는 마지막 것 하나만). 보이는 중이면 바로 실행.
 * 폴링 타이머의 다음 회차처럼 "보일 때만 의미 있는" 일에 쓴다.
 */
export function useWhenActive(): (key: string, fn: () => void) => void {
  const active = usePageActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const pending = useRef(new Map<string, () => void>());

  useEffect(() => {
    if (!active || pending.current.size === 0) return;
    const jobs = [...pending.current.values()];
    pending.current.clear();
    for (const j of jobs) j();
  }, [active]);

  return useCallback((key: string, fn: () => void) => {
    if (activeRef.current) fn();
    else pending.current.set(key, fn);
  }, []);
}
