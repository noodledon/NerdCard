#!/usr/bin/env bash
# dev:sympy — one-command SymPy dev stack.
#
# Boots the sympy-service (uvicorn on :2569 via its venv) AND the dev server
# (tsx watch, Colyseus :2567 + JSON bridge :2568) with USE_SYMPY=true, then
# tears both down on exit — whether that is Ctrl-C, the dev server dying, or
# the script itself being killed. `npm run dev` alone stays on mathjs — the
# locked default engine; this script never falls back silently. For the
# one-shot test variant see test-with-sympy.sh.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$SERVER_DIR/.." && pwd)"
SERVICE_DIR="${SYMPY_SERVICE_DIR:-$ROOT_DIR/sympy-service}"
VENV="${SYMPY_VENV:-$SERVICE_DIR/.venv}"
PYTHON="$VENV/bin/python"
UVICORN="$VENV/bin/uvicorn"
SYMPY_PORT="${SYMPY_PORT:-2569}"
SYMPY_URL="${SYMPY_URL:-http://127.0.0.1:$SYMPY_PORT}"
LOG_FILE="${TMPDIR:-/tmp}/nerdicard-sympy-dev.log"
SERVICE_PID=""
DEV_PID=""

# Children are process trees (npm → sh → tsx → node), so reap recursively —
# a bare `kill` on the parent can orphan the grandchild holding the port.
kill_tree() {
  local pid="$1" child
  [[ -n "$pid" ]] || return 0
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  kill_tree "$DEV_PID"
  kill_tree "$SERVICE_PID"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -x "$PYTHON" || ! -x "$UVICORN" ]]; then
  cat >&2 <<EOF
[dev:sympy] SymPy virtualenv missing at $VENV — set it up first:
  python -m venv sympy-service/.venv
  sympy-service/.venv/bin/pip install -r sympy-service/requirements.txt
EOF
  exit 1
fi

(
  cd "$SERVICE_DIR"
  exec "$UVICORN" main:app --host 127.0.0.1 --port "$SYMPY_PORT"
) >"$LOG_FILE" 2>&1 &
SERVICE_PID=$!

for _ in {1..50}; do
  if "$PYTHON" -c "import urllib.request; urllib.request.urlopen('$SYMPY_URL/health', timeout=1)" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if ! "$PYTHON" -c "import urllib.request; urllib.request.urlopen('$SYMPY_URL/health', timeout=1)" 2>/dev/null; then
  echo "[dev:sympy] SymPy service failed its health check — service log:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo "[dev:sympy] SymPy service healthy at $SYMPY_URL (uvicorn log: $LOG_FILE)"
echo "[dev:sympy] engine=hybrid — integrate/limit/continuityCheck/rref/rank route through SymPy"
echo "[dev:sympy] starting dev server — Colyseus :2567, JSON bridge ws://localhost:${BRIDGE_PORT:-2568}"

cd "$SERVER_DIR"
USE_SYMPY=true SYMPY_URL="$SYMPY_URL" npm run dev &
DEV_PID=$!

# Foreground stand-in: the script blocks here so a terminal Ctrl-C still
# reaches the whole process group, and a dev-server exit drops through to
# the EXIT trap which reaps the service. The dev server's status propagates
# as this script's exit code.
wait "$DEV_PID"
