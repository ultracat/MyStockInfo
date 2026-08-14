import { Router } from 'express';
import { addDividend, deleteDividend, listDividends, monthlySummary } from '../db/dividends';

export const dividendsRouter = Router();

dividendsRouter.get('/', (_req, res) => {
  res.json(listDividends());
});

dividendsRouter.get('/monthly-summary', (_req, res) => {
  res.json(monthlySummary());
});

dividendsRouter.post('/', (req, res) => {
  const { broker, symbol, name, currency, amount, paidDate, memo } = req.body ?? {};

  if (
    typeof broker !== 'string' ||
    typeof symbol !== 'string' ||
    !symbol ||
    typeof name !== 'string' ||
    !name ||
    (currency !== 'KRW' && currency !== 'USD') ||
    typeof amount !== 'number' ||
    amount <= 0 ||
    typeof paidDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(paidDate)
  ) {
    return res.status(400).json({
      error: 'broker, symbol, name, currency(KRW|USD), amount(양수), paidDate(YYYY-MM-DD)가 필요합니다.',
    });
  }

  const record = addDividend({
    broker: broker as any,
    symbol,
    name,
    currency,
    amount,
    paidDate,
    memo: typeof memo === 'string' ? memo : null,
  });
  res.status(201).json(record);
});

dividendsRouter.delete('/:id', (req, res) => {
  const removed = deleteDividend(req.params.id);
  if (!removed) return res.status(404).json({ error: '해당 배당 기록을 찾을 수 없습니다.' });
  res.status(204).end();
});
