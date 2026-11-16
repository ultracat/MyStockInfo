import { Router } from 'express';
import { clearCredential, getCredentialFields, hasCredential, listInsecureBrokers, setCredentialFields } from '../credentials';
import { getSecureStorageState, SECURE_STORAGE_UNAVAILABLE_MESSAGE, SecureStorageUnavailableError } from '../secureStorage';
import { hasInsecureTokens } from '../google/store';
import { getSettings, setUsdKrwRate } from '../db/settings';
import { CREDENTIAL_FIELDS } from '../brokers/credentialFields';
import { BROKER_IDS } from '../brokers/knownBrokers';
import type { BrokerId } from '../brokers/types';
import { clearEximbankAuthKey, hasEximbankAuthKey, setEximbankAuthKey } from '../fx/eximbankKey';
import { checkEximbankAuthKey } from '../fx/eximbankClient';

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

// ---- 한국수출입은행 환율 API 인증키(사용자 입력, fx/eximbankKey.ts) — 값은 절대 돌려주지 않는다(있는지만).
settingsRouter.get('/eximbank-key', (_req, res) => {
  res.json({ configured: hasEximbankAuthKey() });
});

settingsRouter.post('/eximbank-key', async (req, res) => {
  const authKey = typeof req.body?.authKey === 'string' ? req.body.authKey.trim() : '';
  // 발급 키는 영문·숫자 32자 안팎 — 붙여 넣다 섞인 공백·따옴표 같은 것만 거른다.
  if (!/^[A-Za-z0-9]{16,64}$/.test(authKey)) {
    return res.status(400).json({ error: '인증키 형식이 올바르지 않습니다. 한국수출입은행에서 발급받은 인증키(영문·숫자)를 그대로 붙여 넣어 주세요.' });
  }
  const check = await checkEximbankAuthKey(authKey);
  if (check === 'invalid') {
    return res.status(400).json({ error: '한국수출입은행이 이 인증키를 거부했습니다. 키를 다시 확인해 주세요(발급 직후엔 사용 가능해지기까지 시간이 걸릴 수 있습니다).' });
  }
  try {
    setEximbankAuthKey(authKey);
  } catch (err) {
    if (err instanceof SecureStorageUnavailableError) return res.status(409).json({ error: err.message });
    throw err;
  }
  // 'limit'(오늘 한도 마감)·'unreachable'(확인 실패)은 키 자체가 틀렸다는 뜻이 아니라 저장은 한다.
  res.json({
    configured: true,
    verified: check === 'ok',
    warning:
      check === 'limit'
        ? '오늘 호출 한도가 다 찼다고 응답했습니다. 키는 저장했고, 내일부터 조회됩니다.'
        : check === 'unreachable'
          ? '지금 한국수출입은행에 연결하지 못해 키를 확인하지 못했습니다. 키는 저장했습니다.'
          : null,
  });
});

settingsRouter.delete('/eximbank-key', (_req, res) => {
  clearEximbankAuthKey();
  res.json({ configured: false });
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
