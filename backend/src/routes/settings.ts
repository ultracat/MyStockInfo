import { Router } from 'express';
import { clearCredential, hasCredential, setCredentialFields } from '../credentials';
import { getSettings, setUsdKrwRate } from '../db/settings';
import { CREDENTIAL_FIELDS } from '../brokers/credentialFields';
import type { BrokerId } from '../brokers/types';

const SUPPORTED_BROKERS: BrokerId[] = ['toss', 'kis', 'kb'];

function isBrokerId(value: string): value is BrokerId {
  return (SUPPORTED_BROKERS as string[]).includes(value);
}

export const settingsRouter = Router();

settingsRouter.get('/credentials', (_req, res) => {
  const status = Object.fromEntries(SUPPORTED_BROKERS.map((b) => [b, hasCredential(b)]));
  res.json(status);
});

settingsRouter.get('/credential-fields', (_req, res) => {
  res.json(CREDENTIAL_FIELDS);
});

settingsRouter.post('/credentials/:broker', (req, res) => {
  const { broker } = req.params;
  if (!isBrokerId(broker)) {
    return res.status(400).json({ error: `지원하지 않는 증권사입니다: ${broker}` });
  }

  const spec = CREDENTIAL_FIELDS[broker];
  if (spec.length === 0) {
    return res.status(400).json({ error: `${broker}는 아직 지원되지 않습니다.` });
  }

  const fields = req.body?.fields ?? {};
  const missing = spec.filter((f) => typeof fields[f.key] !== 'string' || !fields[f.key]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `다음 항목이 필요합니다: ${missing.map((f) => f.label).join(', ')}`,
    });
  }

  const trimmed = Object.fromEntries(spec.map((f) => [f.key, String(fields[f.key]).trim()]));
  setCredentialFields(broker, trimmed);
  res.status(204).end();
});

settingsRouter.delete('/credentials/:broker', (req, res) => {
  const { broker } = req.params;
  if (!isBrokerId(broker)) {
    return res.status(400).json({ error: `지원하지 않는 증권사입니다: ${broker}` });
  }
  clearCredential(broker);
  res.status(204).end();
});

settingsRouter.get('/fx-rate', (_req, res) => {
  res.json(getSettings());
});

settingsRouter.post('/fx-rate', (req, res) => {
  const { usdKrwRate } = req.body ?? {};
  if (usdKrwRate !== null && (typeof usdKrwRate !== 'number' || usdKrwRate <= 0)) {
    return res.status(400).json({ error: 'usdKrwRate는 양수 또는 null이어야 합니다.' });
  }
  res.json(setUsdKrwRate(usdKrwRate));
});
