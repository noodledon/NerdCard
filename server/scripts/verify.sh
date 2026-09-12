#!/usr/bin/env bash
# One-command local gate — runs the same checks CI enforces, plus the
# headless Godot scene check that stays local (no Godot binary on CI runners).
# Usage: server/scripts/verify.sh   (from anywhere)
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd "$SERVER_DIR/.." && pwd)"
GODOT="${GODOT:-/Applications/Godot.app/Contents/MacOS/Godot}"

cd "$SERVER_DIR"
echo "== npm run typecheck =="
npm run typecheck
echo "== npm test =="
npm test
echo "== npm run test:coverage =="
npm run test:coverage

echo "== headless Godot scene check =="
if [[ ! -x "$GODOT" ]]; then
  echo "Godot binary not found at $GODOT — set \$GODOT to run the client check" >&2
  exit 1
fi
# A fresh checkout/worktree has no .godot cache — class_name lookups (e.g.
# PlayerPanel) fail until the project is imported once.
if [[ ! -f "$ROOT_DIR/client/.godot/global_script_class_cache.cfg" ]]; then
  (cd "$ROOT_DIR" && timeout 60 "$GODOT" --headless --path client/ --import >/dev/null 2>&1 || true)
fi
GODOT_OUT="$(cd "$ROOT_DIR" && timeout 6 "$GODOT" --headless --path client/ 2>&1 || true)"
if echo "$GODOT_OUT" | grep -iE "SCRIPT ERROR|Compile Error|node not found"; then
  echo "Headless Godot check failed" >&2
  exit 1
fi
echo "verify: all checks green"
