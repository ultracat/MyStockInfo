#!/usr/bin/env node
// `npm run dev`의 Electron 쪽(2026-11-17) — 백엔드를 고치면 **다시 빌드하고 Electron을 다시 띄운다**.
//
// 왜: 백엔드는 Electron 메인 프로세스 안에서 `@mystock/backend`(= backend/dist)를 require해서 돈다(Vite HMR 대상이 아님).
// 예전엔 `npm run build:backend` 후 앱을 손으로 껐다 켜야 했다.
//
// 동작:
// - 백엔드: `tsc -w`(backend/tsconfig.json)를 띄우고, 출력의 "Found N errors" 줄로 컴파일이 끝났음을 안다.
//   첫 컴파일이 끝나면 Electron을 띄우고, 그 뒤 **오류 0건**으로 끝난 컴파일마다 Electron을 다시 띄운다(오류가 있으면 안 띄우고 알림만 —
//   반쯤 깨진 dist로 앱이 뜨지 않게).
// - Electron 메인(`electron/src/*.ts`, tsx로 바로 실행): 파일이 바뀌면 다시 띄운다.
// - 다시 띄울 땐 이전 프로세스가 **완전히 끝난 뒤** 띄운다 — 단일 인스턴스 락·백엔드 포트를 이전 프로세스가 들고 있으면 새 것이 바로 종료된다.
// - 사용자가 창을 닫아 Electron이 스스로 끝나면 이 스크립트도 끝난다 → `concurrently -k`가 Vite까지 내린다(예전과 같음).
// ⚠ 다시 띄울 때마다 토스 토큰을 새로 받는다(메모리 토큰) — KIS·NH는 파일 토큰을 재사용해 재발급 없음.
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronDir = path.join(root, 'electron');
const electronBin = require(require.resolve('electron', { paths: [electronDir] }));
const tscBin = require.resolve('typescript/bin/tsc', { paths: [path.join(root, 'backend')] });

let child = null;
let restarting = false;
let started = false;

function log(msg) {
  console.log(`[dev-electron] ${msg}`);
}

function startElectron() {
  child = spawn(electronBin, ['./src/index.cjs'], { cwd: electronDir, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    child = null;
    if (restarting) return; // 우리가 끈 것 — restart()가 다시 띄운다
    log(`Electron이 끝났습니다(${signal ?? code}) — 개발 실행을 마칩니다.`);
    shutdown(code ?? 0);
  });
}

async function restart(reason) {
  if (!started) return;
  if (restarting) return;
  restarting = true;
  log(`${reason} → Electron을 다시 띄웁니다.`);
  if (child) {
    const old = child;
    await new Promise((resolve) => {
      old.once('exit', resolve);
      old.kill('SIGTERM');
      setTimeout(() => old.exitCode === null && old.kill('SIGKILL'), 5000).unref();
    });
  }
  restarting = false;
  startElectron();
}

// ---- 백엔드 tsc -w
const tsc = spawn(process.execPath, [tscBin, '-w', '-p', 'tsconfig.json', '--preserveWatchOutput'], {
  cwd: path.join(root, 'backend'),
  stdio: ['ignore', 'pipe', 'inherit'],
});
let buf = '';
tsc.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/\x1b\[[0-9;]*m/g, '');
    buf = buf.slice(i + 1);
    if (line.trim()) console.log(`[backend] ${line}`);
    const m = /Found (\d+) errors?/.exec(line);
    if (!m) continue;
    const errors = Number(m[1]);
    if (!started) {
      // 첫 컴파일 — 오류가 있어도 띄운다(npm run dev가 이미 build:backend를 거쳤다)
      started = true;
      startElectron();
    } else if (errors === 0) {
      void restart('백엔드가 다시 빌드됐습니다');
    } else {
      log(`백엔드 컴파일 오류 ${errors}건 — 고칠 때까지 지금 앱을 그대로 둡니다.`);
    }
  }
});
tsc.on('exit', (code) => {
  log(`tsc -w가 끝났습니다(${code}).`);
  shutdown(code ?? 1);
});

// ---- Electron 메인 소스(tsx로 바로 실행)
let mainTimer = null;
fs.watch(path.join(electronDir, 'src'), { recursive: true }, (_event, file) => {
  if (!file || !/\.(ts|cjs|js)$/.test(String(file))) return;
  clearTimeout(mainTimer);
  mainTimer = setTimeout(() => void restart(`electron/src/${file} 변경`), 300);
});

function shutdown(code) {
  if (child) child.kill('SIGTERM');
  tsc.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
