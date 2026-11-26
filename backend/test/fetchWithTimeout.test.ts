import { resetDataDir } from './setup';
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { setCredentialFields } from '../src/credentials';
import { FetchTimeoutError, fetchWithTimeout, setDefaultFetchTimeoutForTest } from '../src/http/fetchWithTimeout';
import { tossFetch } from '../src/brokers/toss/tossClient';
import { handleBrokerApiError } from '../src/brokers/errors';

// 외부 요청 제한 시간(http/fetchWithTimeout.ts) — 응답이 안 오면 끝없이 기다리던 토스·KIS·KB·키움·Google 요청(2026-11-26 리뷰).
// 가짜 fetch는 signal이 끊길 때까지 응답하지 않는다(진짜 fetch처럼 signal.reason으로 거부).

type Mode = 'hang' | 'stall-body' | 'ok' | 'no-content';
let mode: Mode = 'ok';

function hangUntilAbort(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return; // signal이 없으면 정말로 끝나지 않는다 — 이 테스트에선 그러면 실패(시간 초과)
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = new URL(String(url));
  if (u.pathname === '/oauth2/token') {
    return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
  }
  if (mode === 'hang') return hangUntilAbort(init?.signal);
  if (mode === 'no-content') return new Response(null, { status: 204, headers: { 'x-test': '1' } });
  if (mode === 'stall-body') {
    // 헤더는 바로 오고 본문이 멈춘다 — 본문 읽기까지 제한 시간 안이어야 한다.
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        signal?.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
    });
    return new Response(body, { status: 200 });
  }
  return new Response(JSON.stringify({ result: [] }), { status: 200, headers: { 'content-type': 'application/json', 'x-test': 'ok' } });
}) as typeof fetch;
process.on('exit', () => (globalThis.fetch = realFetch));

beforeEach(() => {
  resetDataDir();
  mode = 'ok';
  setDefaultFetchTimeoutForTest(null);
});
after(() => setDefaultFetchTimeoutForTest(null));

test('응답이 없으면 제한 시간 뒤 FetchTimeoutError(한국어 메시지, status 0·body ""), URL은 메시지에 없다', async () => {
  mode = 'hang';
  const started = Date.now();
  const err = await fetchWithTimeout('https://example.invalid/oauth?appkey=SECRET', { timeoutMs: 80, label: '테스트증권' }).catch((e) => e);
  assert.ok(err instanceof FetchTimeoutError);
  assert.ok(Date.now() - started < 2000);
  assert.match(err.message, /테스트증권 서버가 1초 안에 응답하지 않아 요청을 중단했습니다\(시간 초과\)/);
  assert.equal(err.status, 0);
  assert.equal(err.body, '');
  assert.ok(!err.message.includes('SECRET'), '쿼리(앱키)가 메시지에 실리지 않는다');
});

test('헤더 뒤 본문이 멈춰도 제한 시간에 끊는다', async () => {
  mode = 'stall-body';
  await assert.rejects(fetchWithTimeout('https://example.invalid/x', { timeoutMs: 80 }), FetchTimeoutError);
});

test('호출부 signal로 끊으면 시간 초과가 아니라 원래 AbortError', async () => {
  mode = 'hang';
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  const err = await fetchWithTimeout('https://example.invalid/x', { timeoutMs: 5000, signal: ac.signal }).catch((e) => e);
  assert.ok(!(err instanceof FetchTimeoutError));
  assert.equal((err as Error).name, 'AbortError');
});

test('정상 응답은 상태·헤더·본문 그대로(204도)', async () => {
  const res = await fetchWithTimeout('https://example.invalid/x');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-test'), 'ok');
  assert.deepEqual(await res.json(), { result: [] });
  mode = 'no-content';
  const empty = await fetchWithTimeout('https://example.invalid/x');
  assert.equal(empty.status, 204);
  assert.equal(empty.headers.get('x-test'), '1');
  assert.equal(await empty.text(), '');
});

test('토스 요청이 응답 없이 멈추면 제한 시간 뒤 실패하고, 라우트 오류 처리(handleBrokerApiError)가 502 + 메시지로 내보낸다', async () => {
  await setCredentialFields('toss', { clientId: 'toss-client', clientSecret: 'toss-secret' });
  setDefaultFetchTimeoutForTest(100);
  mode = 'hang';
  const err = await tossFetch('/api/v1/accounts', 'ACCOUNT').catch((e) => e);
  assert.ok(err instanceof FetchTimeoutError, String(err));
  assert.match(err.message, /^토스증권 서버가 .*시간 초과/);

  let status = 0;
  let payload: unknown = null;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(body: unknown) {
      payload = body;
      return this;
    },
  };
  const origError = console.error;
  console.error = () => {};
  try {
    handleBrokerApiError(err, res as never);
  } finally {
    console.error = origError;
  }
  assert.equal(status, 502);
  assert.match(JSON.stringify(payload), /시간 초과/);
});
