/* eslint-disable */
// 증권사 공식 명세 감시 — MyStock이 실제로 쓰는 엔드포인트만 뽑아(backend/spec/watch.json) 구조를 스냅샷으로 고정하고,
// 최신 공식 명세와 비교해 바뀐 곳을 알려 준다. 사용자가 "안 돼요" 하기 전에 필드 이름·형식 변경을 먼저 알기 위해서다(2026-11-17).
//
//   npm run spec:check     최신 명세를 받아 스냅샷과 비교 — 구조가 바뀌었으면 종료 코드 1(CI 주간 점검이 실패로 알림)
//   npm run spec:update    최신 명세로 스냅샷·타입·예시 픽스처를 다시 만든다(바뀐 내용을 코드에 반영할 때)
//   npm run spec:types     저장된 스냅샷에서 타입 파일만 다시 만든다(네트워크 없음 — CI가 생성물이 최신인지 확인)
//
// 왜 명세 전체를 저장소에 두지 않나: 토스·NH 명세엔 라이선스 표기가 없고, 키움 저장소 라이선스는 복제·배포를 금지한다.
// 그래서 **우리가 쓰는 엔드포인트의 구조(필드 이름·형식·필수 여부)만** 남기고 설명문·예시는 버린다. 예외는 토스 응답 예시 —
// 자동 테스트의 입력으로 쓴다(backend/test/fixtures/toss-spec-examples.json, 키움 예시 픽스처와 같은 방식).
//
// 출처별:
// - 토스: OpenAPI 3.1 → snapshots/toss.json → backend/src/brokers/toss/tossSpec.gen.ts (openapi-typescript)
// - NH:   OpenAPI 3.0 세 개(common·krstock·gbstock) → 하나로 합친 snapshots/nh.json → backend/src/brokers/nh/nhSpec.gen.ts
// - 키움: 저장소의 kiwoom_api_spec.json(자체 형식) → 필드 목록 snapshots/kiwoom.json → backend/src/brokers/kiwoom/kiwoomSpec.gen.ts
// - KIS:  기계가 읽을 명세가 없다 → 공식 예제 전체를 카탈로그(backend/spec/kis-catalog.json)로 만들고, 쓰는 TR의 주소·TR ID·
//         요청 파라미터·응답 필드를 snapshots/kis.json으로 비교한다. 실제 응답 기록·KIS 타입은 scripts/kis-verify.cjs(KIS 검증 묶음).
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const specDir = path.join(root, 'backend', 'spec');
const snapDir = path.join(specDir, 'snapshots');
const watch = JSON.parse(fs.readFileSync(path.join(specDir, 'watch.json'), 'utf8'));
const GEN = {
  toss: path.join(root, 'backend/src/brokers/toss/tossSpec.gen.ts'),
  nh: path.join(root, 'backend/src/brokers/nh/nhSpec.gen.ts'),
  kiwoom: path.join(root, 'backend/src/brokers/kiwoom/kiwoomSpec.gen.ts'),
  kis: path.join(root, 'backend/src/brokers/kis/kisSpec.gen.ts'),
};
const TOSS_EXAMPLES = path.join(root, 'backend/test/fixtures/toss-spec-examples.json');
const GEN_HEADER = (src) =>
  `// ⚠ 자동 생성 파일 — 직접 고치지 말 것. \`npm run spec:types\`가 backend/spec/snapshots/${src}에서 만든다.\n` +
  `// 증권사 공식 명세 중 MyStock이 쓰는 엔드포인트의 구조만 담았다(scripts/spec-watch.cjs).\n/* eslint-disable */\n`;

// ── 공통 ─────────────────────────────────────────────────────────────────────
const stable = (v) => JSON.stringify(sortKeys(v), null, 2) + '\n';
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
}

async function getText(url) {
  // 테스트·오프라인 확인용: SPEC_WATCH_DIR에 같은 이름 파일이 있으면 그걸 쓴다(URL 마지막 두 조각으로 이름을 만든다).
  const local = process.env.SPEC_WATCH_DIR && path.join(process.env.SPEC_WATCH_DIR, url.split('/').slice(-2).join('_'));
  if (local && fs.existsSync(local)) return fs.readFileSync(local, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': 'MyStock-spec-watch' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}
const getJson = async (url) => JSON.parse(await getText(url));

/** 두 값의 차이를 "경로: 무엇이 바뀜" 줄로. 배열은 원소 단위가 아니라 통째로 비교한다(필드 목록이 짧다). */
function diff(a, b, at = '', out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = at ? `${at}.${k}` : k;
      if (!(k in b)) out.push(`- ${p} (삭제됨)`);
      else if (!(k in a)) out.push(`+ ${p} (추가됨)`);
      else diff(a[k], b[k], p, out);
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const sa = a.map((x) => JSON.stringify(x));
    const sb = b.map((x) => JSON.stringify(x));
    for (const x of sa.filter((x) => !sb.includes(x))) out.push(`- ${at}: ${x}`);
    for (const x of sb.filter((x) => !sa.includes(x))) out.push(`+ ${at}: ${x}`);
    if (out.length === 0 || (sa.every((x) => sb.includes(x)) && sb.every((x) => sa.includes(x)))) out.push(`~ ${at}: 순서만 바뀜`);
  } else {
    out.push(`~ ${at}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  }
  return out;
}

// ── OpenAPI(토스·NH): 쓰는 operation + 거기서 닿는 스키마만, 설명문·예시 없이 ─────────────────
const SCHEMA_KEYS = new Set([
  'type', 'format', 'nullable', 'required', 'properties', 'items', 'allOf', 'oneOf', 'anyOf', 'enum', 'const',
  'additionalProperties', '$ref', 'deprecated',
]);
function slimSchema(s) {
  if (Array.isArray(s)) return s.map(slimSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (!SCHEMA_KEYS.has(k)) continue;
    if (k === 'properties') out[k] = Object.fromEntries(Object.entries(v).map(([n, ps]) => [n, slimSchema(ps)]));
    else if (k === 'required') out[k] = [...v].sort();
    else if (k === 'additionalProperties') out[k] = typeof v === 'object' ? slimSchema(v) : v;
    else out[k] = slimSchema(v);
  }
  return out;
}
function refsIn(v, acc = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => refsIn(x, acc));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) k === '$ref' ? acc.add(x) : refsIn(x, acc);
  return acc;
}
const resolve = (spec, ref) => ref.replace(/^#\//, '').split('/').reduce((o, k) => o?.[k], spec);

/** 한 명세에서 operationId 목록에 해당하는 것만 뽑는다. examples는 {operationId: {이름: 값}}. */
function slimOpenApi(spec, wanted) {
  const paths = {};
  const examples = {};
  const found = new Set();
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!op || typeof op !== 'object' || !wanted.includes(op.operationId)) continue;
      found.add(op.operationId);
      const params = [...(item.parameters ?? []), ...(op.parameters ?? [])].map((x) => (x.$ref ? resolve(spec, x.$ref) : x));
      const slimOp = { operationId: op.operationId };
      if (params.length) {
        slimOp.parameters = params
          .map((x) => ({ name: x.name, in: x.in, required: !!x.required, schema: slimSchema(x.schema ?? {}) }))
          .sort((a, b) => `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`));
      }
      const body = op.requestBody && (op.requestBody.$ref ? resolve(spec, op.requestBody.$ref) : op.requestBody);
      if (body?.content) {
        slimOp.requestBody = {
          required: !!body.required,
          content: Object.fromEntries(Object.entries(body.content).map(([ct, c]) => [ct, { schema: slimSchema(c.schema ?? {}) }])),
        };
      }
      const okKey = Object.keys(op.responses ?? {}).find((c) => /^2\d\d$/.test(c));
      const ok = okKey && (op.responses[okKey].$ref ? resolve(spec, op.responses[okKey].$ref) : op.responses[okKey]);
      const json = ok?.content?.['application/json'];
      slimOp.responses = { [okKey ?? '200']: { description: '', ...(json ? { content: { 'application/json': { schema: slimSchema(json.schema ?? {}) } } } : {}) } };
      if (json?.examples) examples[op.operationId] = Object.fromEntries(Object.entries(json.examples).map(([n, e]) => [n, e.value]));
      else if (json?.example !== undefined) examples[op.operationId] = { example: json.example };
      (paths[p] ??= {})[method] = slimOp;
    }
  }
  // 닿는 스키마를 끝까지 따라간다(스키마끼리 서로 $ref).
  const schemas = {};
  const queue = [...refsIn(paths)];
  while (queue.length) {
    const ref = queue.shift();
    const m = /^#\/components\/schemas\/(.+)$/.exec(ref);
    if (!m || schemas[m[1]]) continue;
    const target = resolve(spec, ref);
    if (!target) throw new Error(`명세 안의 참조를 찾을 수 없습니다: ${ref}`);
    schemas[m[1]] = slimSchema(target);
    queue.push(...refsIn(schemas[m[1]]));
  }
  const missing = wanted.filter((id) => !found.has(id));
  return { paths, schemas, examples, missing };
}

async function buildToss() {
  const spec = await getJson(watch.toss.url);
  const s = slimOpenApi(spec, watch.toss.operations);
  return {
    snapshot: {
      openapi: spec.openapi,
      info: { title: 'Toss Securities Open API (MyStock 사용분)', version: spec.info?.version ?? '' },
      paths: s.paths,
      components: { schemas: s.schemas },
      'x-missing-operations': s.missing,
    },
    examples: s.examples,
  };
}

async function buildNh() {
  const merged = { paths: {}, schemas: {}, missing: new Set(watch.nh.operations), versions: {} };
  for (const [name, url] of Object.entries(watch.nh.specs)) {
    const spec = await getJson(url);
    const s = slimOpenApi(spec, watch.nh.operations);
    merged.versions[name] = spec.info?.version ?? '';
    Object.assign(merged.paths, s.paths);
    for (const [k, v] of Object.entries(s.schemas)) {
      if (merged.schemas[k] && JSON.stringify(merged.schemas[k]) !== JSON.stringify(v)) throw new Error(`NH 명세끼리 스키마 이름이 겹칩니다: ${k}`);
      merged.schemas[k] = v;
    }
    for (const p of Object.values(s.paths)) for (const op of Object.values(p)) merged.missing.delete(op.operationId);
  }
  return {
    snapshot: {
      openapi: '3.0.3',
      info: { title: 'NH Investment & Securities Open API (MyStock 사용분)', version: JSON.stringify(merged.versions) },
      paths: merged.paths,
      components: { schemas: merged.schemas },
      'x-missing-operations': [...merged.missing],
    },
  };
}

// ── 키움: 자체 형식 → API별 필드 목록 ────────────────────────────────────────────
async function buildKiwoom() {
  const { apis } = await getJson(watch.kiwoom.url);
  const byId = Object.fromEntries(Object.values(apis).map((a) => [a.meta?.['API ID'], a]));
  const fields = (list) => (list ?? []).filter((f) => !f.is_section).map((f) => [f.element, f.type, f.required, f.depth]);
  const snapshot = {};
  for (const id of watch.kiwoom.apiIds) {
    const a = byId[id];
    snapshot[id] = a
      ? { name: a.meta['API 명'], method: a.meta.Method, url: a.meta.URL, request: fields(a.request?.body), response: fields(a.response?.body) }
      : { missing: true };
  }
  return { snapshot };
}

// ── KIS: 공식 예제 카탈로그 중 쓰는 TR만(scripts/kis-verify.cjs) ───────────────────────────
// 예전엔 예제 파일 15개를 받아 요청 파라미터·파일 해시만 봤다 — 이제 응답 필드(chk_*.py COLUMN_MAPPING)까지 비교한다.
const kisVerify = require('./kis-verify.cjs');
let kisCatalogCache = null;
async function buildKis() {
  kisCatalogCache = kisVerify.fetchCatalog();
  const used = kisVerify.usedApis(kisCatalogCache);
  // 커밋 해시는 비교에서 빼려고 스냅샷에 넣지 않는다(예제가 안 바뀌어도 저장소 커밋은 늘 바뀐다).
  return { snapshot: used };
}

// ── 타입 생성 ───────────────────────────────────────────────────────────────
async function genOpenApiTypes(snapshotFile, outFile) {
  const { default: openapiTS, astToString } = await import('openapi-typescript');
  const doc = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  delete doc['x-missing-operations'];
  const ast = await openapiTS(doc, { alphabetize: true, exportType: true, silent: true });
  fs.writeFileSync(outFile, GEN_HEADER(path.basename(snapshotFile)) + astToString(ast));
}

/** 키움 필드 목록 → API별 응답 타입. depth 0 줄이 최상위, LIST/Object 줄 아래 depth+1 줄이 그 원소. 값은 전부 문자열(명세). */
function genKiwoomTypes(snapshotFile, outFile) {
  const snap = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  const tsType = (t) => (t === 'String' ? 'string' : 'unknown');
  function build(rows, i, depth, indent) {
    const lines = [];
    while (i < rows.length && rows[i][3] >= depth) {
      const [name, type, , d] = rows[i];
      if (d > depth) { i++; continue; } // 부모 없이 깊은 줄 — 명세 오류, 건너뜀
      const nested = /^(LIST|List<Map>|Object)$/.test(type);
      if (nested) {
        const sub = build(rows, i + 1, depth + 1, indent + '  ');
        const body = sub.lines.length ? `{\n${sub.lines.join('\n')}\n${indent}}` : 'Record<string, unknown>';
        lines.push(`${indent}${JSON.stringify(name)}?: ${type === 'Object' ? body : `Array<${body}>`};`);
        i = sub.i;
      } else {
        lines.push(`${indent}${JSON.stringify(name)}?: ${tsType(type)};`);
        i++;
      }
    }
    return { lines, i };
  }
  let out = GEN_HEADER(path.basename(snapshotFile));
  out += '// 키움 명세는 응답 필드를 모두 required "N", 형식 String으로 적는다 — 그래서 전부 선택(?)이고 문자열이다.\n\n';
  // 요청 본문 — 필수("Y")만 필수로. 명세의 요청 필드는 전부 최상위(depth 0)다.
  out += 'export interface KiwoomRequests {\n';
  for (const [id, a] of Object.entries(snap)) {
    if (a.missing) continue;
    const fields = a.request.filter((f) => f[3] === 0).map(([name, type, req]) => `    ${JSON.stringify(name)}${req === 'Y' ? '' : '?'}: ${tsType(type)};`);
    out += `  ${id}: ${fields.length ? `{\n${fields.join('\n')}\n  }` : 'Record<string, never>'};\n`;
  }
  out += '}\n\n';
  out += 'export interface KiwoomResponses {\n';
  for (const [id, a] of Object.entries(snap)) {
    if (a.missing) continue;
    out += `  /** ${a.name} — ${a.method} ${a.url} */\n  ${id}: {\n${build(a.response, 0, 0, '    ').lines.join('\n')}\n  };\n`;
  }
  out += '}\n';
  fs.writeFileSync(outFile, out);
}

async function genTypes() {
  await genOpenApiTypes(path.join(snapDir, 'toss.json'), GEN.toss);
  await genOpenApiTypes(path.join(snapDir, 'nh.json'), GEN.nh);
  genKiwoomTypes(path.join(snapDir, 'kiwoom.json'), GEN.kiwoom);
  fs.writeFileSync(GEN.kis, kisVerify.generateTypes());
  console.log('타입 생성:', Object.values(GEN).map((f) => path.relative(root, f)).join(', '));
}

// ── 명령 ──────────────────────────────────────────────────────────────────
const SOURCES = { toss: buildToss, nh: buildNh, kiwoom: buildKiwoom, kis: buildKis };

async function buildAll() {
  const out = {};
  const errors = [];
  for (const [name, build] of Object.entries(SOURCES)) {
    try {
      out[name] = await build();
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { out, errors };
}

async function check() {
  const { out, errors } = await buildAll();
  const report = [];
  let changed = false;
  for (const [name, built] of Object.entries(out)) {
    const file = path.join(snapDir, `${name}.json`);
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const now = sortKeys(built.snapshot);
    if (!old) { report.push(`## ${name}: 스냅샷 없음 — npm run spec:update`); changed = true; continue; }
    let lines = diff(old, now);
    // 구조와 무관한 변경(명세 버전 문자열, KIS 예제 파일 해시)은 참고로만.
    const notes = lines.filter((l) => /(^|\.)info\.version|\.sha256:/.test(l));
    lines = lines.filter((l) => !notes.includes(l));
    const missing = now['x-missing-operations'] ?? Object.entries(now).filter(([, v]) => v?.missing).map(([k]) => k);
    if (lines.length) changed = true;
    report.push(`## ${name}: ${lines.length ? `구조 변경 ${lines.length}건` : '변경 없음'}${notes.length ? ` (참고 ${notes.length}건)` : ''}`);
    if (missing.length) report.push(`  ⚠ 명세에서 못 찾은 항목: ${missing.join(', ')}`);
    for (const l of lines.slice(0, 80)) report.push(`  ${l}`);
    if (lines.length > 80) report.push(`  … 외 ${lines.length - 80}건`);
    for (const l of notes) report.push(`  (참고) ${l}${name === 'kis' ? ' — 설명·예제 코드만 바뀜, 파일을 열어 확인' : ''}`);
  }
  for (const e of errors) report.push(`## 받기 실패 — ${e}`);
  const text = report.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# 증권사 공식 명세 점검\n\n\`\`\`\n${text}\n\`\`\`\n`);
  if (changed) console.log('\n구조가 바뀌었다 → 해당 클라이언트를 확인하고 `npm run spec:update`로 스냅샷·타입을 갱신한 뒤 `npm run build`로 타입 오류를 본다.');
  process.exit(errors.length ? 2 : changed ? 1 : 0);
}

async function update() {
  const { out, errors } = await buildAll();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(2);
  }
  fs.mkdirSync(snapDir, { recursive: true });
  for (const [name, built] of Object.entries(out)) fs.writeFileSync(path.join(snapDir, `${name}.json`), stable(built.snapshot));
  fs.writeFileSync(TOSS_EXAMPLES, stable(out.toss.examples));
  if (kisCatalogCache) fs.writeFileSync(path.join(specDir, 'kis-catalog.json'), kisVerify.serializeCatalog(kisCatalogCache));
  console.log('스냅샷 갱신:', Object.keys(out).map((n) => `snapshots/${n}.json`).join(', '), '+', path.relative(root, TOSS_EXAMPLES));
  await genTypes();
}

const cmd = process.argv[2];
const run = { check, update, types: genTypes }[cmd];
if (!run) {
  console.error('사용법: node scripts/spec-watch.cjs check|update|types');
  process.exit(64);
}
run().catch((e) => {
  console.error(e);
  process.exit(2);
});
