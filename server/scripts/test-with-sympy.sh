#!/usr/bin/env bash
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$SERVER_DIR/.." && pwd)"
SERVICE_DIR="$ROOT_DIR/sympy-service"
PYTHON="$SERVICE_DIR/.venv/bin/python"
UVICORN="$SERVICE_DIR/.venv/bin/uvicorn"
SERVICE_PID=""
LOG_FILE="${TMPDIR:-/tmp}/nerdicard-sympy.log"

cleanup() {
  if [[ -n "$SERVICE_PID" ]]; then
    kill "$SERVICE_PID" 2>/dev/null || true
    wait "$SERVICE_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ ! -x "$PYTHON" || ! -x "$UVICORN" ]]; then
  echo "SymPy virtualenv missing. Run: python -m venv sympy-service/.venv && sympy-service/.venv/bin/pip install -r sympy-service/requirements.txt" >&2
  exit 1
fi

(
  cd "$SERVICE_DIR"
  exec "$UVICORN" main:app --host 127.0.0.1 --port 2569
) >"$LOG_FILE" 2>&1 &
SERVICE_PID=$!

for _ in {1..50}; do
  if "$PYTHON" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:2569/health', timeout=1)" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if ! "$PYTHON" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:2569/health', timeout=1)" 2>/dev/null; then
  cat "$LOG_FILE" >&2
  exit 1
fi

cd "$SERVER_DIR"
USE_SYMPY=true SYMPY_URL=http://127.0.0.1:2569 npm test
