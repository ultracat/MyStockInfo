/* eslint-disable */
// KIS API 검증 묶음(KIS API Verification Suite) — 한국투자증권은 기계가 읽을 명세가 없어서 세 가지를 맞대어 본다(2026-11-17):
//   ① 공식 예제 카탈로그  backend/spec/kis-catalog.json  — 공식 저장소 examples_llm 전체(API 334개)의 주소·TR·요청 파라미터·응답 필드
//   ② 실제 응답 기록      backend/spec/snapshots/kis-live.json — `npm run kis:record`가 실제 키로 쓰는 TR을 불러 남긴 블록별 필드(값 없음)
//   ③ 앱 코드             backend/src/brokers/kis/ — 쓰는 TR, 그리고 ①②로 만든 타입(kisSpec.gen.ts)으로 읽는 필드
//
//   npm run kis:verify             ①②③을 맞대어 PASS/WARN/FAIL로 보고(최신 공식 예제를 받아 ①과도 비교). FAIL이면 종료 코드 1
//   npm run kis:verify -- --offline   네트워크 없이(받아 오는 비교만 건너뜀) — CI 매 푸시용
//   npm run kis:catalog            ①을 최신 공식 예제로 다시 만든다
//   npm run kis:types              ①②에서 kisSpec.gen.ts를 다시 만든다(네트워크 없음)
//   npm run kis:record             ②를 실제 키로 기록(Electron, 조회 TR만, 개인 데이터 미출력) — scripts/kis-live-check.cjs --record
//
// 원칙: 계좌번호·금액·종목 같은 값은 어디에도 저장·출력하지 않는다(필드 이름과 값의 형태만).
const fs = require('node:fs');
const path = require('node:path');
const { cloneKisExamples, buildKisCatalog, indexByTr, REPO } = require('./lib/kis-catalog.cjs');

const root = path.join(__dirname, '..');
const SPEC = path.join(root, 'backend', 'spec');
const CATALOG = path.join(SPEC, 'kis-catalog.json');
const LIVE = path.join(SPEC, 'snapshots', 'kis-live.json');
const GEN = path.join(root, 'backend', 'src', 'brokers', 'kis', 'kisSpec.gen.ts');
const KIS_SRC = path.join(root, 'backend', 'src', 'brokers', 'kis');
const LIVE_MAX_AGE_DAYS = 90;

const watch = () => JSON.parse(fs.readFileSync(path.join(SPEC, 'watch.json'), 'utf8')).kis;
const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fallback);
const sortKeys = (v) =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

// ── ① 카탈로그 ─────────────────────────────────────────────────────────────
/** API 하나를 한 줄로 — 334개를 담아도 diff가 API 단위로 읽힌다. */
function serializeCatalog(cat) {
  const lines = Object.keys(cat.apis)
    .sort()
    .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(sortKeys(cat.apis[k]))}`);
  return `{\n  "source": ${JSON.stringify(cat.source)},\n  "apis": {\n${lines.join(',\n')}\n  }\n}\n`;
}

function fetchCatalog() {
  const { branch } = watch();
  const clone = cloneKisExamples(branch);
  try {
    return { source: { repo: REPO, branch, commit: clone.commit }, apis: buildKisCatalog(clone.dir) };
  } finally {
    clone.cleanup();
  }
}

function writeCatalog(cat) {
  fs.writeFileSync(CATALOG, serializeCatalog(cat));
  console.log(`카탈로그 갱신: ${path.relative(root, CATALOG)} — API ${Object.keys(cat.apis).length}개, ${cat.source.commit.slice(0, 7)}`);
}

/** 쓰는 TR만 — spec-watch의 주간 비교(snapshots/kis.json)가 이 모양을 쓴다. */
function usedApis(cat) {
  const idx = indexByTr(cat.apis);
  const out = {};
  for (const tr of watch().trIds) {
    const key = idx[tr];
    const a = cat.apis[key];
    // 구조만 — 한글 이름·제목 문구가 바뀐 건 주간 점검에서 실패로 치지 않는다(필드 이름 목록만 비교).
    out[tr] = a
      ? { example: key, url: a.url, method: a.method, trIds: a.trIds, params: a.params, requiredParams: a.requiredParams, blocks: a.blocks, fields: Object.keys(a.fields).sort() }
      : { missing: true };
  }
  return out;
}

// ── 타입 생성(①+②) ─────────────────────────────────────────────────────────
function generateTypes() {
  const cat = readJson(CATALOG, null);
  if (!cat) throw new Error('카탈로그가 없습니다 — npm run kis:catalog');
  const live = readJson(LIVE, { recordedAt: null, trs: {} });
  const idx = indexByTr(cat.apis);
  const id = (s) => (/^[A-Za-z_$][\w$]*$/.test(s) ? s : JSON.stringify(s));
  const types = [];
  const params = [];
  const liveFields = [];
  for (const tr of watch().trIds) {
    const api = cat.apis[idx[tr]];
    if (!api) continue;
    const rec = live.trs[tr] || {};
    const blocks = [...new Set([...Object.keys(rec), ...api.blocks])].sort();
    const liveKnown = new Set(Object.values(rec).filter((b) => b.seenRows).flatMap((b) => Object.keys(b.fields)));
    const blockLines = [];
    const liveBlocks = [];
    for (const block of blocks) {
      const lb = rec[block];
      let row;
      if (lb && lb.seenRows) {
        const fs_ = Object.keys(lb.fields).sort();
        row = `{\n${fs_.map((f) => `      ${id(f)}: string;`).join('\n')}\n    }`;
        liveBlocks.push(`    ${id(block)}: [${fs_.map((f) => JSON.stringify(f)).join(', ')}],`);
      } else {
        // 실측 줄이 없는 블록 — 공식 예제 목록(블록 구분 없음)에서 다른 블록이 실제로 준 필드를 뺀 나머지. 확인 전이라 전부 선택.
        const fs_ = Object.keys(api.fields).filter((f) => !liveKnown.has(f)).sort();
        row = fs_.length ? `{\n      /** 실측 전 — 공식 예제 COLUMN_MAPPING */\n${fs_.map((f) => `      ${id(f)}?: string;`).join('\n')}\n    }` : 'Record<string, string>';
      }
      const kind = lb ? lb.kind : null;
      const t = kind === 'array' ? `Array<${row}>` : kind === 'object' ? row : `${row} | Array<${row}>`;
      blockLines.push(`    ${id(block)}?: ${t};`);
    }
    const when = Object.values(rec).some((b) => b.seenRows) ? `실측 ${live.recordedAt}` : '실측 전(공식 예제만)';
    types.push(`  /** ${api.title} — ${api.method} ${api.url} (${when}) */\n  ${tr}: {\n${blockLines.join('\n')}\n  };`);
    // KIS 쿼리 이름은 대소문자를 가리지 않는다(재무비율 예제는 소문자, 앱은 대문자로 보내 실측 동작) — 대문자로 맞춘다.
    const names = [...new Set(api.params.map((p) => p.toUpperCase()))].sort();
    params.push(`  ${tr}: ${names.length ? names.map((p) => JSON.stringify(p)).join(' | ') : 'never'};`);
    if (liveBlocks.length) liveFields.push(`  ${tr}: {\n${liveBlocks.join('\n')}\n  },`);
  }
  return (
    `// ⚠ 자동 생성 파일 — 직접 고치지 말 것. \`npm run kis:types\`가 backend/spec/kis-catalog.json(공식 예제 ${cat.source.commit.slice(0, 7)})과\n` +
    `// backend/spec/snapshots/kis-live.json(실제 응답 기록 ${live.recordedAt ?? '없음'})에서 만든다(scripts/kis-verify.cjs).\n` +
    `// 값은 KIS가 전부 문자열로 준다. 실측한 블록의 필드는 필수, 실측 전 블록은 공식 예제 목록이라 선택.\n/* eslint-disable */\n\n` +
    `export interface KisResponses {\n${types.join('\n')}\n}\n\n` +
    `/** TR별 요청 파라미터 이름(공식 예제의 params, 대문자로 맞춤). */\nexport interface KisParamNames {\n${params.join('\n')}\n}\n\n` +
    `/** 실제 응답 기록의 블록별 필드 — 앱이 응답 모양이 바뀌었는지 볼 때 쓴다(kisResponseShape.ts). */\n` +
    `export const KIS_LIVE_FIELDS = {\n${liveFields.join('\n')}\n} as const;\n`
  );
}

function writeTypes() {
  fs.writeFileSync(GEN, generateTypes());
  console.log(`타입 생성: ${path.relative(root, GEN)}`);
}

// ── 검증 ────────────────────────────────────────────────────────────────────
/** 앱 코드가 부르는 KIS TR — 주석을 뺀 코드의 따옴표('…'·"…") 안 TR ID 모양 문자열(생성 파일 제외). 주석의 `TTTS3012R` 같은
 *  언급이나 오류 코드는 세지 않는다. */
function trIdsInCode() {
  const found = new Set();
  for (const f of fs.readdirSync(KIS_SRC)) {
    if (!f.endsWith('.ts') || f.endsWith('.gen.ts')) continue;
    const code = fs
      .readFileSync(path.join(KIS_SRC, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
    for (const m of code.matchAll(/['"]([A-Z]{4,6}\d{3,6}[A-Z0-9]*)['"]/g)) found.add(m[1]);
  }
  return [...found].sort();
}

async function verify({ offline }) {
  const results = [];
  const log = (status, name, detail = '') => {
    results.push(status);
    const icon = { PASS: '✔', FAIL: '✖', WARN: '!', SKIP: '-', INFO: 'i' }[status];
    console.log(`${icon} [${status}] ${name}${detail ? ` — ${detail}` : ''}`);
  };
  console.log('KIS API 검증 묶음 — 공식 예제 · 실제 응답 기록 · 앱 코드\n');
  const cat = readJson(CATALOG, null);
  const live = readJson(LIVE, { recordedAt: null, trs: {} });
  const used = watch().trIds;
  if (!cat) {
    log('FAIL', '카탈로그', '없음 — npm run kis:catalog');
    return 1;
  }

  // A. 앱이 부르는 TR이 감시 목록·카탈로그에 다 있나
  const inCode = trIdsInCode();
  const notWatched = inCode.filter((t) => !used.includes(t));
  const unused = used.filter((t) => !inCode.includes(t));
  log(notWatched.length ? 'FAIL' : 'PASS', '앱이 부르는 TR ⊂ 감시 목록(watch.json)', notWatched.length ? `빠짐: ${notWatched.join(', ')}` : `${inCode.length}개`);
  if (unused.length) log('WARN', '감시 목록에만 있는 TR', `코드에서 안 씀: ${unused.join(', ')}`);
  const idx = indexByTr(cat.apis);
  const notInCatalog = used.filter((t) => !idx[t]);
  log(notInCatalog.length ? 'FAIL' : 'PASS', '쓰는 TR이 공식 예제에 있음', notInCatalog.length ? `없음: ${notInCatalog.join(', ')} — 폐지됐는지 KIS 공지 확인` : `${used.length}개`);

  // B. 최신 공식 예제와 저장된 카탈로그(쓰는 TR만 구조 비교)
  if (offline) log('SKIP', '최신 공식 예제와 비교', '--offline');
  else {
    try {
      const fresh = fetchCatalog();
      const changed = [];
      const freshIdx = indexByTr(fresh.apis);
      for (const tr of used) {
        const a = cat.apis[idx[tr]];
        const b = fresh.apis[freshIdx[tr]];
        if (!b) { changed.push(`${tr}: 공식 예제에서 사라짐`); continue; }
        for (const k of ['url', 'params', 'fields', 'blocks', 'trIds']) {
          const ka = k === 'fields' ? Object.keys(a?.[k] ?? {}).sort() : a?.[k];
          const kb = k === 'fields' ? Object.keys(b[k]).sort() : b[k];
          if (JSON.stringify(ka) !== JSON.stringify(kb)) {
            const sa = new Set(ka ?? []), sb = new Set(kb ?? []);
            const add = [...sb].filter((x) => !sa.has(x)), del = [...sa].filter((x) => !sb.has(x));
            changed.push(`${tr} ${k}: ${typeof kb === 'string' ? `${ka} → ${kb}` : `${del.length ? `빠짐 ${del.join(',')}` : ''}${add.length ? ` 추가 ${add.join(',')}` : ''}`.trim()}`);
          }
        }
      }
      if (changed.length) {
        log('FAIL', `최신 공식 예제(${fresh.source.commit.slice(0, 7)})와 다름`, `${changed.length}건 — 확인 후 npm run kis:catalog → kis:types → build`);
        for (const c of changed.slice(0, 40)) console.log(`    ${c}`);
      } else {
        log('PASS', '최신 공식 예제와 비교', `쓰는 TR ${used.length}개 구조 같음 (${fresh.source.commit.slice(0, 7)}${fresh.source.commit === cat.source.commit ? '' : `, 저장본 ${cat.source.commit.slice(0, 7)}`})`);
      }
    } catch (e) {
      log('WARN', '최신 공식 예제 받기', e.message);
    }
  }

  // C. 실제 응답 기록 vs 공식 예제
  if (!live.recordedAt) log('WARN', '실제 응답 기록', '없음 — npm run kis:record(실제 키, 조회 TR만)');
  else {
    const age = Math.floor((Date.now() - Date.parse(live.recordedAt)) / 864e5);
    log(age > LIVE_MAX_AGE_DAYS ? 'WARN' : 'PASS', '실제 응답 기록 시점', `${live.recordedAt}(${age}일 전)${age > LIVE_MAX_AGE_DAYS ? ' — 다시 기록 권장' : ''}`);
    for (const tr of used) {
      const rec = live.trs[tr];
      const api = cat.apis[idx[tr]];
      if (!rec) { log('WARN', `${tr} 기록`, '없음 — kis:record에서 이 TR 호출이 실패했거나(점검 출력의 FAIL 확인) 부르지 않았다'); continue; }
      const seen = Object.entries(rec).filter(([, b]) => b.seenRows);
      const empty = Object.keys(rec).filter((b) => !rec[b].seenRows);
      if (!seen.length) { log('SKIP', `${tr} 필드 대조`, `줄 없음(${Object.keys(rec).join(',') || '블록 없음'}) — 자료가 생기면 다시 기록. 타입은 공식 예제 목록으로 대신`); continue; }
      const liveSet = new Set(seen.flatMap(([, b]) => Object.keys(b.fields)));
      const official = new Set(Object.keys(api?.fields ?? {}));
      const onlyLive = [...liveSet].filter((f) => !official.has(f));
      const onlyOfficial = [...official].filter((f) => !liveSet.has(f));
      const parts = [`실측 블록 ${seen.map(([b]) => b).join(',')}`];
      if (empty.length) parts.push(`줄 없는 블록 ${empty.join(',')}`);
      if (onlyLive.length) parts.push(`예제에 없는 필드 ${onlyLive.length}(${onlyLive.slice(0, 6).join(',')}${onlyLive.length > 6 ? '…' : ''})`);
      if (onlyOfficial.length && !empty.length) parts.push(`응답에 없던 예제 필드 ${onlyOfficial.length}(${onlyOfficial.slice(0, 6).join(',')}${onlyOfficial.length > 6 ? '…' : ''})`);
      log(onlyOfficial.length && !empty.length ? 'INFO' : 'PASS', `${tr} 실측↔예제`, parts.join(' · '));
    }
  }

  // D. 생성 타입이 ①②와 맞나
  const expected = generateTypes();
  const current = fs.existsSync(GEN) ? fs.readFileSync(GEN, 'utf8') : '';
  log(expected === current ? 'PASS' : 'FAIL', '생성 타입(kisSpec.gen.ts) 최신', expected === current ? '' : 'npm run kis:types 후 npm run build');
  log('INFO', '앱이 읽는 필드', '`npm run build`(타입 검사)가 kisSpec.gen.ts 기준으로 확인한다');

  const fails = results.filter((s) => s === 'FAIL').length;
  console.log(`\n요약: PASS ${results.filter((s) => s === 'PASS').length} · WARN ${results.filter((s) => s === 'WARN').length} · FAIL ${fails} · SKIP ${results.filter((s) => s === 'SKIP').length}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `# KIS API 검증 묶음\n\nFAIL ${fails}건 — 로그 참고\n`);
  return fails ? 1 : 0;
}

// ── 카탈로그 차이(자동 업데이트 PR 본문, scripts/spec-watch.cjs auto) ─────────────────────────────
const stableKeys = (v) =>
  Array.isArray(v) ? v.map(stableKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stableKeys(v[k])])) : v;
const same = (a, b) => JSON.stringify(stableKeys(a)) === JSON.stringify(stableKeys(b));
const setDiff = (a = [], b = []) => ({ added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) });

/** 저장본 → 최신 카탈로그 차이(순수 함수 — 테스트가 부른다). */
function diffCatalogs(oldApis, newApis, usedTrIds) {
  const oldIdx = indexByTr(oldApis);
  const newIdx = indexByTr(newApis);
  const used = [];
  for (const tr of usedTrIds) {
    const a = oldApis[oldIdx[tr]];
    const b = newApis[newIdx[tr]];
    if (!b) { used.push({ tr, lines: ['공식 예제에서 **사라짐** — 폐지 여부를 KIS 공지에서 확인'] }); continue; }
    if (!a) { used.push({ tr, lines: ['저장본에 없던 TR(새로 감시)'] }); continue; }
    const lines = [];
    if (a.url !== b.url) lines.push(`주소: \`${a.url}\` → \`${b.url}\``);
    if (a.method !== b.method) lines.push(`메서드: ${a.method} → ${b.method}`);
    const describe = (label, d) => {
      const parts = [];
      if (d.removed.length) parts.push(`빠짐 \`${d.removed.join('`, `')}\``);
      if (d.added.length) parts.push(`추가 \`${d.added.join('`, `')}\``);
      if (parts.length) lines.push(`${label}: ${parts.join(' · ')}`);
    };
    for (const k of ['trIds', 'params', 'requiredParams', 'blocks']) describe(k, setDiff(a[k], b[k]));
    describe('응답 필드', setDiff(Object.keys(a.fields), Object.keys(b.fields)));
    if (lines.length) used.push({ tr, lines });
  }
  const keys = new Set([...Object.keys(oldApis), ...Object.keys(newApis)]);
  const other = { added: [], removed: [], changed: [] };
  const usedKeys = new Set(usedTrIds.flatMap((t) => [oldIdx[t], newIdx[t]]).filter(Boolean));
  for (const k of keys) {
    if (usedKeys.has(k)) continue;
    if (!oldApis[k]) other.added.push(k);
    else if (!newApis[k]) other.removed.push(k);
    else if (!same(oldApis[k], newApis[k])) other.changed.push(k);
  }
  return { used, other };
}

function catalogReport(d, oldCat, newCat) {
  const out = [];
  out.push(`공식 예제 \`${oldCat.source.commit.slice(0, 7)}\` → \`${newCat.source.commit.slice(0, 7)}\` ([비교](https://github.com/${newCat.source.repo}/compare/${oldCat.source.commit}...${newCat.source.commit}))`);
  out.push('');
  out.push('### 앱이 쓰는 TR');
  if (!d.used.length) out.push('바뀐 것 없음 — 카탈로그(참고용 목록)만 갱신합니다.');
  for (const u of d.used) {
    out.push(`- **${u.tr}**`);
    for (const l of u.lines) out.push(`  - ${l}`);
  }
  out.push('');
  out.push('### 그 밖의 KIS API(앱이 안 씀)');
  out.push(`추가 ${d.other.added.length} · 삭제 ${d.other.removed.length} · 변경 ${d.other.changed.length}`);
  const list = (name, xs) => xs.length && out.push(`- ${name}: ${xs.slice(0, 30).map((x) => `\`${x}\``).join(', ')}${xs.length > 30 ? ` 외 ${xs.length - 30}` : ''}`);
  list('추가', d.other.added);
  list('삭제', d.other.removed);
  list('변경', d.other.changed);
  return out.join('\n');
}


module.exports = { fetchCatalog, usedApis, generateTypes, serializeCatalog, trIdsInCode, diffCatalogs, catalogReport };

if (require.main === module) {
  const [cmd = 'verify', ...rest] = process.argv.slice(2);
  const run = {
    verify: () => verify({ offline: rest.includes('--offline') }),
    catalog: () => writeCatalog(fetchCatalog()),
    types: () => writeTypes(),
  }[cmd];
  if (!run) {
    console.error('사용법: node scripts/kis-verify.cjs [verify [--offline] | catalog | types]');
    process.exit(64);
  }
  Promise.resolve(run())
    .then((code) => process.exit(typeof code === 'number' ? code : 0))
    .catch((e) => {
      console.error(e);
      process.exit(2);
    });
}
