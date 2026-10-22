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

# 백엔드(4317)나 Vite(5173) 포트를 이미 쓰고 있으면 앱이 이미 떠 있을 가능성이 높다.
if command -v lsof >/dev/null 2>&1; then
  for port in 4317 5173; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[MyStock] 포트 $port 를 이미 사용 중입니다 — MyStock이 이미 실행 중인지 확인하세요." >&2
      exit 1
    fi
  done
fi

if [ ! -d node_modules ]; then
  echo "[MyStock] 처음 실행이라 의존성을 설치합니다 (npm install)..."
  npm install
fi

echo "[MyStock] 앱을 실행합니다 (npm run dev). 종료하려면 앱 창을 닫거나 Ctrl+C."
exec npm run dev
