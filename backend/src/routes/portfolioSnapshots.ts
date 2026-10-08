import { Router } from 'express';
import { listSnapshots, upsertSnapshot } from '../db/portfolioSnapshots';

export const portfolioSnapshotsRouter = Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

portfolioSnapshotsRouter.get('/', (_req, res) => {
  res.json(listSnapshots());
});

portfolioSnapshotsRouter.post('/', (req, res) => {
  const { date, totalMarketValueKrw, totalPurchaseAmountKrw, totalProfitLossKrw } = (req.body ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof date !== 'string' ||
    !DATE_RE.test(date) ||
    typeof totalMarketValueKrw !== 'number' ||
    !Number.isFinite(totalMarketValueKrw) ||
    typeof totalPurchaseAmountKrw !== 'number' ||
    !Number.isFinite(totalPurchaseAmountKrw) ||
    typeof totalProfitLossKrw !== 'number' ||
    !Number.isFinite(totalProfitLossKrw)
  ) {
    return res.status(400).json({
      error: 'date(YYYY-MM-DD), totalMarketValueKrw, totalPurchaseAmountKrw, totalProfitLossKrw(모두 숫자)가 필요합니다.',
    });
  }

  const record = upsertSnapshot({ date, totalMarketValueKrw, totalPurchaseAmountKrw, totalProfitLossKrw });
  res.status(201).json(record);
});
