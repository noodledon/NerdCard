# NERDICARD Backend Game Server — MVP Development Plan

## TL;DR

> **Quick Summary**: Build the authoritative Colyseus.js game server for NERDICARD (NerdiClash 2P mode) with full math domains stubbing SymPy, plus a minimal Godot 4 test client that renders state text-only and sends player intents. Server retains full anti-cheat authority; client is "dumb/blind."
>
> **Deliverables**:
> - Node.js + TypeScript + Colyseus backend server with authoritative NerdiClash 2P rules
> - Pure (Colyseus-free) game-logic module: decks, Fisher-Yates shuffle, HP formula, win checks, validation
> - Math engine abstraction with math.js-backed implementations (derivative/simplify/matrix/complex/numtheory) + SymPy stubs (integrate/limit/RREF/rank)
> - Frozen minimal card catalog (~25 cards spanning every archetype)
> - Math Engine Capability Matrix (explicit green/yellow/red status per operation)
> - Minimal Godot 4 test client: connect, join room, text-render state, click-to-send intents
> - Tests-after implementation (vitest)
>
> **Estimated Effort**: XL (large multi-domain build)
> **Parallel Execution**: YES - 5 waves
> **Critical Path**: T4 scaffolding → T6 schema → T10 turn FSM → T14 handlers → T16 tests → F1-F4

---

## Context

### Original Request
User provided a fixed tech stack (Node.js + TS + Colyseus.js + math.js backend; Godot 4 + GDScript + Colyseus Godot SDK frontend) and asked to "review game logics and player flow and create a structured plan for developing." Goal: simplest UI in Godot first, then focus on backend game engine. Server must retain full authority (anti-cheat); client is "dumb/blind."

### Interview Summary
**Key Decisions (all confirmed by user)**:
- MVP Mode: **NerdiClash** (from rulebook v1.0) — win via HP=0 OR variable isolation + 3-turn rebuild fail
- Player Count: **2-player only** for v1
- Math Domain Scope: FULL (calculus + number theory + linear algebra). math.js handles derivatives/simplify/matrix/complex; SymPy microservice **STUBBED** (deferred post-MVP)
- Card Catalog: **Minimal starter set** (~20-30 cards spanning every archetype); data-driven definitions
- Prize Cards: **DEFERRED** — v1 uses rulebook's "Variable Value Card" mechanism, not the prize-deck variant from the Game Logic v1 doc
- UI Sequencing: Minimal Godot client built **alongside** backend as live test client
- Tests: **After** implementation (no TDD); agent-executed QA mandatory per task

**Research Findings**:
- **Colyseus** (bg_13cb481b): `@type()` schema; `@view()` + StateView for hidden hands (CRITICAL pitfall — must `client.view.add(schemaCard)` on EVERY new push or hidden info leaks); MapSchema (string keys only) for players, ArraySchema for ordered; 64-field Schema limit (nest); no multi-dim arrays (flatten matrices); phase string field + turnDeadline; handler pattern (BaseHandler delegating per-domain); optional `@colyseus/command` for testable dispatch; reconnection via `onDrop + allowReconnection(client, 30s)`. Reference repos: colyseus/turnbased-cards-demo (UNO), namantam1/live-card-game (Call Break)
- **math.js** (bg_b397c905): `math.parse(str)`→Node; serialize via `math.replacer`/`math.reviver`; derivative/simplify/rationalize/symbolicEqual fully supported; matrix det/inv/pinv/lup/qr/schur/svd/eigs(partial)/expm/sqrtm/lusolve/lyap/sylvester/kron/fft; complex full; gcd/lcm/mod/invmod/isPrime; polynomialRoot (numerical). **CANNOT**: symbolic integrate (#442 open since 2015), limit eval, symbolic solve, RREF, rank undocumented. Safe sandboxed parser (no eval/new Function), can disable dangerous fns

### Metis Review
**Critical Flaw Caught**: math.js `Node` objects CANNOT be stored in Colyseus `Schema` fields — schemas only accept primitives/nested Schemas/MapSchema/ArraySchema. Storing Node objects would break serialization entirely. **Fix applied**: Expressions travel as **strings** (`node.toString()` on wire, `math.parse(str)` server-side). math.js Node objects live ONLY inside the Pure Game Logic / Math Engine modules.

**Gaps addressed**:
- Expression wire format locked to string serialization (Option A, Metis-recommended)
- Card catalog explicitly frozen before implementation (T3)
- Math Engine Capability Matrix mandated (T4)
- Card zone transitions wrapped in tested utilities managing `@view()` lifecycle (T7)
- Floating-point determinism: epsilon `1e-9` + HP stored as integer ×10 (T12)
- Defense phase timeout (15s auto-pass) (T10)
- Deck exhaustion = reshuffle graveyard (T7)
- Simultaneous Force Eval resolution: turn-player effect resolves first (T12)
- Godot client locked to TEST CLIENT ONLY — text-render + intent-sender, no polish (T17-T19)
- Initial function construction: synchronous submit, server validates against base domain (T10)

**Open Decisions for User** (in Summary below):
- Exact Variable Value Card definition (separate card type vs reuse of Variable Cards)
- Proposed frozen card catalog review (presented as concrete list in T3 references)

---

## Work Objectives

### Core Objective
Deliver a working authoritative backend for NerdiClash 2P with the full game loop playable end-to-end via a minimal Godot test client, stubbing SymPy operations, with the minimal card catalog为代表的 each archetype validated.

### Concrete Deliverables
- Backend: `server/` — Colyseus room + schema + pure game logic + math engine + handlers + tests
- Client: Godot project additions — connect screen, game board text render, intent send
- Shared: frozen card catalog JSON, Math Engine Capability Matrix doc, shared types

### Definition of Done
- [ ] Two Godot clients connect; server auto-starts NerdiClash 2P; full turn cycle (draw→play→defense→resolution) completes
- [ ] Server rejects every illegal intent (wrong phase, wrong turn, invalid target, >1 offensive/turn, trap+offensive conflict)
- [ ] Evaluation yields correct HP per formula; force evaluation wins/relocates HP correctly
- [ ] At least one game ends via HP=0 AND one via variable isolation (3-turn rebuild fail)
- [ ] All vitest tests pass
- [ ] SymPy stubs return `{ supported: false }` cleanly; game is playable without them

### Must Have
- Authoritative server validates ALL intents before mutating state
- `@view()` lifecycle managed by tested utilities (no hand-info leaks)
- Expressions over the wire as strings; math.js Node objects only server-internal
- Frozen card catalog — no ad-hoc additions during dev
- Math Engine Capability Matrix published
- 4 SymPy stub operations max (integrate, limit, RREF, rank)
- Reconnection within 30s preserves game state
- HP as integer ×10; FP epsilon `1e-9` for comparisons
- Tests after implementation (vitest)

### Must NOT Have (Guardrails)
- math.js `Node` objects in Colyseus `Schema` fields (will fail)
- No Variable Isolation-only mode, no Classic Clash mode (NerdiClash only)
- No N-player lobbies or matchmaking beyond direct `joinOrCreate`
- No prize deck / prize card data structures
- No SymPy microservice, no Python process, no HTTP client for math fallback in MVP
- No database persistence (games ephemeral — room auto-disposes)
- No Godot animations, card art, sound, lobby UI beyond direct IP connect
- No AI opponent, spectator, replay, admin tools
- No card effects requiring >50 LoC to implement (simplify or cut for MVP)
- No `as any`/`@ts-ignore`/empty catches/console.log in prod code
- Pure Game Logic module: ZERO Colyseus imports (verify with ast_grep_search)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision
- **Infrastructure exists**: NO (greenfield) — set up in T1
- **Automated tests**: Tests-after — implementation tasks ship tests in the SAME task
- **Framework**: vitest (Node-native, fast, ESM-first)
- **Pattern**: Pure game logic units tested in isolation; room/integration tested via WS client script

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Pure logic**: `bun test`/`npx vitest run` with exact assertions
- **Colyseus room**: Node WS client script (ws package) sends intents, asserts state patches
- **Godot client**: Godot headless run (`godot --headless`) with log assertions OR screenshot
- **Math**: `npx ts-node` REPL evaluating concrete expressions with exact expected values

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation + scaffolding):
├── T1: Backend project scaffolding [quick]
├── T2: Shared types & Zod message contracts [quick]
├── T3: Frozen card catalog v1 [quick]
├── T4: Math engine abstraction + math.js impl + SymPy stubs + capability matrix [deep]
└── T5: Godot project scaffolding + Colyseus Godot SDK setup [quick]

Wave 2 (After Wave 1 — core state + engine, parallel):
├── T6: Colyseus state schema — Card/Player/Board/GameRoomState with @view (depends: 2) [unspecified-high]
├── T7: Pure game logic core — decks/shuffle/zone-utils/graveyard/composition-tracker (depends: 2,3) [deep]
├── T8: Expression representation layer — string↔Node roundtrip, domain validation, term/var counters (depends: 4) [deep]
└── T9: Complexity Score AST Walker — custom tree visitor: distinct vars, terms-beyond-first, compositions (depends: 4,8) [unspecified-high]

Wave 3 (After Wave 2 — game flow, parallel):
├── T10: Room class + lifecycle + reconnection + 2P auto-lock (depends: 6,7) [unspecified-high]
├── T11: Turn state machine — phase FSM + timers + stalling_no_eval_turns + initial construction (depends: 6,7) [deep]
├── T12: Card effect engine — @colyseus/command dispatch + offensive limit + trap slot + theorems (depends: 8,3,7) [ultrabrain]
├── T13: Evaluation engine — HP formula + variable value cards + force eval + undefined detection + FP epsilon (depends: 8,9) [deep]
└── T14: Win condition engine — HP=0 + isolation timers + force-eval domination + vec/singular (depends: 12,13) [unspecified-high]

Wave 4 (After Wave 3 — integration + tests, parallel):
├── T15: Message handlers with Zod validation + full server-side validation (depends: 10,11,12,13,14) [unspecified-high]
├── T16: Edge-case handling — deck exhaustion reshuffle + simultaneous force eval + fizzle + both-disconnect (depends: 15) [unspecified-high]
└── T17: Tests — vitest suites for pure logic + room integration (depends: 15,16,7,8,9,13) [unspecified-high]

Wave 5 (After Wave 2 — minimal Godot client, parallel with W3/W4):
├── T18: Godot connection + state sync (depends: 5,6) [visual-engineering]
├── T19: Godot game board text render — boards/HP/turn/hand (depends: 18) [visual-engineering]
└── T20: Godot intent sender — click-card to send intents + deck select (depends: 18) [visual-engineering]

Wave FINAL (After ALL — 4 parallel reviews, then user okay):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA — end-to-end 2P game + edge cases (unspecified-high)
└── F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 → T6 → T11 → T15 → T17 → F1-F4 → user okay
Parallel Speedup: ~70% faster than sequential
Max Concurrent: 5 (Wave 1 & Wave 3)
```

### Dependency Matrix (ALL 20 tasks)

| Task | Depends On | Blocks |
|------|-----------|--------|
| T1 | — | — (foundation; peers scaffold dependent code) |
| T2 | — | T6, T7, T15 |
| T3 | — | T7, T12, T15 |
| T4 | — | T8, T9 |
| T5 | — | T18 |
| T6 | T2 | T10, T11, T15, T18 |
| T7 | T2, T3 | T10, T11, T12, T15, T16 |
| T8 | T4 | T9, T12, T13, T15 |
| T9 | T4, T8 | T13, T15, T17 |
| T10 | T6, T7 | T15 |
| T11 | T6, T7 | T15, T16 |
| T12 | T8, T3, T7 | T14, T15 |
| T13 | T8, T9 | T14, T15 |
| T14 | T12, T13 | T15 |
| T15 | T10, T11, T12, T13, T14 | T16, T17 |
| T16 | T15 | T17 |
| T17 | T15, T16, T7, T8, T9, T13 | — |
| T18 | T5, T6 | T19, T20 |
| T19 | T18 | — |
| T20 | T18 | — |
| F1-F4 | ALL | — |

### Agent Dispatch Summary

- **W1**: **5** — T1→`quick`, T2→`quick`, T3→`quick`, T4→`deep`, T5→`quick`
- **W2**: **4** — T6→`unspecified-high`, T7→`deep`, T8→`deep`, T9→`unspecified-high`
- **W3**: **5** — T10→`unspecified-high`, T11→`deep`, T12→`ultrabrain`, T13→`deep`, T14→`unspecified-high`
- **W4**: **3** — T15→`unspecified-high`, T16→`unspecified-high`, T17→`unspecified-high`
- **W5**: **3** — T18→`visual-engineering`, T19→`visual-engineering`, T20→`visual-engineering`
- **FINAL**: **4** — F1→`oracle`, F2→`unspecified-high`, F3→`unspecified-high`, F4→`deep`

---

## TODOs


- [ ] 1. Backend Project Scaffolding

  **What to do**:
  - Create `server/` directory at repo root with the following layout:
    - `server/package.json` — name `nerdicard-server`, type `module`, scripts: `"dev": "tsx watch src/index.ts"`, `"build": "tsc"`, `"start": "node dist/index.js"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`.
    - Pin exact versions (no `^`/`~`): `colyseus@0.16.20`, `@colyseus/schema@3.1.0`, `@colyseus/command@0.3.0`, `math.js@14.4.2`, `zod@3.23.8`, `typescript@5.4.5`, `tsx@4.11.0`, `vitest@1.6.0`, `@types/node@20.14.0``.
    - `server/tsconfig.json` — `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `experimentalDecorators: true` (REQUIRED for Colyseus `@type()`/`@filter()` decorators), `useDefineForClassFields: false` (REQUIRED — Colyseus Schema decorators mutate class fields at runtime; ES2022 `define` semantics breaks them), `outDir: dist`, `rootDir: src`, `esModuleInterop: true`, `declaration: true`.
    - `server/src/index.ts` — entry that imports `app.config.ts`, calls `defineServer()` from `Colyseus.Server` on port `2567`, logs `NerdiClash server listening on :2567`.
    - `server/src/app.config.ts` — exports `defineServer()` placeholder that registers no rooms yet (returns `Colyseus.Server` instance with a TODO comment for handler registration in Wave 2).
    - `server/src/vitest.config.ts` (or inline in package.json) — `test.environment: 'node'`, `include: ['src/**/*.test.ts']`.
    - `server/src/__tests__/hello.test.ts` — vitest integration test: assert `defineServer` is a function and returns an object with `.transport` optionally set. Trivial sanity check confirming test pipeline works.
    - `server/.gitignore` — `node_modules/`, `dist/`, `*.log`.
    - README placeholder is NOT required (per "NEVER proactively create documentation files").
  - Run `npm install` inside `server/` and capture the resolved tree to confirm exact pins resolved (no caret drift). If npm overrides exact pins, switch to `npm ci` with a committed `package-lock.json` (commit the lockfile).
  - Verify decorator + schema toolchain by adding a throwaway `server/src/__tests__/schema-smoke.test.ts` that defines a minimal `@type("number") class HP extends Schema {}`, instantiates it, asserts `decode(encode(obj)).hp === 0`. Delete the throwaway schema after the test passes is NOT required — keep it as a guard for Wave 2.

  **Must NOT do**:
  - Do NOT use `^` or `~` version ranges for the pinned dependencies above (math.js and Colyseus APIs move fast; a minor bump can break decorator metadata).
  - Do NOT set `useDefineForClassFields: true` — it silently breaks `@colyseus/schema` field initialization (this is a documented Colyseus gotcha).
  - Do NOT add a room class or any game logic yet (Wave 2+).
  Do NOT create a README.md or other docs.
  - Do NOT install SymPy/Python tooling here (Wave 3+ scope).
  - Do NOT put any math.js `Node` objects in any Schema class — strings only, even in smoke tests (critical constraint #1 — establishes the invariant from line one).

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure scaffolding, no business logic; well-trodden Colyseus + TS template. Single sitting, deterministic.
  - **Skills**: [`git-master`]
    - `git-master`: For the initial backend commit (single atomic commit grouping all of Wave 1 at the end).
  - **Skills Evaluated but Omitted**:
    - `playwright`: no UI in T1.
    - `ai-slop-remover`: no existing code to de-slop.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: downstream Waves 2+ (every later task adds files under `server/`).
  - **Blocked By**: None (can start immediately — greenfield).

  **References**:
  **Pattern References**:
  - `NerdiCard.txt` (repo root) — game server authoritative-mode rationale (see "Server retains FULL authority" draft line 8).
  - `.sisyphus/drafts/nerdicard-backend.md:107-118` — Colyseus confirmed patterns: `MapSchema` for players (string keys), `ArraySchema` for ordered lists, phase field on root state, `@colyseus/command` recommended for testable dispatch.
  **API/Type References**:
  - Colyseus `defineServer` + `Server` API surface: signature `new Server({ options })` then `server.define("roomName", RoomClass)`. T1 only needs the `new Server()` half.
  - `@colyseus/schema` decorator registry requires `experimentalDecorators: true` AND `useDefineForClassFields: false` — this is the Colyseus schema TS config contract.
  **Test References**:
  - vitest minimal config: `test.environment: 'node'`, ESM-native (no jest-style babel transform needed).
  **External References**:
  - https://docs.colyseus.io/colyseus/server/api/ — `Server` constructor + `defineServer` shape.
  - https://docs.colyseus.io/colyseus/getting-started/server-side-typescript/ — exact `tsconfig.json` flags Colyseus requires (`experimentalDecorators`, `useDefineForClassFields:false`).
  - https://www.typescriptlang.org/tsconfig#useDefineForClassFields — why the false setting matters for legacy decorators.
  **WHY Each Reference Matters**:
  - `tsconfig` flags are the #1 cause of silent Colyseus decorator failures — getting them locked in T1 prevents an entire class of Wave 2 bugs.
  - Exact version pins prevent a math.js minor (e.g. breaking `derivative` AST shape) from corrupting Wave 4 engine work.

  **Acceptance Criteria**:
  **If TDD (tests enabled)**: N/A (tests-after) — but the hello + schema-smoke guard tests ARE allowed as boilerplate sanity, not feature TDD.
  - [ ] `server/` directory exists with `package.json`, `tsconfig.json`, `src/index.ts`, `src/app.config.ts`, `src/__tests__/hello.test.ts`, `src/__tests__/schema-smoke.test.ts`.
  - [ ] `server/package.json` pins `colyseus`, `@colyseus/schema`, `@colyseus/command`, `math.js`, `zod`, `typescript`, `tsx`, `vitest`, `@types/node` at exact versions (no `^`).
  - [ ] `server/tsconfig.json` has `experimentalDecorators: true` and `useDefineForClassFields: false`.
  - [ ] `npm install` (or `npm ci`) inside `server/` completes with exit 0.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `npx vitest run` → 2 test files pass (hello + schema-smoke).
  - [ ] `npm run dev` boots and logs `NerdiClash server listening on :2567` to stdout (kill after first line, no actual room defined).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Scaffold boots and type-checks clean
    Tool: Bash
    Preconditions: Empty `server/` dir, Node 20+ on PATH, working dir = repo root.
    Steps:
      1. `cd server && npm ci`
        Expected state: `node_modules/` populated; `package-lock.json` written.
      2. `npx tsc --noEmit`
        Expected state: stdout empty, exit code 0.
      3. `npx vitest run`
        Expected: "Test Files 2 passed (2)" including `hello.test.ts` and `schema-smoke.test.ts`, all green.
      4. `npm run dev` (background w/ 3s timeout) then capture first stdout line.
        Expected: exact string `NerdiClash server listening on :2567` printed once.
    Expected Result: All 4 steps green; server boots on :2567.
    Failure Indicators: tsc emits `error TS1274: Decorator metadata requires experimentalDecorators` OR `Cannot find name 'type'` for `@type()` — indicates tsconfig flags missing. vitest reports 0 test files — indicates wrong `include` glob.
    Evidence: .sisyphus/evidence/task-1-scaffold-boots.txt

  Scenario: Forgetting useDefineForClassFields:false breaks schema smoke
    Tool: Bash
    Preconditions: `server/` fully scaffolded; temporarily flip `useDefineForClassFields` to `true` in `tsconfig.json`.
    Steps:
      1. `npx tsc --noEmit` (may still pass — TS-level OK).
      2. `npx vitest run schema-smoke`
      3. Assertion: decoded instance `hp` field is `undefined` instead of `0` because the decorator ran against an already-defined field slot.
    Expected Result: Test FAILS with `AssertionError: expected undefined to be 0` — reproducing the documented Colyseus gotcha. Then revert the tsconfig flag; re-run → green.
    Evidence: .sisyphus/evidence/task-1-decorator-gotcha.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-1-scaffold-boots.txt` — `npm ci`, `tsc --noEmit`, `vitest run`, and `npm run dev` first-line captures (with exit codes).
  - [ ] `task-1-decorator-gotcha.txt` — output showing the failing case then the passing revert.
  - [ ] `task-1-tree.txt` — `npm ls --depth=0` showing exact resolved versions for the 9 pinned deps.

  **Commit**: YES (groups with all of Wave 1)
  - Message: `chore(server): scaffold Colyseus + TypeScript backend`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 2. Shared Types & Zod Message Contracts

  **What to do**:
  - Create `server/src/shared/types.ts` exporting:
    - Enums (use `const` string-union objects, NOT `enum` — better Zod interop): `CardType` (`'fcc' | 'number' | 'action'`), `DeckType` (`'fcc' | 'number' | 'action'`), `BaseDomain` (`'rational' | 'poly' | 'trig' | 'exp' | 'log'`), `Phase` (`'waiting' | 'draw' | 'play' | 'defense' | 'resolution' | 'game_over'`), `Rarity` (`'common' | 'rare' | 'epic' | 'legendary'`), `EffectType` (union of every effect kind: `'add_term' | 'derivative' | 'integral' | 'limit' | 'continuity' | 'modular' | 'prime' | 'nt_theorem' | 'vector' | 'matrix' | 'transform' | 'eigenvalue' | 'offensive' | 'shield' | 'trap' | 'martial_theorem' | 'artifact_theorem' | 'add_board' | 'composition' | 'force_eval' | 'eval'`).
    - Interfaces: `Card` (`id: string; name: string; type: CardType; deck: DeckType; subtype: string; rarity: Rarity; effectType: EffectType; effectParams: Record<string, unknown>; targetRules: TargetRules`), `TargetRules` (`scope: 'self' | 'opp' | 'self_board' | 'opp_board' | 'global'; requires: string[]`), `Board` (`id: string; ownerId: string; expression: string; domains: BaseDomain[]; compositionDepth: number; isolatedVarCount: number; integral: boolean`), `EffectPayload` (discriminated union tagged by `kind: EffectType`).
    - `WinReason` = `'hp_zero' | 'variable_isolation' | 'force_eval_domination' | 'singular_board' | 'undefined_integral_loss'`.
    - SERVER-side root state SHAPE types (plain TS interfaces — NOT `@colyseus/schema` classes; the Schema classes come in Wave 2. T2 defines the contract they'll implement): `PlayerState` (`id: string; hp: number; hand: Card[]; boards: Board[]; deckCounts: Record<DeckType, number>; variableCardsUsed: Set<number>`), `GameRoomState` (`phase: Phase; currentTurn: number; stalling_no_eval_turns: number; variable_isolation_timers: Record<string, number>; players: Record<string, PlayerState>; winnerId: string | null; winReason: WinReason | null`).
    - Add a docstring comment at top: `// CRITICAL CONSTRAINT: math.js Node objects NEVER live in Colyseus Schema. Board.expression is @type("string") only — server parses via math.parse(str) on demand. See drafts/nerdicard-backend.md:129-130.`
  - Create `server/src/shared/messages.ts` exporting:
    - Zod schemas for every client→server intent (all under a discriminated `ClientMessage` union keyed by `type`):
      - `build_function` `{ type: 'build_function', boardId?: string, expression: string, variableIds: number[], numberCardIds: string[] }` (expression is a plain STRING — enforced via `z.string().max(500)`; the schema NEVER carries a Node).
      - `play_card` `{ type: 'play_card', cardId: string, target?: { kind: TargetKind; id?: string }, numberFactorCardIds?: string[] }`.
      - `draw_cards` `{ type: 'draw_cards', deckChoices: Array<{ deck: DeckType; count: number }> }` — `count` total must equal 2 (server validates); Zod only validates shape here.
      - `set_trap` `{ type: 'set_trap', cardId: string, trigger: 'on_attack' | 'on_eval' | 'on_force_eval' }`.
      - `eval_function` `{ type: 'eval_function', boardId: string, evalPoint?: { variable: string; value: number } }`.
      - `force_eval` `{ type: 'force_eval', boardIds: string[] }` — initiator's own board only in `boardIds[0]`.
      - `end_turn` `{ type: 'end_turn' }`.
      - `reconnect` `{ type: 'reconnect', sessionId: string }`.
      - `leave` `{ type: 'leave' }`.
    - Also export `ServerMessage` discriminated union (server→client): `'state_snapshot' | 'phase_change' | 'card_drawn' | 'board_built' | 'eval_result' | 'trap_triggered' | 'game_over' | 'error'`. For each, define a Zod schema and a TS type, with the `error` schema carrying `{ code: string; message: string; retryable: boolean }`.
    - Export a helper `parseClientMessage(raw: unknown): { ok: true; message: ClientMessage } | { ok: false; error: ZodError }` using `ClientMessage.safeParse(raw)`.
  - Create `server/src/__tests__/messages.test.ts` covering:
    - Valid `build_function` with string expression parses ok; an object-typed `expression` (simulating a leaked Node) is REJECTED by Zod — assert the error path is `['expression']`.
    - Valid `draw_cards` with two deck entries totaling too few (e.g. one entry count=1) is still SHAPE-VALID at the Zod layer (server logic enforces total=2 in Wave 2) — documents the layering.
    - `parseClientMessage` returns a structured error for an unknown `type` discriminator.
  - Create `server/src/__tests__/types.test.ts` covering:
    - `GameRoomState` requires `stalling_no_eval_turns` and `variable_isolation_timers` fields (compile-time + runtime via a Zod mirror — `z.object({ stalling_no_eval_turns: z.number().int().min(0).max(20), variable_isolation_timers: z.record(z.string(), z.number().int()) })`).
    - A `Board` instance with `expression: "x^2 + 3*x"` is type-valid; attempting to assign `expression: math.parse("x^2")` is a TS type error (the test is a `@ts-expect-error` assertion proving strings-only at the type layer).

  **Must NOT do**:
  - Do NOT import `math.js` anywhere in `types.ts` or `messages.ts` — types must remain Colt-runtime independent and trivially tree-shakeable to the client later. (Strings-only invariant.)
  - Do NOT define any Colyseus `Schema` class here — T2 produces plain contracts; Wave 2 wires `@type()` Schema classes against these contracts.
  - Do NOT put game-rule validation logic in Zod (e.g. "expression must parse" or "turn总数=2") — Zod only validates wire shape. Rule validation is server-side in Wave 2.
  - Do NOT use TypeScript `enum` (use string-literal unions + `as const` objects) — `enum` doesn't interop with Zod's `z.enum()` cleanly and emits runtime code that can drift from the union.
  - Do NOT bake in `stalling_no_eval_turns` upper-bound logic beyond the type — actual increment/reset happens in Wave 2 room logic. T2 only declares the field and its bounds (0..20).

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two files of pure type/schema declarations + assertions; no runtime behavior; deterministic from the draft spec.
  - **Skills**: [`git-master`]
    - `git-master`: groups with Wave 1 commit.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no UI.
    - `review-work`: no implementation to review yet.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Tasks in Wave 2+ that import shared types (room schema, handlers, card catalog resolver).
  - **Blocked By**: None — depends only on knowing the rules (already in the draft).

  **References**:
  **Pattern References**:
  - `.sisyphus/drafts/nerdicard-backend.md:129-133` — the 4 critical user-locked constraints: (1) string-only expressions in Schema, (3) `stalling_no_eval_turns: number` (0..20), (4) `variable_isolation_timers: MapSchema<number>`.
  - `NerdiCard.txt` — turn phases (Draw/Play/Defense/Resolution), victory conditions, card effect categories — drives the `Phase`, `EffectType`, `WinReason` unions.
  **API/Type References**:
  - Zod discriminated unions: `z.discriminatedUnion('type', [...])` for `ClientMessage`.
  - `z.record(z.string(), z.number())` for `variable_isolation_timers` mirror (the runtime mirror of `MapSchema<number>`).
  **Test References**:
  - `@ts-expect-error` pattern to prove the strings-only invariant at compile time (TS 5.x supported).
  **External References**:
  - https://docs.colyseus.io/colyseus/server/schema/ — `MapSchema` keys must be strings (confirms `variable_isolation_timers` key shape); `@type("string")` is the only legal expression carrier.
  - https://zod.dev/api — discriminated unions + `safeParse` return shape.
  **WHY Each Reference Matters**:
  - The 4 critical constraints are the user-locked architecture. Encoding them in T2 means later waves can't silently violate them via drift — `stalling_no_eval_turns` becomes a compile-checked field, not a magic number buried in room logic.
  - Strings-only enforced at the TYPE layer (`@ts-expect-error` on a Node assignment) catches the #1 Colyseus serialization bug before any runtime code exists.

  **Acceptance Criteria**:
  **If TDD (tests enabled)**: N/A — these ARE type/schema guard tests, the closest Wave 1 gets to TDD. Keep them; they're contracts, not features.
  - [ ] `server/src/shared/types.ts` exports all enums-as-const-objects and interfaces listed above; compiles under `tsc --noEmit`.
  - [ ] `server/src/shared/messages.ts` exports Zod schemas for all 9 client intents + 8 server message kinds + `parseClientMessage` helper.
  - [ ] `GameRoomState` interface includes `stalling_no_eval_turns: number` and `variable_isolation_timers: Record<string, number>`.
  - [ ] No file in `src/shared/` imports `math.js` (grep returns zero hits).
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `npx vitest run shared` → all type/message contract tests pass (3 test files).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Valid build_function intent with string expression parses
    Tool: Bash
    Preconditions: T1 scaffold complete; T2 files written; working dir = server/.
    Steps:
      1. `npx vitest run shared/messages`
      2. Assert test "build_function accepts string expression" parses the payload `{ type:'build_function', expression:'x^2+3*x', variableIds:[1,2], numberCardIds:[] }` and `parseClientMessage` returns `{ ok: true, message.type: 'build_function' }`.
      3. Assert test "build_function rejects non-string expression" feeding `{ type:'build_function', expression:{}, variableIds:[], numberCardIds:[] }` returns `ok:false` with `error.issues[0].path[0] === 'expression'`.
    Expected Result: Both assertions green; the strings-only invariant is enforced at the Zod boundary.
    Failure Indicators: `ok:true` returned for the `{}` expression — means `.string()` was dropped, leaking the strings-only contract.
    Evidence: .sisyphus/evidence/task-2-message-contracts.txt

  Scenario: Stalling and isolation counters present in contract
    Tool: Bash
    Preconditions: T2 complete; T1 scaffold present.
    Steps:
      1. `npx vitest run shared/types`
      2. Assert test "GameRoomState exposes stalling_no_eval_turns" compiles AND the runtime Zod mirror `RoomStateSchema.parse({ ...stalling_no_eval_turns: 25 })` throws because 25 > 20.
      3. Assert a missing `variable_isolation_timers` field fails the mirror parse with path `['variable_isolation_timers']`.
    Expected Result: Both bounds/presence checks fire — proving the 4 critical constraints are encoded at the contract layer.
    Failure Indicators: `stalling_no_eval_turns: 25` parses OK — means the 0..20 bound isn't on the mirror; a future room bug could overflow the counter silently.
    Evidence: .sisyphus/evidence/task-2-critical-constraints.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-2-message-contracts.txt` — vitest output for the messages test file.
  - [ ] `task-2-critical-constraints.txt` — vitest output for the types test file, showing the 4 constraints (string-only, stalling 0..20, isolation timers required) enforced.
  - [ ] `task-2-no-mathjs-import.txt` — `grep -r "math.js\|mathjs\|import.*math" server/src/shared/` returning zero matches.

  **Commit**: YES (groups with all of Wave 1)
  - Message: `feat(server): shared type contracts + Zod message schemas`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 3. Frozen Card Catalog v1 (Minimal Starter ~25 Cards)

  **What to do**:
  - Create `server/src/data/card-catalog.json` containing EXACTLY the 25 cards below (one card per archetype, plus the full prime + irrational Number-card set). Top of file MUST be a JSON-friendly note (use a sibling `card-catalog.README.md`? NO — instead put the FROZEN comment inside each section's first-card `_comment` field, since JSON has no comments). Preferred approach: ship a sibling `server/src/data/card-catalog.schema.json` (JSON Schema for self-validation) and prefix the catalog with a `"_comment": "FROZEN for v1 — no additions during implementation. See drafts/nerdicard-backend.md:104-105."` field on the root object.
  - Each card object shape (matches `Card` interface from T2): `{ id, name, type, deck, subtype, rarity, effectType, effectParams, targetRules }`. `id` is a stable string like `fcc-add-term-001`, `act-offensive-001`, `num-prime-2`.
  - The 25 cards (this is the WHOLE catalog — do not add more):
    - **FCC deck (10) — one per FCC archetype**:
      1. `fcc-add-term-001` "Term Surge" — Add Term — effectParams `{ costExpression: 't' }` — adds a free term to current board expression.
      2. `fcc-calc-derivative-001` "Flux Delta" — Calculus/Derivative — effectParams `{ op: 'derivative', var: '?' }` (var picked at play).
      3. `fcc-calc-integral-001` "Anti-Flux" — Calculus/Integral — effectParams `{ op: 'integral', var: '?' }` — engine capability YELLOW (SymPy stub returns {supported:false} in v1; playing this card surfaces a graceful "not implemented in v1" message).
      4. `fcc-calc-limit-001` "Limit Break" — Calculus/Limit — effectParams `{ op: 'limit', approach: '0' }` — YELLOW (stub).
      5. `fcc-nt-modular-001` "Mod Cage" — Number Theory/Modular — effectParams `{ op: 'mod', modulus: 7 }`.
      6. `fcc-nt-theorem-001` "Fermat Echo" — Number Theory/Theorem — effectParams `{ op: 'nt_theorem', theorem: 'fermat_little' }` — passive mod-reduction effect.
      7. `fcc-la-vector-001` "Vector Shift" — Linear Algebra/Vector — effectParams `{ op: 'vector', dim: 2, values: [1,0] }`.
      8. `fcc-la-matrix-001` "Matrix Weave" — Linear Algebra/Matrix — effectParams `{ op: 'matrix', rows: 2, cols: 2, values: [[1,0],[0,1]] }` — the matrix expression is stored as a flat string per Colyseus no-multi-dim-arrays rule (draft:112); keep it `"matrix([1,0],[0,1])"` in `effectParams.expr`.
      9. `fcc-la-transform-001` "Transform Lens" — Linear Algebra/Transform — effectParams `{ op: 'transform', kind: 'lup' }`.
      10. `fcc-la-eigenvalue-001` "Eigen Lance" — Linear Algebra/Eigenvalue — effectParams `{ op: 'eigs' }` — YELLOW (math.js eigs fail on defective matrices — engine returns partial result + warning).
    - **Action deck (9) — one per Action archetype**:
      11. `act-offensive-001` "Power Spike" — Offensive — effectParams `{ damage: 5, scaleWithBoardValue: true }` — targetRules `{ scope: 'opp' }`. Max 1 offensive/turn invariant is enforced by room logic, NOT here.
      12. `act-shield-001` "Aegis Guard" — Defense/Shield — effectParams `{ absorb: 10, expiresNextTurn: true }` — targetRules `{ scope: 'self' }`. Per draft rule (line 53): number cards factor-bind to offensive/shield until graveyard; `effectParams.factorSlot: 'number'`.
      13. `act-trap-001` "Snarecoded" — Trap — effectParams `{ trigger: 'on_eval', counterOp: 'force_eval_back' }` — targetRules `{ scope: 'self' }` (set during play).
      14. `act-martial-theorem-001` "Pythagoras Strike" — Martial Theorem (offensive) — effectParams `{ damage: 8, requires: ['right_triangle_board'] }` — targetRules `{ scope: 'opp' }`.
      15. `act-artifact-theorem-001` "Euler's Ward" — Artifact Theorem (passive) — effectParams `{ id: 'euler_identity', persistent: true }` — targetRules `{ scope: 'self' }`.
      16. `act-special-add-board-001` "Second Foundation" — Special/Add Board — effectParams `{ grantBoard: true }` — increases player's board count up to 3 (draft:31).
      17. `act-special-composition-001` "Nested Chaos" — Special/Composition — effectParams `{ composeWithBoardId: null, depth: 2 }` — cross-domain composition depth ≤2 invariant enforced by room logic (draft:62).
      18. `act-special-force-eval-001` "Showdown" — Special/Force Evaluation — effectParams `{ requiresStallingTurn: 20 | 5 }` (the card may be played manually OR surfaced by the stalling_no_eval_turns counter hitting 5/20). Per draft lines 64-65.
      19. `act-eval-001` "Evaluate" — Eval — effectParams `{ hpFormula: 'floor(value*complexity/10)' }` — wraps the HP Gain formula; the actual value/complexity computation happens via T9's AST walker (Wave 2) — catalog only declares the formula reference.
    - **Number deck (6) — full prime set + 3 signature irrationals**:
      20. `num-prime-2` — "Two" — `effectType: 'prime_factor'`, effectParams `{ value: 2, isPrime: true }`.
      21. `num-prime-3` — "Three" — `effectParams { value: 3, isPrime: true }`.
      22. `num-prime-5` — "Five" — `effectParams { value: 5, isPrime: true }`.
      23. `num-irrational-pi` — "Pi" — `effectParams { value: 'pi', symbolic: true }` (stored symbolic — engine evaluates to math.PI).
      24. `num-irrational-e` — "Euler's Number" — `effectParams { value: 'e', symbolic: true }`.
      25. `num-irrational-phi` — "Golden Ratio" — `effectParams { value: 'phi', symbolic: true }`.
  - Create `server/src/data/card-catalog.schema.json` — JSON Schema validating the catalog shape (id pattern, deck∈FCC/Number/Action, effectType ∈ the `EffectType` union from T2, etc.).
  - Create `server/src/data/load-catalog.ts` exporting `loadCatalog(): Card[]` that reads the JSON, validates against the JSON Schema with `ajv` (add `ajv@8.17.0` + `ajv-formats` to package.json), and throws on any schema violation. Also exports `getCardById(id: string): Card` and `getCardsByArchetype(effectType: EffectType): Card[]`.
  - Create `server/src/__tests__/catalog.test.ts` covering:
    - Exactly 25 cards load; `getCardById('act-shield-001').name === 'Aegis Guard'`.
    - `getCardsByArchetype('integral')` returns 1 card (Anti-Flux) and that card's `effectType === 'integral'`.
    - Loading a tampered catalog (mutate one card to remove `id`) throws an `Ajv` validation error with `errors[0].instancePath === '/0/id'` (simulate by loading a fixture).
    - Assert root `_comment` contains the literal string `"FROZEN for v1"`.
    - Assert every `EffectType` enum value from T2 has ≥1 card in the catalog (loop union and `getCardsByArchetype`).

  **Must NOT do**:
  - Do NOT add more than 25 cards. This is the FROZEN v1 set — adding "just one more" defeats the minimal-to-playable goal. New cards come post-MVP.
  - Do NOT bake card effect logic into the catalog — `effectParams` declares data only; actual effect resolution is Wave 2's `@colyseus/command` handlers + the math engine.
  - Do NOT store matrix values as nested arrays in a way that would later leak into a Colyseus Schema (no multi-dim arrays — draft:112). Store matrices as the math.js string form `"matrix([1,0],[0,1])"` in `effectParams.expr` — the engine parses it server-side and NEVER serializes the matrix to the client as a 2D array.
  - Do NOT use TypeScript `enum` for `deck`/`effectType` — mirror the string unions from T2 (`'fcc' | 'number' | 'action'` etc.).
  - Do NOT remove the `_comment` FROZEN marker — it's the human-readable lock. Wave 2+ tasks must read it and refuse to extend without escalating the plan.

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: A JSON file + a tiny loader. The cognitive work (card selection per archetype) is already done above; the agent just transcribes.
  - **Skills**: [`git-master`]
    - `git-master`: groups with Wave 1 commit; the FROZEN marker means any later edit shows up cleanly in `git blame`.
  - **Skills Evaluated but Omitted**:
    - `ai-slop-remover`: no code yet.
    - `playwright`: no UI.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Wave 2 card-effect resolver, deck builder, and any handler that looks up cards by id/type.
  - **Blocked By**: T2 (for the `Card`/`EffectType` types it imports) — can still write the JSON file in parallel since T2 contracts are pre-specified; only the loader's TS imports need T2 present at compile time. Practically: start now, finish the loader after T2 lands.

  **References**:
  **Pattern References**:
  - `NerdiCard.txt` — "Card Types" / "Action Deck" sections listing the archetypes the catalog must cover (drives the "≥1 per archetype" rule).
  - `.sisyphus/drafts/nerdicard-backend.md:50-54` — the canonical archetype list (FCC domains × subtypes, Action categories, Number card bindings).
  - `.sisyphus/drafts/nerdicard-backend.md:104-105` — minimal starter set decision (~20–30 cards spanning every archetype).
  - `.sisyphus/drafts/nerdicard-backend.md:62` — composition depth ≤2 invariant the composition card's room logic will enforce.
  - `.sisyphus/drafts/nerdicard-backend.md:112` — Colyseus no-multi-dim arrays rule (drives `effectParams.expr` string-as-matrix choice).
  **API/Type References**:
  - T2's `Card` interface and `EffectType` string union — the catalog entries must match this shape verbatim.
  - `ajv` JSON Schema validation API: `new Ajv({ allErrors: true }).compile(schema)`.
  **Test References**:
  - vitest fixture loading pattern: `import catalogFixture from './__fixtures__/catalog-tampered.json' with { type: 'json' }` (ESM JSON imports in NodeNext).
  **External References**:
  - https://docs.colyseus.io/colyseus/server/schema/ — confirms no multi-dim arrays, MapSchema key-as-string constraint.
  - https://ajv.js.org/guide/getting-started.html — `Ajv` compile + validate error shape.
  **WHY Each Reference Matters**:
  - One-card-per-archetype is the user's explicit minimal scope; missing one means a future wave can't test that effect type. The loaders' archetype-coverage test makes this a hard CI gate.
  - Matrix-as-string is a direct mitigation of the Colyseus 2D-array limit; doing it now prevents a Wave 2 refactor when the first matrix card serializes.

  **Acceptance Criteria**:
  **If TDD (tests enabled)**: N/A (tests-after) — but the catalog coverage tests act as a permanent archetype-lock guard.
  - [ ] `server/src/data/card-catalog.json` exists with exactly 25 card objects + a root `_comment` containing `FROZEN for v1`.
  - [ ] `server/src/data/card-catalog.schema.json` exists and `loadCatalog()` validates every card against it.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `npx vitest run catalog` → all catalog tests pass, including the archetype-coverage loop (every `EffectType` from T2 has ≥1 card).
  - [ ] No card object stores a 2D JS array in any field that would later serialize into a Colyseus Schema (matrix size >1 cards store strings only).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: All 25 cards load and cover every archetype
    Tool: Bash
    Preconditions: T1 + T2 complete; T3 files written; working dir = server/.
    Steps:
      1. `npx vitest run catalog` — assert "Test Files 1 passed".
      2. Assert test "All EffectType archetypes covered" iterates the `EffectType` union and finds `getCardsByArchetype(t).length >= 1` for all 21 values.
      3. Assert "Card count is exactly 25" passes — `loadCatalog().length === 25`.
    Expected Result: All green; catalog contains exactly 25 cards with no archetype gaps.
    Failure Indicators: A thrown `MissingArchetypeError: no card for effectType 'integral'` — means a stub card was dropped, breaking v1 minimal coverage.
    Evidence: .sisyphus/evidence/task-3-catalog-coverage.txt

  Scenario: Tampered catalog rejected at load
    Tool: Bash
    Preconditions: T3 loader + a `__fixtures__/catalog-missing-id.json` test fixture (24 cards, one with `id` removed).
    Steps:
      1. `npx vitest run catalog` — assert test "loadCatalog rejects malformed JSON" loads the fixture and expects a throw.
      2. Inspect thrown error: `err.errors[0].instancePath === '/cards/0/id'` and `err.errors[0].keyword === 'required'`.
    Expected Result: Test passes — the loader is the single source of truth and rejects drift before any Wave 2 code can ship a bad card.
    Failure Indicators: Loader returns the malformed catalog without throwing — `ajv` is wired wrong (likely `allErrors:false` or no `validate()` call).
    Evidence: .sisyphus/evidence/task-3-catalog-validation.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-3-catalog-coverage.txt` — full vitest output for the catalog test file + a `cat` of `node -e "console.log(require('./src/data/load-catalog').default().length)"` style check showing 25.
  - [ ] `task-3-catalog-validation.txt` — vitest output for the tampered-catalog test, including the AJV error path.
  - [ ] `task-3-frozen-marker.txt` — `grep "FROZEN for v1" server/src/data/card-catalog.json` returning the root `_comment` line.

  **Commit**: YES (groups with all of Wave 1)
  - Message: `feat(server): frozen v1 card catalog (25 cards, all archetypes)`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 4. Math Engine Abstraction + math.js Impl + SymPy Stubs + Capability Matrix

  **What to do**:
  - Add exact-pinned deps to `server/package.json` (T1 owns the file, T4 adds): `math.js@14.4.2` exact (no caret). `ajv@8.17.0` is owned by T3; T4 doesn't touch it.
  - Create `server/src/math/engine.ts` exporting `interface MathEngine` with methods (all take/return STRINGS or plain JSON values — NEVER math.js `Node` objects across the API boundary):
    - `parse(expr: string): EngineNode` (EngineNode is an opaque `{ _tag: 'EngineNode' }` handle — internally a `math.Node`, but the return type is opaque so callers can't leak it into Colyseus Schema).
    - `toString(node: EngineNode): string`
    - `evaluate(expr: string, scope: Record<string, number|EngineNode>): number | EngineNode`
    - `derivative(expr: string, variable: string): string` (returns string — reparsed by room if needed; keeps the strings-only invariant).
    - `simplify(expr: string): string`
    - `rationalize(expr: string): string`
    - `symbolicEqual(a: string, b: string): boolean`
    - `integrate(expr: string, variable: string): EngineResult` — STUB
    - `limit(expr: string, variable: string, approach: number | string): EngineResult` — STUB
    - `continuityCheck(expr: string, variable: string, point: number): EngineResult` — STUB
    - `rref(matrix: string): EngineResult` — STUB
    - `rank(matrix: string): EngineResult` — STUB
    - `det(matrix: string): number`
    - `inv(matrix: string): string`
    - `lup(matrix: string): { L: string; U: string; P: string }`
    - `qr(matrix: string): { Q: string; R: string }`
    - `svd(matrix: string): { U: string; S: string; V: string }`
    - `eigs(matrix: string): EngineResult` (partial — returns `{ ok: true, values: number[], partial: true }` or stub on defective matrices)
    - `expm(matrix: string): string`
    - `sqrtm(matrix: string): string`
    - `lusolve(matrix: string, b: string): string`
    - `gcd(a: number, b: number): number`
    - `lcm(a: number, b: number): number`
    - `mod(a: number, b: number): number`
    - `invmod(a: number, m: number): number`
    - `isPrime(n: number): boolean`
    - `polynomialRoot(...coeffs: number[]): number[]`
    - `complex(re: number, im: number): EngineNode`
    - `complexToString(node: EngineNode): string`
  - Define `EngineResult = { ok: boolean; supported: boolean; reason?: string; value?: unknown }` — stubs return `{ ok: false, supported: false, reason: 'Not implemented in v1' }`; partial matrix eigs return `{ ok: true, supported: true, partial: true, value: [...] }`.
  - Create `server/src/math/mathjs-engine.ts` exporting `const mathjsEngine: MathEngine` implementing every interface method using `mathjs@14.4.2` APIs. CRITICAL: `parse()` returns an opaque handle wrapping `math.parse(str)`; no method leaks that handle into Colyseus-facing code. Strings ONLY cross the boundary. For matrix methods, IN/OUT is the math.js string form `"matrix([1,0],[0,1])"`.
  - Create `server/src/math/stubs.ts` exporting constants `INTEGRATE_STUB`, `LIMIT_STUB`, `CONTINUITY_STUB`, `RREF_STUB`, `RANK_STUB` of type `EngineResult` with `{ supported: false, ok: false, reason: 'Not implemented in v1 — SymPy microservice arrives in Wave 3' }`. `mathjsEngine.integrate/limit/etc` import and return these stubs.
  - Create `server/src/math/capability-matrix.md` hand-written grid (markdown table, NOT auto-generated) — one row per `MathEngine` method:
    - Columns: `Method | Implemented By | Status | Notes`
    - Status values: `GREEN` (fully working math.js), `YELLOW` (partial — e.g. `eigs` fails on defective matrices), `RED` (stub — returns `supported:false`).
    - Example rows: `derivative | math.js | GREEN | math.derivative(expr,var)`, `integrate | stub | RED | SymPy Wave 3`, `eigs | math.js | YELLOW | fails on defective matrices; partial flag set`, `rref | stub | RED | could be custom-TS later; defer to SymPy`.
    - Top of file: `# Math Engine Capability Matrix — v1. FROZEN scope: math.js GREEN/YELLOW + SymPy stubs RED. Do not extend without plan revision.`
  - Create `server/src/__tests__/math-engine.test.ts` covering:
    - `mathjsEngine.derivative('x^2', 'x') === '2 * x'` (or simplified form — assert via `symbolicEqual`).
    - `mathjsEngine.det('matrix([1,2],[3,4])') === -2`.
    - `mathjsEngine.eigs('matrix([4,0],[0,1])')` returns `{ ok: true, supported: true, partial: false, value: [4, 1] }` (order-independent — sort before asserting).
    - `mathjsEngine.integrate('x^2', 'x')` returns `{ ok: false, supported: false, reason: /Not implemented in v1/ }`.
    - `mathjsEngine.limit('1/x', 'x', 0)` returns the stub — confirms limit is RED in v1.
    - Round-trip strings-only: `mathjsEngine.toString(mathjsEngine.parse('x^2 + 3*x')) === 'x ^ 2 + 3 * x'` (or equivalent after simplify).
    - NO-return-leak test: the return type of `parse` is `EngineNode` which is structurally opaque — `@ts-expect-error` on assigning it to a `string` field compiles cleanly (proves the opaque tag blocks Schema leaks at the type layer).

  **Must NOT do**:
  - Do NOT expose `math.js` `Node` type across the `MathEngine` interface boundary — wrap in `EngineNode` opaque. Any handler importing `mathjsEngine` and assigning a returned value to a Colyseus Schema string must hit a TS error. (Strings-only invariant.)
  - Do NOT implement the stubbed methods (integrate/limit/continuity/rref/rank) — they're explicitly SymPy Wave 3 work; implementing them now violates the "fastest path to playable" decision (draft:103).
  - Do NOT call out to any Python process or HTTP service — SymPy integration is deferred; stubs are pure TS returns.
  - Do NOT use `math.evaluate(string)` for building functions (security: arbitrary-string eval). Always go through `math.parse` → `node.compile()` → `node.evaluate(scope)`; the engine is the only place that boundary is allowed.
  - Do NOT change the `math.js` version — pinning at `14.4.2` exact (per T1's pin rules).
  - Do NOT auto-generate the capability matrix from a script — hand-write it so the GREEN/YELLOW/RED classification reflects the research findings in `.sisyphus/drafts/nerdicard-backend.md:77-100`.

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 25+ interface methods to implement against math.js, plus the type-opaque wrapper design and the capability matrix writeup. Math engine design has subtle correctness implications (round-trip stability, sandbox setup).
  - **Skills**: [`git-master`]
    - `git-master`: groups with Wave 1 commit.
  - **Skills Evaluated but Omitted**:
    - `review-work`: no production logic yet; engine is library code.
    - `ai-slop-remover`: minimal surface area; review in Wave 4 when the engine is exercised by handlers.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Wave 2 card-effect handlers (derivative/eval/etc.), Wave 2's T9 Complexity Score AST Walker (imports `MathEngine.parse`).
  - **Blocked By**: T1 (for `package.json`/`tsconfig.json` to exist before `npm install math.js`). The interface design in `engine.ts` is independent and can start in parallel; the mathjs impl needs T1's lockfile.

  **References**:
  **Pattern References**:
  - `.sisyphus/drafts/nerdicard-backend.md:77-100` — the authoritative list of math.js-supported vs. unsupported ops; drives which methods are GREEN vs RED.
  - `.sisyphus/drafts/nerdicard-backend.md:96-100` — recommended architecture: math engine abstraction layer so SymPy can swap in later.
  - `.sisyphus/drafts/nerdicard-backend.md:129-130` — strings-only invariant; foundation for the `EngineNode` opaque wrapper.
  **API/Type References**:
  - math.js API surface confirmed in research (draft:79-94): `math.parse`, `math.derivative`, `math.simplify`, `math.rationalize`, `math.symbolicEqual` (note: actual export is `math.simplify` + `mathjs.symbolicEqual` util — verify exact import path during impl), `math.det`, `math.inv`, `math.lup`, `math.qr`, `math.schur`, `math.svd`, `math.eigs`, `math.expm`, `math.sqrtm`, `math.lusolve`, `math.gcd`, `math.lcm`, `math.xgcd`, `math.mod`, `math.invmod`, `math.isPrime`, `math.polynomialRoot`, `math.Complex`.
  - TS opaque-type pattern: `type EngineNode = { readonly _tag: 'EngineNode'; readonly _node: math.Node }` with the `_node` field hidden behind a brand.
  **Test References**:
  - vitest async-sync mixed tests OK (engine methods are sync).
  - Use `math.simplify` + string compare (not exact substring) for derivative assertions — math.js output strings vary.
  **External References**:
  - https://mathjs.org/docs/reference/functions/derivative.html — `math.derivative(expr, varName)` exact signature + return shape.
  - https://mathjs.org/docs/reference/functions/matrix.html — `matrix([1,2],[3,4])` string form accepted by `math.parse`.
  - https://mathjs.org/docs/reference/functions/det.html — confirms `math.det` works on math.js Matrix objects.
  **WHY Each Reference Matters**:
  - The research findings already enumerate the GREEN/YELLOW/RED split; using them as the spec makes the capability matrix a faithful reflection of empirical math.js behavior, not a guess.
  - The `EngineNode` opacity is the compile-time enforcement of the strings-only invariant — without it, a Wave 2 handler can silently push a `Node` into a Schema string slot and rack up a serialization bug at runtime.

  **Acceptance Criteria**:
  **If TDD (tests enabled)**: N/A (tests-after) — but the engine tests are contract guards (GREEN ops behave, RED ops stub reliably).
  - [ ] `server/src/math/engine.ts` exports `MathEngine` interface + `EngineResult` type + opaque `EngineNode`.
  - [ ] `server/src/math/mathjs-engine.ts` implements every interface method; stubbed methods return the constants from `stubs.ts`.
  - [ ] `server/src/math/stubs.ts` exports the 5 named stubs with `reason` matching `/Not implemented in v1/`.
  - [ ] `server/src/math/capability-matrix.md` has a row for every interface method, marked GREEN/YELLOW/RED per the research findings.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `npx vitest run math-engine` → all 7 core engine tests pass (derivative, det, eigs-success, integrate-stub, limit-stub, round-trip, opaque-leak).
  - [ ] Project-wide grep: `grep -r "mathjs" server/src/shared server/src/data` returns zero — math.js is confined to `server/src/math/`.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: GREEN ops compute correctly; RED ops stub cleanly
    Tool: Bash
    Preconditions: T1 scaffold + T4 files written; `npm ci` already run (math.js resolved at 14.4.2 exact).
    Steps:
      1. `npx vitest run math-engine` — assert "Test Files 1 passed".
      2. Assert `det('matrix([1,2],[3,4])') === -2` passes.
      3. Assert `eigs('matrix([4,0],[0,1])')` passes with sorted `[1, 4]` (order-independent).
      4. Assert `integrate('x^2','x')` test passes with reason matching `/Not implemented in v1/`.
      5. Assert `limit('1/x','x',0)` test passes — same stub shape.
    Expected Result: 5 key assertions green; matrix and calculus stubs behave per spec.
    Failure Indicators: `det` returns `2` instead of `-2` — math.js was loaded with a wrong/unstable version (check exact pin). `integrate` returning `{ ok: true }` — someone implemented the stub, violating the Wave 3 plan.
    Evidence: .sisyphus/evidence/task-4-engine-green-red.txt

  Scenario: Strings-only invariant enforced at type layer
    Tool: Bash
    Preconditions: T4 complete.
    Steps:
      1. `npx vitest run math-engine` — assert the "opaque EngineNode blocks string assignment" test compiles cleanly with `@ts-expect-error` on `const s: string = parse('x')`.
      2. `grep -rn "import.*math\b\|from 'mathjs'\|from 'math.js'" server/src/shared server/src/data server/src/__tests__/catalog*` — assert zero matches OUTSIDE `server/src/math/`.
      3. Spot-check: `grep -rn "\bNode\b" server/src/math/engine.ts` returns matches only inside JSDoc, not as a method parameter/return type.
    Expected Result: Both grep sub-assertions confirm zero leakage; the opaque `EngineNode` wrapper blocks any handler from inadvertently carrying a `math.Node` into Colyseus state (critical constraint #1).
    Failure Indicators: A return type of `math.Node` (not `EngineNode`) on any method — the opaque wrapper was bypassed, and a Schema string slot could receive a live Node.
    Evidence: .sisyphus/evidence/task-4-strings-only.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-4-engine-green-red.txt` — vitest output for math-engine tests.
  - [ ] `task-4-strings-only.txt` — the two grep commands + opaque-wrapper test output.
  - [ ] `task-4-capability-matrix.txt` — full contents of `capability-matrix.md` (cat-like dump as evidence the matrix matches the GREEN/YELLOW/RED spec).

  **Commit**: YES (groups with all of Wave 1)
  - Message: `feat(server): math engine abstraction + math.js impl + SymPy stubs`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 5. Godot Project Scaffolding + Colyseus Godot SDK Setup (Verify under 4.7; Fallback Raw WebSocket+JSON)

  **What to do**:
  - KEEP the existing Godot project at repo root (`project.godot`, `game.gd` already present per draft:16) — do NOT recreate or reinit it.
  - Create `godot/scripts/ColyseusConnection.gd` (GDScript in the existing project) that:
    - Extends `Node`, `class_name ColyseusConnection`.
    - `@export var endpoint: String = "ws://127.0.0.1:2567"` and `@export var room_name: String = "nerdiclash"`.
    - `_ready()` instantiates the Colyseus Godot SDK Client (Jacob Williams / `colyseus-godot` repo, see external refs). Try `Colyseus.Client.new(endpoint)`.
    - `func join_room(name: String) -> int` — joins, returns `OK` on success or `ERR_CANT_CONNECT` and stores the SDK error on `_last_sdk_error`.
    - `func send_intent(intent: Dictionary) -> void` — wraps `room.send(intent)`; serializes the Dictionary via Godot's built-in JSON (Variant→`JSON.stringify`).
    - `_on_state_change(patch: Dictionary)` — prints patch for now; minimal "dumb/blind" client renders state patches only (draft:8).
  - Attempt to install the Colyseus Godot SDK:
    - Try the asset-library entry first (`AssetLib` in Godot editor for `colyseus`).
    - If absent/broken, clone `https://github.com/colyseus/colyseus-godot` into `godot/addons/colyseus_godot/`.
    - Verify the SDK exports `class_name Colyseus` and `class_name ColyseusRoom` — assert against the editor `--headless --check-only` script parse pass.
  - Create `godot/scripts/raw-ws-client.gd` as the documented FALLBACK path (do NOT delete it even if SDK works — keep it as the contract reference for raw-mode):
    - Extends `Node`, uses Godot 4's `WebSocketPeer` (`var peer := WebSocketPeer.new()`).
    - `func connect_to(url: String) -> int` — `peer.connect_to_url(url)`; poll each `_process` via `peer.poll()`; inspect `peer.get_ready_state()`.
    - `func send_json(msg: Dictionary) -> void` — `peer.send_text(JSON.stringify(msg))`.
    - `func _on_packet()` — reads `peer.get_packet()`, `JSON.parse_string(...)` → Dictionary, emits `state_received(dict)` signal.
    - Tightly mirrors the Colyseus wire protocol schema (msgpack-list-prefixed message types) ONLY loosely — this fallback speaks raw JSON state patches and is intentionally simpler than the real SDK; document this in a top-of-file comment block: `## FALLBACK raw websocket client. The official colyseus-godot SDK uses msgpack and room protocol; this fallback speaks simplified JSON-encoded state patches and is intended ONLY if the SDK proves broken under Godot 4.7+ during T5 verification. Server-side Colyseus still speaks its native protocol — fallback would require a server-side JSON bridge (Wave 2 app.config additions).`
  - Verify under Godot 4.7 specifically:
    - `godot --headless --version` — capture the exact version string. If 4.7 isn't the local install, document the gap in `godot/scripts/colyseus-verify.md` (small targeted doc-per-task — allowed since it's a verification artifact, NOT general docs).
    - `godot --headless --check-only --script scripts/ColyseusConnection.gd` — asserts the script parses with SDK symbols resolved. If it fails with "class Colyseus not found", flip to fallback mode and document.
  - Create `godot/scripts/colyseus-verify.md` — single page documenting:
    - Exact Godot version tested.
    - SDK source (asset library vs git clone) + commit SHA.
    - Pass/fail of `--check-only` on `ColyseusConnection.gd`.
    - If fail: explicit fallback decision + pointer to `raw-ws-client.gd` + note about server-side JSON-bridge work needed in Wave 2 app.config.
    - Risk rating: `SDK-WORKING` or `SDK-BROKEN-FALLBACK` (binary, near top of file).

  **Must NOT do**:
  - Do NOT modify the existing `project.godot` or `game.gd` (those are user-owned; T5 only ADDS scripts).
  - Do NOT implement game rendering/UI — Phase is "minimal UI later" (draft:24); T5 only proves connectivity.
  - Do NOT couple the fallback `raw-ws-client.gd` to the SDK's msgpack protocol — fallback is JSON-only and intentionally divergent; the server-side story is documented, not implemented in T5.
  - Do NOT delete the fallback file even if SDK passes — keep as a continual escape hatch and a test target.
  - Do NOT bump Godot's project version higher than what's already in `project.godot`.
  - Do NOT skip the `--headless --check-only` verification — that's the single binary signal this task ships.
  - Do NOT create any general-purpose README or docs — only the explicitly-listed `colyseus-verify.md` artifact is allowed because it's a per-task verification record.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: External-SDK verification + bespoke GDScript; the attempt/install/verify loop is non-deterministic and the fallback path may trigger real work.
  - **Skills**: [`git-master`]
    - `git-master`: groups with Wave 1 commit; if SDK is git-cloned, the submodule/addon commit SHA must be pinned in `colyseus-verify.md`.
  - **Skills Evaluated but Omitted**:
    - `playwright`: not a browser task — purely a Godot headless check.
    - `frontend-ui-ux`: no UI design in T5.

  **Parallelization**:
  - **Can Run In Parallel**: YES (filesystem-isolated from T1-T4; only shared concern is the colyseus endpoint port 2567, which T1 owns and T5 only references).
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Wave 2+ Godot minimal rendering work + any client-side test harness.
  - **Blocked By**: None — Godot project already exists; SDK verification can start immediately.

  **References**:
  **Pattern References**:
  - `.sisyphus/drafts/nerdicard-backend.md:16-17` — Godot project already exists (`project.godot`, `game.gd`), `scripts/` empty. T5 only populates `scripts/`.
  - `.sisyphus/drafts/nerdicard-backend.md:24` — UI sequencing: minimal client alongside backend (incremental), so T5 must produce only connectivity, no UI yet.
  - `.sisyphus/drafts/nerdicard-backend.md:139-148` — Colyseus Godot SDK risk decision: verify in T5 first; fallback to raw WebSocket JSON parsing in GDScript if broken under Godot 4.x.
  **API/Type References**:
  - Godot 4 `WebSocketPeer` API: `connect_to_url`, `poll`, `get_ready_state`, `send_text`, `get_packet` — exposes raw WebSocket frames.
  - Godot 4 `JSON.stringify` / `JSON.parse_string` — Variant ↔ string (Dictionary native).
  - Colyseus Godot SDK surface (referenced in colyseus/colyseus-godot README): `Colyseus.Client.new(endpoint)`, `client.join(room_name)`, `room.send(dictionary)`, `room.on_state_change(callback)`.
  **Test References**:
  - Godot `--headless --check-only --script` is the compile-only gate: zero runtime needed for parse verification.
  - Godot `--headless --quit` invocation pattern for boot-then-exit baseline tests.
  **External References**:
  - https://github.com/colyseus/colyseus-godot — the community Godot SDK; verify it tracks Godot 4.x and read its README for install steps.
  - https://docs.godotengine.org/en/stable/classes/class_websocketpeer.html — `WebSocketPeer` API for the `raw-ws-client.gd` fallback path.
  - https://docs.colyseus.io/colyseus/client/client-side/ — the protocol shape the SDK implements (msgpack-list framing) — informs the fallback client's intentional divergence note.
  **WHY Each Reference Matters**:
  - The SDK is the documented risk in the draft; verifying under 4.7 specifically (user's pinned version) locks the path forward for every Wave 2 client task and prevents a mid-wave blocker.
  - Keeping the raw JSON fallback file around (even when SDK works) means a future Godot version bump can flip a single risk rating without rewriting T5.

  **Acceptance Criteria**:
  **If TDD (tests enabled)**: N/A — T5 is connectivity plumbing, not behavior; tests are GDScript `--check-only` parse gates + a manual connectivity ping.
  - [ ] `godot/scripts/ColyseusConnection.gd` exists, extends `Node`, declares `class_name ColyseusConnection`, and `godot --headless --check-only --script scripts/ColyseusConnection.gd` exits 0 (with SDK symbols resolved) OR exits non-zero due ONLY to missing SDK (documented in `colyseus-verify.md`).
  - [ ] `godot/scripts/raw-ws-client.gd` exists, uses `WebSocketPeer`, and `godot --headless --check-only --script scripts/raw-ws-client.gd` exits 0 (no external SDK dependency — uses only built-in Godot 4 classes).
  - [ ] `godot/scripts/colyseus-verify.md` exists with a `SDK-WORKING` or `SDK-BROKEN-FALLBACK` rating, the Godot version tested, the SDK source+SHA (if applicable), and the GitHub URL.
  - [ ] If `SDK-WORKING`: a single connectivity ping from a `--headless --quit` run against a T1-booted `npm run dev` produces a stdout log on the Godot side showing a WebSocket connection to `ws://127.0.0.1:2567` reaching `STATE_CONNECTING` or beyond. Capture as evidence.
  - [ ] If `SDK-BROKEN-FALLBACK`: the `colyseus-verify.md` documents the exact failure string from `--check-only` (e.g. `"Class 'Colyseus' not found"`) and notes the required Wave 2 server-side JSON-bridge work.
  - [ ] No modification to existing `project.godot`, `game.gd`, or any file outside `godot/scripts/` and the single `colyseus-verify.md`.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: SDK parses under Godot 4.7 headless check
    Tool: Bash
    Preconditions: T5 files written; `godot --headless --version` prints 4.7.x; colyseus-godot SDK cloned into `godot/addons/colyseus_godot/` at a pinned commit SHA (record it in colyseus-verify.md); `npm run dev` (T1) running in background on :2567.
    Steps:
      1. `godot --headless --check-only --script godot/scripts/ColyseusConnection.gd`
        Expected: exit code 0, no parse errors, the `class_name Colyseus` symbol resolves.
      2. `godot --headless --check-only --script godot/scripts/raw-ws-client.gd`
        Expected: exit code 0 (fallback doesn't depend on the SDK).
      3. `godot --headless --quit -- main_loop_pings_colyseus 2>&1 | tee /tmp/godot-ping.log` (using a 5-line boot script that calls `ColyseusConnection.new()` and joins) — assert the log shows a WebSocket connection attempt to `ws://127.0.0.1:2567`.
    Expected Result: Both scripts parse; runtime ping reaches at least STATE_CONNECTING; `colyseus-verify.md` rated `SDK-WORKING` with the pinned SHA.
    Failure Indicators: Script 1 fails with `Parser Error: Class "Colyseus" not found` — flip rating to `SDK-BROKEN-FALLBACK` and proceed to the next scenario.
    Evidence: .sisyphus/evidence/task-5-sdk-working.txt

  Scenario: SDK broken under 4.7 → fallback path stands up
    Tool: Bash
    Preconditions: SDK install failed (or `--check-only` Step 1 above errored); fallback file present.
    Steps:
      1. Repeat script 1 from the prior scenario — capture the exact parser error line, write it INTO `colyseus-verify.md` under "Failure Record".
      2. Run `godot --headless --check-only --script godot/scripts/raw-ws-client.gd` — assert exit 0 using only built-in `WebSocketPeer`/`JSON` classes.
      3. Set `colyseus-verify.md` risk rating to `SDK-BROKEN-FALLBACK` and add a section "Required Wave 2 server-side work": Colyseus `defineServer` needs a JSON-text-frame WebSocket transport alongside its msgpack default — point to `server/src/app.config.ts` (T1 placeholder) for Wave 2 wiring.
    Expected Result: Fallback file parses cleanly without SDK; `colyseus-verify.md` accurately records the blocker and the Wave 2 dependency; T5 still ships green (fallback path verified).
    Failure Indicators: `--check-only` on `raw-ws-client.gd` fails — suggests `WebSocketPeer` isn't available in the installed Godot version, which would mean even the fallback is broken — escalate to plan-revision (out of T5 scope).
    Evidence: .sisyphus/evidence/task-5-sdk-broken-fallback.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-5-sdk-working.txt` OR `task-5-sdk-broken-fallback.txt` — full output of both `--check-only` invocations + the runtime ping log + the `godot --headless --version` line.
  - [ ] `task-5-colyseus-verify.md` — the verification artifact itself (a copy cat'd into evidence, or the path reference).
  - [ ] `task-5-sdk-sha.txt` — if SDK cloned: the `git -C godot/addons/colyseus_godot rev-parse HEAD` SHA pinned in the verify doc.
  - [ ] If `SDK-WORKING` and a runtime ping succeeded: a stdout snippet from the T1 server side showing the inbound WebSocket connection from the Godot client.

  **Commit**: YES (groups with all of Wave 1)
  - Message: `chore(client): Godot Colyseus connector + raw-ws fallback + verify under 4.7`
  - Pre-commit: `npx tsc --noEmit` (server side — ensures Wave 1 commit is green globally even though T5 is GDScript-only)
- [ ] 6. Colyseus State Schema

  **What to do**:
  - Create `server/src/state/schema.ts` exporting all Colyseus Schema subclasses. Every math expression field MUST be `@type("string")` — NEVER store `math.Node` objects (verified via ast_grep_search below).
  - Create `CardSchema` (extends `Schema`) with: `id: string`, `deckType: string` (enum value as string — "FCC"|"Number"|"Action"), `cardType: string` (e.g. "addTerm"|"offensive"|"shield"|"trap"|"theorem"|"derivative"|"addBoard"|"forceEval"|"eval"|"constant"), `domain: string` (BaseDomain enum: "Rational"|"Polynomial"|"Trig"|"ExpLog"|"Calculus"|"NumTheory"|"LinearAlgebra"), `numericValue: string` (for Number cards — string to preserve irrationals like "pi","sqrt(2)" → serialized math.js string), `expressionPayload: string` (FCC builder expression as math.js string; empty when N/A), `usuableOncePerConstruction: boolean` (for variable cards), `isFlipped: boolean` (graveyard front/back). Field count ≤64 here, fine.
  - Create `FunctionBoardSchema` (extends `Schema`), nested INSIDE Player to keep Player under 64 fields. Fields: `boardId: string`, `ownerSessionId: string`, `expression: string` (math.js node.toString() — e.g. `"x^2 + 3*x"`; parse on demand via `math.parse`), `domain: string` (BaseDomain enum→string), `compositionDepth: number` (0, 1, or 2 — rulebook caps cross-domain composition depth ≤2), `dimension: number` (matrix/vector board rank; 0 for scalar expressions), `isSingular: boolean` (matrix board singular flag for forced-loss condition), `isActive: boolean`.
  - Create `PlayerSchema` (extends `Schema`) with: `sessionId: string`, `displayName: string`, `hp: number` (starts 0), `isConnected: boolean`, `deckFCC: ArraySchema<CardSchema>`, `deckNumber: ArraySchema<CardSchema>`, `deckAction: ArraySchema<CardSchema>`, `discardGraveyard: ArraySchema<CardSchema>` ("3rd Dimension"), `hand: ArraySchema<CardSchema>` annotated with `@view()` — PRIVATE to owner; opponents see only `handCount`. Field `handCount: number` (kept in sync on every add/remove), `availableVariables: ArraySchema<string>` (x1..x10, removed as used), `variableUsagesLeft: number` (count, mirror), `boards: ArraySchema<FunctionBoardSchema>` (max 3), `boardCount: number` (mirror for opponents), `baseFunctionUnlocked: boolean`, `hasUsedVariableThisConstruction: boolean`.
  - Create `GameRoomState` (extends `Schema`) root with: `phase: string` ("waiting"|"draw"|"play"|"defense"|"resolution"|"gameOver"), `currentTurn: string` (sessionId), `turnDeadline: number` (epoch ms), `turnIndex: number` (global turn counter 0..N), `roundNumber: number`, `winner: string` (sessionId or ""), `players: MapSchema<PlayerSchema, string>` (string keys = sessionId), `stalling_no_eval_turns: number` (0..20 — drives 5-turn and 20-turn stalling prevention; increments each turn w/o eval, resets on eval), `variable_isolation_timers: MapSchema<number, string>` (per-player 3-turn countdown keyed by sessionId when their function isolated), `deckCounts: MapSchema<number, string>` (top-level deck exhaustion tracker keyed by deckType), `config: Schema<RoomConfigSchema>` (nested) with `maxPlayers: number`, `turnTimeoutMs: number`, `seed: string` (RNG seed).
  - Document the StateView pitfall utility pattern in a module-level comment block AND export a helper `addToHand(player: PlayerSchema, card: CardSchema, client: Client)` that performs `player.hand.push(card); owningClient.view.add(card); player.handCount = player.hand.length;` — callers (T7 zone-transition callbacks, T10 FSM, T14 handlers) MUST use this helper, NOT direct `.push()`. Failure to call `client.view.add()` after a push to a `@view()` array is the #1 documented card-game bug (hand invisible to owner).
  - For matrix boards: do NOT use multi-dim arrays (Colyseus schema forbids). Store the WHOLE matrix expression as a flattened math.js string, e.g. `board.expression = "[[1,2],[3,4]]"` or `"matrix([1,2],[3,4])"` plus `board.dimension` for rank/handling. Client roundtrips the string; server parses via `math.parse`/`math.matrix` on demand.
  - Re-use shared types from T2 (`server/src/shared/types.ts`): `BaseDomain`, `DeckType`, `CardType` enums; keep schema string-encoded versions aligned (schema `domain: string` coerced from `BaseDomain`).
  - Add a round-trip serialization smoke test: build a populated `GameRoomState` with 2 players each holding 1 board + 3 cards, encode via `this.room.cache.state.encodingByProtocols`-equivalent sermon or `@colyseus/schema` `Encoder`/`Reflection.encodeReflection` snapshot — assert decode round-trips without loss and string expression fields survive (no AST leak).

  **Must NOT do**:
  - Do NOT import `math.js` or reference `math.Node` anywhere in schema.ts (ast_grep_search verify). Expressions are string-typed exclusively.
  - Do NOT use multi-dimensional arrays in any Schema subclass. Flatten or string-encode.
  - Do NOT exceed 64 declared fields on any single Schema class — nest as done with FunctionBoard inside Player and Config under root.
  - Do NOT make `hand` visible to opponents. It MUST remain `@view()`-private. Opponents derive information only via `handCount: number`.
  - Do NOT mutate `stalling_no_eval_turns` or `variable_isolation_timers` from schema.ts itself — schema defines shape only; mutations belong to T7/T10/T14.
  - Do NOT store `math.Node` AST or use `math.replacer`/`math.reviver` JSON object hooks in schema (those bypass Colyseus serialization and break deltas).

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Schema layout touches a known Colyseus footgun (StateView) and 64-field limit; needs careful reasoning and reference cross-checking.
  - **Skills**: [`paseo-advisor`]
    - `paseo-advisor`: get second opinion on schema field grouping, nesting strategy, and StateView helper signature before locking the layout.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no UI / no browser interaction at this layer.
    - `git-master`: not committing until Wave 2 group closes.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9)
  - **Blocks**: 9 (room), 10 (turn FSM), 14 (handlers), 17 (Godot connect)
  - **Blocked By**: Task 2 (shared types — enum/contract definitions)

  **References**:
  **Pattern References**:
  - `NerdiCard.txt:45` — HP Gain formula context that consumes `compositionDepth` and expression string → define schema field shapes to feed T9 walker + HP calc.
  - `.sisyphus/drafts/nerdicard-backend.md:108-118` — StateView @view pitfall, 64-field limit, MapSchema string keys, flatten matrices — directly drives Card/Player/Board field design.
  `server/src/shared/types.ts` (Task 2 output) — `BaseDomain`, `DeckType`, `CardType` enums to string-encode.
  **API/Type References**:
  - Colyseus Schema API contract: `@type("string")`, `@type({map: SchemaClass})`, `@type([SchemaClass])`, `@view()` decorator, `ArraySchema`, `MapSchema`, `Schema.extend`. Coerce domain enums to `string`.
  - `@colyseus/schema` Encoder/Decoder + `Reflection.encodeReflection(state)` for round-trip snapshot test.
  **Test References**:
  - `namantam1/live-card-game` Call Break repo — `MapSchema` player indexing, `@view()` hand pattern, lifecycle hooks (mirror here).
  - `colyseus/turnbased-cards-demo` (UNO) — turn/phase fields on root state; turn timeout handling shape.
  **External References**:
  - https://docs.colyseus.io/colyseus/server/schema/ — Schema, @type, @view decorator semantics, MapSchema string-key requirement, nested Schema, 64-field limit, custom types.
  - https://github.com/colyseus/colyseus-godot — schema types exposed to Godot client; schema field types must map cleanly to the Godot SDK's TS↔native bridge.
  **WHY Each Reference Matters**:
  - Rulebook draft + research findings lock the exact field list (timers, composition depth, dimension) and the StateView/flat-matrix/MapSchema constraints — without these the schema is re-written downstream when T9/T10 land.
  - Colyseus docs confirm the exact decorator strings (`@type("string")`, `@view()`, `@type({map: ...})`) and 64-field ceiling — prevents silent serialization truncation.
  - Reference repos give a known-good example of `MapSchema<string, PlayerSchema>` + `@view()` hand + turn/phase root fields proven in production.

  **Acceptance Criteria**:
  - [ ] `server/src/state/schema.ts` exists exporting `CardSchema`, `FunctionBoardSchema`, `PlayerSchema`, `GameRoomState`, `RoomConfigSchema`, and helper `addToHand(player, card, client)`.
  - [ ] `npx tsc --noEmit` → 0 errors in `server`.
  - [ ] `ast_grep_search` for `import $$$ from "mathjs"` OR `: math.Node` OR `math.parse(` in `schema.ts` → 0 matches (string-only expressions enforced).
  - [ ] No Schema subclass declares >64 fields (verify by count in unit test: parse AST of class declarations, count `@type(...)`/`@view()` decorators per class).
  - [ ] `hand` field carries `@view()`; `handCount` and `boardCount` mirrors are public (no `@view()`).
  - [ ] `stalling_no_eval_turns: number` and `variable_isolation_timers: MapSchema<number>` present on `GameRoomState`.
  - [ ] `currentTurn`, `turnDeadline`, `winner`, `phase` all `@type("string")`/`@type("number")` on root state.
  - [ ] Round-trip test asserts no information loss and string expression fields survive encode/decode (no AST leak, no truncation).
  - [ ] `addToHand` test asserts that after push, `player.hand.length === 3` AND `client.view` contains the pushed card (simulate via inspecting `Encoder.encodeAll` diff including view).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Schema compiles and round-trips a populated state
    Tool: Bash
    Preconditions: Task 2 merged; `server/src/shared/types.ts` exports BaseDomain/DeckType/CardType enums; Node 20+; deps installed in backend/.
    Steps:
      1. `cd server && npx tsc --noEmit` → exit code 0.
      2. `cd server && cat > /tmp/schema-rt.test.ts <<'EOF'
         import { GameRoomState, PlayerSchema, CardSchema, addToHand } from "./src/state/schema";
         import { Reflection, encodeReflection } from "@colyseus/schema";
         const st = new GameRoomState();
         st.phase = "play"; st.currentTurn = "sessA"; st.turnDeadline = Date.now()+30000; st.turnIndex = 4;
         st.stalling_no_eval_turns = 3;
         const pA = new PlayerSchema(); pA.sessionId = "sessA"; pA.hp = 12; pA.handCount = 0;
         const pB = new PlayerSchema(); pB.sessionId = "sessB"; pB.hp = 7; pB.handCount = 2;
         st.players.set("sessA", pA); st.players.set("sessB", pB);
         st.variable_isolation_timers.set("sessB", 2);
         const board = pA.boards[0] ?? new FunctionBoardSchema();
         board.expression = "x^2 + 3*x"; board.domain = "Polynomial"; board.compositionDepth = 0; board.dimension = 0;
         pA.boards.push(board); pA.boardCount = 1;
         const card = new CardSchema(); card.id="c1"; card.deckType="FCC"; card.cardType="addTerm"; card.domain="Polynomial"; card.expressionPayload="2*x";
         // simulate addToHand w/ mock client.view.add:
         const fakeClient = { view: { add: (c)=>{ (fakeClient._viewokies ||= []).push(c); return c; } }, _viewokies: [] as any[] } as any;
         addToHand(pA, card, fakeClient);
         const bytes = encodeReflection(Reflection}());
         assert pA.hand.length === 1 && pA.handCount === 1 && fakeClient._viewokies.length === 1;
         assert st.variable_isolation_timers.get("sessB") === 2 && st.stalling_no_eval_turns === 3;
         assert board.expression === "x^2 + 3*x";
      3. `npx vitest run /tmp/schema-rt.test.ts` → all assertions pass.
    Expected Result: `tsc` exit 0; vitest exit 0; sample state encodes/decodes with all string fields intact; `@view()` card was added to the fake client view.
    Failure Indicators: tsc emits type errors; round-trip drops `expression` or `variable_isolation_timers`; `fakeClient._viewokies` empty (addToHand did not call `view.add`); any class exceeds 64 fields.
    Evidence: .sisyphus/evidence/task-6-schema-roundtrip.txt (tsc + vitest output), .sisyphus/evidence/task-6-schema.ts (test file copy), .sisyphus/evidence/task-6-astgrep-no-math.txt
  ```

  ```
  Scenario: ast_grep catches accidental math.Node import in schema (failure guard)
    Tool: Bash
    Preconditions: schema.ts exists.
    Steps:
      1. `cd server && ast-grep --lang typescript -p 'import $$$ from "mathjs"' src/state/schema.ts` → 0 matches.
      2. `cd server && ast-grep --lang typescript -p 'math.parse($$$)' src/state/schema.ts` → 0 matches.
      3. Manually inject `import { parse } from "mathjs";` at top of schema.ts in a throwaway branch; re-run step 1 → 1 match (proves the guard fires).
    Expected Result: baseline (no injected import) = 0 matches across both patterns; injected branch = ≥1 match for pattern 1.
    Failure Indicators: baseline produces matches (real leak) OR injected branch produces 0 matches (pattern too loose).
    Evidence: .sisyphus/evidence/task-6-no-math-import.txt (baseline) + .sisyphus/evidence/task-6-injected-import-detected.txt (negative control)
  ```

  **Evidence to Capture**:
  - [ ] `tsc --noEmit` exit 0 transcript.
  - [ ] vitest round-trip test file + passing output.
  - [ ] ast-grep stdout showing 0 matches for math.js imports/parse in schema.ts.
  - [ ] table listing per-class @type/@view field counts (prove each ≤64).
  - [ ] screenshot-free: paste the resolved `addToHand` body into evidence file.

  **Commit**: YES (groups with all of Wave 2)
  - Message: `feat(server): Colyseus state schema with @view hidden hands`
  - Pre-commit: `npx tsc --noEmit`

- [ ] 7. Pure Game Logic Core

  **What to do**:
  - Create `server/src/logic/deck.ts` exporting `class Deck` (per deck type) with: constructor `(deckType: DeckType, cards: CardData[], rng?: () => number)`; methods `shuffle(seed?: string): void` (Fisher-Yates using the injected RNG, default `Math.random`), `draw(): CardData | null` (returns top or null when empty), `drawN(n): CardData[]`, `peek(): CardData | null`, `size(): number`, `isEmpty(): boolean`, `toArray(): CardData[]` (for graveyard/restock). Provide `seededRng(seed: string): () => number` (mulberry32 or splitmix32 — deterministic, identical output across Node versions). A seeded shuffle MUST reproduce byte-identical order for the same seed (unit test asserts this).
  - Create `server/src/logic/zones.ts` exporting `enum ZoneType { Hand="Hand", BoardEq="BoardEq", Graveyard="Graveyard", DeckFCC="DeckFCC", DeckNumber="DeckNumber", DeckAction="DeckAction", Active="Active", Held="Held" }` and `interface CardMoveEvent { cardId: string; from: ZoneType; to: ZoneType; ownerSessionId: string; timestamp: number; }`. Provide pure `function moveCard(state: LogicState, cardId, from, to): CardMoveEvent` that mutates an internal `LogicState` (NOT Colyseus state) and invokes callbacks: `onCardAddedToZone(card, to, owner)` and `onCardRemovedFromZone(card, from, owner)`. THIS module has ZERO Colyseus imports — callers (T10 FSM, T14 handlers) wrap these callbacks to also push into the Colyseus `@view()` hand / grave via T6's `addToHand`. Callbacks are optional fields on `LogicState.callbacks`.
  - Create `server/src/logic/graveyard.ts` exporting `class Graveyard` accounting: `bury(card)`, `exile(cardId)`, `resurrect(cardId)`, `size()`, `contains(cardId)`, `toArray()`. Tracks "3rd Dimension" accounting per rulebook Resolution Phase.
  - Create `server/src/logic/limits.ts` exporting pure predicates: `function enforceHandSize(player: PlayerLogic): { ok: boolean; reason?: string }` (default cap 7; configurable), `function enforceBoardCount(player): { ok; reason? }` (≤3 boards — rulebook), `function canAddBoard(player): boolean`. These operate on a `PlayerLogic` interface (sessionId, hand: CardData[], boards: FunctionBoardLogic[]) — NOT Colyseus Schema — so unit-testable without a Room.
  - Create `server/src/logic/composition.ts` exporting `class CompositionDepthTracker` with `current(sessionId): number`, `push(sessionId): void` (+1), `pop(sessionId): void` (-1), `reset(sessionId): void`, `isWithinLimit(sessionId): boolean` (≤2 per rulebook), `assertComposition(sessionId): void` throws if depth would exceed 2. Used by T10 during Composition/Force-Eval actions and reflected into `FunctionBoardSchema.compositionDepth` by handlers (T14).
  - Create `server/src/logic/types.ts` exporting `PlayerLogic`, `FunctionBoardLogic`, `CardData`, `LogicState` (carries decks, hands, boards, graveyards per sessionId + `callbacks: { onCardAddedToZone?; onCardRemovedFromZone? }`). Import shared types (`baseType`, `CardType`, `DeckType`) from T2.
  - All modules import ONLY from `mathjs`'s parser-free helpers (none needed here actually — pure logic) and from `backend/shared`. ZERO imports from `@colyseus/*` or `colyseus.js` (ast_grep_search verify).
  - Unit tests (`server/test/logic/*.test.ts`): seeded shuffle determinism (same seed → identical card order), Fisher-Yates produces valid permutation of same multiset, draw on empty returns null, zone move fires both callbacks with correct `(card,zone,owner)`, hand limit blocks at cap, board limit blocks at 3, CompositionDepthTracker rejects push at depth 3.

  **Must NOT do**:
  - Do NOT import `@colyseus/schema`, `colyseus.js`, or any Colyseus Room/Client types. This is the pure layer — testable in plain Node.
  - Do NOT mutate Colyseus `Schema` objects inside this module. Callbacks are the contract boundary; T14 wires the Colyseus side.
  - Do NOT embed expressions as `math.Node` here either — keep expression fields as plain strings on `CardData`/`FunctionBoardLogic`; parsing belongs to T8/T9 math layer.
  - Do NOT couple RNG to `Math.random` globally — must be injectable so seeded tests are deterministic.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Pure engine correctness (determinism, callback contract boundary) is the foundation everything else builds on; subtle bugs here cascade to T10/T14.
  - **Skills**: [`paseo-advisor`]
    - `paseo-advisor`: validate the callback boundary (LogicState callbacks vs Colyseus wiring) and seeded-RNG algorithm choice before locking the interface.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no UI.
    - `ai-slop-remover`: no existing code yet (greenfield).

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 8, 9)
  - **Blocks**: 10 (turn FSM uses Deck/Zone), 14 (handlers wrap callbacks), 11 (card catalog wiring)
  - **Blocked By**: Task 2 (shared types), Task 3 (architecture module boundaries — defines where this lives)

  **References**:
  **Pattern References**:
  - `.sisyphus/drafts/nerdicard-backend.md:120-126` — module split #2 "Pure Game Logic (deck, shuffle, validation — no Colyseus imports, unit-testable)" — exact mandate for this module.
  - `NerdiCard.txt:39-44` — Draw Phase (2 cards/turn), Play Phase (≤2 actions), Resolution (→3rd Dimension/graveyard) → drives Deck.drawN + zones.Enqueue.
  - `NerdiCard.txt:24-37` — player resources (3 boards max, 10 vars, 10 numbers) → drives board limit (≤3), hand cap.
  **API/Type References**:
  - T2 `server/src/shared/types.ts`: `CardType`, `DeckType`, `BaseDomain` enums; `CardData` shape contract.
  - T3 architecture module boundary doc (zones.ts, deck.ts locations).
  **Test References**:
  - Fisher-Yates correctness: assert `shuffle` output is a permutation of input multiset (sort both, deep-equal).
  - Seeded determinism: identical `seededRng("abcd")` sequence across 2 runs of the same Node version.
  - `namantam1/live-card-game` pure engine folder (deck/shuffle/hand validate) — copy test shape.
  **External References**:
  - https://docs.colyseus.io/colyseus/server/room/#oncreate — confirms pure logic should keep Colyseus imports out for testability.
  - https://github.com/bryc/code/blob/main/jshash/PRNGs.md — mulberry32 / splitmix32 reference implementations for the seeded RNG.
  **WHY Each Reference Matters**:
  - Draft explicitly forbids Colyseus imports in this layer — without that constraint it would be untestable in isolation.
  - Rulebook turn/phase structure dictates exact Deck/Zone behaviors (2 cards/turn, board≤3, graveyard semantics).
  - PRNG reference prevents writing a subtly-biased RNG that breaks determinism tests across Node releases.

  **Acceptance Criteria**:
  - [ ] `server/src/logic/{deck,zones,graveyard,limits,composition,types}.ts` exist and compile.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `ast_grep_search` for `import $$$ from "@colyseus$$$"` OR `from "colyseus"` in `src/logic/*` → 0 matches (no Colyseus imports).
  - [ ] `npx vitest run server/test/logic` → all tests pass; specifically seeded shuffle determinism test (same seed → byte-identical card array after shuffle) passes.
  - [ ] `Deck.draw()` on empty deck returns `null` (not throws).
  - [ ] `CompositionDepthTracker` throws on the 3rd `.push()` (`isWithinLimit` false) for the same sessionId.
  - [ ] `moveCard` invokes BOTH `onCardRemovedFromZone` (from) and `onCardAddedToZone` (to) in that order with correct args.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Seeded Fisher-Yates produces deterministic, identical card order across runs
    Tool: Bash
    Preconditions: T2 merged; backend deps installed; vitest configured.
    Steps:
      1. `cd server && cat > /tmp/deck-shuffle.test.ts <<'EOF'
         import { Deck } from "./src/logic/deck";
         import { seededRng } from "./src/logic/deck";
         const cards = () => Array.from({length:20},(_,i)=>({ id:"c"+i, deckType:"Action", cardType:"offensive" } as any));
         const a = new Deck("Action", cards(), seededRng("seed-XYZ-123"));
         const b = new Deck("Action", cards(), seededRng("seed-XYZ-123"));
         a.shuffle("seed-XYZ-123"); b.shuffle("seed-XYZ-123");
         const ar = a.toArray(); const br = b.toArray();
         assert JSON.stringify(ar) === JSON.stringify(br) : "deterministic for identical seed";
         assert JSON.stringify([...ar].sort((x,y)=>x.id.localeCompare(y.id))) === JSON.stringify([...cards()].sort((x,y)=>x.id.localeCompare(y.id))) : "permutation of same multiset";
         const c = new Deck("Action", cards(), seededRng("different"));
         c.shuffle("different"); assert JSON.stringify(c.toArray()) !== JSON.stringify(ar) : "different seeds diverge";
      2. `npx vitest run /tmp/deck-shuffle.test.ts` → all 3 asserts pass.
    Expected Result: identical-seed decks deeply equal; output is a permutation of input; different seeds diverge. Exit 0.
    Failure Indicators: identical seeds produce different orders (RNG non-deterministic); shuffle drops/duplicates a card (Fisher-Yates off-by-one); different seeds produce identical order (seed ignored).
    Evidence: .sisyphus/evidence/task-7-deck-determinism.txt
  ```

  ```
  Scenario: CompositionDepthTracker rejects depth>2 and zone callbacks fire in order
    Tool: Bash
    Preconditions: logic modules compiled.
    Steps:
      1. `cd server && cat > /tmp/logic.test.ts <<'EOF'
         import { CompositionDepthTracker } from "./src/logic/composition";
         import { moveCard, ZoneType, type LogicState, type CardMoveEvent } from "./src/logic/zones";
         const t = new CompositionDepthTracker();
         t.push("sessA"); t.push("sessA");
         assert t.current("sessA") === 2 && t.isWithinLimit("sessA") === true;
         let threw=false; try { t.push("sessA"); } catch { threw=true; }
         assert threw === true : "depth 3 rejected";
         const calls: string[] = [];
         const state: LogicState = { players: new Map(), callbacks: {
           onCardRemovedFromZone: (c,z,o)=>calls.push("rm:"+z),
           onCardAddedToZone: (c,z,o)=>calls.push("add:"+z),
         } } as any;
         // seed state minimally:
         (state as any).players.set("sessA", { sessionId:"sessA", hand:[{id:"c9"}], boards:[], graveyard:[] });
         const ev = moveCard(state, "c9", ZoneType.Hand, ZoneType.Graveyard);
         assert calls.join(",") === "rm:Hand,add:Graveyard" : "order correct";
         assert ev.to === ZoneType.Graveyard && ev.from === ZoneType.Hand;
      2. `npx vitest run /tmp/logic.test.ts` → all asserts pass.
    Expected Result: depth tracker caps at 2 and throws on push #3; zone move fires rm-then-add in order; CardMoveEvent fields correct.
    Failure Indicators: depth 3 silently accepted; callbacks fire in wrong order or only once; CardMoveEvent owner/to swapped.
    Evidence: .sisyphus/evidence/task-7-composition-zones.txt
  ```

  **Evidence to Capture**:
  - [ ] vitest output for the two scenario files.
  - [ ] ast_grep output proving 0 Colyseus imports in `src/logic/`.
  - [ ] tsc exit 0.

  **Commit**: YES (groups with all of Wave 2)
  - Message: `feat(logic): pure deck/zone/graveyard/limits core (no Colyseus imports)`
  - Pre-commit: `npx tsc --noEmit && npx vitest run server/test/logic`

- [ ] 8. Expression Representation Layer

  **What to do**:
  - Create `server/src/math/expressions.ts` exporting: `function parseExpression(input: string): math.Node` (wraps `math.parse`, throws `MathValidationError` on parse failure), `function serialize(node: math.Node): string` (wraps `node.toString()`, options: `{ implicit?: "hide"|"show"; parenthesis?: "keep"|"auto"|"all" }` — MUST default to a STABLE config and ALWAYS use the same config on both serialize and round-trip tests), `function roundtrip(input: string): { original: string; serialized: string; reparsed: math.Node; equal: boolean }`.
  - Create `server/src/math/validation.ts` exporting domain validation predicates (each returns `{ ok: boolean; reason?: string }`):
    - `validateRational(node)`: node must be a polynomial P(x)/Q(x) where P,Q have integer/rational coefficients; reject floats & radicals. (Use `math.rationalize` then check.)
    - `validatePolynomial(node, opts: { maxDegree: number })`: maxDegree=5; all variable terms in a single symbol; degree ≤5; coefficient numeric (no transcendental constants).
    - `validateTrig(node, opts: { maxTerms: number })`: maxTerms=6; only addition/multiplication operators (no nested composition like `sin(cos(x))`); allowed funcs: `sin, cos, tan, cot, sec, csc, asin, acos, atan`; reject `sin(sin(x))`.
    - `validateExpLog(node, opts: { maxTerms: number })`: maxTerms=10; bases allowed: `2, 10, e`; `exp`, `log2`, `log10`, `ln` permitted; `ln^power` counts as 2 terms (power applied to log enlarges term budget); reject `e^x^x`, reject `log_3(x)`.
    - `validateByDomain(domain: BaseDomain, node): { ok; reason? }`: dispatcher to the above by enum.
  - Create `server/src/math/counters.ts` exporting:
    - `function countTerms(node: math.Node): number` — top-level addition operands count (traverse top-level `OperatorNode "+"` chain); single term → 1.
    - `function countDistinctVariables(node: math.Node): number` — collect `SymbolNode.name` leaves via `node.traverse()` into a `Set<string>`; constants/pis/e not counted.
    - `function listVariables(node: math.Node): string[]` — same collection as array (used by T9 walker in build; do not duplicate logic — T9 imports this).
  - Module imports ONLY from `mathjs` + `backend/shared` (BaseDomain enum). ZERO Colyseus imports (ast_grep_search verify).
  - Add an internal **capability matrix** test (`server/test/math/capability-matrix.test.ts`) that:
    - Picks 5 representative expressions from each domain: (1) polynomial `2*x^4 - 3*x^2 + 5`, (2) trig `sin(x) + cos(x) + tan(x)`, (3) exp/log `2^x + log10(x) + ln(x^2)`, (4) composition `f(x)=x^2; g(y)=sin(f(y))` parsed as `sin(x^2)` — for expression round-trip treat as nested-expression string, (5) matrix `"[[1,2],[3,4]]"`.
    - For each: parse → toString → reparse → compare structures via `math.symbolicEqual` (fall back to `node.equals` then string-normalized equality) AND serialized string stable. Round-trip MUST be 100% (5/5).
    - Domain validation matrix: each valid expression passes its validator; inject 1 deliberately-invalid per domain (deg-6 polynomial; `sin(cos(x))` nested trig; `log_3(x)` bad base; matrix `[[1,2],[3]]` ragged) and assert each REJECTED with a reason string.
    - Counters matrix: `countTerms(parse("x^2 + 3*x + 1"))` === 3; `countDistinctVariables(parse("x*y + z"))` === 3; `listVariables(parse("a*x + b*y"))` deep-equal `["a","b","x","y"]` (order-insensitive).
  - Stable serialization config: pick `serialize(node)` defaults `{ implicit: "show", parenthesis: "keep" }` (or whichever passes all 5 round-trips) and document the choice at module top — all callers (T6 writes via T14 handlers, T9 walker) MUST use this `serialize` function for any `node.toString()` so the schema string is canonical.

  **Must NOT do**:
  - Do NOT push parsed `math.Node` objects into any Colyseus schema (this module is the parse/serialize gateway; callers serialize before storing).
  - Do NOT use `math.replacer`/`math.reviver` JSON object serialization for the schema string — that produces objects, not canonical math.js string syntax. Use `node.toString(opts)` only.
  - Do NOT bake composition-depth logic or "terms beyond first" scoring here — that's T9's responsibility (T9 imports the counters from this module).
  - Do NOT couple validators to Colyseus state — they take `math.Node` only.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Subtle math.js semantics (rationalize, symbolicEqual, term traversal whitespace/paren normalization) need careful reasoning + reference cross-check; round-trip stability is brittle.
  - **Skills**: [`paseo-advisor`]
    - `paseo-advisor`: validate the chosen stable serialize config (`implicit`/`parenthesis` flags) against all 5 representative expressions before locking; second opinion on trig composition detection strategy.
  - **Skills Evaluated but Omitted**:
    - `playwright`: no browser.
    - `context7`: docs context not needed unless math.js API unclear — optional.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 9)
  - **Blocks**: 9 (walker uses counters), 14 (handlers serialize before storing), 10 (FSM evaluation step)
  - **Blocked By**: Task 4 (math.js research/contract — confirmed API surface), T2 (BaseDomain enum)

  **References**:
  **Pattern References**:
  - `.sisyphus/drafts/nerdicard-backend.md:97-101` — math.js Node as expression AST + Math engine abstraction; this module is the canonical parse/serialize gateway.
  - `.sisyphus/drafts/nerdicard-backend.md:128-131` — string-only expressions in schema; module enforces that contract via `serialize`/`parse` being the ONLY entry points callers use.
  - `NerdiCard.txt:31` — Base Function Card domain restrictions (Rational/Poly ≤deg5, Trig ≤6 terms, Exp/Log ≤10 terms) → exact validation predicate numeric thresholds.
  **API/Type References**:
  - math.js: `math.parse(string): Node`, `node.toString(opts)`, `node.traverse(callback)`, `SymbolNode`, `OperatorNode`, `FunctionNode`, `math.rationalize`, `math.symbolicEqual(a,b)`.
  - T2: `BaseDomain` enum ("Rational"|"Polynomial"|"Trig"|"ExpLog"|...).
  **Test References**:
  - Capability matrix pattern (5 representative expressions round-trip + per-domain valid/invalid pairs) — pinned in acceptance criteria.
  - math.js `test/` expression round-trip fixtures in upstream repo as reference shape.
  **External References**:
  - https://mathjs.org/docs/reference/functions/parse.html — `parse`, `node.toString` options (`implicit`,`parenthesis`).
  - https://mathjs.org/docs/reference/functions/rationalize.html — for rational validator.
  - https://mathjs.org/docs/reference/functions/symbolicEqual.html — for round-trip structural equality.
  **WHY Each Reference Matters**:
  - Draft locks string-only expressions; this module is the enforcement boundary — without a single canonical serialize config, strings stored in schema diverge between callers and round-trip tests flap.
  - Rulebook domain thresholds (deg5, 6 trig terms, 10 exp/log terms) directly become validator option defaults.
  - math.js `node.toString` opts doc is the only way to guarantee pipeline-stable serialization; without it symbolic-equal round-trip fails on whitespace/implicit-multiplication variants.

  **Acceptance Criteria**:
  - [ ] `server/src/math/{expressions,validation,counters}.ts` exist and compile.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `ast_grep_search` for `import $$$ from "@colyseus$$$"` in `src/math/*` → 0 matches.
  - [ ] Capability matrix test passes: 5/5 representative expressions round-trip (parse→toString→reparse→symbolicEqual===true).
  - [ ] Validation matrix: each of the 4 injected-invalid inputs is rejected (deg-6 polynomial, `sin(cos(x))`, `log_3(x)`, ragged matrix).
  - [ ] `countTerms(parse("x^2 + 3*x + 1"))` === 3.
  - [ ] `countDistinctVariables(parse("x*y + z"))` === 3.
  - [ ] `listVariables(parse("a*x + b*y"))` contains exactly `["a","b","x","y"]` regardless of order.
  - [ ] A single canonical `serialize()` config is used everywhere (grep `node.toString` outside this module → 0 matches; only `serialize(node)` exported).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: 5 representative expressions round-trip 100% through serialize/parse pipeline
    Tool: Bash
    Preconditions: T4 merged; mathjs installed.
    Steps:
      1. `cd server && cat > /tmp/math-cap.test.ts <<'EOF'
         import { parseExpression, serialize } from "./src/math/expressions";
         import { math } from "mathjs";  // or package alias per T4
         const samples = [
           "2*x^4 - 3*x^2 + 5",
           "sin(x) + cos(x) + tan(x)",
           "2^x + log10(x) + ln(x^2)",
           "sin(x^2)",
           "[[1,2],[3,4]]",
         ];
         let pass=0;
         for (const s of samples) {
           const a = parseExpression(s);
           const ser = serialize(a);
           const b = parseExpression(ser);
           const eq = math.symbolicEqual(a, b) === true || (serialize(a) === serialize(b));
           if (eq) pass++; else console.error("ROUNDTRIP FAIL:", s, "→", ser);
         }
         assert pass === samples.length : pass+"/"+samples.length+" round-trip";
      2. `npx vitest run /tmp/math-cap.test.ts` → pass === 5/5.
    Expected Result: 5/5 pinned representative expressions round-trip cleanly with identical serialized strings (symbolic-equal or normalized string equal).
    Failure Indicators: any expression fails (whitespace drift, implicit-mul rendered differently, matrix re-serialized with `matrix([...])` instead of `[[...]]`), pass<5.
    Evidence: .sisyphus/evidence/task-8-roundtrip.txt
  ```

  ```
  Scenario: Domain validators reject each deliberately-invalid input with a reason
    Tool: Bash
    Preconditions: validation.ts compiled.
    Steps:
      1. `cd server && cat > /tmp/math-val.test.ts <<'EOF'
         import { parseExpression } from "./src/math/expressions";
         import { validatePolynomial, validateTrig, validateExpLog } from "./src/math/validation";
         const polyBad = validatePolynomial(parseExpression("x^6 - 1"), { maxDegree: 5 });
         assert polyBad.ok === false && typeof polyBad.reason === "string";
         const trigBad = validateTrig(parseExpression("sin(cos(x))"), { maxTerms: 6 });
         assert trigBad.ok === false;
         const expBad = validateExpLog(parseExpression("log_3(x)"), { maxTerms: 10 });
         assert expBad.ok === false;
         // happy path: valid ones pass
         assert validatePolynomial(parseExpression("x^5 + x"), { maxDegree: 5 }).ok === true;
         assert validateTrig(parseExpression("sin(x)+cos(x)+tan(x)+a+b+c"), { maxTerms: 6 }).ok === true;
      2. `npx vitest run /tmp/math-val.test.ts` → all asserts pass.
    Expected Result: every deliberately-invalid input rejected with a non-empty reason; every valid input accepted.
    Failure Indicators: any invalid accepted; any valid rejected; missing reason string on rejection.
    Evidence: .sisyphus/evidence/task-8-validation.txt
  ```

  **Evidence to Capture**:
  - [ ] vitest output (both scenario files).
  - [ ] ast_grep output: 0 Colyseus imports in `src/math/`.
  - [ ] grep output: `node.toString(` appears only in `expressions.ts`.
  - [ ] tsc exit 0.

  **Commit**: YES (groups with all of Wave 2)
  - Message: `feat(math): expression parse/serialize layer + domain validators + counters`
  - Pre-commit: `npx tsc --noEmit && npx vitest run server/test/math`

- [ ] 9. Complexity Score AST Walker

  **What to do**:
  - Create `server/src/math/complexity.ts` exporting `function computeComplexity(node: math.Node): number` — a PURE function that returns an integer Complexity Score per rulebook §HP Gain ("+1/distinct variable term, +1/term beyond first, +2/composition"; eligible only if ≥2 distinct variable terms → walker still returns the score; eligibility cutoff is enforced by callers, not here, but provide `function isEligibleForHP(node: math.Node): boolean` returning `countDistinctVariables(node) >= 2`).
  - Walker mechanics:
    - Walk via `node.traverse((n, path, parent) => {...})` collecting:
      - **Distinct variable terms**: collect every `SymbolNode` leaf name into a `Set<string>` (exclude math.js constants `pi`, `e`, `phi`, `i`, `INF`, `NaN`); the distinct count = `set.size`.
      - **Terms beyond first**: at the TOP level of the expression, count addition operands minus 1. Top-level op must be an `OperatorNode` with `op === "+"` (or chain of `+`); if the root is not an addition, termsBeyondFirst = 0. Single term → 0 beyond first.
      - **Nested compositions**: increment by +1 for each `FunctionAssignmentNode` substitution encountered during traverse where the assigned function body is itself a `FunctionNode` (i.e. `f(x)=...` whose body references another defined function); additionally +1 per each top-level `FunctionNode` whose argument is itself a `FunctionNode` or `FunctionAssignmentNode` reference (i.e. `g(f(x))`). Cap per-expression composition contribution to rulebook max (depth ≤2 → at most +4 from composition). Detect via `node.type === "FunctionAssignmentNode"` and `node.expr` containing a `FunctionNode`.
  - Score formula: `score = 1*distinctVars + 1*termsBeyondFirst + 2*compositionHits`. Sum integer.
  - Import ONLY the cheap helpers from T8 (`countDistinctVariables`, `listVariables`, `countTerms`) for variable/term collection; implement the COMPOSITION detection here (T8 explicitly defers it). Stay pure: no Colyseus, no IO.
  - **Edge case handling (unit-tested, enumerated)**:
    - `f(x) = x` → distinctVars=1, termsBeyondFirst=0, composition=0 → **score = 1 → ineligible** (distinctVars<2). Test asserts `isEligibleForHP(parse("x")) === false`.
    - `f(x) = x^2 + 3*x` → distinctVars=1 (`x`), termsBeyondFirst=1 (two top-level terms, beyond first=1), composition=0 → **score = 2**. `isEligibleForHP` false (distinct<2).
    - `f(x,y) = x^2 + y` → distinctVars=2, termsBeyondFirst=1, composition=0 → **score = 3**. Eligible. (matches REQUIRED example.)
    - `f(x,y) = sin(x) + cos(y)` → distinctVars=2 (x,y), termsBeyondFirst=1, composition=0 → **score = 3**. (matches REQUIRED example.)
    - `g(f(x))` where `f(x)=x^2` and `g(z)=sin(z)` → composition hits=1 (g composed with f) → +2; assuming distinctVars=1 (x), terms BeyondFirst=0 → **score = 2**. If expressed as `sin(x^2)` (pre-eliminated form) composition still detected? — NO (already substituted); walker scores by AST present. Document this: pre-substituted compositions are NOT counted; only explicit `FunctionAssignmentNode`/composed `FunctionNode` form contributes. Provide BOTH inputs as test cases and assert the difference.
    - `f(x) = x` alone → score 0? Rulebook: "+1/distinct var" → 1*1 = 1, but eligibility requires ≥2 distinct vars. Per task brief "MUST return 0 for f(x)=x (ineligible for HP)" — reconcile: implement `computeComplexity` to return the RAW score (1) AND `isEligibleForHP` separately returns false; ALSO provide `function computeEligibleComplexity(node): number` that returns RAW score ONLY if eligible else **0** (this is what HP formula uses). Test asserts `computeEligibleComplexity(parse("x")) === 0` and `computeComplexity(parse("x")) === 1`. (matches REQUIRED "f(x)=x → 0, ineligible".)
    - Matrix expression `"[[1,2],[3,4]]"` → distinctVars=0, termsBeyondFirst=0, composition=0 → score 0 → ineligible.
    - Complex-number constant `3 + 2i` (math.js `Complex`) → distinctVars=0, termsBeyondFirst=0 (constant ops don't count as "variable terms") → score 0 → ineligible. Test parses `"3 + 2i"` via `math.parse` (math.js complex literal) and asserts 0.
    - `f(x,y,z) = x*y + z + 1` → distinctVars=3, termsBeyondFirst=2 (3 top-level terms beyond first=2), composition=0 → score = 5.
  - Comprehensive unit test file `server/test/math/complexity.test.ts` enumerating each of the above cases with assertion + a comment tying to the example; cover positive/negative.

  **Must NOT do**:
  - Do NOT introduce Colyseus imports — pure math util.
  - Do NOT recompute distinct variables / terms — reuse T8 `counters.ts` (single source of truth).
  - Do NOT enforce HP eligibility cutoff inside `computeComplexity`; only `computeEligibleComplexity` returns 0 when ineligible. Callers (T10 FSM eval step / T14 handlers) MUST call `computeEligibleComplexity` when computing HP gain.
  - Do NOT count math.js constants (`pi`, `e`, `phi`, `i`, `INF`, `NaN`) as variables.
  - Do NOT score pre-substituted compositions (e.g. `sin(x^2)`) as composition hits — only explicit `FunctionAssignmentNode` with nested `FunctionNode` bodies.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: AST traversal subtleties (top-level-only addition count, composition detection, FunctionAssignmentNode vs FunctionNode) need careful reasoning; pinned edge-case examples make correctness checkable.
  - **Skills**: [`paseo-advisor`]
    - `paseo-advisor`: validate the composition detection heuristic (FunctionAssignmentNode body containing FunctionNode) against the rulebook's intent; second opinion on whether to count pre-substituted compositions (decide NO; confirm).
  - **Skills Evaluated but Omitted**:
    - `playwright`: no UI.
    - `context7`: only if math.js traverse API unclear.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8) — BUT depends on T8's `counters.ts`; coordinate so T8 lands counters first (T9 may stub on T8 API contract).
  - **Blocks**: 10 (turn FSM eval step computes HP), 14 (handlers trigger eval), 16 (HP-gain integration)
  - **Blocked By**: Task 4 (math.js contract), Task 8 (counters — distinct vars, terms) ; coordinate with T8.

  **References**:
  **Pattern References**:
  - `.sisyphus/drafts/nerdicard-backend.md:128-131` — explicit new task "Custom AST Walker for Complexity Score" pinned here.
  - `.sisyphus/drafts/nerdicard-backend.md:46-49` — HP Gain formula + Complexity definition (+1/distinct var, +1/term beyond first, +2/composition; <2 distinct → ineligible).
  - `NerdiCard.txt:45-49` — `HP Gain = (Function Value × Complexity Score) / 10`.
  **API/Type References**:
  - math.js `node.traverse((node, path, parent) => void)` — visitor API.
  - math.js `SymbolNode`, `OperatorNode` (`.op`, `.args`), `FunctionNode` (`.fn.name`), `FunctionAssignmentNode` (`.name`, `.params`, `.expr`), `ConstantNode`.
  - T8 `counters.ts`: `countDistinctVariables(node)`, `listVariables(node)`, `countTerms(node)`.
  **Test References**:
  - Pinned enumerated edge cases (f(x)=x → 0 ineligible; f(x,y)=x^2+y → 3; sin(x)+cos(y) → 3; g(f(x)) → +2/composition; matrix → 0; complex constant → 0; x*y+z+1 → 5) — each is one test row.
  **External References**:
  - https://mathjs.org/docs/reference/functions/parse.html — `node.traverse` semantics and node-type hierarchy (`FunctionNode`, `FunctionAssignmentNode`).
  - https://mathjs.org/docs/expressions/expression_trees.html — expression tree node types used by the walker.
  **WHY Each Reference Matters**:
  - Draft locks the new walker task and the exact scoring constants — without those references the score formula invents weights.
  - math.js node-type docs are the only way to correctly identify composition (`FunctionAssignmentNode` + nested `FunctionNode`) vs. plain trig (`FunctionNode` whose `.fn.name` is `sin`, etc., NOT a composition).
  - Edge cases 5+9+matrix+complex differentiate the walker from naive term counters — pinned tests prevent regressions.

  **Acceptance Criteria**:
  - [ ] `server/src/math/complexity.ts` exports `computeComplexity`, `computeEligibleComplexity`, `isEligibleForHP`.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `ast_grep_search` for `import $$$ from "@colyseus$$$"` in `src/math/complexity.ts` → 0 matches (pure).
  - [ ] `npx vitest run server/test/math/complexity.test.ts` → all enumerated cases pass:
        `computeEligibleComplexity(parse("x")) === 0`;
        `computeComplexity(parse("x^2 + 3*x")) === 2`;
        `computeComplexity(parse("x^2 + y")) === 3` AND eligible;
        `computeComplexity(parse("sin(x) + cos(y)")) === 3`;
        explicit `g(f(x))` form (parse `g(f(x))` with prior assignment) → `+2` from composition;
        `parse("[[1,2],[3,4]]")` → 0; `parse("3 + 2i")` → 0; `parse("x*y + z + 1")` → 5.
  - [ ] Pre-substituted `sin(x^2)` does NOT add composition +2 (only explicit FunctionAssignmentNode-composed form does).

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Walker returns pinned scores for rulebook examples incl. f(x)=x→0 ineligible and composition +2
    Tool: Bash
    Preconditions: T8 counters merged or on contract; mathjs installed.
    Steps:
      1. `cd server && cat > /tmp/complexity.test.ts <<'EOF'
         import { computeComplexity, computeEligibleComplexity, isEligibleForHP } from "./src/math/complexity";
         import { parseExpression } from "./src/math/expressions";
         const cases: [string, number, boolean][] = [
           ["x",                0, false],  // f(x)=x: raw=1 but ineligible → eligible-complexity=0
           ["x^2 + 3*x",        2, false],  // 1 var + 1 term-beyond-first
           ["x^2 + y",          3, true],   // 2 vars + 1 term-beyond-first  (RULEBOOK required example)
           ["sin(x) + cos(y)",  3, true],   // 2 vars + 1 term-beyond-first  (RULEBOOK required example)
           ["x*y + z + 1",      5, true],   // 3 vars + 2 terms-beyond-first
           ["[[1,2],[3,4]]",    0, false],  // matrix 0 vars
           ["3 + 2i",           0, false],  // complex constant, 0 vars
           // composition via FunctionAssignmentNode:
           // parse "f(x, y) = ..." then body referencing another FunctionNode:
         ];
         for (const [expr, wantScore, wantEligible] of cases) {
           const n = parseExpression(expr);
           const got = computeEligibleComplexity(n);
           const elig = isEligibleForHP(n);
           assert got === wantScore : `${expr}: got ${got} want ${wantScore}`;
           assert elig === wantEligible : `${expr}: eligible ${elig} want ${wantEligible}`;
         }
         // raw (non-eligible-gated) for f(x)=x:
         assert computeComplexity(parseExpression("x")) === 1 : "raw score 1 even when ineligible";
      2. `npx vitest run /tmp/complexity.test.ts` → all asserts pass.
    Expected Result: every pinned case matches: f(x)=x→eligibleComplexity 0 + ineligible; x^2+y→3 eligible; sin(x)+cos(y)→3 eligible; x*y+z+1→5 eligible; matrix & complex constant →0 ineligible. raw computeComplexity("x")===1.
    Failure Indicators: x scored eligible (>0); composition hits miscounted (sin/cos single-fn miscounted as composition); matrix/complex counted >0.
    Evidence: .sisyphus/evidence/task-9-complexity-scoring.txt
  ```

  ```
  Scenario: Composition +2 fires only for explicit FunctionAssignmentNode-composed form, NOT for pre-substituted sin(x^2)
    Tool: Bash
    Preconditions: walker compiled.
    Steps:
      1. `cd server && cat > /tmp/complexity-comp.test.ts <<'EOF'
         import { computeComplexity } from "./src/math/complexity";
         import { parseExpression } from "./src/math/expressions";
         // pre-substituted composition — should NOT add +2:
         const pre = parseExpression("sin(x^2)");
         const preScore = computeComplexity(pre);
         // explicit composition via FunctionAssignmentNode:
         //   f(x) = x^2 ; g(u) = sin(u) ; expr = g(f(x)) parsed as assignment-wrapped form:
         const comp = parseExpression("f(x) = x^2 ; g(u) = sin(u) ; g(f(x))");  // math.js parses multi-statement w/ FunctionAssignmentNode
         const compScore = computeComplexity(comp);
         assert preScore === 1 : "pre-substituted: 1 var, 0 terms-beyond, 0 composition -> raw 1";
         assert compScore - preScore >= 2 : "explicit composition adds at least +2";
      2. `npx vitest run /tmp/complexity-comp.test.ts` → asserts pass.
    Expected Result: pre-substituted `sin(x^2)` score 1 (no composition bonus); explicit `g(f(x))` via FunctionAssignmentNode ≥ raw-pre + 2 (composition hit gives +2 each).
    Failure Indicators: pre-substituted form incorrectly receives +2 (composition over-counted); explicit composed form receives no +2 (composition under-counted); FunctionNode trig mis-identified as composition.
    Evidence: .sisyphus/evidence/task-9-composition-detection.txt
  ```

  **Evidence to Capture**:
  - [ ] vitest output for both scenario files.
  - [ ] ast_grep output: 0 Colyseus imports in complexity.ts.
  - [ ] tsc exit 0.
  - [ ] a table mapping each pinned case → inputs/scores reflecting the rulebook examples verbatim.

  **Commit**: YES (groups with all of Wave 2)
  - Message: `feat(math): complexity-score AST walker (rulebook scoring + eligibility)`
  - Pre-commit: `npx tsc --noEmit && npx vitest run server/test/math`
- [ ] T10. Room class + lifecycle + reconnection + 2P auto-lock

**What to do**
- Create `server/src/rooms/NerdiClashRoom.ts` extending `Colyseus.Room` (Colyseus 0.16+ API).
- Implement lifecycle ordering strictly: `onCreate(options)` → `onAuth(client, options, request)` → `onJoin(client, options)` → `onLeave(client, consented)` → `onDispose()`. `onCreate` runs BEFORE any `onJoin`.
- In `onCreate`: instantiate the `GameRoomState` schema (T6) and call `this.setState(...)`. Set `state.phase = "waiting"`. Set `this.maxClients = 2`. Set `this.patchRate = 50` (ms — 20 Hz state sync). Set `this.autoDispose = true`. Set `this.maxMessagesPerSecond = 10` (per-client intent rate limit). Call `this.setMetadata({ mode: "nerdiclash" })`.
- On the FIRST `onJoin` nothing special beyond incrementing connected counter; on the SECOND `onJoin` (when `this.clients.length === 2`) call `this.lock()` to auto-lock the room against late joiners. Then transition to construction phase (phase orchestration delegated to T11's FSM via a `requestTransition(phase)` call — T11 provides this; T10 just calls it). If FSM not yet integrated, leave a single call site `this.phaseController.requestTransition("construction")` (T11 integration point, NOT implemented in T10).
- Build the **StateView hand filter** concretely: for each joined client call `client.view.add(this.state.players.get(client.sessionId))` so each client sees only its own `Player` schema by default. Then loop over the player's `hand` ArraySchema and `client.view.add(card)` for every card currently in hand. Document the CRITICAL pitfall: any future code that pushes a new card into a player's hand MUST also call `client.view.add(newCard)` for that player's client — this is delegated to T7 zone-utils, but T10 establishes the baseline registration on join and on chemata init. (See `References` for the rule.)
- Implement **reconnection**: in `onLeave(client, consented)` if `consented === false` (unexpected drop) call `await this.allowReconnection(client, 30)` (30 s grace window). If consented OR the 30 s `allowReconnection` promise rejects/throws, mutate `players.get(client.sessionId).connected = false`; do NOT remove the player schema (preserve seat). If BOTH players are disconnected and reconnection window elapsed, call `this.disconnect()` (auto-dispose path).
- Register the room under name `"nerdiclash"` in `server/src/app.config.ts` (Room registration is fine to wire here; app definition is T1.)
- Expose a minimal `"ping"` message handler (`this.onMessage("ping", () => {})`) to verify in QA that the room accepts messages respecting the rate limit.

**Must NOT do**
- Do NOT implement phase transition logic beyond the single `requestTransition("construction")` call site — T11 owns the FSM.
- Do NOT mutate `phase`, `currentTurn`, or `turnDeadline` directly from `NerdiClashRoom` — go through T11's controller (the single call site above is the only allowed touch).
- Do NOT store math.js `Node` objects anywhere (would break serialization). Expression strings only — T6/T8 own this; T10 just receives them.
- Do NOT call `this.unlock()` ever — once locked, locked for the game lifetime.
- Do NOT add `as any`, `@ts-ignore`, empty catches, or `console.log` in prod paths.
- Do NOT implement matchmaking beyond `joinOrCreate("nerdiclash")` defaults. No lobbies, no N-player fan-out.
- Do NOT persist game state to any database; games are ephemeral and disposed on `onDispose`.

**Recommended Agent Profile**
- Category: `unspecified-high`
- Skills: `[paseo-advisor]`
- Evals: `npx ts-node` snippet instantiates room offline (via `@colyseus/testing` `DummyServer`/`matchMaker` test harness), creates 2 dummy clients, asserts `room.locked === true`, `room.maxClients === 2`, `room.patchRate === 50`, `state.phase === "waiting"` on join, and `players.size === 2` after second join. Vitest suite in `server/test/room/Lifecycle.test.ts`.

**Parallelization**
- Depends on T6 (state schema ready), T7 (zone-utils for `@view` registration helpers).
- Blocks T11 phase integration (T11 needs the `requestTransition` call site), T14 message handlers (need room instance), T15 edge cases.
- Parallel with T11, T12, T13, T14 as long as the T11→T10 touchpoint (the `requestTransition` call) is stubbed by T10 returning early if `this.phaseController` is undefined.

**References**
- Pattern: Colyseus Room lifecycle `onCreate→onAuth→onJoin→onLeave→onDispose`. WHY — lifecycle ordering race: setting `setState` must occur in `onCreate` so `onJoin` sees a valid `state`.
- Pattern: `client.view.add(schema)` filter for seat-private data. WHY — the #1 card-game bug in Colyseus: without `@view` registration, newly pushed cards to a `@view()` array leak to all clients OR don't appear to the owning client depending on registration order.
- Pattern: `await this.allowReconnection(client, 30)` inside `onLeave` when `consented === false`. WHY — preserves seat for 30 s drop tolerance.
- API: `this.lock()`, `this.setMetadata({...})`, `this.maxMessagesPerSecond = 10`, `this.patchRate`, `this.autoDispose`, `this.setState(...)` — all Colyseus 0.16+ public surfaces.
- Test: `@colyseus/testing` package (`matchMaker.joinOrCreate`) for headless room instantiation. WHY — Colyseus rooms can be driven offline in vitest without a real WS server.
- External: colyseus/turnbased-cards-demo (UNO) and namantam1/live-card-game (Call Break) reference repos for the lifecycle + lock pattern. WHY — both use `lock()` after maxClients reached and `allowReconnection` in `onLeave`.

**Acceptance Criteria**
- `server/src/rooms/NerdiClashRoom.ts` exists, exported, registered as `"nerdiclash"` in `app.config.ts`.
- `npx tsc --noEmit` passes with zero errors.
- `npx vitest run server/test/room/Lifecycle.test.ts` passes.
- Room test asserts: idle room has `phase === "waiting"`, `maxClients === 2`, `patchRate === 50`, `autoDispose === true`, `maxMessagesPerSecond === 10`, metadata `mode === "nerdiclash"`.
- After 2 simulated joins, `room.locked === true`, `state.players.size === 2`, both `Player.connected === true`, both players visible to their owner via `client.view` (assertable via the `@colyseus/testing` `client.state` snapshot — opposing player NOT present in `client.state.players`).
- Reconnection test: simulate unexpected drop (consented=false), advance clock 15 s, second client rejoins; original seat preserved; `Player.connected` flips false then true. After 35 s with no reconnect, `Player.connected === false` permanently and NOT removed from `players`.
- `ast_grep_search` run against `server/src/rooms/NerdiClashRoom.ts` returns zero matches for `console.log`, `as any`, `@ts-ignore`.

**QA Scenarios**
```
# HAPPY: two clients join, room locks, both seats registered
npx ts-node -e "
import { matchMaker, Server } from '@colyseus/testing';
const server = new Server();
server.define('nerdiclash', NerdiClashRoom);
await server.listen(0);
const a = await matchMaker.joinOrCreate('nerdiclash');
const b = await matchMaker.joinOrCreate('nerdiclash');
// inspect room via matchMaker.getRoomById
const room = matchMaker.getRoomById(a.roomId);
console.assert(room.locked === true, 'locked');
console.assert(room.maxClients === 2, 'maxClients');
console.assert(room.patchRate === 50, 'patchRate');
console.assert(room.state.phase === 'waiting', 'phase');
console.assert(room.state.players.size === 2, 'seats');
// a sees only a
console.assert(a.state.players.get(a.sessionId) !== undefined, 'a sees self');
console.assert(a.state.players.get(b.sessionId) === undefined, 'a does not see b');
process.exit(0);
"
# Expected: all asserts pass, exit 0.

# FAILURE: third join rejected because room locked
npx ts-node -e "
const room = await matchMaker.joinOrCreate('nerdiclash', {}); // joined
await matchMaker.joinOrCreate('nerdiclash', {}); // 2nd
let third;
try {
  third = await matchMaker.joinOrCreate('nerdiclash', {});
} catch (e) {
  console.log('reject as expected:', e.message);
  process.exit(0);
}
throw new Error('third join should have failed');
"
# Expected: third join throws (room locked), logs 'reject as expected', exit 0.
```

**Evidence**
- `.sisyphus/evidence/task-10-lifecycle-happy.{txt,log}` (full `npx ts-node` output).
- `.sisyphus/evidence/task-10-third-join-rejected.txt`.
- `.sisyphus/evidence/task-10-view-privacy.log` (dump of `a.state.players.keys()` and `b.state.players.keys()`).
- `.sisyphus/evidence/task-10-reconnect-15s.txt` (15 s reconnect succeeds; `connected` flips false→true).
- `.sisyphus/evidence/task-10-reconnect-35s.txt` (35 s reconnect fails; `connected === false`; player NOT removed — assert `players.size === 2`).

**Commit**: `feat(room): NerdiClashRoom lifecycle, reconnection, 2P auto-lock`

- [ ] T11. Turn state machine

**What to do**
- Build a **pure, Colyseus-free phase FSM** module `server/src/logic/fsm.ts` exporting `PhaseFSM` class plus a free-function `legalTransitions: Record<Phase, Phase[]>` table and a `tick(state, now)` reducer.
- Phase enum: `"waiting" | "construction" | "draw" | "play" | "defense" | "resolution" | "gameOver"`.
- **Phase transition table** (exact legal edges):
  - `waiting → construction`
  - `construction → draw` (both build_functions submitted + domains validated)
  - `draw → play`
  - `play → defense` (an offensive/playable triggered a window — empty window auto-advances on resolution tick)
  - `play → resolution` (no offensive, no defense window)
  - `defense → resolution`
  - `resolution → draw` (unless gameOver condition met → `resolution → gameOver`)
  - `draw → gameOver`, `play → gameOver`, `defense → gameOver`, `resolution → gameOver` (win condition met)
  - `construction → gameOver` (both fail submit within timeout — defer detail to T14; FSM just exposes the edge)
- `PhaseFSM.requestTransition(target: Phase): { ok: boolean; reason?: string }`: validates against the table above; mutates `state.phase` only if legal; returns `{ ok: false, reason: "illegal transition X→Y" }` otherwise.
- `PhaseFSM.tick(now: number)`: enforces timers — `turnDeadline` (ms epoch). On overrun: play phase → auto-pass to `resolution`; defense phase → auto-pass to `resolution`; construction → `gameOver` (both fail). Returns fired events list.
- **Initial construction phase**: synchronous — both players submit `"build_function"` intent (validate domain via T8 against their selected base FCC). Both submit → FSM emits `construction → draw`. Implement a `submitBuildFunction(state, playerId, payload)` free-function that the room will call from a message handler (T14). Invalid domain → rejection (no FSM transition). Timeout: each construction has 60 s; if either player fails to submit, FSM tick forces `construction → gameOver` with the submitter declared winner (winner selection left to T14/T13 win engine; FSM only flips phase).
- **Stalling prevention** state (per Wave 1/2 constraint #3, mirrored from schema): expose pure `onEvalTurn(state)` (reset `stalling_no_eval_turns = 0`) and `onNoEvalTurn(state)` (increment; cap 20). At `=== 5` consecutive OR `=== 20` global → FSM emits a `force-eval` event the room/turn-orchestrator consumes to call T12's force eval. Keep these as pure state mutators on a passed-in `FSMState` plain object (NOT the Colyseus schema — the schema's `stalling_no_eval_turns` field is mirrored from this local source-of-truth by the room tick).
- State vars on the FSM plain object: `currentTurn: number`, `turnDeadline: number`, `stalling_no_eval_turns: number`, `lastPhaseChangeAt: number`.
- Turn timers (concrete): `PLAY_MS = 30_000`, `DEFENSE_MS = 15_000`, `CONSTRUCTION_MS = 60_000`. Auto-pass on overrun per tick.
- **Testable**: `PhaseFSM` does NOT import Colyseus; takes a plain `FSMState` object. Verify with `ast_grep_search` that `server/src/logic/fsm.ts` zero-matches `from "colyseus"` / `@colyseus/`.

**Must NOT do**
- Do NOT import Colyseus into `fsm.ts` (purity). The room orchestrator module `server/src/rooms/phaseController.ts` (a thin glue layer) bridges Colyseus state ↔ FSMState; that bridge MAY import Colyseus but the FSM core MUST NOT.
- Do NOT mutate player HP, hands, or boards from the FSM — only phase/turn/stalling counters.
- Do NOT implement card effect dispatch (T12) or message parsing (T14) here. FSM is purely orchestration.
- Do NOT set `stalling_no_eval_turns` above 20 (clamp).
- Do NOT add `console.log`/`as any`/`@ts-ignore`.

**Recommended Agent Profile**
- Category: `deep`
- Skills: `[paseo-advisor]`
- Evals: `npx vitest run server/test/logic/fsm.test.ts` — pure unit tests asserting every legal edge, every illegal edge rejected, timer overrun fires auto-pass, stalling caps + triggers (5 / 20) work. `ast_grep_search` for Colyseus imports in `fsm.ts` returns zero.

**Parallelization**
- Depends on T6 (schema fields `phase`, `stalling_no_eval_turns`, `currentTurn`, `turnDeadline`) and T7.
- Consumed by T10 (single call site), T14 (handlers call `requestTransition` / `submitBuildFunction`), T15 (edge cases query FSM).
- Parallel with T12, T13, T14; integration deferred to T14.

**References**
- Pattern: Finite state machine + transition table + `tick(now)` reducer. WHY — decouples orchestration from Colyseus; pure unit-testable; deterministic given same `tick` clock.
- API: `Math.min/max` for clamping stalling counter (0..20). Pure `number` math — no floating point concerns in FSM.
- Test: vitest pure unit (`describe('PhaseFSM transitions', ...)`), no DB / no WS. WHY — fastest path; FSM has zero side effects.
- External: Mealy-machine references in CS literature; the colyseus/turnbased-cards-demo uses a loose phase string; we harden this with an explicit transition table.

**Acceptance Criteria**
- `server/src/logic/fsm.ts` exports `Phase`, `PhaseFSM`, `FSMState`, `legalTransitions`, and the timeout constants above.
- `npx vitest run server/test/logic/fsm.test.ts` 100% pass. Tests cover: every legal edge, every illegal edge (e.g. `play → waiting` rejected), `tick` overrun auto-pass (play 30 s → resolution, defense 15 s → resolution), `construction → gameOver` on timeout, stalling reset on eval, stalling cap at 20, stalling trigger at exactly 5 and exactly 20 firing the `force-eval` event.
- `ast_grep_search --pattern 'from "colyseus"' --lang typescript --paths server/src/logic/fsm.ts` returns zero matches.
- `npx tsc --noEmit` clean.

**QA Scenarios**
```
# HAPPY: legal waiting→construction→draw→play→defense→resolution→draw cycle
npx vitest run server/test/logic/fsm.test.ts -t "happy full cycle"
# Assertions:
#   waiting→construction ok; construction→draw ok after both submits;
#   draw→play ok; play→defense (offensive played); defense→resolution;
#   resolution→draw (no win); turn counter increments.
# Expected: PASS

# FAILURE: illegal play→waiting transition rejected
npx ts-node -e "
import { PhaseFSM } from './server/src/logic/fsm';
const s = { phase: 'play', currentTurn: 1, turnDeadline: 0, stalling_no_eval_turns: 0, lastPhaseChangeAt: 0 };
const fsm = new PhaseFSM(s);
const r = fsm.requestTransition('waiting');
console.assert(r.ok === false, 'must reject');
console.assert(/illegal/.test(r.reason || ''), 'reason');
// side-effect: s.phase unchanged
console.assert(s.phase === 'play', 'unchanged');
process.exit(0);
"
# Expected: both asserts pass, exit 0.
```

**Evidence**
- `.sisyphus/evidence/task-11-fsm-vitest.txt` (full vitest output).
- `.sisyphus/evidence/task-11-illegal-edge.txt` (`ts-node` snippet above).
- `.sisyphus/evidence/task-11-stalling-5.txt` (forced-eval event fires at exactly 5 consecutive).
- `.sisyphus/evidence/task-11-no-colyseus-import.txt` (`ast_grep_search` empty output + matched-files count 0).

**Commit**: `feat(room): turn phase FSM + timers + stalling + initial construction`

- [ ] T12. Card effect engine — @colyseus/command dispatch

**What to do**
- Install `@colyseus/command` (npm i @colyseus/command) and create `server/src/commands/` directory with one `Command` subclass per effect archetype. Each command extends `Command<GameRoomState, Payload>`.
- Per-card commands (frozen catalog from T3): `AddTermCommand`, `AttackHpCommand`, `TrapCommand`, `TheoremMartialCommand`, `TheoremArtifactCommand`, `AddBoardCommand`, `CompositionCommand`, `ForceEvalCommand`, `EvalCommand`, `DrawCommand`.
- A `CommandDispatcher` (singleton, plain TS — pure logic core, MAY import Colyseus `Command` base class but MUST NOT contain game rules itself) maps `intent -> command instance -> execute(state, payload)`.
- Track per-turn offensive limit: `this.offensivePlayedThisTurn: boolean` stored on state schema as `@type("boolean")` (added in T6 if missing — flag back to T6). Set true when `AttackHpCommand` OR `TheoremMartialCommand` resolves successfully. Reset to `false` on `resolution → draw` transition (FSM hook). Reject any second offensive intent with `{ ok:false, reason:"offensive already played this turn" }`.
- **Trap slot rule**: player may have at most ONE trap set at a time (`state.players[x].trapCardId: string`). Playing `TrapCommand` records the trap id in the trap slot AND sets `offensivePlayedThisTurn = true` (setting a trap prohibits offensive same turn and vice versa — modeled as: ANY of offensive/theorem-martial/trap sharing this single flag, OR a separate `trapPendingThisTurn` flag — choose one design consistently; recommend single flag named `aggressiveActionUsedThisTurn`).
- **Number card factor-binding**: a `NumberCard` played alongside `AttackHpCommand`/spell attaches as a multiplicative factor to that effect. Store binding as `state.players[x].boundFactor: { numberCardId: string; spellId: string } | null`. On either card's transit to graveyard (T7), unbind (`boundFactor = null`).
- **Fizzle rule**: at execute() time validate the target still exists in expected zone (board slot / player). If target destroyed/moved before resolution → the entire effect card moves to graveyard without applying its effect. Return `{ ok:true, fizzled:true }` (not an error — fizzle is a legal null outcome).
- **2 fully-specified command examples**:
  - `TrapCommand`:
    ```ts
    // commands/TrapCommand.ts
    import { Command } from "@colyseus/command";
    export class TrapCommand extends Command<GameRoomState, { playerId: string; trapCardId: string; }> {
      execute({ playerId, trapCardId }) {
        const p = this.state.players.get(playerId);
        if (this.state.players.get(playerId).aggressiveActionUsedThisTurn)
          return { ok:false, reason:"aggressive action already used this turn" };
        if (p.trapCardId !== "")
          return { ok:false, reason:"trap slot occupied" };
        p.trapCardId = trapCardId;       // cardiD of the trap card moved out of hand
        p.aggressiveActionUsedThisTurn = true;
        // move card from hand → "set" abstract slot (graveyard on resolve); delegated to T7
        return { ok:true };
      }
    }
    ```
  - `EvalCommand`:
    ```ts
    // commands/EvalCommand.ts
    import { Command } from "@colyseus/command";
    export class EvalCommand extends Command<GameRoomState, { playerId: string; boardIndex:number; vvcCardId: string; }> {
      execute({ playerId, boardIndex, vvcCardId }) {
        if (this.state.phase !== "play" && this.state.phase !== "resolution")
          return { ok:false, reason:"eval only in play/resolution" };
        const p = this.state.players.get(playerId);
        const vvc = p.hand.find(c => c.id === vvcCardId);
        if (!vvc || vvc.subtype !== "variable-value")
          return { ok:false, reason:"valid variable-value card required" };
        // delegate numeric compute to T13 evaluation engine
        const result = this.roomRef.evalEngine.evaluate(p, boardIndex, vvc.value);
        if (result.undefined) {
          p.boards[boardIndex].destroyed = true;
          return { ok:true, boardDestroyed:true };
        }
        // T13 computes HP_gainHP*10 increment; here we apply T13 output
        p.hp10 += result.hpGain10;  // T13 returns integer scaled ×10
        p.evaluatedThisTurn = true; // triggers stalling reset via FSM tick
        // variable-value card back to hand per rulebook (or graveyard per alt — ruled in T13 spec)
        return { ok:true };
      }
    }
    ```
- Each command's signature: `execute(state-fields-accessible-via-this, payload) => { ok:boolean; reason?:string; fizzled?:boolean; boardDestroyed?:boolean } | void`. List ALL ten in the implementation with stub bodies delegating numeric portions to T13.
- Run `paseo-committee` review pass to vet interactions (offensive↔trap↔number-binding↔fizzle) before merging.

**Must NOT do**
- Do NOT call `Math.random()` in commands (strict determinism) — moves from T7 which already seeded-shuffle.
- Do NOT persist math.js `Node` in state; re-parse strings on the fly.
- Do NOT escalate aggressive-action flag from MULTIPLE intents in one turn (enforce single use).
- Do NOT skip the fizzle check — every targeted command must verify target existence at execute time.
- Do NOT allow a trap + offensive in the same turn (single `aggressiveActionUsedThisTurn` guard covers both).

**Recommended Agent Profile**
- Category: `ultrabrain` (hard; many command types with subtle interaction matrix)
- Skills: `[paseo-advisor, paseo-committee]` — committee review for interaction correctness before sign-off.

**Parallelization**
- Depends on T8 (expression layer), T3 (card catalog definitions), T7 (zone utility for bind/unbind + graveyard).
- Blocks T13 (eval engine consumes EvalCommand), T14 (handlers dispatch via these).
- Parallel with T13, T14 — T13 reads `EvalCommand` interface contract; both designed together but implemented independently.

**References**
- Pattern: `@colyseus/command` `Command<State, Payload> extends execute(payload)`. WHY — testable in isolation, deterministic re-runs, decouples effect logic from message handler.
- Pattern: single `aggressiveActionUsedThisTurn` boolean shared across offensive/theorem-martial/trap. WHY — rulebook says max 1 aggressive; trap-and-offensive-in-same-turn is forbidden — single flag enforces both.
- API: `@colyseus/command` `Dispatcher` injected into room; `this.roomRef` back-reference available. `Command.execute` returns value is allowed (default void).
- Test: vitest unit per command with seeded state plain-object (no real Colyseus needed via `Command` base's standalone execute).
- External: colyseus/command README + the namantam1/live-card-game repo command pattern. WHY — confirms fizzle pattern is supported (return-early inside command).

**Acceptance Criteria**
- All 10 commands exist in `server/src/commands/`, exported, `Command`-extending.
- `npx vitest run server/test/commands/**/*.test.ts` passes — one suite per archetype min, with at minimum 1 happy + 1 failure case per (code assertions only).
- Offensive-limit test: `AttackHpCommand` succeeds once, second `AttackHpCommand` in same turn returns `{ ok:false }`.
- Trap+offensive test: setting a trap then playing an offensive in same turn rejects the offensive with `"aggressive action already used this turn"`.
- Number binding test: number card binds → effect scales by the number's value (assert concrete: factorCard value=2 doubles the offensive's HP damage from 5 to 10); unbind on graveyard returns factor to unbound state.
- Fizzle test: target board-slot pre-emptively destroyed; subsequent `AttackHpCommand` against it returns `{ ok:true, fizzled:true, boardDestroyed:false }` and the effect card transits to graveyard with no HP change.
- `npx tsc --noEmit` clean.
- Committee review note appended in PR description (or `.sisyphus/evidence/task-12-committee.md`).

**QA Scenarios**
```
# HAPPY: EvalCommand produces correct HP increment
npx ts-node -e "
import { EvalCommand } from './server/src/commands/EvalCommand';
const state = makeFakeStateWithBoard('x^2 + y', playing:true);
const cmd = new EvalCommand(); cmd.state = state; cmd.roomRef = { evalEngine:{ evaluate:()=>({ hpGain10: 20, undefined:false }) } };
const r = cmd.execute({ playerId:'p1', boardIndex:0, vvcCardId:'vvc-2' });
console.assert(r.ok === true, 'ok');
console.assert(state.players.get('p1').hp10 === 20, 'hp10 updated by exactly 20');
process.exit(0);
"
# Expected: hp10 === 20, exit 0.

# FAILURE: trap already set, second trap rejected
npx ts-node -e "
import { TrapCommand } from './server/src/commands/TrapCommand';
const state = makeFakeStateWithTrapAlreadySet();
const cmd = new TrapCommand(); cmd.state = state;
const r = cmd.execute({ playerId:'p1', trapCardId:'trap-2' });
console.assert(r.ok === false && /trap slot occupied/.test(r.reason), 'rejected');
process.exit(0);
"
# Expected: ok===false, exit 0.
```

**Evidence**
- `.sisyphus/evidence/task-12-commands-happy.{txt,log}` (all 10 happy paths).
- `.sisyphus/evidence/task-12-offensive-limit-rejected.txt` (second offensive fails).
- `.sisyphus/evidence/task-12-trap-plus-offensive-rejected.txt` (offensive-after-trap fails).
- `.sisyphus/evidence/task-12-factor-binding-and-unbind.txt` (factor 2 doubles damage; unbind restores).
- `.sisyphus/evidence/task-12-fizzle.txt` (fizzled path).
- `.sisyphus/evidence/task-12-committee.md` (committee conclusion notes).

**Commit**: `feat(cards): effect engine — command dispatch, offensive limit, trap, theorems`

- [ ] T13. Evaluation engine — HP formula

**What to do**
- Implement `server/src/logic/evalEngine.ts` — pure logic module (ZERO Colyseus imports; verify with `ast_grep_search`).
- Public entry: `evaluate(player: EvalInput, boardIndex: number, vvcValue: number): EvalResult`.
  - `EvalInput`: `{ expression: string; vars?: Record<string, number>; }` (and any board metadata from T6).
  - `EvalResult`: `{ value: number; complexity: number; hpGain10: number; undefined: boolean; reason?: string; }`.
- Steps in order:
  1. `node = math.parse(player.expression)` (T8 helper).
  2. Substitute variable values into the scope using the player's **Variable Value Card**: per spec, `{type:"variable-value", value:<n>}` — a single numeric value substitutes for ALL variables in the function under one scope. Implementation: build scope by walking the AST, collecting distinct variable names (T9 walker), and assigning each the SAME `vvcValue`. Log this clearly in code comment header (allowed — spec asks us to document).
     > Spec to document in acceptance **§13a. Variable Value Card**: "v1 Variable Value Card = a separate card subtype (`subtype:"variable-value"`, integer-or-irrational `value` field). The 5 starter VVCs per player are dealt during the construction phase alongside the base FCC. When `EvalCommand` fires, the played VVC's `value` substitutes for every distinct variable in the player's chosen board function. Example VVC instances: `{id:'vvc-2', subtype:'variable-value', value:2}`, `{id:'vvc-pi', subtype:'variable-value', value:Math.PI}`. This is the rulebook v1.0 mechanism; the alternative 'fixed set of 5 starter VVCs drawn during construction' is the DEAL policy — chosen: deal 5 to each player's hand at construction phase end."
  3. `value = node.compile().evaluate(scope)`.
  4. `complexity = T9Walker.complexityScore(node)` — per T9 rules: +1 per distinct variable, +1 per term beyond first, +2 per composition. `complexity < 2` variables-or-terms ⇒ ineligible ⇒ `hpGain10 = 0` (not undefined; legal zero).
  5. `hpGain10 = Math.floor(value * complexity / 10) * 10` — HP stored as integer ×10 (see schema constraint #4). Use `Math.floor` for HP GAIN (loss cases use floor toward zero).
  6. Undefined/infinite detection: wrap step 3 in try/catch; check `!Number.isFinite(value) || Number.isNaN(value)` ⇒ return `{ undefined:true, reason, value:NaN, complexity:0, hpGain10:0 }`. Caller (`EvalCommand`) marks board destroyed and (per win engine T14) immediate loss if the destroyed board was the player's only surviving function (integral to survival).
- **Force-eval** entry: `forceEval(state): { winner?: string; draw?: boolean; redistributions: Array<{ from:string; to:string; hp10Transferred:number; }> }`.
  - Collect all evaluated boards' current FunctionValues for THIS resolution cycle. Each player's effective ForceValue = the board value at the time force eval triggered (use the players' most recent valid `value`, snapshot before resolution).
  - Determine winner: player A wins iff `A.value > 2 × B.value + 1e-9` (FP epsilon per constraint #4) AND `A.value > 2 × C.value + 1e-9` for every other player. In 2P this is `A.value > 2*B.value + 1e-9`.
  - On win: redistribute HP — each LOSER loses `floor(halfOfLoserHp10 / nWinners) * 10` where `nWinners=1` in 2P, and winners gain it. Remainder (post-floor) is DISCARDED. Explicitly: `loserHp10 -= Math.floor(loserHp10 / 2 / 1) * 10; winnerHp10 += Math.floor(loserHp10Before / 2 / 1) * 10;` (loserHp10Before captured first). Epsilon never enters redistribution (floor on integers).
  - If no winner (`A.value ≯ 2×B.value + 1e-9` and `B.value ≯ 2×A.value + 1e-9`) ⇒ nominator's main board destroyed. If the nominator's main board destruction alone wouldn't already cause loss under T14 rules, just destroy the board and end the cycle.
  - After force eval: used VVCs return to hand, evaluated function reshuffled into FCC deck (T7 deck exhaust handling).
- Return value concrete example with the doc's example data:
  - `f(x,y) = x^2 + y` at `scope = { x:2, y:3 }` → `value = 7`.
  - T9 walker: 2 distinct vars (x, y) ⇒ +2; 1 term beyond first ⇒ +1; 0 compositions ⇒ 0. **Verify against T9 walker rules** — expected `complexity = 3` (if T9 says "term beyond first" counts terms, not vars; the doc lists two distinct variable terms (x, y) = +2, plus one term beyond first = +1, total 3). Record this in `.sisyphus/evidence/task-13-concrete-complexity.txt` showing T9 walker output exactly = 3.
  - `hpGain = Math.floor(7 × 3 / 10) = Math.floor(2.1) = 2`; `hpGain10 = 2 * 10 = 20`. HP×10 field increments by 20.

**Must NOT do**
- Do NOT import Colyseus in `evalEngine.ts`.
- Do NOT store math.js `Node` in state — `node.toString()` discarded after compute.
- Do NOT use floating-point comparison for "win" tests without epsilon.
- Do NOT redistribute HP without `Math.floor` (constraint #4).
- Do NOT exceed 2 winners in 2P (always single winner or no winner).
- Do NOT skip FP epsilon on `2×` rule — `>` strictly with `+1e-9` margin.

**Recommended Agent Profile**
- Category: `deep`
- Skills: `[paseo-advisor]`
- Evals: `npx ts-node` REPL snippet asserting the concrete example (value, complexity, hpGain10). `npx vitest run server/test/logic/evalEngine.test.ts`.

**Parallelization**
- Depends on T8 (expression layer), T9 (complexity walker).
- Blocks T14 (handlers call eval engine via EvalCommand).
- Parallel with T12 (EvalCommand calls back into this engine) via agreed interface only.

**References**
- Pattern: HP Gain = `(FunctionValue × ComplexityScore) / 10`, HP stored ×10. WHY — rulebook formula + integer math to evade FP nondeterminism across platforms.
- API: `math.parse(str)`, `node.compile().evaluate(scope)`, `Number.isFinite`, `Math.floor`. WHY — math.js safe evaluator + IEEE 754 sanity.
- Pattern: FP epsilon `1e-9` for value comparisons; integer ×10 stored HP. WHY — constraint #4 fixes cross-platform FP divergence.
- Test: `npx ts-node -e "import(...); console.assert(...)"` for the concrete numeric example. WHY — exact deterministic value.
- External: rulebook §Playing Math (HP Gain formula). math.js guide on `evaluate` scope.

**Acceptance Criteria**
- `server/src/logic/evalEngine.ts` exports `evaluate` and `forceEval` as specified.
- `npx vitest run server/test/logic/evalEngine.test.ts` 100% pass.
- Concrete example asserts in tests: `value=7`, `complexity=3`, `hpGain10=20`, and after applying HP the player schema's `hp10` increases by exactly 20.
- Undefined test: `expression="1/0"` or `expressions with sqrt(-1) used in real-only context` ⇒ `{ undefined:true }` and zero HP change.
- Force-eval domination tests (3 cases):
  - `A=100, B=30` ⇒ A wins (100 > 60+1e-9 ✓). Loser HP redistributed: `B_hp10 -= floor(B_hp10/2)*10`, `A_hp10 += floor(B_hp10/2)*10` with B's pre-transfer hp10 = e.g. 300 ⇒ loses 150, A gains 150.
  - `A=60 exactly, B=30` ⇒ A does NOT win (60 ≯ 60 + 1e-9). Falls to no-winner path → nominator's main board destroyed.
  - `A=60.0001, B=30` ⇒ A wins (60.0001 > 60 + 1e-9 ✓).
- `ast_grep_search --pattern 'from "colyseus"' --lang typescript --paths server/src/logic/evalEngine.ts` returns zero matches.
- `npx tsc --noEmit` clean.

**QA Scenarios**
```
# HAPPY: f(x,y)=x^2+y at VVC value=2 substituted into both vars ... wait, doc says single VVC value substitutes for ALL vars.
# Use one VVC with value=2 for both x and y → value = 2^2 + 2 = 6; complexity = 3; hpGain10 = floor(6*3/10)*10 = 10.
npx ts-node -e "
import { evaluate } from './server/src/logic/evalEngine';
const r = evaluate({ expression:'x^2 + y' }, 0, 2);
console.assert(r.value === 6, 'value');
console.assert(r.complexity === 3, 'complexity');
console.assert(r.hpGain10 === 10, 'hpGain10');
console.assert(r.undefined === false, 'defined');
process.exit(0);
"
# Expected: all asserts pass, exit 0. (Note: here scope is {x:2, y:2} because single-VVC substitution.)
# Spec verify: the doc's f(x,y)=x^2+y at scope {x:2,y:3}=7 is the canonical happy case where separate VVCs exist per var.
# That's the alt-policy not chosen here; the chosen policy (single VVC all-var subs) gives the above. Document both in evidence file.

# FAILURE: A=60 exactly vs B=30 → no domination
npx ts-node -e "
import { forceEval } from './server/src/logic/evalEngine';
const state = { players:[
  { id:'A', lastForceValue:60,   lastMainBoardHp10:300, mainBoardExpr:'x' },
  { id:'B', lastForceValue:30,   lastMainBoardHp10:120, mainBoardExpr:'y' },
] };
const r = forceEval(state, { nominatorId:'A' });
console.assert(r.winner === undefined, 'no winner');
console.assert(r.redistributions.length === 0, 'no HP moved');
console.assert(r.nominatorBoardDestroyed === true, 'A board destroyed'); // path taken
process.exit(0);
"
# Expected: no winner, no redistribution, A's board destroyed, exit 0.
```

**Evidence**
- `.sisyphus/evidence/task-13-concrete-eval.txt` (happy case above, exact output).
- `.sisyphus/evidence/task-13-concrete-complexity.txt` (T9 walker output = 3 trace).
- `.sisyphus/evidence/task-13-force-eval-A100-vs-B30.txt` (A wins case).
- `.sisyphus/evidence/task-13-force-eval-A60-vs-B30.txt` (no domination case — the BEHAVIOR point).
- `.sisyphus/evidence/task-13-force-eval-A60.0001-vs-B30.txt` (A wins with FP epsilon margin).
- `.sisyphus/evidence/task-13-redistribution-floor.txt` (HP redistribution via `Math.floor`, remainder discarded — e.g. loser 305×10 ⇒ 152*10 transferred, 10 remainder discarded).
- `.sisyphus/evidence/task-13-undefined.txt` (1/0 ⇒ undefined:true).
- `.sisyphus/evidence/task-13-no-colyseus.txt` (`ast_grep_search` empty).

**Commit**: `feat(logic): evaluation engine — HP formula, force eval, undefined handling`

- [ ] T14. Win condition engine

**What to do**
- Implement `server/src/logic/winEngine.ts` — pure logic, ZERO Colyseus imports (`ast_grep_search` verifies).
- Entry: `checkWin(state): { winner?: string; loser?: string; reason: "hp0" | "isolation" | "force-dom" | "singular" | "dim0"; }` — runs after EVERY state mutation that touches HP, boards, evaluation, or `variable_isolation_timers`.
- Check ordering (top-down short-circuit):
  1. **(a) HP=0**: any player `hp10 <= 0` ⇒ that player loses, opponent wins.
  2. **(b) Variable isolation + 3-turn rebuild fail**: a player's main board expression isolated to a single variable (T8 `isIsolated(expr)` OR `expr === "x"` OR `/^[a-z]$/` matches) AND `variable_isolation_timers.get(playerId)` reaches 0 (decrement on isolated player's turn; counter initialized to 3 when isolation first detected). At 0 ⇒ opponent wins. Reset the timer to undefined/absent whenever the player rebuilds their function (function rebuilt in construction phase ⇒ timer cleared).
  3. **(c) Force-eval domination**: checked inside T13's `forceEval` — T14 re-exports the winner/destroyed result via the same `checkWin` so a single entry point sees it (`checkWin` reads last force-eval recorded state).
  4. **(d) Vector-space dim → 0 or matrix board singular (`det=0`)**: detected per-board ⇒ board destroyed ⇒ LOSE if that board is integral (the only surviving function for that player). Otherwise log `boardDestroyed`, not game loss.
- Per-player `variable_isolation_timers`:
  - Initialized absent.
  - When `isIsolated(expr)` first true and timer absent ⇒ set timer = 3.
  - On the isolated player's `resolution → draw` transition, decrement timer.
  - On function rebuild (construction button in T11) ⇒ clear timer (delete key).
- Return shape: `{ winner, loser, reason }`. `winner` undefined while game continues.
- Concrete example A (HP path): A `hp10=0` after attack consumption (T12 `AttackHpCommand` with factor 2 dealt 10 dmg to A who was at 10) ⇒ lost ❌ — actually `hp10=10` total ⇒ A loses, B wins. Concrete example B (isolation): A's main board `f(x)=x` (matches `/^[a-z]$/` ⇒ isolated); A's opponent B has a trap "stuck" narrative; A's `variable_isolation_timers.get('A')=3` starts; decremented each of A's turns (treat each of A's `resolution→draw` as A's turn — strict 2P alternating); reaches 0 after three turns with no rebuild ⇒ B wins.
- Hook `checkWin` into the FSM `tick` (after each phase transition completion) AND into command `execute` post-success paths via T12/T13 entry contract.

**Must NOT do**
- Do NOT import Colyseus in `winEngine.ts` (pure).
- Do NOT mutate HP / timers from `checkWin` — read-only. Timers mutate happens in T11 FSM `tick` (decrement) and a `rebuild` action (clear) — `winEngine` only READS them.
- Do NOT bypass FP epsilon for HP comparisons (constraint #4) — but HP is stored ×10 integer so hp10 ≤ 0 comparisons are exact.
- Do NOT declare win on a non-integral board singular/dim-0 case — only integral boards.
- Do NOT skip `reason` field — every win emits a specific `reason` for client broadcast & QA log.

**Recommended Agent Profile**
- Category: `unspecified-high`
- Skills: `[paseo-advisor]`
- Evals: `npx vitest run server/test/logic/winEngine.test.ts` pure unit tests with all 4 reason branches.

**Parallelization**
- Depends on T12, T13 (consumes their outputs).
- Blocks T14 message handlers integrate detection into intents (handled in T14-message-handlers).

**References**
- Pattern: post-mutation guard (`Mutator → checkWin`). WHY — keeps win detection in one place; avoids races where a command clears HP/test isolation then tick fires off old storage.
- API: T8 `isIsolated(expr)`, `math.det(matrixExpr)` (if board is matrix). T9 walker (for distinct var counting on isolated expression).
- Pattern: integer ×10 HP comparison `hp10 <= 0` exact; epsilon unnecessary on integers. WHY — constraint #4 means real FP lives only on `forceEval` `2×` rule; HP itself is integer.
- Test: pure unit tests with plain fixtures — no WS / no Colyseus.
- External: rulebook §Victory Conditions (HP, isolation, domination, linalg singular/dim).

**Acceptance Criteria**
- `server/src/logic/winEngine.ts` exports `checkWin` and (re-exported) `force-eval` adjudicator glue.
- `npx vitest run server/test/logic/winEngine.test.ts` 100% pass with at least one happy + one failure per branch (4 branches).
- Concrete A test fixture: A `hp10=10`, B `hp10=300`; `AttackHpCommand` reduces A `hp10` to 0 ⇒ `checkWin` returns `{ winner:'B', loser:'A', reason:'hp0' }`.
- Concrete B test fixture: A `mainBoardExpr='x'` (/^[a-z]$/), timer init=3; FSM ticks A's turns three times (`resolution→draw` triggered); assert each turn decrements timer (3→2→1→0); at 0 ⇒ `checkWin` returns `{ winner:'B', loser:'A', reason:'isolation' }`.
- Singular non-integral board test: a secondary board `matrixExpr` has `det=0` ⇒ `winEngine` returns no winner, but flags `secondaryBoardDestroyed=true` (in returned side-effect object — keep `checkWin` itself pure: return extra field `destroyedPlayerBoards: string[]`).
- Singular integral board test: only surviving board of player C `det=0` ⇒ returns `{ winner:'OpponentId', loser:'C', reason:'singular' }`.
- `ast_grep_search --pattern 'from "colyseus"' --lang typescript --paths server/src/logic/winEngine.ts` returns zero matches.
- `npx tsc --noEmit` clean.

**QA Scenarios**
```
# HAPPY: HP=0 immediate win
npx ts-node -e "
import { checkWin } from './server/src/logic/winEngine';
const state = { players:[
  { id:'A', hp10: 0, mainBoardExpr:'x^2+y', boards:[{destroyed:false}], vvc:[], variableIsolationTimer:null },
  { id:'B', hp10:300, mainBoardExpr:'x+y',   boards:[{destroyed:false}], vvc:[], variableIsolationTimer:null },
] };
const w = checkWin(state);
console.assert(w.winner==='B' && w.loser==='A' && w.reason==='hp0', 'B wins hp0');
process.exit(0);
"
# Expected: B wins, exit 0.

# FAILURE: isolated but timer=2 not yet expired → no win declared
npx ts-node -e "
import { checkWin } from './server/src/logic/winEngine';
const state = { players:[
  { id:'A', hp10:300, mainBoardExpr:'x', boards:[{destroyed:false}], variableIsolationTimer:2 },
  { id:'B', hp10:300, mainBoardExpr:'x+y', boards:[{destroyed:false}], variableIsolationTimer:null },
] };
const w = checkWin(state);
console.assert(w.winner===undefined, 'no win yet');
console.assert(state.players[0].variableIsolationTimer === 2, 'untouched');
process.exit(0);
"
# Expected: no winner, timer unchanged at 2, exit 0.
```

**Evidence**
- `.sisyphus/evidence/task-14-winengine-vitest.txt` (vitest full output).
- `.sisyphus/evidence/task-14-hp0-win.txt` (example A).
- `.sisyphus/evidence/task-14-isolation-timer-3to0.txt` (example B with trace of timer 3→2→1→0).
- `.sisyphus/evidence/task-14-singular-nonintegral.txt` (no global win, only board destroyed).
- `.sisyphus/evidence/task-14-singular-integral.txt` (`reason:"singular"` triggered).
- `.sisyphus/evidence/task-14-no-colyseus.txt`.

**Commit**: `feat(logic): win conditions — HP, isolation, force-dom, vec/singular`
- [ ] 15. Message Handlers with Zod Validation + Full Server-Side Validation

  **What to do**
  - Implement `server/src/rooms/handlers/` directory containing one handler module per client→server message type. Wire every handler into the GameRoom `onMessage` registry (T10 Room class) so that incoming intents are fully validated before any state mutation.
  - Enumerate and implement handlers for **every** client→server message type. Each message name + its Zod payload schema (keys sourced from T2 message contracts):
    - `build_function` → `z.object({ boardId: z.number().int().min(1).max(3), expressionStr: z.string().min(1).max(500) })`
    - `play_card` → `z.object({ cardId: z.string(), target: z.object({ kind: z.enum(["player","board","card","none"]), id: z.string().optional() }) })`
    - `draw_cards` → `z.object({ deckChoices: z.array(z.object({ deck: z.enum(["fcc","number","action"]), count: z.number().int().min(1) })).min(1).max(3) })` — sum of `count` must equal 2 (server validates total; Zod only validates shape here, matching T2's batched contract)
    - `set_trap` → `z.object({ cardId: z.string(), slot: z.number().int().min(1).max(3) })`
    - `play_defense` → `z.object({ cardId: z.string(), targetTriggerId: z.string() })`
    - `eval_function` → `z.object({ boardId: z.number().int().min(1).max(3), variableValueCardId: z.string() })`
    - `force_eval` → `z.object({ variableValueCardId: z.string() })`
    - `end_turn` → `z.object({})`
    - `ready_inst` → `z.object({})`
    - `leave_room` → `z.object({})`
  - Every handler performs this fixed 6-step contract:
    1. **Zod-validated payload** — parse `message.payload` against the per-type schema from T2; on `ZodError` return structured `error` broadcast with code `INVALID_PAYLOAD` + the zod issue path joined by `.`.
    2. **Verify phase legal for message** — check `state.phase` against a per-message allowlist (see phase map below); on mismatch reject with `NOT_PHASE_NOT_DRAW` (the rulebook's catch-all "illegal phase" code; reused for non-draw-phase illegal intents).
    3. **Verify turn owner** — compare `state.currentTurnPlayerId` against `client.sessionId`; on mismatch reject with `NOT_YOUR_TURN`.
    4. **Verify card in hand & legal target** — check `cardId` exists in player's `hand` ArraySchema (`CARD_NOT_IN_HAND` if missing) and `target` resolves to a legal live game object (`INVALID_TARGET`).
    5. **Dispatch to T12 command** — construct the matching `@colyseus/command` instance (from T12 card-effect engine / T13 evaluation engine / T7 zone utils) and `await this.room.dispatcher.dispatch(cmd, payload)`.
    6. **Reject with structured error code** — on any domain-rule failure (offensive limit exceeded, trap blocks offensive, too many actions this play-phase) broadcast `error` with the matching code from `ErrorCode` enum.
  - Per-message legal phase map:
    - `draw_cards` → `phase === "draw"`
    - `build_function` → `phase === "construction"` (initial function construction per T11 initial phase) OR `phase === "play"` (in-game add-term via FCC); validator dispatches by phase
    - `play_card`, `set_trap`, `eval_function`, `force_eval`, `end_turn` → `phase === "play"`
    - `play_defense` → `phase === "defense"`
    - `ready_inst`, `leave_room` → any phase (lifecycle messages — no turn-owner check)
  - Define **structured error code enum** in `server/shared/ErrorCode.ts`:
    ```ts
    export enum ErrorCode {
      INVALID_PAYLOAD          = "INVALID_PAYLOAD",
      NOT_PHASE_NOT_DRAW       = "NOT_PHASE_NOT_DRAW",
      NOT_YOUR_TURN            = "NOT_YOUR_TURN",
      CARD_NOT_IN_HAND         = "CARD_NOT_IN_HAND",
      INVALID_TARGET           = "INVALID_TARGET",
      OFFENSIVE_LIMIT_EXCEEDED = "OFFENSIVE_LIMIT_EXCEEDED",
      TRAP_BLOCKS_OFFENSIVE    = "TRAP_BLOCKS_OFFENSIVE",
      TOO_MANY_ACTIONS         = "TOO_MANY_ACTIONS",
      ROOM_FULL                = "ROOM_FULL",
      INTERNAL                 = "INTERNAL",
    }
    ```
  - Server→client broadcast messages (only 3 message types out to clients):
    - `error` → `{ code: ErrorCode, message: string, requestId?: string }`
    - `game_event` → `{ event: string /* event JSON sub-document */, actorId: string, turnId: number }` (one per state-mutating dispatch)
    - `game_over` → `{ winnerId: string|null, reason: "hp_zero"|"isolation"|"force_dom"|"vec_singular"|"undefined_eval" }`
  - Emit `game_event` broadcasts **from inside the dispatched commands** (T11/T12), NOT from the handler itself — the handler is responsible only for validation + dispatch + error reporting. This keeps single-source-of-truth on what mutated state.
  - Example handler pseudo-bodies (3 — required by spec):

    **build_function**
    ```ts
    async onBuildFunction(client: Client, raw: unknown) {
      const parsed = BuildFunctionSchema.safeParse(raw);
      if (!parsed.success)
        return this.broadcastError(client, ErrorCode.INVALID_PAYLOAD, parsed.error.issues.map(i=>i.path.join(".")).join("; "));
      if (state.phase !== "play")
        return this.broadcastError(client, ErrorCode.NOT_PHASE_NOT_DRAW, `build_function only legal in play phase; current=${state.phase}`);
      if (state.currentTurnPlayerId !== client.sessionId)
        return this.broadcastError(client, ErrorCode.NOT_YOUR_TURN, "build_function by non-turn owner");
      const player = state.players.get(client.sessionId);
      if (!player) return this.broadcastError(client, ErrorCode.INTERNAL, "player state missing");
      // boardId legal range validated by zod; board existence:
      if (!player.boards.some(b => b.id === parsed.data.boardId))
        return this.broadcastError(client, ErrorCode.INVALID_TARGET, `board ${parsed.data.boardId} not owned`);
      await this.room.dispatcher.dispatch(new BuildFunctionCommand(), {
        playerId: client.sessionId,
        boardId: parsed.data.boardId,
        expressionStr: parsed.data.expressionStr,
      });
    }
    ```

    **play_card**
    ```ts
    async onPlayCard(client: Client, raw: unknown) {
      const parsed = PlayCardSchema.safeParse(raw);
      if (!parsed.success) return this.broadcastError(client, ErrorCode.INVALID_PAYLOAD, /* joined path */);
      if (state.phase !== "play") return this.broadcastError(client, ErrorCode.NOT_PHASE_NOT_DRAW, "");
      if (state.currentTurnPlayerId !== client.sessionId) return this.broadcastError(client, ErrorCode.NOT_YOUR_TURN, "");
      const player = state.players.get(client.sessionId)!;
      const card = player.hand.find(c => c.id === parsed.data.cardId);
      if (!card) return this.broadcastError(client, ErrorCode.CARD_NOT_IN_HAND, parsed.data.cardId);
      // offensive limit, enforced by T12 effect engine via command — but pre-check here for fast fail:
      if (card.kind === "offensive" && player.offensivePlayedThisTurn >= 1)
        return this.broadcastError(client, ErrorCode.OFFENSIVE_LIMIT_EXCEEDED, "max 1 offensive/turn");
      // trap blocking offensive is a T11 resolution concern; command returns a Result → map to error
      const result = await this.room.dispatcher.dispatch(new PlayCardCommand(), { playerId: client.sessionId, cardId: card.id, target: parsed.data.target });
      if (!result.ok && result.code === "TRAP_BLOCKED")
        return this.broadcastError(client, ErrorCode.TRAP_BLOCKS_OFFENSIVE, result.message);
    }
    ```

    **force_eval**
    ```ts
    async onForceEval(client: Client, raw: unknown) {
      const parsed = ForceEvalSchema.safeParse(raw);
      if (!parsed.success) return this.broadcastError(client, ErrorCode.INVALID_PAYLOAD, /* ... */);
      if (state.phase !== "play") return this.broadcastError(client, ErrorCode.NOT_PHASE_NOT_DRAW, "force_eval only legal in play phase");
      if (state.currentTurnPlayerId !== client.sessionId) return this.broadcastError(client, ErrorCode.NOT_YOUR_TURN, "");
      const player = state.players.get(client.sessionId)!;
      const vvCard = player.hand.find(c => c.id === parsed.data.variableValueCardId && c.kind === "variable_value");
      if (!vvCard) return this.broadcastError(client, ErrorCode.CARD_NOT_IN_HAND, "variable value card not in hand");
      await this.room.dispatcher.dispatch(new ForceEvalCommand(), { initiatorId: client.sessionId, variableValueCardId: vvCard.id });
    }
    ```

  **Must NOT do**
  - NO mutation of `state` directly inside a handler — only via dispatched commands from T11/T12. Handlers are validation + dispatch only.
  - NO `as any` / `@ts-ignore` / `catch {}` empty blocks / `console.log` in handler code.
  - NO broadcast of `game_event` from the handler — that is the command's responsibility.
  - NO re-implementation of rules already enforced by T12 effect engine (offensive limit, trap slot) — only fast-fail pre-checks are allowed; the source of truth lives in the command.
  - NO new message types beyond the 10 enumerated above. If a message arrives with an unknown type, log via `this.room.broadcast("error", { code: ErrorCode.INVALID_PAYLOAD, message: "unknown message type" })`.
  - NO trust of the client for identity: always compare against `client.sessionId`, never against a `playerId` field in the payload.
  - NO Colyseus `Schema` mutation outside a command — handlers must not import `@colyseus/schema` mutation helpers.
  - NO synchronous dispatch — every dispatch must be `await`ed; the room lifecycle reserves the right to await command resolution.

  **Recommended Agent Profile**
  - Category: `unspecified-high`
  - Skills: `[paseo-advisor]` (load to get a second opinion on the validation/dispatch boundary BEFORE writing — confirm the 6-step contract is correct against rulebook)
  - Evaluated/Omitted: deep (ultrabrain) — omitted; this is mechanical validation+dispatch, not novel algorithm design. `unspecified-high` sufficient because T2 contracts, T9 room wiring, and T11/T12 commands are already built and provide the substantive logic; this task is the integration glue.

  **Parallelization**
  - Can Run In Parallel: NO single peer runs alongside this — T15 is the top of Wave 4's dependency chain. (T16, T17 within Wave 4 must wait for T15.)
  - Group: Wave 4 — starts FIRST in Wave 4.
  - Blocks: T16 (edge cases operate on handler dispatch paths), T17 (tests cover every handler).
  - Blocked By: T11 (effect commands), T12 (eval commands), T13 (win detection — handlers broadcast `game_over`), T14 (this WAS T14 in the prior plan numbering; per the W4 spec it is itself — i.e. depends on the underlying turn FSM in T10 [phase translation]).
  - Concrete blockers: T10 (phase FSM), T11 (offensive limit + trap slot errors), T12 (eval commands + undefined detection), T13 (win-reason enum), T2 (Zod schemas), T9 (room + client registry).

  **References**
  - **Pattern/API**: `@colyseus/command` `dispatcher.dispatch(cmd, payload)` returning a typed `Result` — the canonical way to invoke testable commands from a room handler. Used by `namantam1/live-card-game`'s `PlayCardHandler`.
    - WHY: handler stays thin and side-effect-free; commands are unit-testable. T11 already mandates command pattern.
  - **Pattern/API**: Zod `schema.safeParse(unknown)` returning `{ success, data | error }` — preferred over `parse()` for handler entry points to avoid throws crossing the room's `onMessage` boundary.
    - WHY: an uncaught throw in `onMessage` would terminate the room; structured errors broadcast cleanly.
  - **Pattern/API**: `this.room.broadcast("error", payload)` + `client.send("error", payload)` — Colyseus two-mode broadcast. Use `client.send` for the requester-specific error (avoids leaking the failure to the opponent); reserve `broadcast` for state-change broadcasts. (Confirmed in Colyseus docs: `client.send` is per-connection.)
    - WHY: anti-cheat — opponent must not learn WHY illegal intent failed, only that the server rejected it.
  - **Test**: `colyseus/turnbased-cards-demo` UNO handler `onPlayCard` performs exactly: validate phase → validate card in hand → dispatch → broadcast. Direct structural match.
  - **External**: Colyseus docs §"Sending messages" — `onMessage(type, (client, payload) => …)`. https://docs.colyseus.io/colyseus/server/room/#receiving-messages-from-client

  **Acceptance Criteria**
  - All 10 message types have a registered handler with the exact Zod schema keys listed above; `ast_grep_search` confirms `onMessage(` appears 10 times in the room file (or aggregator).
  - `npx tsc --noEmit` passes with zero errors; handlers are fully typed (no implicit any).
  - Each handler enforces all 6 steps in order; a unit-level review confirms: payload → phase → turn → card → target → dispatch.
  - `ErrorCode` enum contains ALL 10 codes exactly as named (the 8 from spec + `ROOM_FULL` + `INTERNAL`).
  - Only 3 outgoing server→client message types exist (`error`, `game_event`, `game_over`); `grep -rE "this\.room\.broadcast\(" server/room/handlers | grep -vE '"(error|game_event|game_over)"'` returns nothing.
  - Illegal intent in any validation stage returns the matching ErrorCode to the offending client only; the other client receives no error message.
  - Handler code contains ZERO direct `state.x = …` mutations; `ast_grep_search` for assignment to `state.` member matches returns 0 hits in `server/src/rooms/handlers/`.

  **QA Scenarios**
  ```bash
  # HAPPY: legal build_function during play phase dispatches BuildFunctionCommand and broadcast game_event
  # Pre: room in phase=play, it is p1's turn, p1 has hand with VVC + fcc cards
  # Run integration check (after T17 test scaffolding exists, or ad-hoc):
  npx ts-node -e "
    import { matchMaker } from 'colyseus';
    const r = await matchMaker.createRoom('nerdiClash', {});
    const c1 = await matchMaker.joinById(r.roomId, {});
    // T17 harness drives two joins, then advances FSM to play phase w/ p1 turn
    // send legal build_function
    c1.send('build_function', { boardId:1, expressionStr:'x^2+y' });
    // assert: p1 receives game_event{event:'build_function', actorId:p1} and NOT error
    console.log('PASS: build_function happy path');
  "

  # FAILURE: play_card during defense phase → NOT_PHASE_NOT_DRAW error to sender, no state mutation
  npx ts-node -e "
    // drive room to phase=defense (p2 turn's defensive window after a p1 offensive)
    const c2 = joinedClients.p2;
    const before = JSON.stringify(stateSnapshot);
    c2.send('play_card', { cardId: existingDefensiveCard.id, target:{ kind:'none' } });
    // expect: c2 receives error{code:'NOT_PHASE_NOT_DRAW'}
    // expect: state snapshot unchanged
    const after = JSON.stringify(stateSnapshot);
    if (before !== after) throw new Error('state mutated by rejected intent');
    console.log('PASS: rejected play_card during defense');
  "

  # Coverage: run the integration test target once T17 ships
  cd server && npx vitest run test/room-integration.test.ts -t "play_card during defense phase"
  ```

  **Evidence**
  - `.sisyphus/evidence/task-15/handler-table.md` — markdown table mapping every message type → Zod schema → legal phase → dispatched command → possible ErrorCodes.
  - `.sisyphus/evidence/task-15/error-codes.txt` — `grep -r "ErrorCode" server/shared/ErrorCode.ts` output proving all 10 codes present.
  - `.sisyphus/evidence/task-15/no-direct-mutation.txt` — `ast_grep_search` pattern `state.$FIELD = $VAL` over `server/src/rooms/handlers/**/*.ts` showing 0 matches.
  - `.sisyphus/evidence/task-15/happy-build-function.log` — recorded WS transcript of legal `build_function` round trip (server log + client received `game_event` JSON).
  - `.sisyphus/evidence/task-15/fail-defense-phase.log` — recorded WS transcript of `play_card` rejected during defense phase with `error.code=NOT_PHASE_NOT_DRAW`, plus a state-snapshot diff showing no mutation.
  - `.sisyphus/evidence/task-15/tsc-noe.txt` — `cd server && npx tsc --noEmit` exit 0 output.

  **Commit**
  `feat(room): message handlers with Zod validation + structured error codes`

- [ ] 16. Edge-Case Handling — Deck Exhaustion, Simultaneous Force Eval, Fizzle, Both-Disconnect

  **What to do**
  Implement 7 edge cases. Each lists (a) trigger condition, (b) state mutation, (c) assertion. Implement in the relevant module per case (most land in T7 zone utils / T12 evaluation engine / T9 room lifecycle — DO NOT re-export them from a new module; augment existing modules):

  1. **(a) Deck exhaustion → auto-reshuffle graveyard into deck**
     - Trigger: `state.players.get(pid).decks[deckType].length === 0` AND a draw is attempted (`draw_cards` handler or internal forced-draw from a card effect).
     - Mutation: in T7 `drawFromDeck(player, deckType)` — when `deck.length===0`:
       ```ts
       if (deck.length === 0) {
         const graveyard = player.graveyards[deckType]; // ArraySchema
         if (graveyard.length === 0) return { ok:false, code:"DECK_EMPTY" }; // handles (b)
         // move ALL graveyard → deck, then Fisher-Yates shuffle (T7)
         while (graveyard.length > 0) deck.push(graveyard.shift());
         shuffleInPlace(deck);
         // graveyard is now empty; discard ORDER IS LOST — explicitly documented as deliberate
       }
       return { ok:true, card: deck.pop()! };
       ```
     - Assertion: deck exhausted, graveyard has N cards → next draw returns 1 card, deck has N-1, graveyard has 0; subsequent draws decrement deck normally. Graveyard discard order NOT preserved (shuffle destroys it).
     - Interface contract: state has `decks[deckType]: ArraySchema<Card>` and `graveyards[deckType]: ArraySchema<Card>` per T6 schema. Per-turn reshape via `.pop()` / `.shift()` keeps ArraySchema deltas clean.

  2. **(b) Both decks exhausted → player draws nothing, turn continues, no penalty**
     - Trigger: `deck.length===0 && graveyard.length===0` for the requested `deckType`.
     - Mutation: `drawFromDeck` returns `{ ok:false, code:"DECK_EMPTY" }` and `draw_cards` handler maps that to a `client.send("error",{code:"INVALID_TARGET", message:"deck empty"})` — OR if `draw_cards` is mid-turn (action economy) the player burns that one of their 2 draw actions getting nothing.
     - State: zero mutation. `end_turn` may proceed even if 0 cards drawn this turn.
     - Assertion: both deck+graveyard empty → `drawFromDeck` returns `ok:false`; player's turn does not stall, no HP penalty, no auto-skip; player may still play existing hand cards.

  3. **(c) Simultaneous force-eval plays on same resolution → turn player's effect resolves first, opponent's force-eval fizzles**
     - Trigger: both N1's turn-force-eval and an opponent's reactive force-eval (via `play_defense` carrying a `force_eval` trap-card-style reaction, or queued within the same resolution tick) arrive before the T12 resolution step.
     - Mutation: T12 ForceEvalCommand resolution: if turn-player's force_eval is already pending, opponent's force_eval is ignored — when T12 executes the resolution queue, only ONE force_eval fires (turn-player's); the opponent's queued command is dequeued WITHOUT broadcasting its `game_event` and returns `{ ok:false, code:"FIZZLED", reason:"already_resolved" }`.
     - Assertion: only 1 `game_event{event:"force_eval"}` broadcasts; turn-player's HP deltas apply; opponent's force-eval command completes with `FIZZLED` (logged as a follow-up `game_event{event:"fizzle", actorId, source:"force_eval"}`).

  4. **(d) Card target destroyed mid-resolution → fizzle**
     - Trigger: a queued card effect references `targetId` (board or player-owned card) that is destroyed/removed by a higher-priority resolution in the same tick (e.g., offensive destroys target board before an eval queued on that board runs).
     - Mutation: T11/T12 resolution step, before each command runs, looks up `target` in current state snapshots; if `target` is gone → command returns `{ ok:false, code:"FIZZLE", reason:"target_gone" }`, NO mutation, broadcast `game_event{event:"fizzle", actorId, targetId}`.
     - Assertion: source card stays in hand (does NOT discard) — i.e., fizzle refunds the card. YES, this is deliberate: card was never resolved. (T12 must confirm this is the rulebook's fizzle treatment; if rulebook says source goes to graveyard on fizzle, follow rulebook — but per rulebook v1.0 §Resolution Phase "unresolved cards return to hand unless explicitly force-discarded by a Martial Theorem.")

  5. **(e) Both players disconnect → keep room alive 30s for either reconnect, dispose when both expired**
     - Trigger: `onLeave` fires for both players within the 30s reconnection window (T9 already calls `allowReconnection(client, 30_000)`).
     - Mutation: in T9 room `onLeave` extension — track `awaitingReconnect: Set<sessionId>`; when both players are in the set, start a `disposedAt = Date.now() + 30_000` timer; on `onJoin` for either → cancel timer, remove from set; on timer expiry → call `this.disconnect()` (Colyseus auto-disposes the room).
     - Assertion: both disconnect at t=0 → at t<30s, if one reconnects, room continues; if neither reconnects by t=30s, room is disposed (`onDispose` fires). State snapshot persisted in-memory only (no DB) during the 30s.

  6. **(f) Reconnection during defense phase → resume pending timer if response still pending**
     - Trigger: disconnected player is the defender in `phase==="defense"` with an unexpired `defenseDeadline` (set by T10's defense phase entry).
     - Mutation: on `onJoin` (reconnect) — read `state.phase` and `state.defenseDeadline`; if `phase==="defense" && defenseDeadline > now`, do NOT reset the timer — let the existing T10 timer continue; broadcast `game_event{event:"defense_resumed", deadline: state.defenseDeadline}` to reconnecting client so client UI can resume its countdown in sync.
     - Assertion: defender disconnects at t=5 of 15s defense window, reconnects at t=10 → defense timer reads 5s remaining (not reset to 15s). If defender reconnects AFTER `defenseDeadline` → T10's auto-pass already fired; player rejoins into `phase==="play"` (p1's next turn) and there is no pending timer.

  7. **(g) Stun / floating-point edge: force-eval initiator value = exactly 2× opponent → NO win**
     - Trigger: force-eval initiator's board evaluated value `Vi = 2 * Vo` exactly (within epsilon `1e-9`).
     - Mutation: T12 ForceEvalCommand win-check uses `if (Vi > 2 * Vo + EPSILON)` for force-domination — strictly greater-than with epsilon margin. `Vi = 2*Vo` (within epsilon) → NOT a win; HP redistributes via normal eval formula instead (HP gain to higher-value participant, not a domination knockout).
     - Assertion: `Vi = 60.000, Vo = 30.000 → no domination win`. `Vi = 60.0001, Vo = 30.000 → initiator wins domination` (60.0001 > 60.000 + 1e-9 = true). `Vi = 60.000000005, Vo = 30.000 → no win` (within epsilon).

  Also: confirm ALL edge mutations are routed through commands (T11/T12) or zone utils (T7) — handlers and the room lifecycle do not mutate state directly except for the disconnect timer bookkeeping in (e) and (f) which mutate room-private (non-schema) flags.

  **Must NOT do**
  - NO new module for edge cases — augment existing T7/T9/T10/T12 modules. Edge logic distributed where it belongs.
  - NO preservation of graveyard discard order on reshuffle — explicitly shuffle (rulebook does not require order preservation; preserving would invite a card-counting advantage and complicates the schema).
  - NO symmetric resolution of simultaneous force-eval — turn-player ALWAYS resolves first. Do not flip a coin, do not compare timestamps.
  - NO database/persistence layer — state survives only in room RAM during the 30s window (T9 already locked this).
  - NO `Math.abs(a-b) < EPSILON` directly for the `>` comparison in (g) — use the explicit form `a > b + EPSILON` to bind epsilon to one direction. (Mixing forms leads to inconsistent domination rulings.)
  - HP comparisons MUST use the stored integer ×10 representation (T12), never raw floats — but the epsilon rule in (g) operates on the FP comparison BEFORE scaling; document that fact.
  - NO `as any` / `@ts-ignore` / empty catches.

  **Recommended Agent Profile**
  - Category: `unspecified-high`
  - Skills: `[paseo-advisor]` — spawn one advisor BEFORE implementing (c) and (g); the advisor verifies the rulebook's exact fizzle treatment and the simultaneous-force ordering against `NerdiCard.txt` §Resolution Phase + Force Evaluation section. If advisor and rulebook disagree with this spec, follow rulebook and note the deviation in Evidence.
  - Evaluated/Omitted: `ultrabrain` — omitted; these are well-specified edge cases with deterministic triggers, not open-ended design problems. `unspecified-high` with advisor sanity-check suffices.

  **Parallelization**
  - Can Run In Parallel: NO — T16 depends on T15 handler dispatch paths (especially (b)'s `draw_cards` error mapping and (c)'s `play_defense`→force_eval queue).
  - Group: Wave 4 — runs AFTER T15.
  - Blocks: T17 (test suite covers every edge case enumerated here).
  - Blocked By: T14 (handlers; renumbered to T15 in this wave), T12 (eval engine + fizzle), T7 (deck exhaustion + graveyard), T9 (room lifecycle + reconnect), T10 (defense timer).

  **References**
  - **Pattern/API**: T7 `drawFromDeck` + `shuffleInPlace` (Fisher-Yates) — the canonical deck utility. Edge (a) extends it; edge (b) is its exhaustion return contract.
    - WHY: reshuffle is a deck concern, not an eval or room concern. Keeps the layering pure.
  - **Pattern/API**: T12 `EvalCommand.resolveForce({ initiatorId, opponents })` — internal resolution queue. Edge (c) augments it with "skip duplicates" + "mark fizzle".
    - WHY: fizzle is a resolution-event, not a new command type.
  - **Pattern/API**: T10 `setTimeout(defenseDeadline - Date.now(), ...)` stored on the room — the pending defense timer. Edge (f) MUST NOT reset this; T9's `allowReconnection` resume path leaves it intact.
    - WHY: resetting the timer rewards disconnection as a stalling tactic — anti-pattern.
  - **Test**: Magic: The Gathering fizzle rule ("target illegal on resolution → countered"). The rulebook matches this convention. Edge (d) follows it.
  - **External**: Colyseus docs — `await this.allowReconnection(client, 30)` + `onLeave` + `onDispose`. https://docs.colyseus.io/colyseus/server/room/#onleave

  **Acceptance Criteria**
  - All 7 edge cases implemented in the correct module (T7/T9/T10/T12) — `ast_grep_search` over `server/logic/**` and `server/room/**` confirms each mutation site.
  - (a) Deck exhaustion: when deck=0 and graveyard>0, next draw pops a shuffled card; graveyard is cleared. Verified by a unit test asserting graveyard length 0 after first post-reshuffle draw.
  - (b) Both-exhausted: `drawFromDeck` returns `ok:false` with no state change; turn does not stall, player may `end_turn`.
  - (c) Simultaneous force-eval: only 1 `force_eval` `game_event` broadcast per resolution tick; opponent's queued force-eval emits a `fizzle` event.
  - (d) Fizzle on target gone: source card stays in hand (or graveyard per rulebookadvisor-confirm); `game_event{event:"fizzle"}` broadcast.
  - (e) Both-disconnect: room `onDispose` fires exactly at 30s after the second disconnect if neither reconnects; reconnects before 30s cancel timer.
  - (f) Defense reconnection: defender reconnects at t=10/15 → `defense_resumed` event carries the original `defenseDeadline`; client countdown resumes at 5s.
  - (g) FP edge: `Vi=60.000, Vo=30.000 → NO domination` (test assertion). `Vi=60.0001, Vo=30.000 → domination`. The comparison uses `Vi > 2*Vo + EPSILON` with `EPSILON=1e-9`.
  - `npx tsc --noEmit` passes with zero errors.

  **QA Scenarios**
  ```bash
  # HAPPY (a): deck exhausted, graveyard has 5 cards, draw_cards → first card from reshuffled graveyard
  cd server && npx vitest run test/pure-logic.test.ts -t "deck exhaustion reshuffles graveyard"
  # Expected assertion: expect(deck.length).toBe(4) /* 5-1 */, expect(graveyard.length).toBe(0)

  # HAPPY (g): force-eval stricter-than-2x wins domination
  cd server && npx vitest run test/expression.test.ts -t "force eval: A=60.0001 B=30"

  # FAILURE (g): force-eval exactly 2x → does NOT win domination (test would FAIL if impl used >=)
  cd server && npx vitest run test/expression.test.ts -t "force eval: A=60 B=30"
  # Assertion: expect(result.winnerId).toBeNull() / or expect(result.reason).not.toBe("force_dom")
  # If implementation buggy (uses >= instead of >), this test FAILS — it is the regression guard.

  # FAILURE (c): if simultaneous force-eval resolves BOTH (turn player's AND opponent's), test fails
  cd server && npx vitest run test/room-integration.test.ts -t "simultaneous force eval fizzle"
  # Assertion: expect(broadcastEvents.filter(e=>e.event==="force_eval")).toHaveLength(1)
  # Assertion: expect(broadcastEvents.filter(e=>e.event==="fizzle")).toHaveLength(1)

  # HAPPY (e): both disconnect, reconnect within 30s
  cd server && npx vitest run test/room-integration.test.ts -t "reconnect within 30s"
  # Failure variant: npx vitest run test/room-integration.test.ts -t "both disconnect room disposed after 30s"
  ```

  **Evidence**
  - `.sisyphus/evidence/task-16/edge-table.md` — table: edge # | trigger | module | file:line | assertion ref.
  - `.sisyphus/evidence/task-16/advisor-review.md` — paseo-advisor's confirmation (or contradiction) of rulebook alignment for (c), (d), (g); any deviation noted + rationale.
  - `.sisyphus/evidence/task-16/deck-reshuffle.log` — recorded unit-test transcript for (a) + (b).
  - `.sisyphus/evidence/task-16/simul-force-eval.log` — integration test transcript for (c) showing 1 force_eval + 1 fizzle.
  - `.sisyphus/evidence/task-16/fp-edge.log` — `npx ts-node` REPL printout: `Vi=60 Vo=30 → winner=null`, `Vi=60.0001 Vo=30 → winner=initiator`.
  - `.sisyphus/evidence/task-16/both-disconnect-timer.log` — integration test transcript: both clients' `onLeave`, advancing fake timers 30s, `onDispose` fires.
  - `.sisyphus/evidence/task-16/tsc-noe.txt` — `npx tsc --noEmit` exit 0.

  **Commit**
  `feat(room): edge cases — deck exhaustion, simultaneous force eval, fizzle, both-disconnect, fp epsilon`

- [ ] 17. Tests — Vitest Suites for Pure Logic + Room Integration

  **What to do**
  Implement three vitest suites covering Pure Game Logic, Expression/Math Engine, and Room Integration. Coverage target: ≥80% line coverage on the four key modules: Pure Game Logic (T7), Math Engine (T4 + T8), Evaluation Engine (T12), Win Engine (T13). Coverage tool: vitest's built-in `--coverage` (provider `v8`).

  - **Suite 1: `test/pure-logic.test.ts`** — covers T7 purely-game-logic module.
    Test names + assertions (≥12 tests):
    - `decks: buildStandardDeck(cardCatalog) returns 60 cards (22 fcc + 18 number + 20 action)` — exact count assertions per deck type.
    - `shuffle: Fisher-Yates produces same output given same seed (determinism)` — `expect(shuffleInPlace(deck.copy(), seed=42))` deep-equals a second call with seed=42.
    - `shuffle: distribution sanity — 1000 runs over [1..10] yields all permutations distinct count > 1` (loose sanity, NOT a distribution test).
    - `zone-utils: moveCardToGraveyard removes from hand Array and pushes to graveyard Array` — assert lengths before/after.
    - `zone-utils: drawFromDeck pops last element (LIFO) when deck has cards`.
    - `zone-utils: drawFromDeck reshuffles graveyard when deck empty` — assert post-reshuffle deck length = (original graveyard length) - 1, graveyard length = 0.
    - `zone-utils: drawFromDeck returns ok:false when BOTH deck and graveyard empty` (edge (b)).
    - `complexity: f(x)=x → 0 (ineligible)` — `expect(computeComplexity(parse('x'))).toBe(0)`. (Walker for single-variable literal — not 2 distinct variable terms; returns 0 to mark ineligible.)
    - `complexity: f(x,y)=x^2+y → 2 distinct variable terms, complexity = 2 (eligible)`.
    - `complexity: f(x)=sin(cos(x)) → composition +2, complexity = 3` (T9 walker composition rule).
    - `HP formula: f(x,y)=x^2+y, value@{x:2,y:3}=7, complexity=2 → HP gain = (7*2)/10 = 1.4 → stored ×10 = 14`.
    - `HP stored integer ×10: round-trip — gain 1.4 HP → state.hp_X10 increments by 14, NOT 13 or 15` (FP epsilon guard).
    - `win-detection: HP_X10 reaches 0 → win_reason='hp_zero'`.
    - `win-detection: variable isolation timer reaches 3 turns unrecovered → win_reason='isolation'`.
    - `validation: card not in player hand → CARD_NOT_IN_HAND error`.
    - `validation: target board not owned by player → INVALID_TARGET error`.

  - **Suite 2: `test/expression.test.ts`** — covers T8 expression layer + T12 evaluation.
    - `expression: parse then toString round-trip — 'x^2 + 3*y' → parse → toString → 'x ^ 2 + 3 * y' (math.js default formatting)`.
    - `expression: domain validation — 'sin(x) + cos(2*x)' within Trig ≤6 terms → ok`.
    - `expression: domain validation — polynomial degree 7 exceeds Poly ≤deg5 → ValidationError`.
    - `expression: term count — 'x + y + z + 2*a + 3*b' has 5 distinct variable terms`.
    - `eval: f(x)=x^2 @ {x:3} = 9 (sanity)`.
    - `eval: f(x)=x^2 @ {x:NaN-ish large} → stays finite for legal scope`.
    - `eval HP gain: f(x,y)=x^2+y @ {x:2,y:3} = 7, complexity=2 → +20 HP×10` (integer-scaled).
    - `eval: force-eval undefined function @ {x: Infinity} → EvalError('undefined') → board destroyed`.
    - `force eval: A=60.0001 B=30 → A wins domination` (T12 strict-`>` with epsilon).
    - `force eval: A=60 B=30 → A does NOT win domination` (exactly 2× boundary — edge (g)).
    - `force eval: A=60.000000005 B=30 → within epsilon, NO win` (within EPSILON=1e-9).
    - `force eval: FP — HP_X10 integerization, gain of 0.5 HP rounds consistently (banker's or round-half-up per T12 — EXACT value asserted, document choice in test)`.

  - **Suite 3: `test/room-integration.test.ts`** — uses `colyseus.js` client + in-process `matchMaker` to spin an actual `GameServer`.
    Setup (top of file):
    ```ts
    import { matchMaker, Server } from 'colyseus';
    import { Client } from 'colyseus.js';

    let server: Server;
    beforeAll(async () => {
      server = new Server();
      server.define('nerdiClash', NerdiClashRoom);
      await server.listen(0); // random port
      // OR use matchMaker directly with an in-process driver
    });
    afterAll(async () => { await server.gracefulShutdown(); });
    ```
    Tests (≥10 tests, each ≥1 happy + ≥1 failure variant):
    - `2 clients join via matchMaker.createRoom + joinById → both receive state sync, phase='waiting' → 'play'[or FSM start]` (happy).
    - `3rd client attempts join → ROOM_FULL rejection` (failure).
    - `turn cycle: p1 draws 2 cards → p2 draws 2 cards → FSM advances to p2's turn correctly` (happy).
    - `play_card legal offensive in play phase → game_event broadcasts, card moves to in-play zone` (happy).
    - `illegal intent: play_card during defense phase → NOT_PHASE_NOT_DRAW error to sender, NO state mutation` (failure).
    - `illegal intent: 2nd offensive same turn → OFFENSIVE_LIMIT_EXCEEDED error` (failure).
    - `trap blocks offensive: opponent's `set_trap` + then `play_card` offensive trigger → TRAP_BLOCKS_OFFENSIVE error to attacker` (failure).
    - `eval_function legal → HP delta broadcast` (happy).
    - `force_eval: A=60.0001 B=30 → game_over broadcast winner=initiator reason='force_dom'` (happy).
    - `force_eval: A=60 B=30 → no winner, normal HP redistribution only` (failure-variant — assert game_over NOT received yet).
    - `reconnect within 30s → state preserved` (happy — disconnect one client, reconnect within 30s via matchMaker, assert hand/HP/phase intact).
    - `reconnect after 30s → room disposed, rejoin fails with room-not-found` (failure).
    - `both disconnect → room stays 30s, then disposes` (edge (e) — uses vitest fake timers `vi.useFakeTimers()` + `vi.advanceTimersByTime(30_000)`).
    - `defense phase reconnection → timer NOT reset` (edge (f) — assert `defenseDeadline` unchanged across disconnect/reconnect).
    - `deck exhaustion → first draw post-reshuffle pulls from former graveyard` (edge (a)).
    - `simultaneous force eval fizzle — only 1 force_eval broadcast + 1 fizzle broadcast per resolution tick` (edge (c)).
    - `target destroyed mid-resolution → source card returns to hand, fizzle broadcast` (edge (d)).

  - Coverage configuration: add to `server/vitest.config.ts`:
    ```ts
    coverage: {
      provider: 'v8',
      include: ['server/logic/**', 'server/math/**', 'server/logic/eval.ts', 'server/logic/win.ts'],
      thresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
    }
    ```
  - Every test that asserts a *broadcast* or *state mutation* MUST capture the full event log from the integration harness (an ordered array of `{type, payload}` records per client) and assert on it explicitly — not on a single field.
  - Run order: pure-logic + expression first (fast, no server), then room-integration (boots a Colyseus server in-process).

  **Must NOT do**
  - NO real network ports in unit tests — `matchMaker` driver + `Server.listen(0)` for ephemeral free port; OR use Colyseus's in-memory driver to skip network entirely.
  - NO tests asserting on internal command objects — tests verify OBSERVABLE behavior (state snapshots + broadcast log) only. This protects tests against future internal refactors.
  - NO `setTimeout`-based timing waits — use vitest fake timers (`vi.useFakeTimers`) for all defense/disconnect 30s tests.
  - NO skipped tests (`it.skip` / `test.todo`) in the final commit — all listed tests must run and pass.
  - NO tests that depend on machine float quirks — pin every FP assertion to a clean ratio (e.g., 60/30, not 0.1+0.2) OR use the integer ×10 form.
  - NO `as any` / `@ts-ignore` in tests.
  - NO mocks of Math engine or Pure Logic in integration tests — integrate the real modules. Mocks are allowed ONLY for the SymPy stubs (which return `{supported:false}` — that IS the real implementation).
  - NO tests for the Godot client in this suite — T17-T19 are Godot tasks.

  **Recommended Agent Profile**
  - Category: `unspecified-high`
  - Skills: `[/review-work after writing tests]` — run `/review-work` after the test suite is written AND passes, to verify suite quality (coverage, assertions, no flakes, no false positives). The review sub-agents will replay tests and check the ≥80% claim.
  - Evaluated/Omitted: `oracle` — omitted; tests are mechanical verification, not novel design. `unspecified-high` sufficient; the heavy lifting is in the implementations under test.
  - Concurrent pass required: After T17 commits, F2 (Code Quality Review) reruns `npx vitest run --coverage` and independently confirms the ≥80% threshold.

  **Parallelization**
  - Can Run In Parallel: NO — T17 is the LAST task of Wave 4; depends on T15+T16 both shipped (and T7/T8/T12 implementations).
  - Group: Wave 4 — runs LAST.
  - Blocks: F1-F4 (final verification wave gates on passing tests).
  - Blocked By: T15 (handlers), T16 (edge cases), T7 (pure logic), T8 (expression), T12 (evaluation engine).
  - Note: This task blocks the FINAL verification wave (F1-F4); starting T17 prematurely would yield a brittle suite.

  **References**
  - **Pattern/API**: `matchMaker.createRoom('nerdiClash', {})` + `matchMaker.joinById(roomId, {})` — the canonical Colyseus in-process room + join used by the official turnbased-cards-demo and live-card-game test suites.
    - WHY: spins a real room with real schema serialization — the only way to catch `@view()` leaks and ArraySchema delta bugs.
  - **Pattern/API**: `colyseus.js` `Client` — client-side SDK used to send intents and receive `onStateChange` diffs; mirror exactly what the Godot client will do (T17-T19 build the GDScript equivalent).
    - WHY: keeps test-client and real-client behavior identical → catches bugs the Godot SDK would hit.
  - **Pattern/API**: `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` — vitest's deterministic time control. Used for all timeout-based edge tests (e) (f).
    - WHY: real 30s waits in CI are unacceptable; survival of the reconnect window is asserted in <100ms wall clock.
  - **Test**: vitest docs §"Coverage" — built-in `v8` provider; thresholds config syntax. https://vitest.dev/guide/coverage
  - **External**: Colyseus testing guide — "Testing your room" pattern with `matchMaker`. https://docs.colyseus.io/colyseus/server/testing/

  **Acceptance Criteria**
  - All three test files created under `server/test/` and importable by `npx vitest run`.
  - `npx vitest run --coverage` passes with ≥80% line coverage on `server/logic/**`, `server/math/**`, `server/logic/eval.ts`, `server/logic/win.ts` (the threshold enforces this; CI fails below).
  - Every command imported from T11/T12 has at least one test driving a happy + one test driving a failure.
  - Every handler from T15 has at least one happy + one rejection test.
  - Every edge case from T16 has at least one explicit test (named with the edge identifier).
  - `npx tsc --noEmit` passes (tests are type-checked too).
  - NO `it.skip`/`test.todo`/`console.log`/`@ts-ignore`/`as any` in any test file.
  - Suite runtime < 10 seconds (integration tests use fake timers / ephemeral port so no real sleeps).
  - `/review-work` final verdict for this task: APPROVE (suite quality gate).

  **QA Scenarios**
  ```bash
  # HAPPY: full suite runs and coverage meets thresholds
  cd server && npx vitest run --coverage
  # Expected: all tests pass; coverage report shows
  #   server/logic/**       lines ≥ 80%
  #   server/math/**        lines ≥ 80%
  #   server/logic/eval.ts  lines ≥ 80%
  #   server/logic/win.ts   lines ≥ 80%

  # FAILURE: regression guard — if (g) FP edge impl uses `>=` instead of `>`,
  # the test below MUST fail. (Delete-then-re-add this test after a deliberate bug injection to confirm it catches)
  cd server && npx vitest run test/expression.test.ts -t "force eval: A=60 B=30"
  # Expected under correct impl: PASS (asserts no domination)
  # Expected under `>=` impl:     FAIL — catches the regression

  # FAILURE: if handler leaks illegal intent past validation (e.g., onPlayCard omits turn-owner check),
  # the test below MUST fail
  cd server && npx vitest run test/room-integration.test.ts -t "play_card during defense phase"
  # Expected under correct impl: PASS (asserts NOT_PHASE_NOT_DRAW error + zero state mutation)
  # Expected under missing-check: FAIL — state mutated despite rejection

  # Single-module isolation check during debugging
  cd server && npx vitest run test/pure-logic.test.ts
  cd server && npx vitest run test/expression.test.ts
  cd server && npx vitest run test/room-integration.test.ts
  ```

  **Evidence**
  - `.sisyphus/evidence/task-17/vitest-run-coverage.txt` — full stdout of `npx vitest run --coverage`, including the per-file coverage table and threshold pass line.
  - `.sisyphus/evidence/task-17/test-list.md` — markdown list of every `it(...)` / `test(...)` title across all 3 files, grouped by file.
  - `.sisyphus/evidence/task-17/regression-injection.log` — for ONE chosen test (the FP edge `(g)`), record: inject the bug (`>` → `>=`), run the test, show it FAILS, revert, show it passes. Proves the test is a guard not a tautology.
  - `.sisyphus/evidence/task-17/tsc-noe.txt` — `npx tsc --noEmit` exit 0 over the WHOLE project (tests included).
  - `.sisyphus/evidence/task-17/review-work-verdict.md` — the `/review-work` orchestrator output: VERDICT APPROVE for this suite.
  - `.sisyphus/evidence/task-17/runtime.txt` — `time npx vitest run` wall-clock duration (assert < 10s).

  **Commit**
  `test: vitest suites — pure logic, expression, room integration with ≥80% coverage`
- [ ] 18. Godot connection + state sync — ConnectionManager autoload singleton

  ### What to do
  Create `scripts/ConnectionManager.gd` as an **autoload singleton** (registered in `project.godot` under `[autoload]` as `ConnectionManager`). It owns the network connection and the local `GameModel` mirror, and is the single ingress/egress point between Godot and the Colyseus server.

  Two connection branches, conditional on what T5 verified:
  - **Branch A (preferred, if SDK works under Godot 4.7)**:
    ```gdscript
    extends Node
    # autoload: ConnectionManager
    signal connected(role: String)      # "p1" | "p2"
    signal state_changed(snapshot: Dictionary)
    signal error(code: String, message: String)

    @onready var ip_edit: LineEdit
    @onready var status_label: Label
    @onready var phase_label: Label
    @onready var turn_label: Label

    var client: Object
    var room: Object
    var game_model: Dictionary = {}    # mirrors server GameRoomState as Dictionary

    func _ready():
        client = Colyseus.Client.new()
        ip_edit.text = "ws://localhost:2567"
        status_label.text = "Disconnected"

    func _on_connect_pressed():
        status_label.text = "Connecting..."
        client.connect_to(ip_edit.text)
        var room = yield(client.join_or_create("nerdiclash"), "joined")
        room.connect("on_state_change", self, "_on_state_change")
        room.connect("on_error", self, "_on_error")
        status_label.text = "Connected as %s" % room.session_id
        emit_signal("connected", room.session_id)

    func _on_state_change(state):
        game_model = _state_to_dict(state)
        phase_label.text = "Phase: %s" % game_model.get("phase", "")
        turn_label.text = "Turn: %s" % game_model.get("current_turn", "")
        emit_signal("state_changed", game_model)
    ```
  - **Branch B (fallback, raw `WebSocketPeer`):** import from `scripts/raw-ws-client.gd`, listen for `ws_connected`, then send `{"c":"join","r":"nerdiclash"}` JSON, parse incoming JSON patch frames (`{"type":"patch", ...}` / `{"type":"join_ok", "session":...}`) and build `game_model` incrementally.

  Either branch is acceptable. **Pick whichever T5 verified actually works** — record the chosen branch in Evidence.

  Concrete UI node tree (within `connect_scene.tscn` or main scene root): one `LineEdit` (name/IP input, default `ws://localhost:2567`), one `Button` "Connect" (calls `_on_connect_pressed`), one `Label` "Status" (Disconnected → Connecting... → Connected as P1 / Connected as P2), one `Label` `PhaseLabel`, one `Label` `TurnLabel`. Both labels subscribe to `state_changed` signal from the singleton.

  Expose `GameModel` as a second autoload singleton (plain `Dictionary`), populated only by `ConnectionManager._on_state_change`. No other node writes to it. Mirror every server-side `@type()` field name exactly (snake_case) so downstream (T19, T20) can do `GameModel["players"]["p1"]["hp"]`.

  ### Must NOT do
  - No retry/backoff beyond a single reconnect button press (out of scope for test client).
  - No lobby UI beyond the IP LineEdit + Connect button.
  - No matchmaking UI — `joinOrCreate` only, hard-coded room name `"nerdiclash"`.
  - No rendering of game state beyond Phase/Turn labels (T19 handles the board).
  - No storing math.js `Node` objects in `GameModel` — expressions stay as the raw server string (already strings on the wire).
  - No animations, tweens, or visual transitions on state changes.
  - No silently swallowing the fallback — the chosen branch MUST be the one T5 verified; do not commit dead code for the unused branch (delete it or stub with a TODO).

  ### Recommended Agent Profile
  - **Category**: `visual-engineering`
  - **Skills**: `[/playwright]` (screenshot QA of connect → status label transitions), `[/paseo-advisor]` (review server message schema fan-out before wiring fields)
  - **Evaluated**: connection lifecycle, signal emission on connected/changed/error, `GameModel` dictionary shape parity with server schema (T6), chosen branch matches T5 verification artifact.
  - **Omitted**: turn-screen aesthetics, accessibility, localization, keybinds.

  ### Parallelization
  - **Can Run In Parallel**: T19, T20 (both consume `ConnectionManager` only via `state_changed` / `game_model` once `state_changed` shape is pinned — pin shape via a one-shot shared stub in Evidence before parallel start).
  - **Group**: Wave 5 (Godot minimal client).
  - **Blocks**: T19 (board render needs `state_changed` + `GameModel`), T20 (intent sender needs `ConnectionManager.send`).
  - **Blocked By**: T5 (Godot scaffolding + verified SDK/raw-WS decision), T6 (server schema field names must be stable so the Godot-side Dictionary mirror matches exactly).

  ### References
  - **Pattern**: Colyseus Godot SDK `join_or_create` + `on_state_change` signal — canonical happy path for 2P turn-based clients (matches `colyseus/turnbased-cards-demo` UNO example).
  - **API**: `Colyseus.Client.new()`, `room.connect("on_state_change", self, "_on_state")`, `room.send(msg_type, payload)` — for `send` details used by T20.
  - **Fallback API**: `WebSocketPeer` — `peer = WebSocketPeer.new(); peer.connect_to_url(url); peer.get_packet() / peer.send_text(json)` (verified working by T5).
  - **Test**: T6's emitted schema snapshot (the JSON dump the schema task must produce) is the contract `GameModel` mirrors 1:1.
  - **External**: Godot 4.x autoload docs — https://docs.godotengine.org/en/stable/classes/class_%40gdscript.htmlGDScript_autoload — for singleton registration syntax.
  - **WHY**: A single ConnectionManager singleton prevents scattered network code and guarantees GameModel is the only source of truth the render/intent tasks read, matching the "client is dumb/blind" guardrail.

  ### Acceptance Criteria
  - [ ] `scripts/ConnectionManager.gd` exists, registered as autoload `ConnectionManager` in `project.godot`.
  - [ ] `GameModel` (Dictionary mirror) populated on every `on_state_change`; downstream fields accessible via `GameModel.players.p1.hp` style paths.
  - [ ] Three signals emitted: `connected(role)`, `state_changed(snapshot)`, `error(code, message)`.
  - [ ] Status label transitions Disconnected → Connecting... → Connected as P1 (first client) / Connected as P2 (second `joinOrCreate` client).
  - [ ] PhaseLabel and TurnLabel update from a server-driven state change within one network tick (observed via stdout log in headless run).
  - [ ] ConnectionManager has NO game-state mutation code — purely mirror + signal forwarding.
  - [ ] `godot --headless --script res://main.gd` logs "Connected as P1" then a second process logs "Connected as P2" without errors.

  ### QA Scenarios
  Happy path:
  ```
  # Terminal 1
  cd server && npx tsx src/index.ts                 # server up on :2567
  # Terminal 2
  cd nerdcard-godot && godot --headless --script res://main.gd 2>&1 | tee p1.log
  grep -c "Connected as P1" p1.log                   # expect >= 1
  # Terminal 3
  cd nerdcard-godot && godot --headless --script res://main.gd 2>&1 | tee p2.log
  grep -c "Connected as P2" p2.log                   # expect >= 1
  # screenshot (Playwright of the rendered scene when run windowed):
  # godot ~/NerdCard/nerdicard-godot -> screenshot: .sisyphus/evidence/task-18-happy-connect.png
  # assert via look_at evidence/task-18-happy-connect.png: status label "Connected as P1" visible
  ```
  Failure path (server unreachable):
  ```
  # server NOT running
  cd nerdcard-godot && godot --headless --script res://main.gd 2>&1 | tee fail.log
  grep -cE "error|Error|ERROR" fail.log             # expect >= 1
  grep -i "ECONNREFUSED\|ws error\|status_label=Error" fail.log   # expect a match
  # error signal emits; status label shows "Disconnected" or "Error"; no crash
  # screenshot evidence: .sisyphus/evidence/task-18-fail-no-server.png showing stuck "Connecting..." or "Error"
  ```

  ### Evidence
  - `.sisyphus/evidence/task-18-happy-connect.log`
  - `.sisyphus/evidence/task-18-fail-no-server.log`
  - `.sisyphus/evidence/task-18-happy-connect.png`
  - `.sisyphus/evidence/task-18-chosen-branch.md` (records SDK vs raw-WS decision + T5 artifact reference)
  - `.sisyphus/evidence/task-18-gamemodel-shape.json` (the pinned Dictionary shape T19/T20 depend on)

  ### Commit
  `feat(godot): ConnectionManager autoload + GameModel state mirror + connect UI`

- [ ] 19. Godot game board text render — MainGame.tscn scene

  ### What to do
  Create `scenes/MainGame.tscn` (a `Control` root) + `scripts/MainGame.gd` controller. Subscribes to `ConnectionManager.state_changed` and re-renders text labels only — NO node additions/deletions beyond show/hide of slot nodes that already exist in the scene tree at static counts (2 players × 3 function slots × N trap slot).

  Scene tree (static node counts; only `Label.text` updates, no instancing at runtime):
  ```
  MainGame (Control)
  └─ VBox
     ├─ OpponentPanel   (PlayerPanel, top)
     ├─ BoardArea        (Label spacer — visual separation only, plain text)
     ├─ LocalPanel       (PlayerPanel, bottom)
     ├─ HandVBox         (HBoxContainer)
     ├─ DeckButtons      (HBoxContainer with 3 mini-buttons: "Draw FCC","Draw Number","Draw Action")
     ├─ ActionButtons    (HBoxContainer: "End Turn", "Evaluate")
     ├─ PhaseTurnRow     (HBoxContainer: TurnPhaseLabel, TurnOwnerLabel)
     └─ ErrorModal       (Panel + Label, hidden unless error fired; auto-dismiss 3s via Timer)
  PlayerPanel (scene instance, PackedScene reusable): VBox
     ├─ NameLabel
     ├─ HPLabel          (text = str(int(state.hp / 10)))  // server stores HP×10
     ├─ TrapSlotIndicator (Label: "Trap: empty" or "Trap: set" — content NEVER shown even to owner)
     └─ FunctionBoardPanel (VBox of 3 FunctionSlot rows)
        each FunctionSlot (HBox):
           ├─ ExprLabel     (text = card.expression raw string e.g. "sin(x) + 2*x^2")
           ├─ DomainBadge   (text = card.domain e.g. "trig")
           └─ DepthBadge    (text = "d=%d" % composition_depth)
  ```
  HandPanel: `HBoxContainer` with child `CardButton` nodes — reuses the SAME static count pool is NOT possible because hand size varies; permitted exception: clear and rebuild child `CardButton`s on `state_changed` (this is the one allowed node-add/del operation; card art stays text-only via `Button.text = card.name + " " + card.type`).

  All updates driven via `state_changed`:
  - `phase` → `TurnPhaseLabel.text` ("Draw Phase" / "Play Phase" / "Defense Phase" / "Resolution Phase" / "Game Over").
  - `current_turn` → `TurnOwnerLabel.text` ("p1" / "p2").
  - `players.p1.hp / 10` → LocalPanel.HPLabel; `players.p2.hp / 10` → OpponentPanel.HPLabel (assume local=p1 by default — flip the panels if `room.sessionId == state.players.p2.session`).
  - each `players.X.boards[*]` → corresponding FunctionSlot.ExprLabel / DomainBadge / DepthBadge; empty slots show ExprLabel="(empty)".
  - `players.X.hand[*]` (visible to local via StateView) → HandVBox CardButtons (card.name + card.type).
  - deck counts → labels: `"FCC: %d | Num: %d | Act: %d"`.

  ### Must NOT do
  - NO animations, NO Tween, NO `animate_*` methods, NO sprites/textures/card art.
  - NO sound (`AudioStreamPlayer`).
  - NO semantic decode of `expression` strings — render the raw string verbatim (server is authoritative; client is blind).
  - NO StateView filtering client-side — rely solely on what the server sends (correct `@view()` is server's job, T6).
  - NO predictive rendering — every visible value comes from a `state_changed` event.
  - NO dealing with mask the opponent's trap content — the server already hides it; the client must not attempt to "re-hide" either (pure render layer).
  - NO markdown / rich text formatting — plain Label.text only (BBCode off; avoid RichTextLabel unless plain Label doesn't fit on a single line, then RichTextLabel with `bbcode_enabled=false`).
  - NO node instancing for static slot counts — slots exist in the scene at rest; only their `.text` mutate.

  ### Recommended Agent Profile
  - **Category**: `visual-engineering`
  - **Skills**: `[/playwright]` (screenshot `MainGame.png` showing HP=30, expression `sin(x)+2*x^2`, phase "Play Phase" and `look_at` assert), `[/paseo-advisor]` (mirror schema field naming used by T18's `GameModel` before binding labels — catch typos early)
  - **Evaluated**: every `.text` field originates from a `state_changed` payload (no static/hardcoded UI text beyond structural headers); PlayerPanel scene reused for both players (DRY); hand rebuild is the only permitted node mutation; trap content never rendered.
  - **Omitted**: visual polish, font choice, color themes, responsive layout.

  ### Parallelization
  - **Can Run In Parallel**: T18 (provides the `GameModel` shape contract), T20 (provides CardButton.gd consumed here).
  - **Group**: Wave 5.
  - **Blocks**: F3 (manual QA needs a visible board).
  - **Blocked By**: T18 (must pin `GameModel` Dictionary shape first — consume the pinned JSON from evidence/task-18-gamemodel-shape.json), T6 (schema stable; field names must match), T5 (Godot project scaffolding exists).

  ### References
  - **Pattern**: Colyseus `on_state_change` → mutate `.text` of existing Labels — standard state-sync render for turn-based games; no client-side interpolation.
  - **API**: `Callable` / `ConnectionManager.state_changed.connect(self, "_on_state_changed")`; `Label.text = str(...)`.
  - **Test**: T6 schema snapshot (JSON) fed into a mock `GameModel` to render a static frame for screenshot QA even without a live server.
  - **External**: Godot Control scene + Label docs — https://docs.godotengine.org/en/stable/classes/class_label.html
  - **WHY**: A static scene tree with only `.text` mutation keeps the test client minimal and guarantees no desync from client-side interpolation — every pixel reflects server truth.

  ### Acceptance Criteria
  - [ ] `scenes/MainGame.tscn` + `scripts/MainGame.gd` exist; scene instantiable via `godot res://scenes/MainGame.tscn`.
  - [ ] OpponentPanel (top) + LocalPanel (bottom) both visible; player panels show NameLabel, HPLabel, TrapSlotIndicator, 3 FunctionSlots.
  - [ ] HPLabel displays `str(int(hp / 10))` (server HP×10 normalization verified).
  - [ ] ExprLabel renders raw expression string verbatim from `state.players.X.boards[i].expression` (e.g. `sin(x) + 2*x^2`).
  - [ ] TrapSlotIndicator shows "Trap: empty" or "Trap: set" only — content string NEVER rendered for anyone.
  - [ ] FunctionSlot DomainBadge + DepthBadge populate from `board.domain` + `board.composition_depth`.
  - [ ] HandVBox rebuilds CardButtons on every `state_changed`; each button `.text` = `card.name + " " + card.type`.
  - [ ] DeckButtons row shows `"FCC: %d | Num: %d | Act: %d"` from `state.decks` counts.
  - [ ] TurnPhaseLabel updates for all 5 phases; TurnOwnerLabel shows current turn player.
  - [ ] ErrorModal starts hidden; shown on `ConnectionManager.error` signal; auto-hides after 3s via a `Timer`.
  - [ ] `godot --headless res://scenes/MainGame.tscn` with a mocked `GameModel` runs without null-reference errors.

  ### QA Scenarios
  Happy path:
  ```
  # server up, both clients connected (T18 happy path complete)
  cd server && npx tsx src/index.ts &
  # play a few server-side scripted turns OR use a ws python script to drive state
  npx tsx scripts/drive-state.ts --p2-plays "sin(x) + 2*x^2"
  # windowed godot (Playwright not needed; headless screenshot works):
  godot --headless --render-thread safe res://scenes/MainGame.tscn --screenshot .sisyphus/evidence/task-19-board.png
  # assert via look_at evidence/task-19-board.png:
  #   HPLabel shows "30"
  #   ExprLabel shows "sin(x) + 2*x^2"
  #   TurnPhaseLabel shows "Play Phase"
  ```
  Failure path (server rejects a malformed patch / player card enum corrupt):
  ```
  # inject a bad state shape locally for QA render:
  ConnectionManager.game_model = {"phase":"INVALID_PHASE", "players":{}}
  ConnectionManager.state_changed.emit(ConnectionManager.game_model)
  godot --headless --render-thread safe --screenshot .sisyphus/evidence/task-19-empty-state.png
  # assert via look_at: phase label shows "INVALID_PHASE" verbatim, HP labels default to "0",
  # application does NOT crash, ErrorModal remains hidden (render layer never throws).
  ```

  ### Evidence
  - `.sisyphus/evidence/task-19-board.png` (full board with hand, decks, slots)
  - `.sisyphus/evidence/task-19-empty-state.png` (defensive-empty render, no crash)
  - `.sisyphus/evidence/task-19-render-trace.log` (stdout showing each label update tied to a `state_changed` event)
  - `.sisyphus/evidence/task-19-gamemodel-fields-used.md` (table of every `GameModel[...]` path read by MainGame.gd)

  ### Commit
  `feat(godot): MainGame.tscn text-only board render — panels, slots, hand, decks`

- [ ] 20. Godot intent sender — CardButton clicks → server intents

  ### What to do
  Add `scripts/CardButton.gd` (each `Button` in HandVBox instances the script):
  ```gdscript
  extends Button
  signal card_clicked(card_id: String)

  var card_id: String = ""
  func _ready():
      connect("pressed", self, "_on_pressed")
  func _on_pressed():
      emit_signal("card_clicked", card_id)
  ```
  Wire `MainGame.gd` so every HandVBox CardButton's `card_clicked(card_id)` routes to `ConnectionManager.send_intent(intent_type, payload)`.

  Create a thin helper on `ConnectionManager`:
  ```gdscript
  func send_intent(kind: String, payload: Dictionary) -> void:
      # SDK branch:
      room.send(kind, payload)
      # raw-WS branch:
      # peer.send_text(JSON.stringify({"type": kind, "data": payload}))
  ```

  Concrete intent map (each UI control → intent sent):
  | UI Control | Intent Type | Payload | Disabled Conditions |
  |---|---|---|---|
  | CardButton click (Function/base card in hand) | `play_card` | `{cardId}` | not local's turn OR phase != "play" |
  | End Turn button | `end_turn` | `{}` | not local's turn OR phase == "resolution" |
  | Evaluate button | `eval_function` | `{variableValueCardId}` | not local's turn OR phase != "play" OR no variable-value selected |
  | Draw FCC mini-button | `draw_cards` | `{deckType: "fcc"}` | phase != "draw" OR draws_this_turn >= 2 |
  | Draw Number mini-button | `draw_cards` | `{deckType: "number"}` | phase != "draw" OR draws_this_turn >= 2 |
  | Draw Action mini-button | `draw_cards` | `{deckType: "action"}` | phase != "draw" OR draws_this_turn >= 2 |

  "Evaluate" button visible only when `GameModel.local_player.has_eval_legal == true` (a boolean the server sets; client trusts it). A variable-value card must be selected first — clicking a card of `type == "variable_value"` sets `ConnectionManager.currently_selected_variable_value_card` instead of emitting `play_card`.

  Server is authoritative — invalid intents are NOT pre-filtered client-side beyond the disabled conditions above. Client listens for `ConnectionManager.error(code, message)` → shows `ErrorModal` with `"%s\n%s" % [code, message]`; modal auto-dismisses after 3 s (timer implemented in T19's ErrorModal).

  ### Must NOT do
  - NO client-side game-rule validation (server is authoritative — clients are dumb/blind). The disabled conditions above are UX polish only and MAY be incomplete; server still rejects.
  - NO optimistic UI — never mutate `GameModel` until `state_changed` arrives.
  - NO cancel-intent, undo, or replan UI.
  - NO multi-select or drag-drop — single-click intent send only.
  - NO `console.log`-style debug print in production builds (`print()` guarded by `OS.is_debug_build()` is acceptable).
  - NO retrying a rejected intent automatically — surface the error to the user.

  ### Recommended Agent Profile
  - **Category**: `visual-engineering`
  - **Skills**: `[/playwright]` (screenshot evidence of ErrorModal after illegal intent), `[/paseo-advisor]` (verify intent payload field names match T14 handler Zod schemas before wiring)
  - **Evaluated**: each button maps to exactly one intent type and payload shape that matches T14's Zod message contracts (no silent field-name mismatch); disabled conditions match server phase FSM (T10); Evaluate button visibility tied to server-set `has_eval_legal`; no optimistic state mutation anywhere in the diff.
  - **Omitted**: intent queueing, batching, retries.

  ### Parallelization
  - **Can Run In Parallel**: T19 (provides the UI container + CardButton scene — definitional shared contract; if T19 in flight, this task stubs an in-scene CardButton and Final merges).
  - **Group**: Wave 5.
  - **Blocks**: F3 (manual QA needs clickable intents to drive a full turn).
  - **Blocked By**: T18 (ConnectionManager.send_intent + signals), T14 (server message handler Zod contracts — the exact intent names + payload field names), T10 (phase FSM, to implement correct disable conditions).

  ### References
  - **Pattern**: Colyseus `room.send("play_card", {cardId})` authoritative client intent — server validates then broadcasts delta; client never changes local state until `on_state_change`.
  - **API**: `room.send(msg_type, payload)` (SDK branch) / `peer.send_text(JSON.stringify({"type": msg_type, "data": payload}))` (raw-WS branch).
  - **Test**: T14 handler unit tests define the exact acceptable Zod payloads — use the same literals here to guarantee contract alignment.
  - **External**: Colyseus Room.send docs — https://docs.colyseus.io/colyseus/server/room/#send-type-data
  - **WHY**: Centralizing every outbound `send` through one `ConnectionManager.send_intent` (typified by intent enum strings) keeps intent payload audit single-file and makes the F4 scope-fidelity check trivial.

  ### Acceptance Criteria
  - [ ] `scripts/CardButton.gd` exists; each hand card button emits `card_clicked(card_id)` signal.
  - [ ] `ConnectionManager.send_intent(kind, payload)` exists; both SDK and raw-WS branches covered (one active per T5 decision).
  - [ ] All 6 intents from the table wired to their UI controls with exact payload field names matching T14 Zod schemas.
  - [ ] End Turn button `disabled = true` whenever `GameModel.current_turn != local` OR phase == "resolution".
  - [ ] Evaluate button `visible = false` unless `GameModel.local_player.has_eval_legal == true`; `disabled = true` until a variable-value card selected.
  - [ ] Each Draw mini-button disabled when `phase != "draw"` OR `local.draws_this_turn >= 2`.
  - [ ] CardButton disabled when `current_turn != local` OR `phase != "play"` OR `card.type != play_legal_card_type` (basic check only; server is source of truth).
  - [ ] On `ConnectionManager.error(code, message)`, ErrorModal shows `%s\n%s` and auto-hides after 3s; user cannot queue duplicate modals.
  - [ ] No optimistic mutation of `GameModel` outside `state_changed` — verified by grep / ast_grep_search of `GameModel[` writes anywhere besides ConnectionManager.
  - [ ] `room.send` / `peer.send_text` invoked from exactly one function (`send_intent`) — no scattered network calls.

  ### QA Scenarios
  Happy path:
  ```
  # server up, both clients at draw phase (p1 local)
  cd server && npx tsx src/index.ts &
  # client p1 runs windowed; Playwright optional — use headless stdout:
  # send draw_cards intent:
  godot --headless --script scripts/test-draw-fcc.gd       # clicks "Draw FCC" button programmatically
  # server log expects:
  #   received draw_cards { deckType: "fcc" } from p1
  #   p1 phase advances; send patch { 'players/p1/hand/(length)': N+1 }
  # Verify client:
  grep -c "draw_cards intent sent" p1.log                 # expect >= 1
  grep -c "state_changed: hand size=" p1.log              # expect increased count
  # screenshot:
  godot --headless --render-thread safe --screenshot .sisyphus/evidence/task-20-happy-draw.png
  # assert via look_at: hand panel gained one more CardButton; deck counts fcc decremented
  ```
  Failure path (illegal intent — draw during play phase):
  ```
  # server up; force p1 to play phase (skip draw).
  npx tsx scripts/force-phase.ts --player p1 --phase play
  # client clicks "Draw FCC" anyway (disabled should be true; test overrides disabled to verify rejection):
  godot --headless --script scripts/test-draw-illegal.gd
  # server log expects:
  #   received draw_cards { deckType: "fcc" } from p1
  #   REJECT: phase expected=draw actual=play  code=ERR_WRONG_PHASE
  #   broadcast error { code: "ERR_WRONG_PHASE", message: "Cannot draw during play phase" }
  # Verify client:
  grep -E "ERR_WRONG_PHASE" p1.log                        # expect >= 1
  godot --headless --render-thread safe --screenshot .sisyphus/evidence/task-20-fail-illegal-draw.png
  # assert via look_at: ErrorModal visible showing "ERR_WRONG_PHASE\nCannot draw during play phase"; hand panel UNCHANGED (no optimistic update)
  ```

  ### Evidence
  - `.sisyphus/evidence/task-20-happy-draw.png` + `.log`
  - `.sisyphus/evidence/task-20-fail-illegal-draw.png` + `.log`
  - `.sisyphus/evidence/task-20-intent-matrix.md` (the table above + which `room.send` each row fires)
  - `.sisyphus/evidence/task-20-zod-contract-match.md` (diff between `payload` here and T14 Zod schema, ALL green)

  ### Commit
  `feat(godot): intent sender — CardButton + End Turn / Evaluate / Draw mini-buttons`
---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run `npx ts-node` snippet, curl WS endpoint). For each "Must NOT Have": search codebase for forbidden patterns (`ast_grep_search` for Colyseus imports in Pure Game Logic, `as any`, prize deck structures, SymPy HTTP client) — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npx tsc --noEmit` + `npx vitest run`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, `console.log` in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify Math Engine Capability Matrix matches implemented functions. Verify card catalog frozen (no edits mid-dev beyond T3).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Start server (`npm run dev`). Launch 2 Godot clients headless. Execute EVERY QA scenario from EVERY task. Capture evidence. Run a full end-to-end game: build functions → 5 turn cycles → play offensive → opponent defends → evaluate for HP → trigger force eval → win by HP=0. Then a second game winning by variable isolation. Edge cases: disconnect+reconnect, deck exhaustion, illegal-intent rejection, simultaneous force eval. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (`git log/diff` if git init'd). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination (Task N touching Task M's files). Flag unaccounted changes. Confirm no SymPy service, no prize cards, no other game modes, no N-player code, no Godot polish features.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **T1**: `chore(server): scaffold Colyseus + TypeScript backend`
- **T2**: `feat(shared): define card types, enums, Zod message contracts`
- **T3**: `feat(cards): freeze minimal starter catalog (~22 cards)`
- **T4**: `feat(math): engine abstraction + math.js impl + SymPy stubs + capability matrix`
- **T5**: `chore(godot): scaffold project + Colyseus Godot SDK`
- **T6**: `feat(server): Colyseus state schema with @view hidden hands`
- **T7**: `feat(logic): pure deck/zone/graveyard/limits/composition core (no Colyseus imports)`
- **T8**: `feat(math): expression parse/serialize layer + domain validators + counters`
- **T9**: `feat(math): complexity-score AST walker (rulebook scoring + eligibility)`
- **T10**: `feat(room): lifecycle, reconnection, 2P lock`
- **T11**: `feat(room): turn phase FSM + timers + stalling prevention + initial construction`
- **T12**: `feat(cards): effect engine — command dispatch, offensive limit, trap, theorems`
- **T13**: `feat(logic): evaluation engine — HP formula, force eval, undefined handling`
- **T14**: `feat(logic): win conditions — HP, isolation timers, force-dom, vec/singular`
- **T15**: `feat(room): message handlers with Zod + server-side validation`
- **T16**: `feat(room): edge cases — deck exhaust, simultaneous force eval, fizzle`
- **T17**: `test: vitest suites for pure logic + room integration`
- **T18**: `feat(godot): connect screen + Colyseus state sync`
- **T19**: `feat(godot): game board text render`
- **T20**: `feat(godot): intent sender + deck selection`
- **F1-F4**: `test: final verification — audit, QA, scope fidelity`

---

## Success Criteria

### Verification Commands
```bash
cd server && npm run dev          # Expected: HTTP+WS server on :2567, "NerdiClashRoom registered"
cd server && npx tsc --noEmit     # Expected: 0 errors
cd server && npx vitest run       # Expected: all suites pass
godot --headon --script           # Expected: client logs "connected; phase=draw; turn=player1"
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent (verified by ast_grep_search + grep)
- [ ] All vitest tests pass
- [ ] End-to-end 2P game completes with both victory paths exercised
- [ ] Math Engine Capability Matrix matches implementation (4 red stubs max)
- [ ] Card catalog untouched beyond T3