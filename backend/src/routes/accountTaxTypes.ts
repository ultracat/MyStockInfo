import { Router } from 'express';
import {
  deleteAccountTaxType,
  listAccountTaxTypes,
  upsertAccountTaxType,
  type AccountTaxType,
} from '../db/accountTaxTypes';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';

export const accountTaxTypesRouter = Router();

const VALID_TYPES: AccountTaxType[] = ['GENERAL', 'ISA', 'PENSION_SAVINGS', 'IRP'];

accountTaxTypesRouter.get('/', (_req, res) => {
  res.json(listAccountTaxTypes());
});

accountTaxTypesRouter.put('/:broker/:accountId', (req, res) => {
  const { broker, accountId } = req.params;
  if (!BROKER_IDS.includes(broker as BrokerId)) {
    return res.status(400).json({ error: `지원하지 않는 증권사입니다: ${broker}` });
  }
  const { taxType } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof taxType !== 'string' || !VALID_TYPES.includes(taxType as AccountTaxType)) {
    return res.status(400).json({ error: `taxType(${VALID_TYPES.join('|')})이 필요합니다.` });
  }
  const entry = upsertAccountTaxType(broker as BrokerId, accountId, taxType as AccountTaxType);
  res.json(entry);
});

// accountLabels.ts의 DELETE와 달리 엔트리가 없어도 404를 안 던진다 — 프론트가
// "일반"을 선택하면 그냥 이 엔드포인트를 부르는데, 애초에 저장된 적 없는
// 계좌(기본값이 이미 GENERAL)에 대해 불러도 "GENERAL 상태가 됐다"는 목표는
// 이미 달성된 것이므로 성공으로 본다.
accountTaxTypesRouter.delete('/:broker/:accountId', (req, res) => {
  const { broker, accountId } = req.params;
  deleteAccountTaxType(broker as BrokerId, accountId);
  res.status(204).end();
});
