import { Router } from 'express';
import { deleteAccountLabel, listAccountLabels, upsertAccountLabel } from '../db/accountLabels';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';

export const accountLabelsRouter = Router();

accountLabelsRouter.get('/', (req, res) => {
  const broker = typeof req.query.broker === 'string' ? (req.query.broker as BrokerId) : undefined;
  res.json(listAccountLabels(broker));
});

accountLabelsRouter.put('/:broker/:accountId', (req, res) => {
  const { broker, accountId } = req.params;
  if (!BROKER_IDS.includes(broker as BrokerId)) {
    return res.status(400).json({ error: `지원하지 않는 증권사입니다: ${broker}` });
  }
  const { label } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ error: 'label이 필요합니다.' });
  }
  const entry = upsertAccountLabel(broker as BrokerId, accountId, label.trim());
  res.json(entry);
});

accountLabelsRouter.delete('/:broker/:accountId', (req, res) => {
  const { broker, accountId } = req.params;
  const removed = deleteAccountLabel(broker as BrokerId, accountId);
  if (!removed) return res.status(404).json({ error: '해당 계좌 별칭을 찾을 수 없습니다.' });
  res.status(204).end();
});
