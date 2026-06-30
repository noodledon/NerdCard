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