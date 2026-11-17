import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { PlannerState } from './types';

/** 계획·목표 값(backend db/planner.ts) — 한 번 읽고, `update`는 보낸 필드만 바꾼 뒤 서버가 돌려준 값으로 맞춘다. */
export function usePlanner() {
  const [planner, setPlanner] = useState<PlannerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    api
      .getPlanner()
      .then((p) => {
        setPlanner(p);
        setError(null);
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => reload(), [reload]);
  const update = useCallback(async (patch: Partial<PlannerState>) => {
    const next = await api.updatePlanner(patch);
    setPlanner(next);
    return next;
  }, []);
  return { planner, error, reload, update };
}
