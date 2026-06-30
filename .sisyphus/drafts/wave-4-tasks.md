- [ ] 15. Message Handlers with Zod Validation + Full Server-Side Validation

  **What to do**
  - Implement `server/room/handlers/` directory containing one handler module per client→server message type. Wire every handler into the GameRoom `onMessage` registry (T9 Room class) so that incoming intents are fully validated before any state mutation.
  - Enumerate and implement handlers for **every** client→server message type. Each message name + its Zod payload schema (keys sourced from T2 message contracts):
    - `build_function` → `z.object({ boardId: z.number().int().min(1).max(3), expressionStr: z.string().min(1).max(500) })`
    - `play_card` → `z.object({ cardId: z.string(), target: z.object({ kind: z.enum(["player","board","card","none"]), id: z.string().optional() }) })`
    - `draw_cards` → `z.object({ deckType: z.enum(["fcc","number","action"]), count: z.number().int().min(1).max(2) })`
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
    5. **Dispatch to T12 command** — construct the matching `@colyseus/command` instance (from T12 evaluation engine / T11 effect engine / T7 zone utils) and `await this.room.dispatcher.dispatch(cmd, payload)`.
    6. **Reject with structured error code** — on any domain-rule failure (offensive limit exceeded, trap blocks offensive, too many actions this play-phase) broadcast `error` with the matching code from `ErrorCode` enum.
  - Per-message legal phase map:
    - `draw_cards` → `phase === "draw"`
    - `build_function`, `play_card`, `set_trap`, `eval_function`, `force_eval`, `end_turn` → `phase === "play"`
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
      // offensive limit, enforced by T11 effect engine via command — but pre-check here for fast fail:
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
  - NO re-implementation of rules already enforced by T11 effect engine (offensive limit, trap slot) — only fast-fail pre-checks are allowed; the source of truth lives in the command.
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
  - Handler code contains ZERO direct `state.x = …` mutations; `ast_grep_search` for assignment to `state.` member matches returns 0 hits in `server/room/handlers/`.

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
  - `.sisyphus/evidence/task-15/no-direct-mutation.txt` — `ast_grep_search` pattern `state.$FIELD = $VAL` over `server/room/handlers/**/*.ts` showing 0 matches.
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