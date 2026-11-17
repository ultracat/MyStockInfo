/* eslint-disable */
// KIS 자동 업데이트 — 공식 예제(examples_llm)가 바뀌면 카탈로그(backend/spec/kis-catalog.json)·주간 비교 스냅샷(snapshots/kis.json)·
// 생성 타입(kisSpec.gen.ts)을 다시 만들고, 무엇이 바뀌었는지 보고서(Markdown)를 쓴다. .github/workflows/kis-auto-update.yml이
// 이 결과로 빌드·테스트·검증을 돌려 업데이트 PR(안 되면 이슈)을 연다. **앱 코드는 고치지 않는다** — 쓰는 TR의 필드가 사라졌으면
// 빌드(타입 검사)가 실패하는 것으로 고칠 곳이 드러나고, 사람이 고쳐서 같은 PR에 올린다. 실행 중 앱이 필드를 추측해 바꿔 읽는
// 방식은 잔고·배당 금액을 조용히 틀리게 할 수 있어 하지 않는다(2026-11-17 결정).
//
//   node scripts/kis-auto-update.cjs <보고서.md>   바뀐 게 없으면 파일을 안 바꾸고 changed=false
//   GITHUB_OUTPUT이 있으면 changed / used_changed(쓰는 TR 구조가 바뀌었나)를 적는다.
// 실제 응답 기록(kis-live.json)은 실제 키가 있어야 해서 여기서 갱신하지 않는다 — 보고서가 `npm run kis:record`를 안내한다.
const fs = require('node:fs');
const path = require('node:path');
const kisVerify = require('./kis-verify.cjs');
const { indexByTr } = require('./lib/kis-catalog.cjs');

const root = path.join(__dirname, '..');
const SPEC = path.join(root, 'backend', 'spec');
const CATALOG = path.join(SPEC, 'kis-catalog.json');
const SNAPSHOT = path.join(SPEC, 'snapshots', 'kis.json');
const GEN = path.join(root, 'backend', 'src', 'brokers', 'kis', 'kisSpec.gen.ts');

const stable = (v) =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
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

function report(d, oldCat, newCat) {
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

function main() {
  const reportFile = process.argv[2];
  const oldCat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const newCat = kisVerify.fetchCatalog();
  const setOutput = (k, v) => process.env.GITHUB_OUTPUT && fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  if (same(oldCat.apis, newCat.apis)) {
    // 저장소 커밋만 바뀌고 예제 구조가 같으면 아무것도 안 한다(매주 의미 없는 PR을 만들지 않게).
    console.log(`변경 없음 — 공식 예제 ${newCat.source.commit.slice(0, 7)}, API ${Object.keys(newCat.apis).length}개`);
    setOutput('changed', 'false');
    return;
  }
  const usedTrIds = JSON.parse(fs.readFileSync(path.join(SPEC, 'watch.json'), 'utf8')).kis.trIds;
  const d = diffCatalogs(oldCat.apis, newCat.apis, usedTrIds);
  fs.writeFileSync(CATALOG, kisVerify.serializeCatalog(newCat));
  fs.writeFileSync(SNAPSHOT, JSON.stringify(stable(kisVerify.usedApis(newCat)), null, 2) + '\n');
  fs.writeFileSync(GEN, kisVerify.generateTypes());
  const md = report(d, oldCat, newCat);
  if (reportFile) fs.writeFileSync(reportFile, md + '\n');
  console.log(md);
  setOutput('changed', 'true');
  setOutput('used_changed', d.used.length ? 'true' : 'false');
}

module.exports = { diffCatalogs };
if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e);
    process.exit(2);
  }
}
