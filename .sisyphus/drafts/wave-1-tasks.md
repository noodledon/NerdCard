- [ ] 1. Backend Project Scaffolding

  **What to do**:
  - Create `server/` directory at repo root with the following layout:
    - `server/package.json` — name `nerdicard-server`, type `module`, scripts: `"dev": "tsx watch src/index.ts"`, `"build": "tsc"`, `"start": "node dist/index.js"`, `"typecheck": "tsc --noEmit"`, `"test": "vitest run"`.
    - Pin exact versions (no `^`/`~`): `colyseus@0.15.20`, `@colyseus/schema@3.0.3`, `@colyseus/command@0.3.0`, `math.js@14.4.2`, `zod@3.23.8`, `typescript@5.4.5`, `tsx@4.11.0`, `vitest@1.6.0`, `@types/node@20.14.0`.
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
  - **Category**: `default`
    - Reason: 25+ interface methods to implement against math.js, plus the type-opaque wrapper design and the capability matrix writeup. Moderate complexity but mostly mechanical — stays `default`, not `heavy`.
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
  - **Category**: `default`
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