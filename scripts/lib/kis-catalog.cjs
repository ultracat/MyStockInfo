/* eslint-disable */
// KIS API 카탈로그 — 한국투자증권 공식 저장소(koreainvestment/open-trading-api)의 예제 폴더(examples_llm/<분류>/<기능>/)를 전부 읽어
// API마다 이름·주소·TR ID·요청 파라미터·응답 필드(+한글명)를 뽑는다. KIS는 기계가 읽을 명세(OpenAPI 등)를 공개하지 않고,
// 같은 저장소의 MCP용 data.csv는 갱신이 몇 달씩 밀린다(2026-11-17 확인: 07-09 이후 그대로, 예제는 11-16에 응답 필드 수정).
// KIS가 실제로 고치는 곳이 예제 파일이라 그걸 정본으로 삼는다. 설명문·코드는 담지 않고 이름·구조만 담는다.
//
// 예제 파일에서 읽는 것:
//   <기능>.py      `# [국내주식] 주문/계좌 > 주식잔고조회[v1_국내주식-006]` 머리 주석, `API_URL = "..."`, `tr_id = "..."`(실전·모의),
//                  `params = { "CANO": ..., }`(요청 파라미터), docstring의 `name (str): [필수]`(필수 여부), `.output1` 같은 블록 이름
//   chk_<기능>.py  `COLUMN_MAPPING = { 'pdno': '상품번호', ... }`(응답 필드 — output1/output2가 한 목록으로 섞여 있다)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = 'koreainvestment/open-trading-api';

/** 저장소를 얕게 받아(examples_llm만) 폴더 경로와 커밋을 돌려준다. git이 필요하다(CI·개발 PC 모두 있음). */
function cloneKisExamples(branch = 'main') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kis-examples-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', branch, '--filter=blob:none', '--sparse', `https://github.com/${REPO}`, dir], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  git('sparse-checkout', 'set', 'examples_llm');
  return { dir, commit: git('rev-parse', 'HEAD'), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const uniqSorted = (xs) => [...new Set(xs)].sort();

/** 예제 파일 한 쌍에서 구조를 뽑는다(순수 함수 — 테스트가 직접 부른다). */
function parseKisExample(src, chkSrc = '') {
  const title = /#\s*(\[[^\]\n]+\][^\n]*)/.exec(src)?.[1]?.trim() ?? null;
  const url = /^API_URL\s*=\s*["']([^"']+)["']/m.exec(src)?.[1] ?? null;
  const trIds = uniqSorted([...src.matchAll(/tr_id\s*=\s*["']([A-Z0-9]+)["']/g)].map((m) => m[1]));
  // params 블록이 여럿(실전/모의·연속조회 분기)일 수 있다 — 전부 합친다.
  const params = uniqSorted(
    [...src.matchAll(/params\s*=\s*\{([\s\S]*?)\n\s*\}/g)].flatMap((m) => [...m[1].matchAll(/["']([A-Za-z0-9_]+)["']\s*:/g)].map((x) => x[1]))
  );
  const requiredArgs = new Set([...src.matchAll(/^\s*(\w+)\s*\([^)]*\):\s*\[필수\]/gm)].map((m) => m[1].toLowerCase()));
  const requiredParams = params.filter((p) => requiredArgs.has(p.toLowerCase()));
  const blocks = uniqSorted([...src.matchAll(/\.(output\d?)\b|\[["'](output\d?)["']\]/g)].map((m) => m[1] ?? m[2]));
  const method = /postFlag\s*=\s*True|_url_fetch\([^)]*,\s*True\s*\)/.test(src) ? 'POST' : 'GET';
  const fields = {};
  const cm = /COLUMN_MAPPING\s*=\s*\{([\s\S]*?)\n\}/.exec(chkSrc);
  if (cm) for (const m of cm[1].matchAll(/["']([A-Za-z0-9_]+)["']\s*:\s*["']([^"'\n]*)["']/g)) fields[m[1]] = m[2];
  return { title, url, method, trIds, params, requiredParams, blocks, fields };
}

/** examples_llm 전체 → { "<분류>/<기능>": 구조 } (키 정렬). 실시간(WebSocket) 예제는 REST 주소가 없어 `url: null`. */
function buildKisCatalog(examplesDir) {
  const root = path.join(examplesDir, 'examples_llm');
  const apis = {};
  for (const category of fs.readdirSync(root).sort()) {
    const catDir = path.join(root, category);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const fn of fs.readdirSync(catDir).sort()) {
      const main = path.join(catDir, fn, `${fn}.py`);
      if (!fs.existsSync(main)) continue;
      const chk = path.join(catDir, fn, `chk_${fn}.py`);
      apis[`${category}/${fn}`] = parseKisExample(fs.readFileSync(main, 'utf8'), fs.existsSync(chk) ? fs.readFileSync(chk, 'utf8') : '');
    }
  }
  return apis;
}

/** TR ID → 카탈로그 키(여러 예제에 같은 TR이 있으면 첫 것). */
function indexByTr(apis) {
  const out = {};
  for (const [key, a] of Object.entries(apis)) for (const tr of a.trIds) out[tr] ??= key;
  return out;
}

module.exports = { REPO, cloneKisExamples, parseKisExample, buildKisCatalog, indexByTr };
