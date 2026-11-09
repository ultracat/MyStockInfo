#!/usr/bin/env bash
# MyStock 실행 스크립트 (macOS / Linux) — 터미널에서 `./start.sh`.
# macOS Finder에서 더블클릭하려면 start-mac.command, Windows는 start-windows.bat.
#
# 하는 일: 저장소 루트로 이동 → node/npm 확인 → node_modules가 없으면 npm install
# → npm run dev (백엔드 빌드 후 Vite + Electron 실행). 창을 닫거나 Ctrl+C로 종료.
set -euo pipefail

cd "$(dirname "$0")"

# 더블클릭/바탕화면 실행처럼 셸 설정(.zshrc 등)을 읽지 않는 환경에서는 nvm·Homebrew로
# 설치한 node가 PATH에 없다 — 흔한 설치 위치를 직접 찾아 붙인다.
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
  fi
  for dir in /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
  done
  export PATH
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[MyStock] node/npm을 찾을 수 없습니다. Node.js(LTS)를 설치한 뒤 다시 실행하세요: https://nodejs.org" >&2
  exit 1
fi

echo "[MyStock] node $(node -v), npm $(npm -v)"

# 포트 사전 검사는 하지 않는다 — 예전엔 4317/5173이 사용 중이면 "이미 실행 중"으로 보고
# 멈췄는데, 다른 프로젝트의 Vite가 5173을 잡고 있어도 막혀버렸다(2026-11-09). 이제
# 포트가 차 있으면 scripts/dev.cjs(Vite)와 electron/src/main.ts(백엔드)가 빈 포트로
# 옮겨 뜨고, MyStock이 진짜 이미 떠 있으면 Electron 단일 인스턴스 락이 기존 창을
# 앞으로 가져온다.

if [ ! -d node_modules ]; then
  echo "[MyStock] 처음 실행이라 의존성을 설치합니다 (npm install)..."
  npm install
fi

echo "[MyStock] 앱을 실행합니다 (npm run dev). 종료하려면 앱 창을 닫거나 Ctrl+C."
exec npm run dev
