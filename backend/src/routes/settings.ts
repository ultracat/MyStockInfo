import { Router } from 'express';
import { clearCredential, getCredentialFields, hasCredential, setCredentialFields } from '../credentials';
import { getSettings, setEximbankAuthKey, setUsdKrwRate } from '../db/settings';
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

// eximbankAuthKey도 여기 같이 담겨 나온다(getSettings()가 AppSettings 전체를
// 돌려줌) — 별도 GET 라우트를 안 만들고 이 응답 하나로 환율 설정 카드 전체를
// 채운다. 계좌 접근 권한이 없는 공개 환율 조회 전용 키라 KIS appKey 같은
// non-secret 필드와 같은 수준으로 그냥 보여준다(값을 가리지 않음).
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

// 한국수출입은행 환율 API 인증키 — 토스 환율 조회가 실패했을 때의 대체 소스
// (exchangeRateResolver.ts). 무료 발급, 계좌/거래 권한 없는 공개 데이터 조회
// 전용 키라 브로커 자격증명과 달리 암호화 저장 안 함(db/settings.ts 주석 참고).
settingsRouter.post('/eximbank-key', (req, res) => {
  const { authKey } = req.body ?? {};
  if (authKey !== null && (typeof authKey !== 'string' || !authKey.trim())) {
    return res.status(400).json({ error: 'authKey는 문자열 또는 null이어야 합니다.' });
  }
  res.json(setEximbankAuthKey(authKey === null ? null : authKey.trim()));
});
