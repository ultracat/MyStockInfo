import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// 앱 코드가 부르는 증권사 API가 전부 공식 명세 감시 목록(backend/spec/watch.json → snapshots)에 있는지 — 감시 목록은 손으로 관리해서
// 빠지기 쉽다(2026-11-17 KIS에서 배당 원천 CTRGA011R·해외 권리 CTRGT011R이 빠져 있었다). 새 API를 쓰면 이 테스트가 watch.json에
// 넣으라고 실패한다 → 한 줄 추가 + `npm run spec:update`. 주석 속 언급은 세지 않는다.

const BROKERS = path.join(__dirname, '..', 'src', 'brokers');
const SPEC = path.join(__dirname, '..', 'spec');
const watch = JSON.parse(fs.readFileSync(path.join(SPEC, 'watch.json'), 'utf8'));
const snapshot = (name: string) => JSON.parse(fs.readFileSync(path.join(SPEC, 'snapshots', `${name}.json`), 'utf8'));

/** 그 증권사 폴더의 코드(주석·생성 파일 제외). */
function code(broker: string): string {
  return fs
    .readdirSync(path.join(BROKERS, broker))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.gen.ts'))
    .map((f) => fs.readFileSync(path.join(BROKERS, broker, f), 'utf8'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
const uniq = (xs: string[]) => [...new Set(xs)].sort();
/** 코드의 경로(`${…}`·`{…}`는 경로 변수) → 명세 경로와 맞대는 정규식. */
const pathPattern = (p: string) => new RegExp(`^${p.replace(/\$\{[^}]*\}|\{[^}]*\}/g, '\u0000').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\u0000/g, '[^/]+')}$`);

test('토스: 코드가 부르는 경로가 전부 명세 감시 스냅샷에 있다', () => {
  const used = uniq([...code('toss').matchAll(/['"`](\/(?:api\/v1|oauth2)\/[^'"`?\s]*)/g)].map((m) => m[1].replace(/\/$/, '')));
  const watched = Object.keys(snapshot('toss').paths);
  assert.ok(used.length >= 15, `토스 경로를 찾았다(${used.length}개)`);
  const missing = used.filter((u) => !watched.some((w) => pathPattern(u).test(w)));
  assert.deepEqual(missing, [], `watch.json toss.operations에 없는 경로 — 추가 후 npm run spec:update`);
});

test('NH: 코드가 부르는 경로가 전부 명세 감시 스냅샷에 있다', () => {
  const used = uniq([...code('nh').matchAll(/['"`](\/(?:krstock|gbstock|common|n2|oauth2)\/[A-Za-z0-9/]+)['"`]/g)].map((m) => m[1]));
  const watched = Object.keys(snapshot('nh').paths);
  assert.ok(used.length >= 8, `NH 경로를 찾았다(${used.length}개)`);
  assert.deepEqual(used.filter((u) => !watched.includes(u)), [], 'watch.json nh.operations에 없는 경로');
});

test('키움: 코드가 부르는 API ID가 전부 감시 목록에 있다', () => {
  const used = uniq([...code('kiwoom').matchAll(/['"]((?:au|ka|kt|ust)\d{4,6})['"]/g)].map((m) => m[1]));
  assert.ok(used.length >= 6);
  assert.deepEqual(used.filter((u) => !watch.kiwoom.apiIds.includes(u)), [], 'watch.json kiwoom.apiIds에 없는 API');
});

test('KIS: 코드가 부르는 TR이 감시 목록과 같다', () => {
  const { trIdsInCode } = createRequire(__filename)(path.join(__dirname, '..', '..', 'scripts', 'kis-verify.cjs'));
  assert.deepEqual(trIdsInCode(), [...watch.kis.trIds].sort());
});

test('KB: 코드가 부르는 TR이 전부 감시 목록에 있다', () => {
  const used = uniq([...code('kb').matchAll(/kbPost\(\s*['"]([A-Z]{4}\d{4})['"]/g)].map((m) => m[1]));
  assert.ok(used.length >= 3);
  assert.deepEqual(used.filter((u) => !watch.kb.trIds.includes(u)), [], 'watch.json kb.trIds에 없는 TR');
});

test('LS: 코드가 부르는 TR이 전부 감시 목록에 있다', () => {
  const used = uniq([...code('ls').matchAll(/['"]((?:t\d{4})|(?:C[A-Z]{4}\d{5}))['"]/g)].map((m) => m[1]));
  assert.ok(used.length >= 4);
  assert.deepEqual(used.filter((u) => !watch.ls.trIds.includes(u)), [], 'watch.json ls.trIds에 없는 TR');
});

test('DB: 코드가 부르는 TR·경로가 전부 감시 목록에 있다', () => {
  const src = code('db');
  const used = uniq([...src.matchAll(/['"]((?:C[A-Z]{4}\d{5}))['"]/g)].map((m) => m[1]));
  const paths = uniq([...src.matchAll(/['"](\/api\/v1\/[a-z0-9/-]+)['"]/g)].map((m) => m[1]));
  assert.ok(used.length >= 6 && paths.length >= 6);
  assert.deepEqual(used.filter((u) => !(u in watch.db.trs)), [], 'watch.json db.trs에 없는 TR');
  const watchedPaths = Object.values(watch.db.trs as Record<string, { path: string }>).map((t) => t.path);
  assert.deepEqual(paths.filter((p) => !watchedPaths.includes(p)), [], 'watch.json db.trs의 path와 다른 경로');
});
