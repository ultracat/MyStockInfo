import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import type { PlannerState } from './types';

// 계획·목표 값(backend db/planner.ts) — **화면들이 하나의 저장소를 공유한다**(2026-11-17 UI 점검: 화면마다 따로 받아서, 설정에서 알림을 켜도
// 관심종목 화면엔 "꺼져 있습니다"가 남는 식으로 어긋났다). 처음 쓰는 화면이 한 번 받고, `update`는 서버가 돌려준 값으로 모두에게 알린다.
let state: PlannerState | null = null;
let error: string | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(force = false): Promise<void> {
  if (inflight) return inflight;
  if (state && !force) return Promise.resolve();
  inflight = api
    .getPlanner()
    .then((p) => {
      state = p;
      error = null;
    })
    .catch((e) => {
      error = (e as Error).message;
    })
    .finally(() => {
      inflight = null;
      emit();
    });
  return inflight;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function usePlanner() {
  const planner = useSyncExternalStore(subscribe, () => state);
  const err = useSyncExternalStore(subscribe, () => error);
  useEffect(() => void load(), []);
  const reload = useCallback(() => void load(true), []);
  const update = useCallback(async (patch: Partial<PlannerState>) => {
    const next = await api.updatePlanner(patch);
    state = next;
    emit();
    return next;
  }, []);
  return { planner, error: err, reload, update };
}
