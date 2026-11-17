import { Router } from 'express';
import { getPlanner, PlannerValidationError, updatePlanner } from '../db/planner';

// 계획·목표 값(월 배당 목표, ISA·연금 설정과 한도, 목표 비중, 알림 설정·관심종목 목표가) — db/planner.ts.
export const plannerRouter = Router();

plannerRouter.get('/', (_req, res) => {
  res.json(getPlanner());
});

plannerRouter.put('/', (req, res) => {
  try {
    res.json(updatePlanner((req.body ?? {}) as Record<string, unknown>));
  } catch (err) {
    if (err instanceof PlannerValidationError) return res.status(400).json({ error: err.message });
    throw err;
  }
});
