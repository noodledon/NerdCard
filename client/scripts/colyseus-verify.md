# Colyseus Godot SDK Verification Report

## Risk Rating: `SDK-BROKEN-FALLBACK`

> **Update (wave-14 T3):** the SDK never came back, and the JSON bridge
> was formalized as the client's only transport. The inert
> `ColyseusConnection.gd` stub kept below was deleted; this report is
> retained as the branch-decision record.

---

## Godot Version Tested

```
4.7.stable.official.5b4e0cb0f
```

Installed at: `xxxDesktop/Godot.app`

---

## SDK Status: UNAVAILABLE

- **Source attempted:** `https://github.com/colyseus/colyseus-godot`
- **Result:** Repository not found (HTTP 404)
- **Verified via:** `curl` + GitHub API — returns `"message": "Not Found"`

---

## `--check-only` Results

### 1. `ColyseusConnection.gd` — FAILED

```
SCRIPT ERROR: Parse Error: Identifier "Colyseus" not declared in the current scope.
          at: GDScript::reload (res://scripts/ColyseusConnection.gd:34)
ERROR: Failed to load script "res://scripts/ColyseusConnection.gd" with error "Parse error".
```

**Cause:** The `Colyseus` class (from the official Godot SDK addon) is not available because the SDK repo no longer exists.

**Exact failure string:** `Identifier "Colyseus" not declared in the current scope`

### 2. `raw-ws-client.gd` — PASSED

Exit code 0, no parse errors. Uses only built-in Godot 4 classes (`WebSocketPeer`, `JSON`).

---

## Fallback Decision

**Decision:** Use `raw-ws-client.gd` as the active connection path.

**Required Wave 2 server-side work:**
- Colyseus's native protocol uses msgpack-list framing (see `docs.colyseus.io/colyseus/client/client-side/`).
- The raw WebSocket fallback speaks **plain JSON** text frames.
- To make the fallback work, Wave 2 must add a **JSON text-frame bridge** to `server/src/app.config.ts`:
  - Register a custom transport that sends JSON-encoded state patches over text frames
  - OR use Colyseus's built-in JSON transport if available in the version being used

**Pointer:** `server/src/app.config.ts` (T1 placeholder — add JSON transport registration in Wave 2).

---

## Files Added

| File | Purpose | Status |
|------|---------|--------|
| `scripts/ColyseusConnection.gd` | SDK wrapper stub | Fails to parse — SDK unavailable; deleted wave-14 T3 |
| `scripts/raw-ws-client.gd` | Raw WebSocket fallback (ACTIVE) | Parses cleanly |
| `addons/` | SDK addon directory (empty — SDK not available) | N/A |

---

## Notes

- `ColyseusConnection.gd` was kept at the time of this report as a contract reference for a possible SDK revival. It was deleted in wave-14 T3 when the JSON bridge was formalized as the only client transport.
- No modifications were made to `project.godot`, `game.gd`, or any other existing files.
