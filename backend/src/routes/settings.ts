import { Router } from 'express';
import { clearCredential, getCredentialFields, hasCredential, listInsecureBrokers, setCredentialFields } from '../credentials';
import { getSecureStorageState, SECURE_STORAGE_UNAVAILABLE_MESSAGE, SecureStorageUnavailableError } from '../secureStorage';
import { hasInsecureTokens } from '../google/store';
import { getSettings, setUsdKrwRate } from '../db/settings';
import { CREDENTIAL_FIELDS } from '../brokers/credentialFields';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';

function isBrokerId(value: string): value is BrokerId {
  return (BROKER_IDS as string[]).includes(value);
}

export const settingsRouter = Router();

settingsRouter.get('/credentials', (_req, res) => {
  const status = Object.fromEntries(BROKER_IDS.map((b) => [b, hasCredential(b)]));
  res.json(status);
});

// 설정 화면 경고 배너용 — 키링 없는 Linux 등에서는 자격증명/Google 연결 저장을
// 거부하므로(secureStorage.ts) 화면이 먼저 이유와 해결 방법을 보여준다.
settingsRouter.get('/secure-storage', (_req, res) => {
  const state = getSecureStorageState();
  res.json({
    available: state.kind !== 'unavailable',
    message: state.kind === 'unavailable' ? SECURE_STORAGE_UNAVAILABLE_MESSAGE : null,
    linuxBackend: state.kind === 'unavailable' ? state.linuxBackend : null,
    insecureBrokers: listInsecureBrokers(),
    insecureGoogle: hasInsecureTokens(),
  });
});

settingsRouter.get('/credential-fields', (_req, res) => {
  res.json(CREDENTIAL_FIELDS);
});

// "증권사 연동 상태" 표에 계좌번호 같은 계좌 정보를 보여주기 위한 엔드포인트 —
// `secret: true`인 필드(appSecret 등)뿐 아니라 `kind !== 'account'`인 필드
// (appKey, Client ID 등 — 비밀은 아니지만 계좌 정보도 아님)도 뺀다. 그래서
// KIS의 계좌번호/상품코드, KB의 계좌번호처럼 "API 연동에 계좌 정보를 같이
// 입력해야 하는" 브로커에서만, 그 계좌 정보만 채워지고 나머지는 빈 객체.
settingsRouter.get('/credential-info', (_req, res) => {
  const info: Partial<Record<BrokerId, Record<string, string>>> = {};
  for (const broker of BROKER_IDS) {
    if (!hasCredential(broker)) continue;
    const spec = CREDENTIAL_FIELDS[broker].filter((f) => f.kind === 'account');
    if (spec.length === 0) continue;
    const stored = getCredentialFields(broker);
    if (!stored) continue;
    const nonSecret: Record<string, string> = {};
    for (const f of spec) {
      if (typeof stored[f.key] === 'string' && stored[f.key]) nonSecret[f.key] = stored[f.key];
    }
    if (Object.keys(nonSecret).length > 0) info[broker] = nonSecret;
  }
  res.json(info);
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
  try {
    setCredentialFields(broker, trimmed);
  } catch (err) {
    if (err instanceof SecureStorageUnavailableError) return res.status(409).json({ error: err.message });
    throw err;
  }
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
