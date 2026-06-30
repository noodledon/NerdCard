# Draft: NERDICARD Backend Game Server Development

## Requirements (confirmed)
- Tech stack (user-decided):
  - Backend: Node.js + TypeScript + Colyseus.js + math.js
  - Frontend: Godot 4.x + GDScript + Colyseus Godot SDK (WebSockets)
- User wants: "simplest UI in godot first and then focus on backend game engine"
- Server retains FULL authority (anti-cheat) — client is "dumb/blind"
- User asked: "review game logics and player flow and create a structured plan for developing"

## Research Findings
- 3 design docs found in repo root:
  1. `NerdiCard.txt` — Official Rulebook v1.0 (most complete/formal)
  2. `Nerdicard Game Logic Version 1.txt` — Game logic w/ 3 game modes
  3. `Nerdicard - Overall Description WIP.txt` — Early brainstorm (note says "disregard most")
- Godot project exists (`project.godot`, `game.gd`) but `scripts/` is empty — no game logic yet
- NO Node.js / TypeScript project scaffolding exists yet (no package.json/tsconfig) — greenfield backend

## Game Model Summary (from rulebook + game logic doc)
### Game Modes (3 total, only implement MVP first):
1. **NerdiClash** (Official) — Win by Variable Isolation OR reducing opponent HP to 0
2. **Variable Isolation** (2nd) — Win only by isolating opponent's variables
3. **Classic Clash** (HP, WIP) — Pure HP attack mode

### Decks (3):
- FCC Deck (Function Component Cards)
- Number Deck (constants, primes 2/3/5, irrationals π/e/√2/√3/φ/γ/log2)
- Action Deck (offensive, defensive, trap, spell, theorem, special)

### Player Resources:
- 1 Base Function Card (domain: Rational/Poly ≤deg5, Trig ≤6 terms, Exp/Log ≤10 terms)
- 10 Variable Cards (x1..x10, each usable once per construction phase)
- 10 Number Cards
- 5 starter cards (FCC/Action/Defense mix)
- Hand of cards
- Up to 3 Function Boards
- HP starts at 0; gain via evaluation

### Turn Structure (4 phases):
1. Draw Phase — draw 2 cards from any deck combo
2. Play Phase — up to 2 actions (build/attack/defend/trap/special/evaluate); max 1 offensive/turn
3. Defense Phase — others may respond w/ defense/trap (1 per trigger)
4. Resolution Phase — resolve, move used cards to "3rd Dimension" (graveyard)

### HP Gain Formula:
HP Gain = (Function Value × Complexity Score) / 10
- Complexity = +1/distinct variable term, +1/term beyond first, +2/composition
- <2 variable terms → ineligible for HP

### Card Types & Effects:
- FCCs: Add Term, Calculus (diff/integrate/limit/continuity), Number Theory (modular/primes/theorems), Linear Algebra (vectors/matrices/transforms/eigenvalues)
- Action Cards: Offensive, Defense/Shield, Trap, Theorem (Martial=offensive / Artifact=passive), Special (Add Board/Composition/Force Evaluation)
- Number Cards: bind to spell/offensive as factor until graveyard

### Victory Conditions:
1. Reduce all opponents' HP to 0
2. Isolate opponent's function to single variable + prevent rebuild in 3 turns
3. Force Evaluation domination (initiator value > 2× every other)
4. Reduce opponent's vector space dim to 0 / force matrix board singular

### Key Mechanics:
- Variable isolation, Function composition (cross-domain, depth ≤2)
- Force Evaluation (simultaneous eval, HP redistribution rules)
- Stalling prevention (20 global turns or 5 consecutive no-eval → forced eval)
- Undefined/infinite eval → board destroyed / immediate loss
- Prize cards (in Game Logic v1 doc) — pull on events

## User Decisions (CONFIRMED)
1. **MVP Game Mode**: NerdiClash (from NerdiCard.txt rulebook — most complete).
   Win conditions: HP reduction to 0 OR variable isolation (3-turn rebuild fail).
2. **Player Count**: 2-player only for v1.
3. **Math Domain Scope**: FULL (all domains — calculus + number theory + linear algebra).
   ⚠️ ARCHITECTURAL IMPLICATION: math.js supports derivatives, simplify, matrix ops, complex numbers, basic number theory. It CANNOT do: symbolic integration, limits, RREF, symbolic equation solving. → SymPy microservice is REQUIRED for "Full" scope.
4. **UI Sequencing**: Minimal client alongside backend (Godot acts as live test client; build incrementally with backend).
5. **Test Strategy**: Tests AFTER implementation (no TDD). Agent-executed QA mandatory per task.

## Research Findings — math.js (bg_b397c905, COMPLETED)
### Supported by math.js:
- Expression parsing & AST: `math.parse(string)` → Node tree, serialize via `math.replacer`/`math.reviver`
- Symbolic derivative: `math.derivative(expr, var)` ✅
- Simplify, rationalize, leafCount, symbolicEqual ✅
- Complex numbers: full support (Complex class, polar/rect)
- Matrix ops: det, inv, pinv, transpose, trace, lup, qr, schur, svd (new 2025), eigs (⚠️ partial — fails on defective matrices), expm, sqrtm, lusolve, lyap, sylvester, kron, fft/ifft, solveODE
- Number theory: gcd, lcm, xgcd, mod, invmod, isPrime
- Polynomial roots: `math.polynomialRoot(...coeffs)` (numerical)
- Safe eval: sandboxed parser (no eval/new Function), can disable dangerous fns, worker pool for isolation

### NOT supported by math.js (require SymPy):
- ❌ Symbolic integration (Issue #442 open since 2015; external pkg mathjs-simple-integral too limited)
- ❌ Limit evaluation (no function, not on roadmap)
- ❌ Symbolic equation solving (Issue #38 since 2013)
- ❌ RREF (Reduced Row Echelon Form) — write custom or use SymPy
- ⚠️ Rank — undocumented (may or may not exist)
- ⚠️ eigs on defective matrices — fails; SymPy fallback needed

### Recommended architecture:
- v1: Use math.js Node objects DIRECTLY as expression AST (Option A). Cards map to Node constructors; build tree programmatically; evaluate via `node.compile().evaluate(scope)`.
- Math engine abstraction layer (interface) so swappable to SymPy later
- SymPy microservice for: integrate, limit, rref, rank, robust eigs
- Custom RREF impl is simple enough to write in TS without SymPy (optional)

## User Decisions (Round 2 — CONFIRMED)
6. **SymPy Service**: STUB now (math.js ops working + "not implemented" stubs for integrate/limit), full Python/SymPy microservice as a LATER wave. Faster to playable state.
7. **Card Catalog Scope**: MINIMAL starter set (~20-30 cards spanning every archetype: FCC add-term, basic offensive/defensive/shield/spell/trap, derivative, 1-2 theorems, add-board, force-eval, eval). Catalog data-driven for future expansion.
8. **Prize Cards**: DEFER. v1 evaluation uses a "Variable Value Card" from player's own hand/set (rulebook v1.0 mechanism, no prize deck). Prize cards deferred post-MVP.

## Research Findings — Colyseus (bg_13cb481b, COMPLETED)
### Key patterns confirmed:
- **StateView for hidden hands**: `@view()` decorator + `client.view.add(schemaCard)` is CRITICAL — newly-pushed cards to a `@view()` array are NOT visible unless manually added. This is the #1 card-game bug.
- **64-field Schema limit**: use nested Schema objects for >64 fields.
- **No multi-dim arrays**: flatten to 1D + manual indexing (relevant for matrix boards).
- **MapSchema for players (string keys only)**, ArraySchema for ordered (hand, deck, graveyard).
- **Authoritative pattern confirmed**: clients send intents ("play_card", "eval"), server validates turn/phase/legality, mutates state, broadcasts via schema delta.
- **Phase field on root state**: `phase: "waiting"|"draw"|"play"|"defense"|"resolution"|"gameOver"` + `currentTurn` + `turnDeadline`.
- **Handler pattern** (from production Call Break repo): BaseHandler with `this.room` access, separate handlers per domain (Connection, Play, Defense, etc.).
- **Optional @colyseus/command**: Command pattern for testable action dispatch — recommended given complex card effects.
- **Reconnection**: `onDrop` → `allowReconnection(client, 30s)` for disconnect tolerance.
- **Reference repos**: colyseus/turnbased-cards-demo (UNO), namantam1/live-card-game (Call Break).

### Module split (confirmed):
1. State Schema (Card, Player, Board, GameRoomState)
2. Pure Game Logic (deck, shuffle, validation — no Colyseus imports, unit-testable)
3. Room Class (lifecycle, turn scheduling, orchestration)
4. Message Handlers (per-domain, validated with Zod)
5. App Config (server definition, room registration)
6. Shared Types (cards, enums, contracts — server+client)

## User Decisions (Round 3 — CONFIRMED, critical constraints)
9. **String-only expressions in Colyseus Schema**: math.js `Node` objects NEVER live in Colyseus state. Expressions stored solely as `@type("string")`. Server parses string→AST on-the-fly via `math.parse(str)` for any modification/evaluation, then `node.toString()` back to the schema string. (Metis caught this — already incorporated.)
10. **Custom AST Walker task for Complexity Score**: math.js has no native "count distinct variable terms / nested compositions" function. New dedicated task: build a Tree Walker/Visitor util that traverses math.js Node trees to compute Complexity Score dynamically before HP Gain formula applied.
11. **Schema turn counters (explicit)**:
    - `stalling_no_eval_turns: number` (0..20) — drives 5-turn and 20-turn Stalling Prevention mechanics
    - `variable_isolation_timers: MapSchema<number>` — per-player 3-turn countdown when function isolated
12. **4-week structured roadmap** — user wants output formatted as a step-by-step 4-week action plan.

## Defaults Applied
- **Expression representation**: STRING-ONLY in schema; math.js Node only server-internal in math engine / pure logic modules (non-negotiable).
- **@colyseus/command**: Include command pattern for testable card-effect dispatch (recommendation).
- **Colyseus Godot SDK risk**: If community SDK fails under Godot 4.7, fallback T5 to raw WebSocket + JSON parsing in GDScript. Plan T5 to verify SDK first; flag blocker if broken.
- **Task renumber**: New T9 "Complexity Score AST Walker" inserted in Wave 2; downstream tasks renumber T10-T20.

## Tech Stack Review (user invited changes)
- ✅ Node.js + TypeScript — keep (best JS runtime + type safety for game rules)
- ✅ Colyseus.js — keep (best-in-class authoritative turn-based server; StateView, reconnection, lobby)
- ✅ math.js — keep (covers deriv/simplify/matrix/complex/numtheory; SymPy stubs for rest)
- ✅ vitest — keep (ESM-native, fast, good TS support)
- ⚠️ Colyseus Godot SDK — verify in T5; fallback to raw WebSocket if broken. SDK has been spotty under Godot 4.x; community SDK at github.com/colyseus/colyseus-godot
- ✅ Godot 4.x + GDScript — keep (user's choice)

## CLEARANCE CHECK — ALL YES ✅
- Core objective clear: NerdiClash 2P authoritative Colyseus server, full math domains (stub SymPy), minimal card set
- Scope boundaries: IN (NerdiClash 2P, ~20-30 cards, math.js ops + SymPy stubs) / OUT (other modes, N-player, prize cards, full SymPy service)
- No blocking ambiguities: ✅
- Technical approach: Colyseus authoritative + StateView + handler/command pattern + math.js engine abstraction
- Test strategy: Tests after implementation + agent QA per task
- No outstanding questions: ✅
→ AUTO-TRANSITION to plan generation.

## Scope Boundaries
- INCLUDE: NerdiClash 2P mode, full math domains (calculus/numtheory/linalg), authoritative Colyseus server, minimal Godot client
- EXCLUDE: Variable Isolation-only mode, Classic Clash HP mode, >2 players (defer N-player)
