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
  kb: path.join(root, 'backend/src/brokers/kb/kbSpec.gen.ts'),
  ls: path.join(root, 'backend/src/brokers/ls/lsSpec.gen.ts'),
  db: path.join(root, 'backend/src/brokers/db/dbSpec.gen.ts'),
  live: path.join(root, 'backend/src/brokers/liveFields.gen.ts'),
};
const BROKERS_WITH_LIVE = ['kis', 'toss', 'nh', 'kiwoom', 'kb', 'ls', 'db'];
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

// ── KB: 공개 명세에서 계좌 TR이 빠졌다 → 마지막 공개본을 고정 기준으로 ────────────────────────
// kbsecurities/kb-openapi의 samples.generated.json은 2026-09-14 커밋("불필요 sample 삭제")으로 97 → 31종이 되며 계좌 TR
// (SSQM2952 보유·SWQA2301 거래내역)이 빠졌다(남은 건 "투자정보"뿐). 그래서 **고정 기준 커밋(watch.json kb.pinnedCommit, 그 직전
// 공개본)**에서 구조를 읽고, 지금 공개본에 그 TR이 있으면 그쪽을 쓴다. 지금 공개본에 다시 나타나거나 바뀌면 주간 점검이 알린다.
// 명세는 한 줄 목록이다 — `grid_cnt1` 뒤의 필드가 반복 줄(dataBody.Record1)이고 앞은 dataBody 요약이다(SSQM2952에 같은 이름
// fncng_amt·val_pl·val_yld가 양쪽에 있어 확인). 계좌 TR은 연동 계좌가 0건이라 실측 검증이 안 됐다 — kb-live.json(`check:kb --record`).
async function buildKb() {
  const { repo, file, pinnedCommit, trIds } = watch.kb;
  const raw = (ref) => getJson(`https://raw.githubusercontent.com/${repo}/${ref}/${file}`);
  const flat = (j) => Object.values(j).flat().filter((v) => v && v.transactionCode);
  const [head, pinned] = [flat(await raw('HEAD')), flat(await raw(pinnedCommit))];
  const snapshot = {};
  for (const tr of trIds) {
    const now = head.find((v) => v.transactionCode === tr);
    const src = now ?? pinned.find((v) => v.transactionCode === tr);
    if (!src) { snapshot[tr] = { missing: true }; continue; }
    const names = src.outputSpec.map((o) => o.name);
    const grid = names.indexOf('grid_cnt1');
    snapshot[tr] = {
      source: now ? 'HEAD' : 'pinned',
      endpoint: src.endpoint,
      method: src.method,
      request: src.inputSpec.map((i) => [i.name, i.required === 'Y']),
      body: (grid >= 0 ? names.slice(0, grid + 1) : names).filter((n) => !/^o_(lngth|clsf|msg)$/.test(n)),
      record1: grid >= 0 ? names.slice(grid + 1) : [],
    };
  }
  return { snapshot };
}

// ── LS·DB: TR 블록 명세 → { TR: { path, tps, request: {블록: [[필드, 형식, 필수]]}, response: {블록: {kind, fields}} } } ──────────
// 두 회사는 같은 계열 시스템이라(TR 코드 CDPCQ04700 등이 겹침) 스냅샷 모양과 타입 생성기를 같이 쓴다(genBlockTypes).
// 블록 kind: 'array'(명세가 배열이라고 함) · 'object' · 'either'(명세는 객체인데 공식 예시가 배열인 블록이 있어 둘 다 받는다).
async function buildLs() {
  const spec = await getJson(watch.ls.url);
  const all = spec.apis.flatMap((a) => a.transactions.map((t) => ({ ...t, path: a.path })));
  const fieldType = (t) => (/^Number$/i.test(t) ? 'number' : 'string');
  const snapshot = {};
  for (const tr of watch.ls.trIds) {
    const t = all.find((x) => x.code === tr);
    if (!t) { snapshot[tr] = { missing: true }; continue; }
    const blocks = (list) =>
      Object.fromEntries((list ?? []).map((b) => [b.element, { kind: /array/i.test(b.type) ? 'array' : 'either', fields: (b.fields ?? []).map((f) => [f.element, fieldType(f.type)]) }]));
    snapshot[tr] = {
      path: t.path,
      tps: t.transactionPerSec ?? null,
      request: Object.fromEntries(Object.entries(blocks(t.request?.body)).map(([k, v]) => [k, v.fields.map(([n, ty]) => [n, ty, true])])),
      response: blocks(t.response?.body),
    };
  }
  return { snapshot: { version: spec.version, trs: snapshot } };
}

async function buildDb() {
  const TYPE = { A0001: 'string', A0004: 'number', A0003: 'object', A0005: 'array', A0002: 'array' };
  const snapshot = {};
  for (const [tr, meta] of Object.entries(watch.db.trs)) {
    const props = await getJson(watch.db.propertyUrl.replace('{trId}', meta.trId));
    if (!Array.isArray(props) || !props.length) { snapshot[tr] = { missing: true }; continue; }
    const side = (bodyType) => {
      const rows = props.filter((p) => p.bodyType === bodyType).sort((a, b) => String(a.propertyOrder).localeCompare(String(b.propertyOrder)));
      const blocks = {};
      let current = null;
      for (const p of rows) {
        const name = String(p.propertyCd).replace(/&nbsp;/g, '').replace(/^[\s-]+/, '');
        if (!String(p.propertyOrder).includes('.')) {
          current = name;
          blocks[name] = { kind: TYPE[p.propertyType] === 'array' ? 'array' : TYPE[p.propertyType] === 'object' ? 'either' : 'scalar', fields: [] };
        } else if (current) {
          blocks[current].fields.push([name, TYPE[p.propertyType] === 'number' ? 'number' : 'string', p.requireYn === 'Y']);
        }
      }
      return blocks;
    };
    const req = side('req_b');
    snapshot[tr] = {
      path: meta.path,
      tps: meta.tps,
      request: Object.fromEntries(Object.entries(req).map(([k, v]) => [k, v.fields])),
      response: Object.fromEntries(Object.entries(side('res_b')).map(([k, v]) => [k, { kind: v.kind, fields: v.fields.map(([n, ty]) => [n, ty]) }])),
    };
  }
  return { snapshot: { trs: snapshot } };
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

/** KB — dataBody 요약 + Record1 줄. 명세 형식이 전부 char라 문자열, 필수 표시가 없어 전부 선택. 실측 기록이 있으면 그 블록 필드는 필수. */
function genKbTypes(snapshotFile, outFile) {
  const snap = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  const liveFile = path.join(snapDir, 'kb-live.json');
  const live = fs.existsSync(liveFile) ? JSON.parse(fs.readFileSync(liveFile, 'utf8')) : { trs: {} };
  const fieldsOf = (tr, block, specNames) => {
    const b = live.trs[tr]?.[block];
    // 실측 블록 — 중첩(객체·배열) 필드는 따로 블록이 되므로 글자 필드에서 뺀다(dataBody의 Record1 등).
    if (b?.seenRows) return Object.keys(b.fields).filter((f) => !['object', 'array'].includes(b.fields[f])).sort().map((f) => `${JSON.stringify(f)}: string;`);
    return [...new Set(specNames)].map((f) => `${JSON.stringify(f)}?: string;`);
  };
  let out = GEN_HEADER(path.basename(snapshotFile));
  out += `// 기준: ${watch.kb.repo} 공개 명세(계좌 TR은 고정 커밋 ${watch.kb.pinnedCommit.slice(0, 7)}) + 실제 응답 기록(kb-live.json, 있으면).\n\n`;
  out += 'export interface KbRequests {\n';
  for (const [tr, a] of Object.entries(snap)) {
    if (a.missing) continue;
    out += `  ${tr}: {\n${a.request.map(([n, req]) => `    ${JSON.stringify(n)}${req ? '' : '?'}: string;`).join('\n')}\n  };\n`;
  }
  out += '}\n\nexport interface KbResponses {\n';
  for (const [tr, a] of Object.entries(snap)) {
    if (a.missing) continue;
    const body = fieldsOf(tr, 'dataBody', a.body).map((l) => `    ${l}`);
    if (a.record1.length) body.push(`    Record1?: Array<{\n${fieldsOf(tr, 'dataBody.Record1', a.record1).map((l) => `      ${l}`).join('\n')}\n    }>;`);
    out += `  /** ${a.method} ${a.endpoint} (${a.source === 'HEAD' ? '현재 공개 명세' : `고정 기준 ${watch.kb.pinnedCommit.slice(0, 7)} — 현재 공개본엔 없음`}) */\n  ${tr}: {\n${body.join('\n')}\n  };\n`;
  }
  out += '}\n';
  fs.writeFileSync(outFile, out);
}

/** 실제 응답 기록(snapshots/<증권사>-live.json) → 앱이 응답 모양 변화를 볼 때 쓰는 블록별 필드(responseShape.ts). */
function genLiveFields(outFile) {
  const all = {};
  for (const b of BROKERS_WITH_LIVE) {
    const f = path.join(snapDir, `${b}-live.json`);
    if (!fs.existsSync(f)) continue;
    const live = JSON.parse(fs.readFileSync(f, 'utf8'));
    const per = {};
    for (const [key, blocks] of Object.entries(live.trs)) {
      const seen = Object.entries(blocks).filter(([, s]) => s.seenRows);
      if (seen.length) per[key] = Object.fromEntries(seen.map(([blk, s]) => [blk, Object.keys(s.fields).sort()]));
    }
    all[b] = { recordedAt: live.recordedAt, fields: per };
  }
  const body = JSON.stringify(sortKeys(all), null, 2);
  fs.writeFileSync(
    outFile,
    `// ⚠ 자동 생성 파일 — 직접 고치지 말 것. \`npm run spec:types\`가 backend/spec/snapshots/<증권사>-live.json(실제 응답 기록)에서 만든다.\n` +
      `// 블록별 필드 이름만(값 없음). 앱이 응답을 받을 때 여기 있던 필드가 빠지면 로그에 한 번 경고한다(brokers/responseShape.ts).\n/* eslint-disable */\n\n` +
      `export const LIVE_FIELDS: Record<string, { recordedAt: string; fields: Record<string, Record<string, readonly string[]>> }> = ${body};\n`
  );
}

/** LS·DB 블록 스냅샷 → `<이름>Requests`(요청 블록)·`<이름>Responses`(응답 블록) 타입. 숫자 필드는 JSON 숫자로도 소수 문자열로도
 *  온다(두 회사 공식 예시 모두) — `number | string`. 블록·필드가 없을 수 있어 전부 선택. */
function genBlockTypes(snapshotFile, outFile, name, source) {
  const snap = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  const ts = (t) => (t === 'number' ? 'number | string' : 'string');
  const row = (fields, indent, required) => `{\n${fields.map(([n, t, req]) => `${indent}  ${JSON.stringify(n)}${required && req ? '' : '?'}: ${ts(t)};`).join('\n')}\n${indent}}`;
  let out = GEN_HEADER(path.basename(snapshotFile)) + `// 기준: ${source}\n\n`;
  out += `export interface ${name}Requests {\n`;
  for (const [tr, a] of Object.entries(snap.trs)) {
    if (a.missing) continue;
    const blocks = Object.entries(a.request).map(([b, f]) => `    ${JSON.stringify(b)}: ${f.length ? row(f, '    ', true) : 'Record<string, never>'};`);
    out += `  ${tr}: {\n${blocks.join('\n')}\n  };\n`;
  }
  out += `}\n\nexport interface ${name}Responses {\n`;
  for (const [tr, a] of Object.entries(snap.trs)) {
    if (a.missing) continue;
    const blocks = Object.entries(a.response).map(([b, blk]) => {
      if (blk.kind === 'scalar' || !blk.fields.length) return `    ${JSON.stringify(b)}?: unknown;`;
      const r = row(blk.fields, '    ', false);
      return `    ${JSON.stringify(b)}?: ${blk.kind === 'array' ? `Array<${r}>` : `${r} | Array<${r}>`};`;
    });
    out += `  /** POST ${a.path}${a.tps ? ` (초당 ${a.tps}건)` : ''} */\n  ${tr}: {\n    rsp_cd?: string;\n    rsp_msg?: string;\n${blocks.join('\n')}\n  };\n`;
  }
  out += '}\n';
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out);
}

async function genTypes() {
  await genOpenApiTypes(path.join(snapDir, 'toss.json'), GEN.toss);
  await genOpenApiTypes(path.join(snapDir, 'nh.json'), GEN.nh);
  genKiwoomTypes(path.join(snapDir, 'kiwoom.json'), GEN.kiwoom);
  fs.writeFileSync(GEN.kis, kisVerify.generateTypes());
  genKbTypes(path.join(snapDir, 'kb.json'), GEN.kb);
  genBlockTypes(path.join(snapDir, 'ls.json'), GEN.ls, 'Ls', `LS증권 공식 명세 JSON(${watch.ls.url})`);
  genBlockTypes(path.join(snapDir, 'db.json'), GEN.db, 'Db', 'DB증권 포털 TR 필드 명세(openapi.dbsec.co.kr guide/tr/property)');
  genLiveFields(GEN.live);
  console.log('타입 생성:', Object.values(GEN).map((f) => path.relative(root, f)).join(', '));
}

// ── 명령 ──────────────────────────────────────────────────────────────────
const SOURCES = { toss: buildToss, nh: buildNh, kiwoom: buildKiwoom, kis: buildKis, kb: buildKb, ls: buildLs, db: buildDb };

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

/** 최신 공식 명세와 저장된 스냅샷을 비교한다. 바꾸지 않는다. */
async function compare() {
  const { out, errors } = await buildAll();
  const report = [];
  const changedBrokers = [];
  for (const [name, built] of Object.entries(out)) {
    const file = path.join(snapDir, `${name}.json`);
    const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    const now = sortKeys(built.snapshot);
    if (!old) { report.push(`## ${name}: 스냅샷 없음 — npm run spec:update`); changedBrokers.push(name); continue; }
    let lines = diff(old, now);
    // 구조와 무관한 변경(명세 버전 문자열)은 참고로만.
    const notes = lines.filter((l) => /(^|\.)info\.version/.test(l));
    lines = lines.filter((l) => !notes.includes(l));
    const missing = now['x-missing-operations'] ?? Object.entries(now).filter(([, v]) => v?.missing).map(([k]) => k);
    if (lines.length) changedBrokers.push(name);
    report.push(`## ${name}: ${lines.length ? `구조 변경 ${lines.length}건` : '변경 없음'}${notes.length ? ` (참고 ${notes.length}건)` : ''}`);
    if (missing.length) report.push(`  ⚠ 명세에서 못 찾은 항목: ${missing.join(', ')}`);
    for (const l of lines.slice(0, 80)) report.push(`  ${l}`);
    if (lines.length > 80) report.push(`  … 외 ${lines.length - 80}건`);
    for (const l of notes) report.push(`  (참고) ${l}`);
  }
  // KIS 카탈로그(앱이 안 쓰는 API 포함 334개) — 쓰는 TR이 그대로여도 목록이 바뀌었으면 갱신 대상.
  let kisCatalogDiff = null;
  if (kisCatalogCache) {
    const saved = JSON.parse(fs.readFileSync(path.join(specDir, 'kis-catalog.json'), 'utf8'));
    if (JSON.stringify(sortKeys(saved.apis)) !== JSON.stringify(sortKeys(kisCatalogCache.apis))) {
      kisCatalogDiff = { saved, fresh: kisCatalogCache, diff: kisVerify.diffCatalogs(saved.apis, kisCatalogCache.apis, watch.kis.trIds) };
      report.push(`## kis 카탈로그: 공식 예제 변경(쓰는 TR 외 포함) — 추가 ${kisCatalogDiff.diff.other.added.length} · 삭제 ${kisCatalogDiff.diff.other.removed.length} · 변경 ${kisCatalogDiff.diff.other.changed.length}`);
    }
  }
  for (const e of errors) report.push(`## 받기 실패 — ${e}`);
  return { out, errors, report: report.join('\n'), changedBrokers, kisCatalogDiff, changed: changedBrokers.length > 0 || !!kisCatalogDiff };
}

async function check() {
  const r = await compare();
  console.log(r.report);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# 증권사 공식 명세 점검\n\n\`\`\`\n${r.report}\n\`\`\`\n`);
  if (r.changed) console.log('\n구조가 바뀌었다 → 해당 클라이언트를 확인하고 `npm run spec:update`로 스냅샷·타입을 갱신한 뒤 `npm run build`로 타입 오류를 본다.');
  process.exit(r.errors.length ? 2 : r.changed ? 1 : 0);
}

/** 스냅샷·KIS 카탈로그·토스 예시를 쓰고 타입을 다시 만든다. */
async function writeAll(out) {
  fs.mkdirSync(snapDir, { recursive: true });
  for (const [name, built] of Object.entries(out)) fs.writeFileSync(path.join(snapDir, `${name}.json`), stable(built.snapshot));
  fs.writeFileSync(TOSS_EXAMPLES, stable(out.toss.examples));
  if (kisCatalogCache) fs.writeFileSync(path.join(specDir, 'kis-catalog.json'), kisVerify.serializeCatalog(kisCatalogCache));
  console.log('스냅샷 갱신:', Object.keys(out).map((n) => `snapshots/${n}.json`).join(', '), '+', path.relative(root, TOSS_EXAMPLES));
  await genTypes();
}

/**
 * 자동 업데이트(.github/workflows/spec-watch.yml) — 바뀐 게 있으면 스냅샷·타입을 갱신하고 PR 본문용 보고서(Markdown)를 쓴다.
 * 앱 코드는 고치지 않는다: 앱이 쓰는 필드가 사라졌으면 그 PR의 빌드(타입 검사)가 실패하고, 그게 고칠 곳이다.
 * 실행 중 앱이 필드를 추측해 바꿔 읽는 방식은 금액을 조용히 틀리게 할 수 있어 하지 않는다(2026-11-17 결정).
 * GITHUB_OUTPUT에 changed·kis_used_changed를 적는다. 받기 실패면 종료 코드 2(워크플로 실패 → 메일).
 */
async function auto() {
  const reportFile = process.argv[3];
  const r = await compare();
  const setOutput = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  console.log(r.report);
  if (r.errors.length) process.exit(2);
  if (!r.changed) {
    setOutput('changed', 'false');
    return;
  }
  await writeAll(r.out);
  const md = [`바뀐 증권사: ${[...r.changedBrokers, ...(r.kisCatalogDiff && !r.changedBrokers.includes('kis') ? ['kis(카탈로그만)'] : [])].join(', ')}`, ''];
  md.push('<details><summary>구조 비교(스냅샷)</summary>', '', '```', r.report, '```', '</details>', '');
  if (r.kisCatalogDiff) {
    const { saved, fresh, diff: d } = r.kisCatalogDiff;
    md.push('### 한국투자증권 공식 예제', kisVerify.catalogReport(d, saved, fresh), '');
  }
  if (reportFile) fs.writeFileSync(reportFile, md.join('\n') + '\n');
  setOutput('changed', 'true');
  setOutput('kis_used_changed', r.kisCatalogDiff?.diff.used.length || r.changedBrokers.includes('kis') ? 'true' : 'false');
}

async function update() {
  const { out, errors } = await buildAll();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(2);
  }
  await writeAll(out);
}

module.exports = { genLiveFields };
if (require.main === module) {
  const cmd = process.argv[2];
  const run = { check, update, auto, types: genTypes }[cmd];
  if (!run) {
    console.error('사용법: node scripts/spec-watch.cjs check|update|auto <보고서.md>|types');
    process.exit(64);
  }
  run().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
