# NerdCard

A mathematically-driven strategic card game where players construct functions, manipulate expressions, and attack each other's math. The live MVP is **NerdiClash**, a 2-player authoritative-server mode.

> Design docs: `docs/gameplay-flow.md` · Master plan: `.sisyphus/completed/nerdicard-dev-plan.md` · QA findings: `report.md`

## Stack

| Layer | Tech | Role |
|-------|------|------|
| Server | Node.js + TypeScript + Colyseus | Authoritative rules engine |
| Math | mathjs + optional SymPy service | Local math (pure-TS polynomial integrate/limit) plus symbolic integration, limits, continuity, RREF, and rank |
| Client | Godot 4.7 + GDScript | Dumb UI — renders server state, sends intents |
| Tests | vitest | Server-side unit/integration tests |

## Quick start

### Server

```bash
cd server
npm install
npm run dev          # Colyseus on :2567 + JSON bridge on :2568
```

Wait for:

```
NerdiClash server listening on :2567
[JsonBridge] Listening on ws://localhost:2568
```

### Tests

```bash
cd server
npm run typecheck    # tsc --noEmit
npm test             # vitest (500+ tests)
npm run test:coverage # vitest + v8 coverage gate (lines/stmts 78, funcs 84, branches 74)
```

### SymPy mode

Normal development and `npm test` use math.js and do not require Python. Set `USE_SYMPY=true` to route integration, limit, continuity, RREF, and rank operations to the FastAPI service. `SYMPY_URL` defaults to `http://localhost:2569`.

```bash
python -m venv sympy-service/.venv
sympy-service/.venv/bin/pip install -r sympy-service/requirements.txt
```

Three entry points, by intent:

```bash
cd server
npm run dev                          # everyday dev — mathjs only, no Python needed
npm run dev:sympy                    # SymPy dev stack — boots uvicorn :2569 plus
                                     # tsx watch under USE_SYMPY=true; Ctrl-C or
                                     # dev-server exit tears down both
./server/scripts/test-with-sympy.sh  # one-shot check — service + full vitest
                                     # suite under SymPy, then teardown
```

`dev:sympy` exits non-zero with the setup commands above if the venv is missing — it never falls back to mathjs silently.

To run the application stack containerized:

```bash
docker compose up --build
```

Compose enables `USE_SYMPY=true`, starts SymPy on `:2569`, and waits for its health check before starting Node.

### Client

`godot` is not on PATH. The binary is expected at:

```bash
/Applications/Godot.app/Contents/MacOS/Godot
```

This path is also configured in `opencode.json` for the Godot MCP servers.

```bash
GODOT="/Applications/Godot.app/Contents/MacOS/Godot"
"$GODOT" --path client/                    # play
"$GODOT" --path client/ --editor           # edit
"$GODOT" --headless --path client/ --import  # re-import after asset/script changes
```

Main scene: `client/game.tscn`. Autoloads: `GameModel`, `ConnectionManager`.

## Architecture

- **Authoritative server.** The client never validates rules; it only renders state and sends intents like `play_card` or `eval_function`.
- **Two transports, one game core**
  - Colyseus native: `ws://localhost:2567`, room `nerdiclash`
  - JSON WebSocket bridge (what Godot uses): `ws://localhost:2568`
- **Join handshake (bridge):** client sends `join_room` → server replies `joined` with `sessionId`, `role`, and a `reconnectToken`; rejoin requires the `sessionId` + token pair. A ~10s WS heartbeat drops dead sockets and frees their seats.
- **Wire protocol:** gameplay intents are validated against `server/src/shared/messages.ts` (Zod) and serialized through a per-game queue. The ten client message types are `build_function`, `play_card`, `draw_cards`, `set_trap`, `play_defense`, `eval_function`, `force_eval`, `end_turn`, `ready_inst`, and `leave_room`. Server→client: `state_snapshot`, `game_event`, `defense_resumed`, and a dedicated `game_over` frame on win.
- **State snapshots** stream every 100ms and hide the opponent's hand/deck/trap card (opponent sees a `trapSet` boolean instead).
- **Games are ephemeral** — no database, no persistence.

## Project layout

```
server/src/
  logic/          # Rules, eval, win, decks, zones, FSM
  commands/       # Intent handlers / command dispatch
  state/schema.ts # Colyseus Schema definitions
  shared/messages.ts # Zod wire contracts
  shared/types.ts    # Shared TS types
  json-bridge.ts  # Godot-facing WebSocket bridge
  rooms/          # Colyseus room shell + NerdiClashGame
  data/           # Card catalog
  math/           # math.js engine and optional SymPy adapter

client/
  game.gd         # Main scene controller
  scripts/        # UI, state, networking
  game.tscn       # Main scene
  project.godot   # Autoloads, main scene, display settings

docs/
  gameplay-flow.md # Game design explainer

sympy-service/     # FastAPI/SymPy calculator service

.sisyphus/
  drafts/                     # Active wave task breakdowns
  completed/                  # Executed plans ([COMPLETED] header + summary)
  docs/                       # Reference docs
  evidence/                   # QA/playtest artifacts
  prompts/                    # Self-contained agent task prompts
```

## Development workflow

Server changes:

```bash
cd server
npm run typecheck && npm test
```

GDScript changes — verify via full scene run, not `--check-only` (autoload references fail in isolated checks):

```bash
timeout 6 "$GODOT" --headless --path client/ 2>&1 | grep -iE "SCRIPT ERROR|Compile Error|node not found"
```

Kill stuck server ports:

```bash
lsof -ti :2567 :2568 | xargs kill -9
```

Run focused server tests:

```bash
npx vitest run src/__tests__/logic/deck.test.ts
npx vitest run --testNamePattern="schema"
```

## Key constraints

- **Expressions are strings on the wire.** `Board.expression` and card payloads are math.js strings; math.js `Node` objects are never stored in Colyseus Schema.
- **HP is `hp10`** (integer ×10). Display = `hp10 / 10`. Starting HP is `0`; you gain HP by evaluating functions.
- **Schema ≤64 fields per class** — nest sub-schemas instead of flattening.
- **TypeScript `strict: true`** — no ESLint/Prettier; quality gate is `tsc --noEmit` + vitest.
- **Decorators:** `experimentalDecorators` + `useDefineForClassFields: false` (required for `@colyseus/schema`).
- **Colyseus Godot SDK unavailable for Godot 4.7** — the client uses a custom raw WebSocket client (`client/scripts/raw-ws-client.gd`). `ColyseusConnection.gd` is an inert stub.
- **SymPy is optional by default.** `USE_SYMPY=true` enables the hybrid engine; configure its endpoint with `SYMPY_URL`.

## Notes

- The official `qa-runner.mjs` exists for bridge smoke tests but has known runner-side issues; `npm test` is the authoritative gate.
- `client/tools/run_screenshots.sh` generates UI screenshots but the `client/tools/` directory is gitignored.
- The `.sisyphus/`, `.agents/`, `.claude/`, `.codegraph/`, and `AGENTS.md` files are local-only and gitignored.
