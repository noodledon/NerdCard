- [ ] 6. Colyseus State Schema

  **What to do**:
  - Create `backend/server/src/state/schema.ts` exporting all Colyseus Schema subclasses. Every math expression field MUST be `@type("string")` — NEVER store `math.Node` objects (verified via ast_grep_search below).
  - Create `CardSchema` (extends `Schema`) with: `id: string`, `deckType: string` (enum value as string — "FCC"|"Number"|"Action"), `cardType: string` (e.g. "addTerm"|"offensive"|"shield"|"trap"|"theorem"|"derivative"|"addBoard"|"forceEval"|"eval"|"constant"), `domain: string` (BaseDomain enum: "Rational"|"Polynomial"|"Trig"|"ExpLog"|"Calculus"|"NumTheory"|"LinearAlgebra"), `numericValue: string` (for Number cards — string to preserve irrationals like "pi","sqrt(2)" → serialized math.js string), `expressionPayload: string` (FCC builder expression as math.js string; empty when N/A), `usuableOncePerConstruction: boolean` (for variable cards), `isFlipped: boolean` (graveyard front/back). Field count ≤64 here, fine.
  - Create `FunctionBoardSchema` (extends `Schema`), nested INSIDE Player to keep Player under 64 fields. Fields: `boardId: string`, `ownerSessionId: string`, `expression: string` (math.js node.toString() — e.g. `"x^2 + 3*x"`; parse on demand via `math.parse`), `domain: string` (BaseDomain enum→string), `compositionDepth: number` (0, 1, or 2 — rulebook caps cross-domain composition depth ≤2), `dimension: number` (matrix/vector board rank; 0 for scalar expressions), `isSingular: boolean` (matrix board singular flag for forced-loss condition), `isActive: boolean`.
  - Create `PlayerSchema` (extends `Schema`) with: `sessionId: string`, `displayName: string`, `hp: number` (starts 0), `isConnected: boolean`, `deckFCC: ArraySchema<CardSchema>`, `deckNumber: ArraySchema<CardSchema>`, `deckAction: ArraySchema<CardSchema>`, `discardGraveyard: ArraySchema<CardSchema>` ("3rd Dimension"), `hand: ArraySchema<CardSchema>` annotated with `@view()` — PRIVATE to owner; opponents see only `handCount`. Field `handCount: number` (kept in sync on every add/remove), `availableVariables: ArraySchema<string>` (x1..x10, removed as used), `variableUsagesLeft: number` (count, mirror), `boards: ArraySchema<FunctionBoardSchema>` (max 3), `boardCount: number` (mirror for opponents), `baseFunctionUnlocked: boolean`, `hasUsedVariableThisConstruction: boolean`.
  - Create `GameRoomState` (extends `Schema`) root with: `phase: string` ("waiting"|"draw"|"play"|"defense"|"resolution"|"gameOver"), `currentTurn: string` (sessionId), `turnDeadline: number` (epoch ms), `turnIndex: number` (global turn counter 0..N), `roundNumber: number`, `winner: string` (sessionId or ""), `players: MapSchema<PlayerSchema, string>` (string keys = sessionId), `stalling_no_eval_turns: number` (0..20 — drives 5-turn and 20-turn stalling prevention; increments each turn w/o eval, resets on eval), `variable_isolation_timers: MapSchema<number, string>` (per-player 3-turn countdown keyed by sessionId when their function isolated), `deckCounts: MapSchema<number, string>` (top-level deck exhaustion tracker keyed by deckType), `config: Schema<RoomConfigSchema>` (nested) with `maxPlayers: number`, `turnTimeoutMs: number`, `seed: string` (RNG seed).
  - Document the StateView pitfall utility pattern in a module-level comment block AND export a helper `addToHand(player: PlayerSchema, card: CardSchema, client: Client)` that performs `player.hand.push(card); owningClient.view.add(card); player.handCount = player.hand.length;` — callers (T7 zone-transition callbacks, T10 FSM, T14 handlers) MUST use this helper, NOT direct `.push()`. Failure to call `client.view.add()` after a push to a `@view()` array is the #1 documented card-game bug (hand invisible to owner).
  - For matrix boards: do NOT use multi-dim arrays (Colyseus schema forbids). Store the WHOLE matrix expression as a flattened math.js string, e.g. `board.expression = "[[1,2],[3,4]]"` or `"matrix([1,2],[3,4])"` plus `board.dimension` for rank/handling. Client roundtrips the string; server parses via `math.parse`/`math.matrix` on demand.
  - Re-use shared types from T2 (`backend/shared/types.ts`): `BaseDomain`, `DeckType`, `CardType` enums; keep schema string-encoded versions aligned (schema `domain: string` coerced from `BaseDomain`).
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
  `backend/shared/types.ts` (Task 2 output) — `BaseDomain`, `DeckType`, `CardType` enums to string-encode.
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
  - [ ] `backend/server/src/state/schema.ts` exists exporting `CardSchema`, `FunctionBoardSchema`, `PlayerSchema`, `GameRoomState`, `RoomConfigSchema`, and helper `addToHand(player, card, client)`.
  - [ ] `npx tsc --noEmit` → 0 errors in `backend/server`.
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
    Preconditions: Task 2 merged; `backend/shared/types.ts` exports BaseDomain/DeckType/CardType enums; Node 20+; deps installed in backend/.
    Steps:
      1. `cd backend/server && npx tsc --noEmit` → exit code 0.
      2. `cd backend/server && cat > /tmp/schema-rt.test.ts <<'EOF'
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
      1. `cd backend/server && ast-grep --lang typescript -p 'import $$$ from "mathjs"' src/state/schema.ts` → 0 matches.
      2. `cd backend/server && ast-grep --lang typescript -p 'math.parse($$$)' src/state/schema.ts` → 0 matches.
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
  - Create `backend/server/src/logic/deck.ts` exporting `class Deck` (per deck type) with: constructor `(deckType: DeckType, cards: CardData[], rng?: () => number)`; methods `shuffle(seed?: string): void` (Fisher-Yates using the injected RNG, default `Math.random`), `draw(): CardData | null` (returns top or null when empty), `drawN(n): CardData[]`, `peek(): CardData | null`, `size(): number`, `isEmpty(): boolean`, `toArray(): CardData[]` (for graveyard/restock). Provide `seededRng(seed: string): () => number` (mulberry32 or splitmix32 — deterministic, identical output across Node versions). A seeded shuffle MUST reproduce byte-identical order for the same seed (unit test asserts this).
  - Create `backend/server/src/logic/zones.ts` exporting `enum ZoneType { Hand="Hand", BoardEq="BoardEq", Graveyard="Graveyard", DeckFCC="DeckFCC", DeckNumber="DeckNumber", DeckAction="DeckAction", Active="Active", Held="Held" }` and `interface CardMoveEvent { cardId: string; from: ZoneType; to: ZoneType; ownerSessionId: string; timestamp: number; }`. Provide pure `function moveCard(state: LogicState, cardId, from, to): CardMoveEvent` that mutates an internal `LogicState` (NOT Colyseus state) and invokes callbacks: `onCardAddedToZone(card, to, owner)` and `onCardRemovedFromZone(card, from, owner)`. THIS module has ZERO Colyseus imports — callers (T10 FSM, T14 handlers) wrap these callbacks to also push into the Colyseus `@view()` hand / grave via T6's `addToHand`. Callbacks are optional fields on `LogicState.callbacks`.
  - Create `backend/server/src/logic/graveyard.ts` exporting `class Graveyard` accounting: `bury(card)`, `exile(cardId)`, `resurrect(cardId)`, `size()`, `contains(cardId)`, `toArray()`. Tracks "3rd Dimension" accounting per rulebook Resolution Phase.
  - Create `backend/server/src/logic/limits.ts` exporting pure predicates: `function enforceHandSize(player: PlayerLogic): { ok: boolean; reason?: string }` (default cap 7; configurable), `function enforceBoardCount(player): { ok; reason? }` (≤3 boards — rulebook), `function canAddBoard(player): boolean`. These operate on a `PlayerLogic` interface (sessionId, hand: CardData[], boards: FunctionBoardLogic[]) — NOT Colyseus Schema — so unit-testable without a Room.
  - Create `backend/server/src/logic/composition.ts` exporting `class CompositionDepthTracker` with `current(sessionId): number`, `push(sessionId): void` (+1), `pop(sessionId): void` (-1), `reset(sessionId): void`, `isWithinLimit(sessionId): boolean` (≤2 per rulebook), `assertComposition(sessionId): void` throws if depth would exceed 2. Used by T10 during Composition/Force-Eval actions and reflected into `FunctionBoardSchema.compositionDepth` by handlers (T14).
  - Create `backend/server/src/logic/types.ts` exporting `PlayerLogic`, `FunctionBoardLogic`, `CardData`, `LogicState` (carries decks, hands, boards, graveyards per sessionId + `callbacks: { onCardAddedToZone?; onCardRemovedFromZone? }`). Import shared types (`baseType`, `CardType`, `DeckType`) from T2.
  - All modules import ONLY from `mathjs`'s parser-free helpers (none needed here actually — pure logic) and from `backend/shared`. ZERO imports from `@colyseus/*` or `colyseus.js` (ast_grep_search verify).
  - Unit tests (`backend/server/test/logic/*.test.ts`): seeded shuffle determinism (same seed → identical card order), Fisher-Yates produces valid permutation of same multiset, draw on empty returns null, zone move fires both callbacks with correct `(card,zone,owner)`, hand limit blocks at cap, board limit blocks at 3, CompositionDepthTracker rejects push at depth 3.

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
  - T2 `backend/shared/types.ts`: `CardType`, `DeckType`, `BaseDomain` enums; `CardData` shape contract.
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
  - [ ] `backend/server/src/logic/{deck,zones,graveyard,limits,composition,types}.ts` exist and compile.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `ast_grep_search` for `import $$$ from "@colyseus$$$"` OR `from "colyseus"` in `src/logic/*` → 0 matches (no Colyseus imports).
  - [ ] `npx vitest run backend/server/test/logic` → all tests pass; specifically seeded shuffle determinism test (same seed → byte-identical card array after shuffle) passes.
  - [ ] `Deck.draw()` on empty deck returns `null` (not throws).
  - [ ] `CompositionDepthTracker` throws on the 3rd `.push()` (`isWithinLimit` false) for the same sessionId.
  - [ ] `moveCard` invokes BOTH `onCardRemovedFromZone` (from) and `onCardAddedToZone` (to) in that order with correct args.

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Seeded Fisher-Yates produces deterministic, identical card order across runs
    Tool: Bash
    Preconditions: T2 merged; backend deps installed; vitest configured.
    Steps:
      1. `cd backend/server && cat > /tmp/deck-shuffle.test.ts <<'EOF'
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
      1. `cd backend/server && cat > /tmp/logic.test.ts <<'EOF'
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
  - Pre-commit: `npx tsc --noEmit && npx vitest run backend/server/test/logic`

- [ ] 8. Expression Representation Layer

  **What to do**:
  - Create `backend/server/src/math/expressions.ts` exporting: `function parseExpression(input: string): math.Node` (wraps `math.parse`, throws `MathValidationError` on parse failure), `function serialize(node: math.Node): string` (wraps `node.toString()`, options: `{ implicit?: "hide"|"show"; parenthesis?: "keep"|"auto"|"all" }` — MUST default to a STABLE config and ALWAYS use the same config on both serialize and round-trip tests), `function roundtrip(input: string): { original: string; serialized: string; reparsed: math.Node; equal: boolean }`.
  - Create `backend/server/src/math/validation.ts` exporting domain validation predicates (each returns `{ ok: boolean; reason?: string }`):
    - `validateRational(node)`: node must be a polynomial P(x)/Q(x) where P,Q have integer/rational coefficients; reject floats & radicals. (Use `math.rationalize` then check.)
    - `validatePolynomial(node, opts: { maxDegree: number })`: maxDegree=5; all variable terms in a single symbol; degree ≤5; coefficient numeric (no transcendental constants).
    - `validateTrig(node, opts: { maxTerms: number })`: maxTerms=6; only addition/multiplication operators (no nested composition like `sin(cos(x))`); allowed funcs: `sin, cos, tan, cot, sec, csc, asin, acos, atan`; reject `sin(sin(x))`.
    - `validateExpLog(node, opts: { maxTerms: number })`: maxTerms=10; bases allowed: `2, 10, e`; `exp`, `log2`, `log10`, `ln` permitted; `ln^power` counts as 2 terms (power applied to log enlarges term budget); reject `e^x^x`, reject `log_3(x)`.
    - `validateByDomain(domain: BaseDomain, node): { ok; reason? }`: dispatcher to the above by enum.
  - Create `backend/server/src/math/counters.ts` exporting:
    - `function countTerms(node: math.Node): number` — top-level addition operands count (traverse top-level `OperatorNode "+"` chain); single term → 1.
    - `function countDistinctVariables(node: math.Node): number` — collect `SymbolNode.name` leaves via `node.traverse()` into a `Set<string>`; constants/pis/e not counted.
    - `function listVariables(node: math.Node): string[]` — same collection as array (used by T9 walker in build; do not duplicate logic — T9 imports this).
  - Module imports ONLY from `mathjs` + `backend/shared` (BaseDomain enum). ZERO Colyseus imports (ast_grep_search verify).
  - Add an internal **capability matrix** test (`backend/server/test/math/capability-matrix.test.ts`) that:
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
  - [ ] `backend/server/src/math/{expressions,validation,counters}.ts` exist and compile.
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
      1. `cd backend/server && cat > /tmp/math-cap.test.ts <<'EOF'
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
      1. `cd backend/server && cat > /tmp/math-val.test.ts <<'EOF'
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
  - Pre-commit: `npx tsc --noEmit && npx vitest run backend/server/test/math`

- [ ] 9. Complexity Score AST Walker

  **What to do**:
  - Create `backend/server/src/math/complexity.ts` exporting `function computeComplexity(node: math.Node): number` — a PURE function that returns an integer Complexity Score per rulebook §HP Gain ("+1/distinct variable term, +1/term beyond first, +2/composition"; eligible only if ≥2 distinct variable terms → walker still returns the score; eligibility cutoff is enforced by callers, not here, but provide `function isEligibleForHP(node: math.Node): boolean` returning `countDistinctVariables(node) >= 2`).
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
  - Comprehensive unit test file `backend/server/test/math/complexity.test.ts` enumerating each of the above cases with assertion + a comment tying to the example; cover positive/negative.

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
  - [ ] `backend/server/src/math/complexity.ts` exports `computeComplexity`, `computeEligibleComplexity`, `isEligibleForHP`.
  - [ ] `npx tsc --noEmit` → 0 errors.
  - [ ] `ast_grep_search` for `import $$$ from "@colyseus$$$"` in `src/math/complexity.ts` → 0 matches (pure).
  - [ ] `npx vitest run backend/server/test/math/complexity.test.ts` → all enumerated cases pass:
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
      1. `cd backend/server && cat > /tmp/complexity.test.ts <<'EOF'
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
      1. `cd backend/server && cat > /tmp/complexity-comp.test.ts <<'EOF'
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
  - Pre-commit: `npx tsc --noEmit && npx vitest run backend/server/test/math`