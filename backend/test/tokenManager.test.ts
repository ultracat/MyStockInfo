import { DATA_DIR, readSecretJson, resetDataDir } from './setup';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { clearCredential, setCredentialFields } from '../src/credentials';
import { createTokenManager, credentialKeyHash, invalidateBrokerTokens } from '../src/brokers/tokenManager';
import { tossFetch } from '../src/brokers/toss/tossClient';
import { kisGet } from '../src/brokers/kis/kisClient';

// 공용 토큰 관리자(brokers/tokenManager.ts) — 2026-11-26 리뷰에서 나온 세 가지를 고정한다:
// ① 동시에 401을 받은 요청들은 재발급을 한 번만 한다(토스는 재발급하면 이전 토큰이 죽고, KIS는 발급 빈도 제한이 있다)
// ② 자격증명을 바꾸거나 지우면 이전 토큰을 쓰지 않고 토큰 파일도 지운다 ③ 해시 없는 예전 파일은 한 번 받아들인다.
// 앞쪽은 관리자 자체(가짜 발급 함수), 뒤쪽은 실제 토스·KIS 클라이언트를 가짜 서버(fetch 대체)로.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── 가짜 서버 ───────────────────────────────────────────────────────────────────
interface Call {
  host: string;
  path: string;
  headers: Record<string, string>;
  form: URLSearchParams | null;
  json: Record<string, unknown> | null;
}
let calls: Call[] = [];
let tossSeq = 0;
let kisSeq = 0;
/** 지금 유효한 토스 토큰 — 이것과 다른 Bearer는 401(재발급하면 이전 토큰이 죽는 토스 동작 흉내). */
let tossValid = '';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
  const form = init?.body instanceof URLSearchParams ? init.body : null;
  const parsed = typeof init?.body === 'string' && init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  calls.push({ host: u.host, path: u.pathname, headers, form, json: parsed });

  if (u.host === 'openapi.tossinvest.com') {
    if (u.pathname === '/oauth2/token') {
      tossValid = `toss-tok-${++tossSeq}`;
      return json({ access_token: tossValid, token_type: 'Bearer', expires_in: 3600 });
    }
    if (headers.authorization !== `Bearer ${tossValid}`) {
      await sleep(300); // 두 요청이 모두 401을 받은 뒤에 재발급이 끝나도록 — 겹치는 상황을 만든다
      return json({ error: { code: 'invalid-token' } }, 401);
    }
    return json({ result: [] });
  }
  if (u.host === 'openapi.koreainvestment.com:9443') {
    if (u.pathname === '/oauth2/tokenP') return json({ access_token: `kis-tok-${++kisSeq}`, token_type: 'Bearer', expires_in: 86400 });
    return json({ rt_cd: '0', msg_cd: 'KIOK0000', msg1: '정상처리 되었습니다.', output: {} });
  }
  return json({ error: 'no handler' }, 404);
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

const at = (p: string) => calls.filter((c) => c.path === p);

beforeEach(() => {
  resetDataDir();
  calls = [];
});

// ── 관리자 자체 ─────────────────────────────────────────────────────────────────
function fakeManager(opts: { persist?: boolean; key?: () => string; delayMs?: number } = {}) {
  let issued = 0;
  const m = createTokenManager({
    broker: 'kb', // 아무 브로커 id — 이 파일에선 KB 클라이언트를 쓰지 않는다
    persist: opts.persist ?? false,
    loadCreds: async () => ({ appKey: opts.key?.() ?? 'app-1' }),
    keyOf: (c) => c.appKey,
    async issue() {
      const n = ++issued;
      await sleep(opts.delayMs ?? 20);
      return { accessToken: `t${n}`, expiresAt: Date.now() + 3600_000 };
    },
  });
  return { m, issuedCount: () => issued };
}

test('관리자: 캐시가 없을 때 동시에 온 요청은 발급 한 번을 공유한다', async () => {
  const { m, issuedCount } = fakeManager();
  const got = await Promise.all([m.getToken(), m.getToken(), m.getToken()]);
  assert.deepEqual(got, ['t1', 't1', 't1']);
  assert.equal(issuedCount(), 1);
});

test('관리자: 같은 토큰으로 동시에 401을 받은 요청들은 재발급을 한 번만 한다(staleToken 비교)', async () => {
  const { m, issuedCount } = fakeManager();
  const t1 = await m.getToken();
  // 셋이 동시에 "t1이 죽었다" — 하나만 발급하고 나머지는 그 결과를 같이 받는다.
  const renewed = await Promise.all([m.getToken(t1), m.getToken(t1), m.getToken(t1)]);
  assert.deepEqual(renewed, ['t2', 't2', 't2']);
  // 재발급이 끝난 뒤 늦게 온 401도(여전히 t1이 죽었다고 보고) 또 발급하지 않는다.
  assert.equal(await m.getToken(t1), 't2');
  assert.equal(issuedCount(), 2);
  // 새 토큰마저 죽었다고 하면 그때는 다시 받는다.
  assert.equal(await m.getToken('t2'), 't3');
});

test('관리자: 앱키가 바뀌면 이전 키의 토큰(메모리·파일)을 쓰지 않는다', async () => {
  let key = 'app-A';
  const { m, issuedCount } = fakeManager({ persist: true, key: () => key });
  assert.equal(await m.getToken(), 't1');
  const stored = await readSecretJson<{ accessToken: string; keyHash: string }>('kb-token.json');
  assert.equal(stored.keyHash, credentialKeyHash('app-A'));
  assert.ok(!JSON.stringify(stored).includes('app-A'), '앱키 원문은 저장하지 않는다');
  key = 'app-B';
  assert.equal(await m.getToken(), 't2');
  assert.equal(issuedCount(), 2);
});

test('관리자: 해시 없는 예전 토큰 파일은 한 번 받아들이고 지금 키 해시를 붙여 다시 쓴다', async () => {
  const { m, issuedCount } = fakeManager({ persist: true });
  fs.writeFileSync(path.join(DATA_DIR, 'kb-token.json'), JSON.stringify({ accessToken: 'legacy', expiresAt: Date.now() + 3600_000 }));
  // 메모리는 비어 있고 파일만 있다 — 업그레이드 직후 재시작 상황
  assert.equal(await m.getToken(), 'legacy');
  assert.equal(issuedCount(), 0);
  const stored = await readSecretJson<{ accessToken: string; keyHash: string }>('kb-token.json');
  assert.equal(stored.keyHash, credentialKeyHash('app-1'));
});

test('관리자: 다른 키 해시가 붙은 파일은 쓰지 않는다', async () => {
  const { m, issuedCount } = fakeManager({ persist: true });
  fs.writeFileSync(
    path.join(DATA_DIR, 'kb-token.json'),
    JSON.stringify({ accessToken: 'other-key', expiresAt: Date.now() + 3600_000, keyHash: credentialKeyHash('someone-else') })
  );
  assert.equal(await m.getToken(), 't1');
  assert.equal(issuedCount(), 1);
});

test('관리자: 발급 도중 무효화되면 그 결과를 캐시·파일에 남기지 않는다', async () => {
  const { m, issuedCount } = fakeManager({ persist: true, delayMs: 100 });
  const pending = m.getToken();
  await sleep(20);
  invalidateBrokerTokens('kb'); // 자격증명 저장/삭제 — 진행 중인 발급은 이전 키로 시작한 것
  assert.equal(await pending, 't1', '기다리던 호출은 결과를 받는다');
  assert.equal(fs.existsSync(path.join(DATA_DIR, 'kb-token.json')), false, '파일에 쓰지 않는다');
  assert.equal(await m.getToken(), 't2', '다음 호출은 새로 받는다');
  assert.equal(issuedCount(), 2);
});

// ── 토스: 동시에 401 → 재발급 한 번 ────────────────────────────────────────────
test('토스: 동시에 401을 받은 두 요청은 토큰을 한 번만 다시 받는다(서로의 새 토큰을 죽이지 않는다)', async () => {
  await setCredentialFields('toss', { clientId: 'toss-client', clientSecret: 'toss-secret' });
  await tossFetch('/api/v1/accounts', 'ACCOUNT'); // 토큰 하나 받아 둔다
  const firstIssue = at('/oauth2/token').length;
  // 앱 밖에서 같은 키로 토큰을 받은 상황 — 서버 쪽에서 지금 토큰이 죽었다.
  tossValid = 'issued-elsewhere';
  await Promise.all([tossFetch('/api/v1/holdings', 'ASSET', { accountSeq: 1 }), tossFetch('/api/v1/holdings', 'ASSET', { accountSeq: 1 })]);
  assert.equal(at('/oauth2/token').length - firstIssue, 1, '재발급은 한 번');
  const holdings = at('/api/v1/holdings');
  assert.equal(holdings.length, 4, '두 요청 모두 401 한 번 + 재시도 한 번');
  assert.ok(holdings.slice(2).every((c) => c.headers.authorization === `Bearer ${tossValid}`), '재시도는 둘 다 새 토큰으로');
});

test('토스: Client ID/Secret을 바꾸면 메모리의 이전 토큰을 쓰지 않는다', async () => {
  await setCredentialFields('toss', { clientId: 'toss-client', clientSecret: 'toss-secret' });
  await tossFetch('/api/v1/accounts', 'ACCOUNT');
  const before = at('/oauth2/token').length;
  await setCredentialFields('toss', { clientId: 'toss-client', clientSecret: 'toss-secret' }); // 같은 값 다시 저장 — 그대로
  await tossFetch('/api/v1/accounts', 'ACCOUNT');
  assert.equal(at('/oauth2/token').length, before, '같은 값이면 재발급하지 않는다');
  await setCredentialFields('toss', { clientId: 'toss-client-2', clientSecret: 'toss-secret-2' });
  await tossFetch('/api/v1/accounts', 'ACCOUNT');
  const tokenCalls = at('/oauth2/token');
  assert.equal(tokenCalls.length, before + 1);
  assert.equal(tokenCalls.at(-1)!.form?.get('client_id'), 'toss-client-2');
  assert.equal(at('/api/v1/accounts').at(-1)!.headers.authorization, `Bearer ${tossValid}`);
});

// ── KIS: 자격증명 변경·삭제 → 토큰 파일 정리 ───────────────────────────────────
const KIS_CREDS = { appKey: 'kis-app', appSecret: 'kis-secret-1', accountNumber: '12345678', accountProductCode: '01' };
const kisCall = () => kisGet('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: '005930' });

test('KIS: 앱시크릿만 바꿔도 이전 토큰(메모리·kis-token.json)을 버리고 새로 받는다, 지우면 파일도 지운다', async () => {
  await setCredentialFields('kis', KIS_CREDS);
  await kisCall();
  const tokenFile = path.join(DATA_DIR, 'kis-token.json');
  const first = await readSecretJson<{ accessToken: string }>('kis-token.json');
  const issuedBefore = at('/oauth2/tokenP').length;

  await setCredentialFields('kis', { ...KIS_CREDS, appSecret: 'kis-secret-2' });
  assert.equal(fs.existsSync(tokenFile), false, '바꾸는 즉시 토큰 파일을 지운다');
  await kisCall();
  assert.equal(at('/oauth2/tokenP').length, issuedBefore + 1, '새로 한 번 받는다');
  assert.equal(at('/oauth2/tokenP').at(-1)!.json?.appsecret, 'kis-secret-2');
  const second = await readSecretJson<{ accessToken: string }>('kis-token.json');
  assert.notEqual(second.accessToken, first.accessToken);
  assert.equal(calls.at(-1)!.headers.authorization, `Bearer ${second.accessToken}`);

  clearCredential('kis');
  assert.equal(fs.existsSync(tokenFile), false, '키를 지우면 디스크에 토큰이 남지 않는다');
  await assert.rejects(kisCall, /API 키가 설정되지 않았습니다/);
});
