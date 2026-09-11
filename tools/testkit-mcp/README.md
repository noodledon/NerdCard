# NerdCard testkit MCP

Repo-local Godot playtest harness. One stdio MCP server hosts **N** Godot
clients — no per-client bridge ports, no godot/godot2 pair.

```
MCP host ──stdio──> server.mjs ──TCP hub :9721<──dial── Godot "p1"
                                        ▲
                                        └──────dial── Godot "p2"
```

- `client/testkit/TestKit.gd` — env-gated autoload. Inert unless launched
  with `NERDCARD_TESTKIT_PORT` + `NERDCARD_TESTKIT_ID` (launch_client sets them).
- `server.mjs` — zero-dep MCP stdio server + TCP hub + Godot spawner.
- `drive.mjs` — run a JSONL list of tool calls without an MCP host:
  `node drive.mjs demo-calls.jsonl`
- `demo-calls.jsonl` — full 2P match script (join → build → draw → attack →
  defense-window screenshot → log dump).

## Why not godot-mcp-runtime

| Pain | Fix here |
|---|---|
| every call = one round-trip; 15s defense windows slip by | `scenario` runs step lists **inside** the client — wait_phase→screenshot is one call |
| run_script policy blocks Callable/signals | no scanner (local dev tool, trusts itself) |
| errors die on a transient banner | ring buffer taps `state_received`/`error`; `get_messages` |
| bridge launch flake (8s timeout) | `launch_client` waits for client dial-in, retries |
| two MCP server instances for 2 clients | clients dial out by id; one hub serves all |

## Tools

`launch_client` `list_clients` `connect_game` `send_intent` `eval`
`wait_state` `screenshot` `scenario` `get_messages` `stop_client`

`eval` code bodies get `tree`, `gm` (GameModel), `cm` (ConnectionManager),
`kit`, `root` in scope; `await` works; `return` yields the result.

Scenario steps: `intent` `eval` `expect` `wait_state` `wait` `screenshot`
`ws_close` `connect_ws` `dump_log` `log`. First failure aborts; per-step
results are returned either way.

Wire `cardType` values are camelCase (`offensive`, `martialTheorem`,
`artifactTheorem`, `forceEval`, `eval`); Eval action cards and VVCs both
use `cardType:"eval"` — distinguish by `subtype`/`id`.

Registered in `.mcp.json` as server `testkit`. Requires the game server on
:2568 (`cd server && npm run dev`).
