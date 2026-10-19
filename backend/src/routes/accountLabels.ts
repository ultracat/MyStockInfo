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
  const { label, accountNumber } = (req.body ?? {}) as Record<string, unknown>;
  if ((label !== undefined && typeof label !== 'string') || (accountNumber !== undefined && typeof accountNumber !== 'string')) {
    return res.status(400).json({ error: 'label/accountNumber는 문자열이어야 합니다.' });
  }
  const trimmedLabel = (label ?? '').trim();
  const trimmedNumber = (accountNumber ?? '').trim();
  if (!trimmedLabel && !trimmedNumber) {
    return res.status(400).json({ error: 'label 또는 accountNumber가 필요합니다.' });
  }
  const entry = upsertAccountLabel(broker as BrokerId, accountId, { label: trimmedLabel, accountNumber: trimmedNumber });
  res.json(entry);
});

accountLabelsRouter.delete('/:broker/:accountId', (req, res) => {
  const { broker, accountId } = req.params;
  const removed = deleteAccountLabel(broker as BrokerId, accountId);
  if (!removed) return res.status(404).json({ error: '해당 계좌 별칭을 찾을 수 없습니다.' });
  res.status(204).end();
});
