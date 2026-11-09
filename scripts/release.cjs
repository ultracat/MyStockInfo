/* eslint-disable */
// 릴리스 두 단계 — 태그와 빌드를 따로 한다(.github/workflows/release.yml은 태그 push로 돌지 않는다).
//
//   npm run release:tag              version.json의 버전으로 vX.Y.Z 태그를 만들어 push(빌드 안 함)
//   npm run release:build [-- vX.Y.Z] 그 태그로 GitHub Actions 빌드 + 초안 릴리스(기본: version.json의 버전)
//
// 초안이 올라오면 내용을 확인하고 GitHub에서(또는 `gh release edit vX.Y.Z --draft=false --latest`) 공개한다.
// 커밋 작성자·태그 작성자는 git 설정 그대로(이 저장소는 소유자 한 사람).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', ...opts }).trim();
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

const version = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8')).version;
const [command, tagArg] = process.argv.slice(2);
const tag = tagArg || `v${version}`;
if (!/^v\d+\.\d+\.\d+$/.test(tag)) fail(`태그 형식이 아닙니다: ${tag} (예: v1.1.0)`);

function remoteTagExists(t) {
  return sh('git', ['ls-remote', '--tags', 'origin', `refs/tags/${t}`]) !== '';
}

function changelogHas(t) {
  const text = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  return text.split('\n').some((l) => l === `## ${t}` || l.startsWith(`## ${t} `));
}

if (command === 'tag') {
  if (tagArg && tagArg !== `v${version}`) fail(`version.json은 ${version}인데 ${tagArg}를 요청했습니다 — version.json을 먼저 올리세요.`);
  const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') fail(`main 브랜치에서 하세요(지금: ${branch}).`);
  if (sh('git', ['status', '--porcelain', '--untracked-files=no'])) fail('커밋하지 않은 변경이 있습니다.');
  sh('git', ['fetch', '-q', 'origin', 'main']);
  if (sh('git', ['rev-parse', 'HEAD']) !== sh('git', ['rev-parse', 'origin/main'])) {
    fail('HEAD가 origin/main과 다릅니다 — 먼저 push(또는 pull)하세요. 태그는 원격에 있는 커밋에 답니다.');
  }
  if (!changelogHas(tag)) fail(`CHANGELOG.md에 "## ${tag}" 절이 없습니다 — 릴리스 노트가 그 절에서 나옵니다.`);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  if (pkg !== version) fail(`package.json(${pkg})과 version.json(${version})이 다릅니다 — npm run generate:app-info 후 커밋하세요.`);
  if (sh('git', ['tag', '--list', tag])) fail(`로컬에 이미 ${tag} 태그가 있습니다.`);
  if (remoteTagExists(tag)) fail(`원격에 이미 ${tag} 태그가 있습니다.`);

  sh('git', ['tag', '-a', tag, '-m', `MyStock ${tag}`]);
  sh('git', ['push', '-q', 'origin', tag], { stdio: ['ignore', 'pipe', 'inherit'] });
  console.log(`✔ ${tag} 태그를 만들어 push했습니다(빌드는 시작하지 않음).`);
  console.log(`  릴리스 빌드: npm run release:build${tagArg ? ` -- ${tag}` : ''}`);
} else if (command === 'build') {
  if (!remoteTagExists(tag)) fail(`원격에 ${tag} 태그가 없습니다 — 먼저 npm run release:tag`);
  try {
    sh('gh', ['release', 'view', tag, '--json', 'tagName']);
    fail(`${tag} 릴리스가 이미 있습니다 — 다시 빌드하려면 GitHub에서 그 릴리스(초안)를 지운 뒤 실행하세요.`);
  } catch (e) {
    if (e && e.status === undefined) throw e; // fail()의 process.exit가 아닌 진짜 오류
  }
  sh('gh', ['workflow', 'run', 'release.yml', '--ref', tag, '-f', 'platforms=all'], { stdio: ['ignore', 'pipe', 'inherit'] });
  console.log(`✔ ${tag} 릴리스 빌드를 시작했습니다 — 세 OS 빌드 후 초안 릴리스가 생깁니다(약 3~5분).`);
  console.log('  진행: gh run list --workflow release.yml -L 1   /   gh run watch');
  console.log(`  공개: 초안 확인 후 gh release edit ${tag} --draft=false --latest`);
} else {
  fail('사용법: node scripts/release.cjs tag | build [vX.Y.Z]');
}
