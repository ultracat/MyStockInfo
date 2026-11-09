#!/usr/bin/env node
// `npm run dev`의 실제 진입점 — Vite dev 서버가 쓸 **빈 포트**를 먼저 고른 뒤
// frontend(Vite) + electron을 함께 띄운다(예전엔 package.json에서 concurrently를 바로
// 불렀다).
//
// 왜: 예전엔 Vite가 5173 고정(`strictPort`)이라, 다른 프로젝트의 Vite가 5173을 잡고
// 있으면 MyStock이 아예 못 떴다(실제 발생, 2026-11-09 — hev_log_analyzer의 Vite가
// 며칠째 5173을 점유). 이제 5173부터 비어 있는 포트를 찾아 **같은 값**을
// MYSTOCK_VITE_PORT로 Vite(vite.config.ts)와 Electron(electron/src/main.ts)에 같이
// 넘긴다. Vite에 그냥 `strictPort: false`만 주면 Vite는 다른 포트로 뜨는데 Electron은
// 여전히 5173(남의 앱)을 열게 되므로, 포트는 반드시 여기서 한 번만 정한다.
//
// ⚠ "비어 있음" 판단은 127.0.0.1과 ::1 **둘 다** 확인한다 — Vite는 `localhost`로 열고
// macOS에서 그게 ::1로 풀리는 경우가 많아서(실제로 남의 Vite가 [::1]:5173에 떠
// 있었다), IPv4만 확인하면 "비었다"고 잘못 판단한다.
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PREFERRED_PORT = 5173;
const MAX_TRIES = 30;

function tryListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (err) => {
      // 이 머신에 IPv6(::1)가 없으면 그 주소는 확인할 필요가 없다.
      resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT' ? 'skip' : 'busy');
    });
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve('free')));
  });
}

async function isPortFree(port) {
  for (const host of ['127.0.0.1', '::1']) {
    if ((await tryListen(port, host)) === 'busy') return false;
  }
  return true;
}

async function findFreePort(start) {
  for (let port = start; port < start + MAX_TRIES; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`${start}~${start + MAX_TRIES - 1} 포트가 모두 사용 중입니다.`);
}

async function main() {
  const port = process.env.MYSTOCK_VITE_PORT ? Number(process.env.MYSTOCK_VITE_PORT) : await findFreePort(PREFERRED_PORT);
  if (port !== PREFERRED_PORT) {
    console.log(`[MyStock] 포트 ${PREFERRED_PORT}을 다른 프로그램이 쓰고 있어 Vite를 ${port}에서 띄웁니다.`);
  }

  const concurrentlyPkg = require.resolve('concurrently/package.json');
  const { bin } = require(concurrentlyPkg);
  const binPath = path.join(path.dirname(concurrentlyPkg), typeof bin === 'string' ? bin : bin.concurrently);

  const child = spawn(
    process.execPath,
    [binPath, '-k', '-n', 'frontend,electron', 'npm:dev:frontend', 'npm:dev:electron'],
    { stdio: 'inherit', env: { ...process.env, MYSTOCK_VITE_PORT: String(port) } }
  );
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
}

main().catch((err) => {
  console.error(`[MyStock] ${err.message}`);
  process.exit(1);
});
