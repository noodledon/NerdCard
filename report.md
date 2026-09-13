# Contract Consistency Report

## Purpose

This report records the cross-wave contract inconsistencies found while preparing the NerdiCard server for Wave 4, why they matter, and the normalization work used to resolve them.

## Inconsistencies Found

### 1. Client message contract drift

The master plan defines two incompatible client message contracts.

T2 defines the early message shape for construction and gameplay. For example, it specifies `build_function` with `boardId?: string`, `expression`, `variableIds`, and `numberCardIds`.

T15 later requires different shapes and additional message types. It expects `build_function` with `boardId` and `expressionStr`, `eval_function` with a variable-value card ID, and adds `play_defense` and `ready_inst`.

The original server implementation followed the T2 contract, while the Wave 4 draft assumed the T15 contract. Implementing handlers directly would have made handlers disagree with shared validation and any future client implementation.

### 2. Turn state has three meanings

The same turn concept was represented inconsistently:

- `server/src/state/schema.ts` used `currentTurn: string`, apparently a player session ID.
- `server/src/shared/types.ts` used `currentTurn: number`, apparently a numeric counter.
- `server/src/logic/fsm.ts` used `currentTurn: number`, a pure FSM turn index.

As a result, a handler could not safely answer the basic authoritative-server question: "Is this client the current turn owner?"

### 3. Evaluation payload was incomplete

The existing `eval_function` message accepted an optional raw evaluation point. The gameplay rules require the player to choose a Variable Value Card, whose one value is substituted into every distinct variable in the selected board expression.

The former shape could not prove that the submitted value came from a card in the player hand.

### 4. Wave 3 dependencies were missing

Wave 4 expects evaluation and win-condition engines, but the corresponding T13 and T14 modules did not exist. That made handler integration incomplete: an evaluation command had no canonical calculation engine, and state mutations had no central win-condition adjudicator.

## Normalization Decisions

### Canonical turn model

The normalized state has two distinct fields:

- `currentTurnPlayerId: string`: the active player's session ID. Handlers use this for authorization.
- `turnIndex: number`: the monotonically increasing turn counter mirrored from the pure FSM.

This removes the ambiguous schema field named `currentTurn`. The pure FSM keeps its numeric local `currentTurn` because it is an implementation-level turn index, not a player identity.

### Canonical client protocol

The normalized protocol has exactly ten message types:

1. `build_function`
2. `play_card`
3. `draw_cards`
4. `set_trap`
5. `play_defense`
6. `eval_function`
7. `force_eval`
8. `end_turn`
9. `ready_inst`
10. `leave_room`

The protocol keeps useful T2 mechanics where they represent actual game behavior, such as batch `draw_cards.deckChoices`, while adding the T15 fields required for authoritative validation, such as `variableValueCardId`.

### Evaluation and win engines

T13 and T14 were implemented as pure modules:

- `logic/evalEngine.ts` parses expression strings, applies one VVC value to all variables, computes complexity and scaled `hp10` gain, and evaluates strict force-evaluation domination with epsilon.
- `logic/winEngine.ts` checks HP loss after `everGainedHP`, isolation timer expiration, force domination, and integral-board destruction.

Keeping these modules free of Colyseus imports allows deterministic unit tests and lets room commands act as the mutation boundary.

## Completed Fixes

- Replaced schema-level `currentTurn` with `currentTurnPlayerId`.
- Updated shared room-state types to use `currentTurnPlayerId`, `turnIndex`, and `turnDeadline`.
- Added the ten-message protocol to `shared/messages.ts`.
- Added schemas for `play_defense` and `ready_inst`.
- Changed evaluation and force-evaluation requests to identify a Variable Value Card.
- Added T13 evaluation and force-evaluation logic with tests.
- Added T14 win-condition logic with tests.
- Extended message tests to validate every canonical message type.

## Remaining Work Before Wave 4 Handlers

1. Finish room turn-owner initialization and rotation when resolution advances to draw.
2. Add structured `ErrorCode` values and requester-only error sending.
3. Add room handler modules that parse canonical messages, validate phase and turn ownership, then dispatch commands.
4. Wire command outcomes through the evaluation and win engines.
5. Add deck exhaustion, reconnect, fizzle, and force-evaluation edge-case handling.
6. Add room integration tests around the normalized protocol.

## Handler Completion Decisions

The normalized protocol exposed several message types whose server-side command did not yet exist. The following minimal authoritative behaviors are used to complete the integration without inventing new client messages:

- `build_function`: validates and records the construction submission through the FSM. During construction it writes the selected owned board expression only after domain validation succeeds. In-play function changes remain card effects rather than arbitrary direct rebuilds.
- `play_defense`: validates that a defense or trap card is in the responding player's hand and that it references the pending trigger. Only one reactive card may be used per trigger. The response then closes the defense window into resolution. Detailed card-specific counter math remains catalog-driven command work.
- `ready_inst`: is an acknowledged lifecycle intent with no schema mutation. It exists so a client can confirm readiness without bypassing validation.
- `force_eval`: the VVC identity is required by the network protocol, and the player must also hold the catalog's Force Evaluation card (`cardType === "forceEval"` or equivalent subtype). The room dispatch adapter selects that card and supplies both identities to the force-evaluation command.
- `end_turn`: transitions `play -> resolution -> draw`, resets the active player's per-turn aggressive-action and evaluation flags, and rotates the active turn owner exactly once.
- Command outcomes are emitted as `game_event` from the room dispatch boundary, while handler validation failures remain requester-only `error` messages.

These are deliberately narrow integration rules. Future card-specific resolution work can extend commands without changing the canonical protocol again.

The gameplay explainer resolves the fizzle discrepancy in favor of the current v1 behavior: a card whose target is already destroyed fizzles and goes to the graveyard. The older unresolved-card-return wording in the Wave 4 draft is not used.

## Validation At This Checkpoint

After the protocol normalization, the server passes:

```text
16 test files passed
140 tests passed
npm run typecheck passed
```

## Wave 5 Inconsistencies Found (Godot Client)

Wave 5 wires the existing Godot UI (`game.tscn`/`game.gd`, `scenes/PlayerPanel.tscn`,
`scripts/GameModel.gd`, `scripts/ConnectionManager.gd`, `scripts/CardButton.gd`,
`scripts/PlayerPanel.gd`) to the server contract established through Wave 4. The
wave-5 task file (`.sisyphus/completed/wave-5-tasks.md`) and the master plan assume
several server-side capabilities that do not exist as written. All were verified
against the current on-disk server source via CodeGraph before compensating
client-side; none required a server change to keep Wave 5 unblocked, but each is
flagged below for future server work.

### 1. No server-side JSON bridge for the raw-WS fallback (T5 debt, never paid)

`client/scripts/colyseus-verify.md` records `SDK-BROKEN-FALLBACK`: the official
`colyseus-godot` SDK repository is gone (404), so the raw `WebSocketPeer` fallback
(`raw-ws-client.gd`) is the only viable client transport. That report explicitly
flags "Required Wave 2 server-side work: ... add a JSON text-frame bridge to
`server/src/app.config.ts`". Grepping the full server source turns up no such
bridge — `app.config.ts` only registers the native Colyseus room; Colyseus's
default transport speaks its own binary/msgpack room protocol, not plain JSON
text frames.

**Resolution used for Wave 5**: `ConnectionManager.gd` is written to speak the
exact wire shapes the server already defines in `shared/messages.ts`
(`ClientMessage`/`ServerMessage`, `state_snapshot`, `error`), plus a `join_room`/
`joined` handshake pair that has no server-side equivalent yet (see #2). This
makes the client's half of the contract concrete and ready to bridge, but the
Wave 5 QA scripts that assume a live server round-trip (T18–T20 "happy path"
scenarios) cannot pass end-to-end until the bridge is built. This is scoped as
follow-up server work, not a Wave 5 blocker.

**Status: FIXED** — `server/src/json-bridge.ts` (`JsonBridgeServer`, port 2568)
now accepts plain-JSON WebSocket connections and routes them into a
transport-agnostic `NerdiClashGame` (extracted from `NerdiClashRoom`).
`app.config.ts` starts both transports (Colyseus on 2567, JSON bridge on 2568),
and the Godot client connects to 2568. Committed as `204c099`.

### 2. No join/session-identity message exists in the protocol

The ten canonical `ClientMessage` types (`build_function`, `play_card`,
`draw_cards`, `set_trap`, `play_defense`, `eval_function`, `force_eval`,
`end_turn`, `ready_inst`, `leave_room`) and eight `ServerMessage` types
(`state_snapshot`, `phase_change`, `card_drawn`, `board_built`, `eval_result`,
`trap_triggered`, `game_over`, `error`) never include a join handshake or a way
for the client to learn its own `sessionId` / seat ("p1"/"p2"). Colyseus's own
`onJoin`/`room.sessionId` mechanics normally cover this, but the raw-WS fallback
bypasses that entirely.

**Resolution used for Wave 5**: `ConnectionManager.gd` defines and sends
`{"type": "join_room", "room": "nerdiclash"}` and expects
`{"type": "joined", "sessionId": ..., "role": ...}` in response. This is
client-only scaffolding today; the eventual JSON bridge (item #1) needs to emit
`joined` after a successful Colyseus `onJoin`.

**Status: FIXED** — `JsonBridgeServer.handleJoin()` implements exactly this
handshake: it assigns the `json-N` session ID, seats `p1`/`p2` in join order,
rejects a third client with `ROOM_FULL`, emits `joined`, and starts the game
when the second player joins (see item #1).

### 3. `has_eval_legal` / `draws_this_turn` do not exist anywhere on the server

T20's intent table and acceptance criteria assume the server sets a boolean
`GameModel.local_player.has_eval_legal` to gate the Evaluate button, and a
counter `local.draws_this_turn` to gate the three draw buttons at `>= 2`.
Neither field exists in `PlayerSchema` (`server/src/state/schema.ts`), the
protocol (`shared/messages.ts`), or any command
(`server/src/commands/*.ts`) — confirmed via CodeGraph search across the
entire server source.

**Resolution used for Wave 5**: `game.gd` derives an equivalent client-side
signal instead of trusting a nonexistent server flag:
- Evaluate button visibility is derived from whether the local player has at
  least one board with `isActive == true` (matching `EvalCommand`'s actual
  `isBoardAlive` check), gated further by turn ownership, phase, and having a
  VVC selected.
- Draw buttons are gated only on `phase == "draw"` and turn ownership, since
  the server's `draw_cards` handler doesn't track a per-turn draw counter either
  (see #4) — it validates the whole batch atomically instead.

These are UX-polish approximations per the wave-5 plan's own guidance
("disabled conditions ... MAY be incomplete; server still rejects"); the server
remains authoritative.

### 4. `draw_cards` requires an exact-2-card batch payload, not one card per click

T20's intent table specifies three independent mini-buttons ("Draw FCC" /
"Draw Number" / "Draw Action"), each sending `draw_cards` with a single-card
payload `{deckType: "fcc"}`. The actual server contract
(`DrawCardsSchema` in `shared/messages.ts`, enforced again in
`rooms/handlers.ts drawChoiceTotal()`) requires
`deckChoices: [{deck, count}]` where the **sum of all `count` values across the
array must equal exactly 2**. A `{deckType: "fcc"}`-shaped single-card message
would fail Zod validation (wrong field name: `deckType` vs `deck`) and then fail
the exact-total-2 check even if the field name were fixed.

**Resolution used for Wave 5**: each draw button now sends one
`deckChoices: [{"deck": "<fcc|number|action>", "count": 2}]` message — a full,
valid batch draw of 2 cards from that single deck, matching what the handler
actually accepts. Mixed-deck draws (e.g. 1 FCC + 1 Number) are not exposed in
the UI; the wave-5 plan didn't call for that either.

### 5. `EvalCommand` checks a VVC subtype string (`'variable-value'`) that no catalog card has

`server/src/commands/EvalCommand.ts:15` rejects any card whose
`subtype !== 'variable-value'` as an invalid VVC. The actual catalog
(`server/src/data/card-catalog.json`, cards `vvc-1` through `vvc-5`) sets
`"subtype": "Anchor"` for every Variable Value Card. As written, `EvalCommand`
can never accept a real VVC from the deployed catalog — `eval_function` is
unreachable in practice. This is a genuine server-side bug, not a client
concern, but it directly affects how the Wave 5 client must select a VVC
before sending `eval_function`.

**Status: FIXED** — Changed `EvalCommand.ts:18` from `'variable-value'` to `'Anchor'` to match the catalog. The `eval_function` intent is now reachable with real VVC cards.

**Related fix**: `ForceEvalCommand.ts:16` had the same class of bug, checking `card.subtype !== 'force_eval'` when the catalog uses `"subtype": "Force Evaluation"` (line 198). Fixed to `'Force Evaluation'` so the Showdown card works correctly.

### 6. `deckCounts` (public deck-size mirror) is never populated by any command

`GameRoomState.deckCounts` (`MapSchema<number>`) is documented as "Public
mirror — opponents derive board/hand size from this" pattern used elsewhere
(`handCount`, `boardCount`), and T19's acceptance criteria expect
`"FCC: %d | Num: %d | Act: %d"` to come from `state.decks` counts. Grepping the
full server source shows `deckCounts` is set only in a schema unit test —
no room, command, or handler ever calls `.set()` on it. It stays `{}` for the
lifetime of a real game.

**Status: FIXED** — `NerdiClashRoom.ts:onJoin()` now populates `deckFCC`, `deckNumber`, and `deckAction` from the 30-card catalog using the new `catalogCardToSchema()` helper, shuffles each deck with `shuffleArraySchema()`, and initializes `deckCounts` for the joining player. Players joining an existing game now have seeded decks instead of empty ones.

## Validation At This Checkpoint (Wave 5)

- `godot --headless --path client --quit` boots the full project (autoloads +
  main scene `game.tscn`) with zero script/parse/compile errors.
- Server suite: `npx tsc --noEmit` passes; `npx vitest run` → 20 test files / 160 tests passed.
- Three server bugs from the Wave 5 inconsistency report have been fixed:
  1. `EvalCommand.ts` VVC subtype check (`'variable-value'` → `'Anchor'`)
  2. `ForceEvalCommand.ts` subtype check (`'force_eval'` → `'Force Evaluation'`)
  3. `NerdiClashRoom.ts:onJoin()` now seeds player decks from the catalog and initializes `deckCounts`
- Items #1–#2 from the Wave 5 inconsistency list are FIXED (JSON bridge +
  `join_room`/`joined` handshake, commit `204c099`). Items #3–#4 remain
  client-side compensations (`has_eval_legal`/`draws_this_turn`, draw batch
  shape) — architectural gaps, not bugs, requiring design decisions.

## Wave 5 Client Runtime Findings (First Live Godot Run)

The first real Godot-client run against the JSON bridge surfaced three
client-side issues, captured from the Godot debugger output. All fixed.

### 1. `ERR_ALREADY_IN_USE` on duplicate Connect press (the valuable one)

```text
raw-ws-client.gd:26 @ connect_to(): Condition "ready_state != STATE_CLOSED
&& ready_state != STATE_CLOSING" is true. Returning: ERR_ALREADY_IN_USE
```

**Root cause**: `raw-ws-client.gd` held a single `WebSocketPeer` instance for
the app's whole lifetime, and Godot's `connect_to_url()` refuses to run unless
that peer is fully `STATE_CLOSED`. Pressing the Connect button while the peer
was `CONNECTING` or `OPEN` (a second click, or a click after a successful
connect) was rejected at the C++ level.

**Diagnostic value**: this error was actually *good news in disguise* — it can
only fire when a previous connection attempt is still alive, so its appearance
proved the first connect had not failed.

**Fix**: `connect_to()` now ignores duplicate calls while `CONNECTING`/`OPEN`,
and always dials from a **fresh** `WebSocketPeer` instance. This also fixes the
latent reconnect bug: a used `WebSocketPeer` in Godot 4 cannot reliably
re-connect after close, so disconnect→reconnect would have failed next.

### 2. `INTEGER_DIVISION` warning — HP display truncated

`PlayerPanel.gd:33` computed `int(hp10 / 10)`, which triggers Godot's
integer-division warning and, worse, displays wrong HP: hp10 = 175 renders as
"17" instead of "17.5", violating the locked `Display = hp10 / 10` constraint.

**Fix**: `hp_label.text = "%.1f" % (hp10 / 10.0)`.

### 3. Housekeeping warnings

- `_pending_messages` was declared in `raw-ws-client.gd` but never used —
  removed.
- Every received packet was printed in full; with the bridge broadcasting
  `state_snapshot` ~10×/second, the debugger console became an unreadable
  waterfall. Snapshot bodies are no longer logged (other message types still
  are).

## Validation At This Checkpoint (Wave 5, live client)

- `godot --headless --path client --quit` → zero script/parse errors after fixes.
- Server: `npx tsc --noEmit` → 0 errors; `npx vitest run` → 160/160 tests.
- JSON bridge verified end-to-end with a Node.js test client (join → `joined`
  → seeded-deck state snapshots) in commit `204c099`.
- **Pending**: full visual 2P smoke test with two live Godot instances (F3).

## F1 Gameplay Audit — Findings and Fixes

A post-Wave-5 audit of the live codebase against the game rules (`docs/gameplay-flow.md`)
and the master plan revealed three inoperable gameplay systems and one connection bug.
All four were fixed in the same session.

### 1. Stuck-at-connecting (Godot client — PRIMARY)

**Symptom**: after fixing the duplicate-connect bug (Wave 5, finding #1), a fresh run
left the client stuck at "Connecting…" indefinitely. `connection_failed` never fired,
meaning the peer never reached `STATE_CLOSED`.

**Root cause**: `client/scripts/raw-ws-client.gd _process()` only called
`peer.poll()` when `get_ready_state() == STATE_OPEN`. Godot 4's `WebSocketPeer`
requires `poll()` to be called regularly during `STATE_CONNECTING` too; without it the
TCP/TLS handshake never progresses and the peer stalls forever. This also explains the
earlier `ERR_ALREADY_IN_USE` error: a previous peer stuck in `CONNECTING` was still
alive when the button was pressed a second time.

**Fix**: `_process()` now calls `peer.poll()` whenever the state is
`STATE_CONNECTING` **or** `STATE_OPEN`. The `STATE_CLOSED` detection branch is
unchanged.

### 2. Stalling counters inoperable

**Root cause**: `PhaseController.onEvalTurn()` and `PhaseController.onNoEvalTurn()`
were defined and correctly wired to the FSM, but had zero call sites in production code.
`consecutive_no_eval_turns` and `global_no_eval_turns` only advanced on FSM timeout
(when `fsm.tick()` detected deadline expiry). Manual `end_turn` messages never advanced
them, so force-eval could never trigger.

**Fix**: `NerdiClashGame.requestEndTurn()` now reads `player.evaluatedThisTurn`
**before** resetting it, then calls `phaseController.onEvalTurn()` (if the player
evaluated) or `phaseController.onNoEvalTurn()` (if they did not). The flag is reset
afterward. Additionally, `NerdiClashGame.dispatchIntent()` now calls
`phaseController.onEvalTurn()` after a successful, non-fizzled `eval_function` or
`force_eval` dispatch, so the counter resets correctly for mid-turn evaluations too.

### 3. Force-eval counter reset clobbered by mirror()

**Root cause**: `logic/evalEngine.ts:115,124` writes `state.consecutive_no_eval_turns = 0`
directly onto the `ForceEvalState` object passed to `forceEval()`. However, the
`PhaseController.mirror()` call that follows immediately after overwrites the schema's
`consecutive_no_eval_turns` from the FSM's private copy — which had not been updated.
The direct write was effectively a no-op in the schema.

**Fix**: routing through `phaseController.onEvalTurn()` (fix #2 above) keeps the FSM
state and the schema in sync. The `forceEval()` function still writes to its local
`ForceEvalState` argument (which is fine for tests that use the pure function directly),
but the authoritative schema update now always goes through the controller.

### 4. Isolation win is dead code

**Root cause**: `logic/winEngine.ts:checkWin()` correctly declares an isolation win when
`timerFor(state, playerId) === 0`, but no production code ever initialized the timer to
3 or decremented it. `variable_isolation_timers` was populated only by schema unit tests.
The isolation win condition could never be reached in a real game.

**Fix**: `NerdiClashGame` gains a private `tickIsolationTimers()` method called at each
`requestEndTurn()`. For every player whose main board expression is a single lowercase
letter (isolated), the method initializes the timer to 3 on first detection, decrements
it on subsequent turns, and clears it when the expression is no longer isolated. The
existing `winEngine.checkWin()` logic requires no changes.

## Validation At This Checkpoint (F1 audit)

- Server: `npx tsc --noEmit` → 0 errors; `npx vitest run` → 160/160 tests.
- All four findings fixed in `NerdiClashGame.ts` and `raw-ws-client.gd`.
- Verification recipe: start the server (`npx tsx src/index.ts`, confirm
  `[JsonBridge] Listening on ws://localhost:2568`), run Godot, confirm URL box
  shows `ws://localhost:2568`, press Connect once — expect `Connected as p1`
  within one second.

## F3 Live 2P Smoke Test — Findings and Fixes

The F3 checkpoint (full two-player smoke test over the JSON bridge) surfaced four
connection/gameplay bugs. All four were fixed in `server/src/json-bridge.ts` and
`server/src/rooms/NerdiClashGame.ts`.

### 1. First state snapshot delayed until the next interval tick

**Root cause**: `handleJoin()` called `game.startGame()` but relied on the 100ms
`broadcastSnapshots()` interval to push the first snapshot. Both clients briefly saw a
stale `waiting` state instead of `construction` on join.

**Fix**: `handleJoin()` now calls `broadcastSnapshots()` immediately after `startGame()`,
so both clients receive the construction-phase snapshot in the same tick they become the
second player.

### 2. Construction phase has no board to build on

**Root cause**: `seedPlayerDecks()` populated each player's decks but never created a
`FunctionBoardSchema`. With zero boards, `build_function` always failed and the client
UI stalled on "Waiting for boards…". (Also recorded in memory: `construction-phase-no-boards`.)

**Fix**: `seedPlayerDecks()` now seeds one active board per player
(`boardId: <sessionId>_board_1`, `domain: 'poly'`, `isActive: true`), so `build_function`
works the instant construction begins.

### 3. Game never resets on empty room; no reconnection path

**Root cause**: `handleDisconnect()` keyed the game teardown off `game.playerCount()`,
but `removePlayer()` leaves disconnected players in `state.players` (marked
`isConnected: false`), so the count never reached zero. A stale game persisted, and the
next join hit `ROOM_FULL`. There was also no way for a dropped player to reclaim a seat.

**Fix**: teardown now keys off `this.clients.size === 0` (live connections, not player
records). `handleJoin()` gained a reconnection branch: a client that sends back its prior
`sessionId` for a currently-disconnected player restores that seat instead of being
rejected — mirroring the Colyseus room's `allowReconnection()` window that the raw JSON
path otherwise lacked.

### 4. `end_turn` misrouted through `dispatchIntent`

**Root cause**: in the message `switch`, `end_turn` shared a case block with the
generic-intent handler and was dispatched via `dispatchIntent`, not the dedicated
`requestEndTurn()` turn-advance path. (During the fix, an intermediate edit also caused
`draw_cards`/`build_function`/`play_card` to fall through into the `end_turn` block — a
`build_function` returned `ack:end_turn` and skipped board validation. Caught via a direct
WS probe and corrected.)

**Fix**: `end_turn` now has its own case calling `game.requestEndTurn()`; the other
intents route through `dispatchIntent()` as before. Confirmed by probe: `build_function`
→ `ack:build_function` (and `error: board not found` for a bad board), `end_turn` →
`ack:end_turn`.

### Note on the `qa-runner.mjs` verdict (39/49)

The 10 remaining qa-runner failures are **test-script artifacts, not server bugs**,
verified individually with direct WebSocket probes:

- **SC2.3, SC2.3a, SC3.1, SC8.7a, SC9.1** — the runner's `next()` returns the oldest
  buffered message and catches a streamed `state_snapshot` (broadcast every 100ms)
  instead of the `ack`/`error` the server actually sends.
- **SC6.2, SC6.2a** — the runner reconnects with only `displayName` and no `sessionId`,
  so it is correctly treated as a fresh join → `ROOM_FULL`. Reconnection works when the
  client passes its `sessionId` (fix #3).
- **SC8.3** — asserts `hp10 === 1000`, but HP starts at 0 by design (`everGainedHP` gates
  win condition #1; dev-plan line 831).
- **SC1.2, SC1.4** — flaky snapshot ordering; pass on rerun.

The runner itself should be updated (filter by message type, pass `sessionId` on
reconnect, correct the HP assertion) before its verdict can be trusted.

## Validation At This Checkpoint (F3 smoke test)

- Server: `npx tsc --noEmit` → 0 errors; `npx vitest run` → 160/160 tests.
- Four bugs fixed in `server/src/json-bridge.ts` and `server/src/rooms/NerdiClashGame.ts`.
- Behavioral verification via direct WS probes (filtering by message type, not the
  oldest-buffered-message pattern the qa-runner uses):
  - `build_function` on the seeded board → `ack:build_function`; bad board → `error: board not found`.
  - `end_turn` → `ack:end_turn`.
  - P1 disconnects mid-game, rejoins with its `sessionId` → reclaims its seat (`role: p1`)
    instead of `ROOM_FULL`.

## Wave 7 — Playability Wiring: Land, Harden, Verify

Wave 7 landed the deferred-attack / defense-window / command-semantics rework on clean
commits, closed the gaps it left behind, and verified the full attack → defense → resolve
loop against the real JSON bridge with two live Godot clients. Commits:
`7ebafd6` (server wiring), `cfa963c` (client playability), `f1f49c6` (probe gitignore),
`28e42a5` (test ports), `9b312c2` (client reconnect), `8e3109e` (stalling force-eval +
AFK defense window), `1ce0234` (snapshot `name` + optional trap trigger),
`935a598` (game_event forwarding + dispose port release), `e924bf7` (testkit MCP),
`ecbf211` (CLOSING-poll fix).

### 1. §8.5 stalling force-eval was wired but unreachable — FIXED

**Root cause**: the FSM emitted a `'force-eval'` event when `consecutive_no_eval_turns`
hit 5 or `global_no_eval_turns` hit 20 (`fsm.ts onNoEvalTurn`, also inside `tick`), but
both consumers discarded the returned `FSMEvent[]` — `NerdiClashGame.requestEndTurn`
dropped `onNoEvalTurn()`'s return and `tick` dropped `phaseController.tick(now)`'s
events. The auto-showdown could never fire.

**Fix** (`8e3109e`): both paths now consume the events and call the new
`runStallingForceEval(nominatorId)` (`NerdiClashGame.ts:577`). v1 auto-trigger contract,
now pinned in a code comment: nominator = the player whose turn just ended (the staller
pays any failed-domination penalty), `vvcValue = 1` (no per-player VVC choice on an
automatic trigger), no Force Evaluation card consumed. A `force_eval` `game_event` with
`details {trigger:'stalling', counter:'consecutive'|'global'}` distinguishes it from a
card play (manual carries `{cardId}`). After the showdown, `onEvalTurn()` resets
`consecutive_no_eval_turns` (a forced eval is an eval); `global_no_eval_turns` keeps
counting. Verified live: `stalling-probe.mjs` 22/22 — counters 1→4 with no event, 5th
`end_turn` broadcasts the event to both clients, consecutive resets to 0 while global
stays 5, showdown resolves `force_eval_domination` at vvc=1. New tests:
`__tests__/rooms/stalling-force-eval.test.ts` (5 tests).

### 2. Play-deadline auto-pass skipped the defense window — FIXED

**Root cause**: `NerdiClashGame.tick()` resolved `play→resolution` on deadline and landed
the pending attack immediately (a leftover "MVP simplification"), so an AFK attacker
bypassed the defender's reactive cards entirely.

**Fix** (`8e3109e`): a tick intercept runs BEFORE `phaseController.tick` — when
`phase === play`, `now >= turnDeadline`, and `pendingAttackTargetId` is set, it
transitions `play→defense` directly and returns early (`resolution→defense` is not a
legal FSM transition, so the intercept must precede the FSM auto-pass). The existing
`defense→resolution` auto-pass then lands the attack unchanged. Covered by the expanded
`defense-window.test.ts` (21 tests) and observed live in the T8 playtest.

### 3. EADDRINUSE test flake — root cause found and fixed

**Root cause**: `appConfig(httpServer)` ignored its `httpServer` argument and
unconditionally called `jsonBridge.start(2568)`, so importing the app config from
`hello.test.ts` bound the real bridge port — a running dev server turned the suite red,
and an intercepted `process.exit` once corrupted a worker mid-run (7 phantom
`build-function-phase` failures that passed on rerun).

**Fix** (`28e42a5`): `appConfig` accepts `{ bridgePort, startBridge }` (defaults
unchanged; `BRIDGE_PORT` env supported via `config.ts`). `hello.test.ts` calls
`appConfig(mock, { startBridge: false })`; `JsonBridgeServer.dispose()` releases the
port. Verified: `npm test` green while a dev server holds :2567/:2568
(`wave7-task-4-ports.txt`). `npm run dev` defaults unchanged.

### 4. Client reconnection half — landed

Server reclaim existed since F3; the client couldn't use it (`local_session_id` wiped by
`GameModel.reset()` on disconnect, `join_room` never carried it). `9b312c2`:
`ConnectionManager` keeps `local_session_id` across a transient drop (cleared only on a
fresh seat or `ROOM_FULL`), sends it on `join_room` whenever held, auto-retries once
after ~1s (`RETRY_DELAY_SEC`, no backoff), and surfaces `SEAT_GONE` when a reclaim falls
through to a new seat plus a distinct "Room full / seat gone" on `ROOM_FULL`.
`GameModel.state` is kept on drop — snapshots resync.

### 5. Trap `trigger` contract decision — option (b) taken

The client hardcoded `"trigger": "on_force_eval"` while the catalog's trap card declares
`effectParams.trigger: "on_eval"` — and the server ignored the field entirely
(`toCommandIntent` drops it). Decision: `SetTrapSchema.trigger` is now **optional**
(`messages.ts:41`); the server derives trap behavior from the catalog card, never from
client claims. Note: `game.gd` still sends the vestigial value (harmless — schema
allows, server ignores); its inline comment claiming the schema "still requires the
field" is stale and the send can be deleted later.

Also in `1ce0234`: hand snapshot entries now carry `name` joined from the catalog at the
snapshot layer (`CARD_NAME_BY_ID`, `NerdiClashGame.ts:28,361`) — no `CardSchema` field
added (keeps the ≤64-field guard happy). `CardButton.gd` prefers snapshot `name` →
local `CARD_NAMES` → subtype → id.

### 6. `game_event` stream never reached JSON-bridge clients — FIXED

`JsonBridgeServer` created `NerdiClashGame` but never wired `setEventListener`, so
`play_card` / `attack_resolved` / `trap_triggered` / `force_eval` events — including the
new stalling showdown — never reached :2568 clients. `935a598` broadcasts them natively
(same shape as the Colyseus path minus the JSON-string wrapping), sends a
`defense_resumed` nudge to a (re)joining defender mid-window, and makes `dispose()`
close the internal HTTP server so the port actually frees.

### 7. qa-runner reconciliation — GREEN, no server bugs

Post-fix runner verdict across 3 runs: **66/66, 61/61, 66/66** asserts
(`wave7-task-7-qarunner.txt`). The 61-assert run skipped 5 asserts by design
(SC8.20–24 need an attack card AND a defender card in the same round-2 draw — random
draws sometimes don't produce them). Every prior F3 failure classification holds; no
new runner bugs found, **zero server bugs**.

One related tooling failure was found and classified as stale-tooling, not a server bug:
`probe-live.mjs`'s card-hunt loop ran >5 consecutive no-eval `end_turn`s, which tripped
the *new* §8.5 auto force-eval mid-loop; the forced showdown destroyed the nominator's
only board and ended the game, so subsequent asserts hit "game is over". The probe was
rewritten as a bounded turn driver that evaluates opportunistically → now 27/27.

Independent probes (wait on specific message types, pass `sessionId` on reconnect):
`eval-probe.mjs` 14/14 (eval happy path — never covered by the runner),
`stalling-probe.mjs` 22/22 (§8.5 auto trigger end-to-end), `probe-live.mjs` 27/27
(full loop incl. both defense paths + manual force_eval → gameOver + post-game intent
rejection).

### 8. Live 2P playtest — all acceptance criteria met

Two real Godot 4.7.1 clients over the bridge (`wave7-task-8-playtest.md` +
`wave7-task-8-events.log`): defense-negate and defense-pass paths both observed live
with correct HP/snapshots; the defense banner renders correct pending damage; an armed
trap countered a manual `force_eval` (`trap_triggered {countered:'force_eval'}`,
`forceEvalRequested` stayed false); mid-game disconnect/reconnect reclaimed the seat
(same `sessionId`, intact hand); `gameOver` + win-reason label rendered on both clients
(`force_eval_domination`, `singular_board`); the stalling auto force-eval fired in every
match at `consecutive=5`.

**Bug found and fixed during playtest** (`ecbf211`): `raw-ws-client.gd`'s `_process`
didn't `poll()` during `STATE_CLOSING`, so a client-initiated `peer.close()` left the
peer stuck in CLOSING forever — `disconnected` never fired, the auto-retry never armed,
and the seat was silently lost (server-initiated drops worked because they surface as
CLOSED directly). Fixed by polling in CLOSING too; re-verified `close()` → CLOSED →
disconnected → retry → reclaim.

### 9. New tooling: repo-local testkit MCP (`e924bf7`)

`tools/testkit-mcp/` (zero-dep stdio MCP + TCP hub + Godot spawner) +
`client/testkit/TestKit.gd` (env-gated autoload): one MCP server drives N Godot clients
— the harness used for the T8 evidence capture. `drive.mjs` replays JSONL tool calls
without an MCP host.

## Residual issues (Wave 7)

- `game.gd` still sends a vestigial `set_trap.trigger` value + a stale comment (see §5).
- `dim0` → `singular_board` winReason label is coarse for "all boards destroyed"
  (`WIN_REASON_BY_ENGINE`, `NerdiClashGame.ts:24`) — the wire enum is locked to 5
  values; cosmetic.
- `gameOver` with empty `winner`/`winReason` occurs when the 60s construction deadline
  elapses (AFK safeguard) — cosmetic edge.
- qa-runner coverage gaps: eval success, stalling auto-eval, trap counter, game_over —
  covered by probes/vitest/playtest; consider folding into a future runner scenario.
- `npm test` gate now: **224 passed / 3 skipped (227)** — the 3 skips are the SymPy
  live-service tests in `math/integration.test.ts`.

## Wave 9 — Rule Fidelity pins (partial; T9 owns the full write-up)

### T2 — Composition semantics

- **Cross-domain restriction deferred.** The rulebook limits composition to
  cross-domain board pairs, but `AddBoardCommand` clones the first board's
  domain (`toCommandIntent` `addBoard` case), so a multi-domain board set is
  unreachable in v1. **Pin: composition is allowed on any two distinct own
  boards.** Revisit if boards ever gain per-board domains.
- **`variable` wire field is real.** `PlayCardSchema.variable?: string` names
  the symbol substituted inside the outer board. Omitted → defaults to the
  outer board's sole distinct variable (`listVariables`, constants excluded);
  0 or ≥2 distinct vars → reject `ambiguous variable — specify one`.
- **`secondaryBoardId` wire field is real.** Names the inner board; fallback
  (documented) auto-picks the first own board that isn't the outer.
  `secondaryBoardId === outerBoardId` → reject `composition requires two
  distinct boards`; a secondary id resolving to no own board (e.g. an
  opponent's) follows the existing missing/dead-board fizzle.
- **AST substitution.** `substituteVariable` (math/expressions.ts) replaces
  `SymbolNode`s by name via `node.transform` — `exp(x)` no longer corrupts to
  `e(inner)p(inner)`. The `path !== 'fn'` guard keeps FunctionNode names
  un-rewritten; each hit wraps a fresh `inner.clone()` in a ParenthesisNode.
  No math.js `Node` is stored in schema — the result is re-serialized.
- **Alive-but-unparseable board** (post-eval `expression=''`) → reject
  `board expression is not parseable`; the card is kept. The old string-replace
  silently no-op'd while spending the card.
- **Client** (`game.gd`): composition sends outer = first active board, inner =
  next active own board, `variable` = identifier scan of the outer expression
  minus reserved names, hardcoded `'x'` fallback (server still validates).
- Depth-2 cap, dead-board fizzle, and card-on-success → graveyard unchanged.

### T1 — Two-actions-per-turn cap

- **Action definition.** Each resolved `play_card` (any routed cardType,
  trap-set included), `set_trap`, `eval_function`, `force_eval` consumes one
  of 2 actions (`ACTION_COUNTING_INTENTS` + `MAX_ACTIONS_PER_TURN` in
  `NerdiClashGame.ts`). `draw_cards`/`build_function`/`play_defense`/
  `end_turn`/`ready_inst`/`leave_room` never count.
- **Fizzles consume.** Increment runs on `result.ok` in
  `applyPostPlayProcessing` — a fizzled play still spent the card. Rejected
  intents (`ok:false`) never consume; the cap check sits after the
  winner/phase/ownership guards and before `toCommandIntent`, so an unrouted
  card doesn't burn an action either.
- **Eval-in-resolution edge.** `EvalCommand` permits `Phase.resolution`, but
  no transport currently delivers `eval_function` outside play — the
  intent-name check covers it if that ever changes (counter resets only in
  `requestEndTurn`).
- Rejection reason: `'turn action limit reached'`. Client greys the whole
  hand at `actionsUsedThisTurn >= 2` (Anchor/factor selection too — every
  intent they feed is action-counting).

### T3 — Catalog damage/absorb params

- **Units pin.** Catalog `damage`/`absorb` are display HP → hp10 = ×10
  (`damage:5` → 50, `damage:8` → 80, `absorb:10` → 100). The old
  `damage10 ?? 5` default was the 0.5-HP units bug; the martial `damage10: 8`
  hardcode in `toCommandIntent` is gone.
- **Single lookup.** `catalogEffectParams(cardId)` in `load-catalog.ts`
  serves both the routing layer and commands (`catalogParams(card)` in
  `commands/base.ts`) — the wave-8 `CARD_EFFECT_PARAMS_BY_ID` map was folded
  into it; nothing reads params off `CardSchema`.
- **`payload.damage10` is a test-harness override only** — `PlayCardSchema`
  has no such field and `toCommandIntent` never copies one, so the wire
  can't forge damage.
- **Absorb semantics.** `pendingAttackDamage10 = max(0, pending − absorb10)`
  — residual over the shield lands. Cards with no absorb rating (armed trap
  spent reactively, off-catalog test cards) keep the legacy full negate.
- **`scaleWithBoardValue` ignored** (v1 damage is flat from params);
  **`expiresNextTurn` unimplemented** — shields are reactive-only in v1.

### T4 — Theorem semantics

- **Euler's Ward = persistent passive.** `artifactTheoremActive` is now a
  real `@type('boolean')` on `PlayerSchema` (was an untracked ad-hoc write)
  and ships in snapshots. While set, `applyPendingAttack` halves incoming
  damage via `Math.floor` and emits `artifactHalved: true` in
  `attack_resolved`. Persists across turns/attacks — no expiry in v1.
- **Ordering pin: absorb first, then halve.** `PlayDefenseCommand` reduces
  the pending amount upstream; the ward halves whatever residual arrives.
- **Pythagoras Strike `requires:['right_triangle_board']` = documented
  flavor.** No domain produces such a board in v1 — the card resolves as a
  plain catalog-damage (80 hp10) attack, no precondition.

### T5 — Unrouted reasons + snapshot privacy

- **Unrouted = non-playable resource.** `prime`/`Irrational` → bound-factor
  message; `Anchor` → "spent by eval_function/force_eval"; `Eval` →
  spent-automatically; `shield` → reactive-only. `'card effect not
  implemented in v1'` is removed (unreachable); unknown cardTypes get a
  generic "resource — never played directly" fallback.
- **Trap leak closed (§16).** Opponent snapshots carry `trapSet: boolean`
  instead of `trapCardId`; the owner still sees the id. `PlayerPanel.gd`
  reads either.
- **`BuildFunctionSchema.variableIds`/`numberCardIds` removed.** The
  variable-card construction economy was never built; Zod strips unknown
  keys so a legacy client sending them still parses (covered by tests).

## Wave 8 — NT/LA card pins (T2/T3; T8 owns the full write-up)

- **effectParams join.** `CardSchema` never carries `effectParams`; routing
  re-joins them on `card.id` via `CARD_EFFECT_PARAMS_BY_ID`
  (`NerdiClashGame.ts`, same pattern as `CARD_NAME_BY_ID`) and passes narrowed
  values in the command payload. Nothing reads params off CardSchema.
- **Creation-card target kind = `none`.** Vector Shift / Matrix Weave take
  `target:{kind:'none'}` — the enum member already existed in
  `PlayCardSchema`, so no wire change. The server mints the board id
  (`<sessionId>_board_<n>`); any sent `target.id` is ignored.
- **Board cap rejects, not fizzles.** At 3 boards a creation card returns
  `board limit reached` and the card stays in hand.
- **LA board `domain`.** `BaseDomain` has no linear-algebra member, so LA
  boards carry their shape as the domain string: `'vector'` / `'matrix'`.
  The client uses it (plus a `matrix(` expression prefix) to route Transform
  Lens / Eigen Lance at matrix boards.
- **Matrix detection rule** (`math/linalg.ts`): parsed root is a
  `FunctionNode` named `matrix` or a nested `ArrayNode` literal. A flat
  `[1, 0]` vector is NOT a matrix. `dimension` = matrix row count (the
  rank for the non-singular catalog matrix) — mathjs `rank` is stubbed and
  `det` is not a rank, so row count is the honest marker.
- **Fermat Echo modulus.** The catalog carries `theorem:'fermat_little'`,
  no modulus; `THEOREM_MODULUS` maps the theorem name to its pinned prime 7.
  Constants reduce via AST transform (unaryMinus-wrapped constants fold
  correctly: `-8 → 6`).
- **Eigen Lance singular test.** `|det| < 1e-9` primary; the eigs fallback
  fires when det can't be computed and treats SOME `|λ| < 1e-9` as singular
  (the mathematically correct test — the draft's literal "every" would miss
  `[[1,2],[2,4]]` whose eigenvalues are `[0,5]`). Kill sets `isActive=false`
  + `isSingular=true`; the win flows through the existing `runCheckWin` →
  `singular`/`dim0` → `singular_board` path. Non-singular matrix → attack
  resolves, card spent, `survived` detail — not a fizzle. Non-matrix or dead
  target → fizzle (card graveyards, aggressive slot free).

## Wave 8 tail — dead-code sweep, live bridge QA, coverage gate (T6/T7/T8)

Landed on branch `w8-t6-t7-t8` (worktree `../nerdcard-w8-tail`):
`0b1f8a1` (sweep) + `05f7d05` (coverage gate). Gate at commit time:
`npm run typecheck` clean; `npm test` = **416 passed / 3 skipped**
(the 3 skips are the SymPy live-service tests).

### T6 — Dead-code and consistency sweep (`0b1f8a1`)

- **`ErrorCode.TRAP_BLOCKS_OFFENSIVE` removed** — zero callers (trap-blocks-
  offensive is enforced inside `dispatchIntent`'s play guard, not via an
  error code).
- **`WinState.lastForceEvalWinner` + its `checkWin` branch removed** — dead
  since `runCheckWin` never feeds it; `runForceEval` → `declareWinner`
  directly. The flag only ever appeared in a unit test.
- **`EvalCommand` fizzle aligned to documented v1.** On a dead/unparseable
  board target it now spends both cards to the graveyard
  (`moveCardToGraveyard` for the VVC + the Eval card) — matching
  `IntegralCommand`/`AttackHpCommand` fizzle semantics and
  `docs/gameplay-flow.md` ("fizzle → graveyard"). The keep-in-hand test was
  updated; it had been pinning undocumented behavior since the original
  wiring commit.
- **dim0/`singular_board` verified end-to-end** — `EigenvalueCommand` sets
  `isActive=false` + `isSingular=true`; `runCheckWin` maps `isSingular`
  through (scalar boards' `dimension:0` is intentionally not treated as
  rank); `checkWin` counts both flags → `singular`/`dim0` → wire
  `singular_board`. No change needed.
- **`set_trap.trigger` confirmed landed** — optional field, server derives
  behavior from catalog `effectParams.trigger` (client's sent value ignored
  for authority).
- **Probe files**: `server/*probe*.mjs` already in `.gitignore`; local
  probes left in place.
- **`ColyseusConnection.gd`**: documented dead stub — retained (Godot 4.7
  has no official colyseus SDK; `raw-ws-client.gd` is live).

### T7 — Live JSON-bridge QA (bridge standalone on :2571)

Four type-filtered `ws` probes (`server/probe-w8-*.mjs`, gitignored)
against a standalone `tsx src/json-bridge.ts` on port 2571. Evidence under
`.sisyphus/evidence/wave8-task-7-*.log` — **all pass**:

- **Wins** (`wave8-task-7-wins.log`): `hp_zero` via real attack → defense
  pass → damage; `force_eval_domination` via a real Showdown;
  `singular_board` via Eigen Lance on a `matrix([1,2],[2,4])` (det=0)
  target — `boardDestroyed` event + `game_over` wire frame observed.
  (Probe fix: engine `parseMatrixString` needs the `matrix(r1,r2)` form,
  not a bare `[[..]]` literal.)
- **Deck exhaustion + reshuffle** (`wave8-task-7-deck-exhaustion.log`):
  p1 action deck 9 → 7 → 5 → 3 → 1 → **2**; the 1→2 draw pulled
  `act-special-add-board-001` — a card already played to the graveyard —
  proving graveyard-filtered, deck-specific reshuffle.
- **Double `force_eval`** (`wave8-task-7-double-forceeval.log`): first
  resolves (ack + card-sourced `force_eval` event); second same-turn
  intent → `INVALID_TARGET / unsupported intent force_eval`. **Deviation
  (documented, not a bug):** the `already_resolved` fizzle branch in
  `ForceEvalCommand` is wire-unreachable — the command validates the
  Showdown card *before* `state.forceEvalRequested`, and the sole card is
  already in the graveyard, so the second intent is unrouted upstream.
  Rejection is correct behavior; only the error label differs from the
  command-level fizzle.
- **Reconnect during defense** (`wave8-task-7-reconnect.log`): defender
  drop → `isConnected=false` broadcast; token-less and wrong-token rejoins
  → `ROOM_FULL`; correct `reconnectToken` reclaims same `sessionId`/role;
  `defense_resumed` replayed; snapshot resyncs `phase=defense`; hand
  intact; pending attack lands after the window closes.

### T8 — Coverage gate + docs (`05f7d05`)

- `@vitest/coverage-v8` added; `server/vitest.config.ts` created;
  `npm run test:coverage` = `vitest run --coverage`.
- Measured on this branch: **80.66% lines/statements, 86.12% functions,
  76.49% branches**. Thresholds set below measured: **78 / 78 / 84 / 74**
  (lines, statements, functions, branches).
- `report.md` appended (this section); `AGENTS.md` refreshed (416-test
  count, coverage command, `game_over` note, card-routing list);
  `docs/gameplay-flow.md` destubbed (all 10 FCCs playable; §19 now
  describes the SymPy service instead of "STUBBED").
- Coverage evidence: `.sisyphus/evidence/wave8-task-8-coverage.txt`;
  wave summary: `.sisyphus/evidence/wave-8-summary.md`.

## Wave 10 — Transport Hardening & Live-Game Integrity

A 2026-09-12 review found live authority, lifecycle, race, and
rules-integrity gaps that survived earlier waves. Six fix lanes plus a
final live QA pass. Gate at completion: `npm run typecheck` clean;
`npm test` = **419 passed / 3 skipped (422 total)** — the 3 skips remain
the SymPy live-service tests.

Live evidence: `.sisyphus/evidence/wave10-task-7-live.log` — **ALL PASS**
(10 notes, 161s) from a type-filtered `ws` probe
(`server/probe-w10-t7.mjs`, gitignored) against `ws://localhost:2568`.
Per-task evidence: `wave10-task-{1..6}-*.log`.

### T1 — `build_function` authority (`d0ad750`, merge `0633939`)

- **Finding:** `build_function` was reachable in any phase and could
  rewrite a live board mid-game; a rejected construction build also
  mutated state before the FSM said no.
- **Fix:** phase gate (`construction`/`play` only → `NOT_PHASE_NOT_DRAW`),
  ownership + turn-owner checks (off-turn → `NOT_YOUR_TURN`), live-board
  rewrite rejected (`INVALID_TARGET`, board untouched), construction
  execution write-free until the FSM accepts the submission.
- **Verified live:** draw-phase build rejected with board unchanged;
  off-turn play-phase build rejected; live-board rewrite rejected;
  post-eval rebuild by the turn owner acks and lands in the snapshot.

### T2 — exact-two draw + error-code parity (`98376f3`)

- **Finding:** `deckChoices` totals weren't enforced on the bridge (1-card
  and 4-card draws slipped through), and `end_turn` errors classified
  differently than the contract.
- **Fix:** `dispatchIntent` requires the draw batch to total exactly 2 →
  `INVALID_PAYLOAD`; `end_turn` outside play → `NOT_PHASE_NOT_DRAW`;
  off-turn → `NOT_YOUR_TURN`.
- **Verified live:** 4-card and 1-card draws rejected `INVALID_PAYLOAD`;
  mixed 1+1 (FCC+action) accepted; error codes match.

### T3 — reconnect tokens + heartbeat (`2a74668`, merge `3ced72f`)

- **Finding:** seat reclaim needed only a guessable sequential
  `sessionId`; dead sockets were never reaped, so killed clients held
  their seats forever.
- **Fix:** `joined` now issues a UUID `reconnectToken`; reclaim requires
  `sessionId` + token (`ROOM_FULL` otherwise). 10s ping interval; a
  socket that fails to pong is terminated on the next sweep.
- **Verified live:** no-token and wrong-token reclaim → `ROOM_FULL`;
  correct pair rejoins the same seat with hand intact; a killed client's
  seat frees after ~2 sweeps (`isConnected=false` broadcast, then
  reclaimable).

### T4 — intent serialization (`c404240`, merge `3ced72f`)

- **Finding:** intents and ticks ran unserialized — a slow async command
  (SymPy path) could interleave with the next intent.
- **Fix:** per-game promise queue serializes intents and ticks.
- **Verified live:** back-to-back `end_turn` → first acks, second sees
  post-rotation state and is rejected `NOT_PHASE_NOT_DRAW` — strict
  ordering, no interleaving.

### T5 — lifecycle edges (`b6609d2`, merge `0633939`)

- **Findings:** construction AFK never produced a game-over (winnerless
  stall); a negative eval could drive HP below 0; a `force_eval`
  domination win incorrectly transferred HP; the shared graveyard could
  contaminate deck refills across deck types.
- **Fixes:** construction deadline → `gameOver` (0 submissions →
  `winnerId:null`, `winReason:'abandoned'`; 1 submission → submitter
  wins `abandoned`); `EvalCommand` floors HP at 0; domination returns no
  redistribution; `drawFromDeck` reshuffles only same-deck-type cards
  (Anchors excluded).
- **Verified live:** 0-sub AFK → `game_over {winnerId:null,
  winReason:'abandoned'}` + snapshot `phase=gameOver`; 1-sub AFK →
  submitter wins `abandoned`; vvc-5 (−1) eval on `x+y` → `0 → 0` with
  `everGainedHP` still false and no winner; domination observed with HP
  frozen (10→10, 0→0); number-deck drain against a foreign-only
  graveyard → `deck empty`, no cross-deck refill.

### T6 — client truth fields (`73dd3fd`, merge `06be6b7`)

- **Finding:** clients lacked server-derived legality flags and couldn't
  compose mixed-deck draws.
- **Fix:** `evalLegal`/`drawsRemaining` snapshot fields scoped to the
  viewer's own player entry; opponent entries expose `trapSet` only.
  Client greys actions on the flags and supports mixed draw picks.
- **Verified live:** own entry shows `drawsRemaining===2` /
  `evalLegal===false` in draw; opponent entries omit both; `set_trap`
  leaves the opponent seeing `trapSet===true` with no `trapCardId`.

### T7 — this pass: notes & deviations

- `end_turn` sent after a winnerless `gameOver` returns
  `NOT_PHASE_NOT_DRAW` (the winner check consults `state.winner`, not the
  winnerless gameOver flag) — intent still refused; cosmetic label only.
- `deck empty` surfaces under `INVALID_TARGET` — the rejection is
  correct; only the code label is generic.
- Probe-side flake (not a server bug): the §8.5 consecutive counter (5)
  can end a scripted game before a random Eval card arrives — drivers
  keepalive-eval any Eval+Anchor and rebuild wiped boards; the trips
  observed (`singular_board` via stalling force-eval) are bonus live
  coverage of the auto-showdown path.
- No production code changed in T7; probe (`server/probe-w10-t7.mjs`)
  is local tooling, gitignored.

## Wave 12 — Rooms UX: Directory, Leave-to-Lobby, QA Backfill, Modes Design

Four lanes plus this final live-QA/docs pass. Gate at completion:
`npm run typecheck` clean; `npm test` = **570 passed / 3 skipped** (the 3
skips remain the SymPy live-service tests); `npm run test:coverage` green
at the ratcheted floor — measured **91.16 lines / 91.16 stmts / 89.65
funcs / 82.27 branches** vs thresholds **90 / 90 / 89 / 82**.

### T1 — Room directory (`eb68e40`, merge `e71fd14`)

- `list_rooms` is **lobby-level**: handled in `handleMessage` before the
  `findClientByWs` seat gate, so any connected socket — never-joined,
  seated, or unseated — gets `{type:'room_list', rooms:[{name,
  playerCount, connected, phase}]}`. Pull-only; no streaming.
- `playerCount` = seated players incl. disconnected-but-reclaimable;
  `connected` = live sockets; `phase` = game phase or `'waiting'`.
  Aggregate counts only — no sessionIds, tokens, or hand data cross.
- Client: Refresh button + code-built rows under ConnectRow
  (`name — playerCount/2 — phase`); a row click fills the room field.
  `browse_rooms` dials a cold socket purely to fetch the list
  (`_browse_only` → `list_rooms` instead of `join_room` on connect).
- **Verified live** (`wave12-task-5-live.log` S1 + testkit client):
  pre-join pull returns `[]`; create/fill/teardown all reflected;
  browse-then-join lands p2; a seated socket can still list. Client
  rendered `gamma — 1/2 — waiting`, row click filled the field, Connect
  joined the listed room as p2 (`wave12-task-5-roombrowser.png`,
  `wave12-task-5-joined-gamma.png`, `wave12-task-5-client2-log.json`).

### T2 — Leave-to-lobby (`7298036`, merge `17da9fc`)

- `leave_room` no longer closes the socket: `unseat(client)` — exactly a
  drop (player `isConnected=false`, seat held reclaimable via
  sessionId+token while the room lives) — then `{type:'left_room'}` and
  the socket stays open for lobby browsing or a fresh join.
- Teardown trigger unchanged: last leaver still kills the room
  (`slot.clients.size === 0`) — an unseated socket is not a slot client.
- Client clears seat credentials on `left_room` (voluntary leave ≠
  transient drop): `GameModel.reset()`, back to the connect screen, and
  an automatic re-`list_rooms`. Server-side the seat still honors a token
  reclaim — the client just doesn't send it.
- **Verified live** (S2): `left_room` on a live socket; a second
  `leave_room` on the now-seatless socket → `NOT_JOINED`; directory shows
  `{playerCount:2, connected:1}` (seat held); the same socket joins
  another room with a fresh sessionId; tokenless reclaim → `ROOM_FULL`,
  token reclaim restores the same seat; last leaver tears the room down
  (waiting-room and mid-construction both); a fresh join into the
  tombstone gets a clean lone-p1 room; other rooms unaffected. Client
  drive: Leave → "Left room — still connected" → auto re-list → same
  socket joined a different room as a fresh seat
  (`wave12-task-5-left2.png`, client logs).
- S3 guard: an unseated-but-connected socket survived ~2 heartbeat
  sweeps (~22s) and kept answering `list_rooms` — heartbeat is
  socket-keyed, not seat-keyed.

### T3 — QA backfill + coverage ratchet (`e8f9db6`, merge `d73c301`)

- The four probe-only gaps now run under `npm test` via a new
  `probe-parity gameplay` describe in `json-bridge.test.ts` (+1 bonus:
  `defense_resumed` replay, the last uncovered bridge path): eval
  success (VVC+Eval consumed, `hp10` gain, board cleared, counter reset),
  §8.5 stalling auto force-eval (`{trigger:'stalling', counter:
  'consecutive'}`, nominator = just-ended player, failed nomination
  destroys the board + halves hp10), trap counter on the wire
  (`trapSet` privacy + `trap_triggered`, no showdown), dedicated
  `game_over` frame (winner + winnerless `abandoned` variants,
  post-game intents → `GAME_OVER`).
- Coverage gate ratcheted to measured actuals: **78/78/84/74 →
  90/90/89/82** (lines/stmts/funcs/branches). `coverage.include` scoped
  to `src/**` so gitignored probe drivers can't skew the floor
  (`7c58cf4`).
- `qa-runner.mjs` kept as manual smoke tooling — header now pins it as
  NOT the gate and lists the former probe-only gaps; its one stale
  scenario (SC6 reconnect) fixed to send sessionId+reconnectToken.
- Evidence: `wave12-task-3-coverage.txt`.

### T4 — Game modes 2–3 design (`0da115c`, merge `4f6b989`)

- `docs/game-modes.md` — rules delta, engine/schema/FSM/wire/client
  impact and a task breakdown for Variable Isolation and Classic Clash,
  judged against the locked constraints. Doc-only lane; implementation
  is wave 13.

### T5 — this pass: notes & deviations

- Rematch end-to-end was **not re-run**: wave-11 T7 already evidenced it
  (`wave11-task-7-live.log` S2 — both votes → same-seat construction
  reset, plus client PNGs). Spec defers to existing evidence.
- Probe artifact (not a client bug): one duplicate directory row was
  observed when two `room_list` replies landed inside the same frame —
  `_on_room_listed` clears via `queue_free`, which is deferred. After a
  400ms settle the list renders exactly one row per live room
  (`wave12-task-5-left2.png` shows `gamma — 2/2 — construction` alone).
- First client drive landed in the default room instead of `gamma` —
  probe bug (`Object.get` called with a 2-arg default in the row-click
  eval; GDScript `get` takes one arg). Fixed drive re-verified the full
  row-click → field-fill → listed-room-join path.
- Stale testkit hub on 127.0.0.1:9721 (leftover process) — harness
  honors `TESTKIT_PORT`; drive ran on 9722.
- Wave-11 closeout ran concurrently with this pass (its report.md
  section, summary, and draft move landed mid-run — see the Wave 11
  section below). Its evidence was re-verified on the final tree
  including the wave-12 merges.
- No production code changed in T5; probes (`server/probe-w12-t5*.mjs`,
  `probe-bridge-2688.mjs`) are local tooling, gitignored.

## Wave 11 — Post-MVP Foundations: Multi-Room, Rematch, Dormant Ops, CI

Six lanes closing the items the megaplan listed as real product gaps:
single-game servers, no rematch path, dormant engine stubs, imprecise
error codes, no CI, and a two-command SymPy dev path. Final gate on the
merged tree (incl. early wave-12 commits): `npm run typecheck` clean;
`npm test` = **570 passed / 3 skipped (573)** — skips remain the SymPy
live-service tests.

Live evidence: `.sisyphus/evidence/wave11-task-7-live.log` — **ALL
PASS** (41 wire assertions) from a type-filtered `ws` probe
(`server/probe-w11-t7.mjs`, gitignored) re-run on the final tree, plus a
real two-client Godot playtest and a `dev:sympy` card round-trip.
Per-task evidence: `wave11-task-{1..6}-*.{log,txt}`; summary:
`wave-11-summary.md`.

### T1 — multi-room bridge (`4a02714`)

- **Finding:** `JsonBridgeServer` held a single `this.game`; a second
  pair hit `ROOM_FULL` — one game per server.
- **Fix:** per-room `GameSlot` map keyed by `join_room.room`
  (`[a-zA-Z0-9_-]{1,32}`, default `nerdiclash`); each slot owns its game,
  clients, intent queue, reconnect tokens, rematch votes; cap 16 rooms →
  `SERVER_FULL`; snapshots/broadcasts scoped per slot; teardown when a
  room's live sockets hit zero.
- **Verified live:** `alpha`+`beta` concurrently to `play` with
  independent turn owners; snapshots/events room-local; `ROOM_FULL`
  scoped; invalid name → `INVALID_PAYLOAD`; 17th room → `SERVER_FULL`.

### T2 — rematch (`db92950`, merge `f88be02`)

- **Finding:** the only replay path was both clients leaving (teardown
  → fresh game), losing seats and sessionIds.
- **Fix:** `rematch` intent — `gameOver`-only (`NOT_PHASE_NOT_DRAW`
  otherwise); each vote acks + broadcasts `game_event {votes, needed}`;
  second vote rebuilds a fresh `NerdiClashGame` on the same slot,
  preserving sessionIds/display names/tokens, clearing votes, back to
  `construction`.
- **Verified live:** lone vote doesn't reset; disconnected seat reclaims
  post-gameOver then votes; reset → `construction` with same seats,
  `expression=''` boards, 5-card reseeded hands, votes cleared.
  Client-side: game-over overlay Rematch button → "Waiting for
  opponent…" on vote, "Opponent wants a rematch." on offer, both votes →
  construction (real UI, 2 Godot clients — `wave11-task-7-*.png`).

### T3 — dormant engine ops (`6ea0ef5`, merge `0fef916`)

- **Fix:** real pure-TS `rref`/`rank` (Gaussian elimination) replace the
  "Not implemented in v1" stubs; `continuity` pinned to an honest
  polynomial-continuity answer. (Verified no command calls these — the
  capability matrix was the only surface.)
- Evidence: `wave11-task-3-engine.log`.

### T4 — error-code precision (merge `6b7710c`)

- **Fix:** shared `errorCodeFor` maps command reasons to wire codes:
  `deck empty` → `DECK_EMPTY`, `game is over` → `GAME_OVER` (incl. the
  winnerless-abandoned path — the phase check now precedes the winner
  check in `end_turn`).
- **Verified live:** drained number deck → `{"code":"DECK_EMPTY"}`;
  post-gameOver `end_turn`/`draw_cards` → `{"code":"GAME_OVER"}`.
  Closes both wave-10 T7 cosmetic notes.

### T5 — CI wiring (merge `a8478d0`)

- `scripts/verify.sh` one-command local gate (typecheck + test +
  coverage + headless Godot scene check); `.github/workflows/ci.yml`
  runs the three server commands on push/PR.
- Evidence: `wave11-task-5-verify.txt`.

### T6 — `dev:sympy` (`4683867`, merge `f2fb41a`)

- `npm run dev:sympy` boots uvicorn (`SYMPY_PORT`) + `npm run dev`
  (`BRIDGE_PORT`) under `USE_SYMPY=true`, logs `engine=hybrid`, tears
  down both on exit, fails loudly if the venv is missing.
- **Verified live (final tree):** stack up on :2571/:2573;
  `fcc-calc-integral-001` on `x^2 + y` → `x^3/3 + x*y`; uvicorn access
  log `POST /integrate 200`.

### T7 — this pass: notes & deviations

- S3 deck-drain races the §8.5 stalling force-eval; the probe holds an
  Eval card and gates evals on `consecutive_no_eval_turns`. Early
  game-end is probe luck (NOTE), not a FAIL.
- Testkit dynamic-eval quirk (tooling): tab-indented wrapper rejects
  space-indented blocks and `elif`; first client run timed out on it —
  probe bug, not server. Rewritten flat; full pass.
- Wave-12 commits landed mid-QA (`d73c301` QA backfill, `4f6b989`
  game-modes design, `7c58cf4` coverage scoping, `eb68e40`/`e71fd14`
  `list_rooms`, `7298036`/`17da9fc` `leave_room`); all wave-11 evidence
  re-verified on the final tree.
- No production code changed in T7; probes are local tooling,
  gitignored.

## Wave 13 — Game Modes (M5): Variable Isolation playability + balance notes

M5 ships the VI end-to-end playability pass (`vi-playability.test.ts`,
client isolation-countdown badges) — **v1 escape semantics kept per OQ-8**;
this section records the tuning knobs observed while driving real games,
not implemented changes.

### What the e2e pass proved live

- The timer only arms once EVERY active board is ≤1 var — a Second
  Foundation spare holds the net open until it is struck too.
- All four documented escapes break a running countdown: Term Surge
  (adds `t` → 2 vars), Evaluate (board → `''`, unparseable), Second
  Foundation (fresh `''` board), build_function resurrection (OQ-7).
- The deadline auto-pass path ticks the countdown to the kill (§10.1 fix).
- `isolated: N turns left` renders per player from the snapshot-root
  `variable_isolation_timers`; the badge vanishes the turn the net breaks.

### OQ-8 balance notes (ship v1 semantics — tuning options only)

- **Escapes are cheap but card-gated** (spec'd). Each is a single common/
  epic card the defender must actually draw; Term Surge + Evaluate are the
  realistic outs, Second Foundation is epic and the rebuild requires a
  dead board to exist first.
- **The §8.5 soft_wipe is a hidden defender escape.** The shared
  `consecutive_no_eval_turns` counter trips at 5 regardless of who is
  stalling — and in VI the trip wipes EVERY active board, clearing the
  net for free. Demonstrated in-test: a two-board siege (2 strike turns +
  3 countdown turns = 5 no-eval turn-ends) can NEVER land on raw passes —
  the soft_wipe fires on the kill turn and erases the attackerʼs work.
  The attacker's answer is evaluating their own board mid-siege (the eval
  resets the shared counter while the countdown keeps ticking) — a real
  cost: it spends an Anchor + Evaluate pair and erases the attacker's
  board.
- **The never-resetting `global_no_eval_turns` cap can make a VI match
  unterminable.** Past 20 no-eval turn-ends the force-eval fires on EVERY
  end_turn — in VI that is a soft_wipe every single turn, so no board ever
  stays reduced long enough to count down. With HP non-decisive and
  showdown disabled in this mode, the game then has NO remaining win path:
  not a draw rule, just an infinite wipe loop. Evals are the only counter
  relief and they're scarce: Anchors are free (all 5 dealt open) but each
  deck carries a single Evaluate card, recyclable only via graveyard
  reshuffle. This is the sharpest OQ-8 finding — v1 ships it as-is, but if
  matches feel like they time-out into limbo, the fix belongs in the
  mode's stalling profile (e.g. showdown instead of soft_wipe past the
  global cap, or a draw declaration), not in the isolation rules.
- **Single-board sieges complete** (4 no-eval turn-ends, one under the
  trip) — the mode's baseline kill is reachable; multi-board sieges are
  the ones that need eval fuel.
- **Timer staleness is cosmetic**: the entry deletes on the next
  turn-boundary tick after an escape, so a snapshot can show a stale
  countdown mid-turn. Harmless — the kill check re-derives the net.
- **Tuning options if playtests call escapes too cheap** (NOT shipped):
  timer survives a board wipe at `turns - 1`; escape requires a
  domain-valid rebuild before the turn ends; `isolationRebuildTurns` up
  to 4 (worsens the §8.5 collision above); per-player stalling counters
  so a *defender's* no-eval streak doesn't free them; soft_wipe spares
  the nominator's boards.
- **Tuning options if sieges are too hard**: strike cards not consuming
  the aggressive slot; `isolationRebuildTurns` down to 2 (single-board
  kills then land in 3 turn-ends); count the attacker's evals as
  "pressure" that doesn't reset the shared stalling counter.

## Wave 13 — Game Modes (M6): final QA + docs closeout

Closeout gate run on `main`. All five lanes confirmed merged
(`0aec799` plumbing, `1142d25` Classic Clash, `5b3c8fe` picker,
`6044387` Variable Isolation, `fbdbfed` VI e2e). No implementation fixes
were needed — the wave ships as merged.

### Verification gate

- `npm run typecheck` — clean.
- `npm test` — **624 passed / 3 skipped** (45 files; skips are the live
  SymPy-service tests).
- `npm run test:coverage` — **91.41% stmts / 83.01% branch / 89.44%
  funcs / 91.41% lines**, all above the v8 floor (90/82/89).

### Live bridge probe matrix (evidence: `.sisyphus/evidence/wave13-final-*.log`)

`ws` probes against in-process `JsonBridgeServer` instances on unique
ports (:2595–:2597); every probe waited on specific message types, and
`qa-runner.mjs` was not used as the gate. All checks passed:

- **Join matrix** — `nerdiclash`, `variable_isolation`, `classic_clash`
  each join and echo `mode` in `joined` + `state.mode`; omitted mode
  defaults to `nerdiclash`; invalid mode → `INVALID_PAYLOAD`; a
  mismatched join to a live room → `MODE_MISMATCH` and the agreeing
  retry joins as p2.
- **VI isolate → kill** — `limit` strike on the opp board leaves `y`
  (1 var), timer arms at 3, ticks 3→2→1→0 across turn-ends,
  `gameOver` with `winReason: variable_isolation`, winner = attacker;
  `game_event game_over` + `game_over` frames emitted to both sockets.
- **CC hp0** — defender evals (`hp10=10`, `everGainedHP`), attacker
  Power Spike → `pending=50` → defender passes the defense window →
  `hp10=0`, `winReason: hp_zero`; `variable_isolation_timers` never
  non-empty in any snapshot.

### Two-client Godot playtest (testkit MCP, bridge :2568)

- **Variable Isolation** — real clients joined `variable_isolation`,
  built `x^2 + y` past the ≥2-var gate, drove a `limit` opp-board
  strike, watched the countdown badge tick to the kill:
  `gameOver`, `winReason: variable_isolation`. Screenshots:
  `.sisyphus/evidence/wave13-vi-*.png`.
- **Classic Clash** — three live matches exercised the profile:
  `singular_board` (boardWipe on), `force_eval_domination`
  (forceDomination on), and `hp_zero` via deferred Power Spike +
  defense-window pass — the game-over overlay renders "HP depleted"
  (`.sisyphus/evidence/wave13-cc-gameover-p2.png`,
  `wave13-cc-defense-p1.png`). Rematch inherited `classic_clash` (M1
  spec live). Wire dumps: `wave13-cc-c{1,2}-wirelog.json`.
- Client picker (M3) visible in the connect row; HUD shows
  `Mode: Classic Clash` / `variable_isolation` badges from
  `state.mode`.

### Docs

- `AGENTS.md` — mode architecture bullet (profiles, join-time
  selection, `MODE_MISMATCH`, snapshot/`room_list` propagation).
- `docs/gameplay-flow.md` — new §21 Game Modes (comparison table, VI
  mechanics/escapes, CC behavior) + §11 qualifier.
- Evidence roll-up: `.sisyphus/evidence/wave-13-summary.md`.

### Open issues (shipped as v1)

- **VI global-stalling limbo** (M5 OQ-8 note stands): past
  `global_no_eval_turns = 20` the every-turn soft_wipe can make a VI
  match unterminable — no win path remains while both boards keep
  being wiped. Documented tuning options only; not a regression gate.
- `qa-runner.mjs` remains manual smoke tooling — the authoritative
  mode checks live in `npm test` + the wave13-final probes.

## Wave 14 — Transport formalization note (T3)

The Godot client only ever uses the JSON bridge (`raw-ws-client.gd` →
`ConnectionManager.gd`, `ws://localhost:2568`). The server-side Colyseus
room (`NerdiClashRoom`, `:2567`) stays as the app host but is a
single-room (`nerdiclash`) legacy/dev transport: multi-room, rematch,
`list_rooms`/`leave_room`, and all three game modes are JSON-bridge-only
(bridge-only since waves 11–13). The dead client-side SDK stub
`ColyseusConnection.gd` was removed in T3; earlier entries in this
report that describe Colyseus-path parity should be read with that
split in mind.

## Wave 14 — Rulebook Fidelity + Dead-Path Cleanup: final QA + closeout

Closeout gate run on `main`. All four lanes confirmed merged
(`78750ab` rulebook fidelity, `5e3b9ab` VI stalling resolution,
`0699cd5` bridge-only transport, `ea66dfa` client polish), plus the
`ecd4b75` confirmed-bugs sweep that landed between lanes
(settleTurnEnd unification, command/bridge/schema fixes, client
dial/status repairs). No implementation fixes were needed — the wave
ships as merged.

### What shipped

- **T1 rulebook fidelity** — `undefined_integral_loss` (rulebook
  §10.1): an undefined/infinite eval that destroys the player's LAST
  live board is an immediate loss, checked at both sites an undefined
  eval lands (`eval_function` post-processing and `runForceEval`),
  ahead of the domination/board-wipe rulings so the winReason names
  the true cause. Profile-gated (`win.undefinedIntegralLoss`): armed
  on `nerdiclash`/`classic_clash`, off on `variable_isolation`
  (isolation is the only win path — OQ-12). §10.3 predicate
  alignment: `isolationMinVars` is now 0 in every shipped profile, so
  the kill band (0..1) shares the countdown's ≤1 semantics — a
  constant-only main board can no longer stall the win forever.
- **T2 VI stalling-limbo resolution** — new
  `ModeProfile.stallingResolution`: once `global_no_eval_turns` sits
  at its never-resetting cap the profile decides the endgame instead
  of re-firing the per-trip `stallingEval` forever. VI resolves
  `'draw'` — `declareStalledDraw` emits
  `game_over {winner: null, winReason: 'stalled'}` exactly once, and
  `runCheckWin` is now terminal-guarded by phase so a same-tick
  isolation timer cannot award a post-draw win. v1 modes keep
  `'soft_wipe'` (no special resolution — their standard showdown is
  already decisive). `STALLING_CONSECUTIVE_LIMIT`/`STALLING_GLOBAL_LIMIT`
  constants pin the locked 5/20 bounds. Closes the wave-13 OQ-8
  unterminable-limbo finding.
- **T3 bridge-only transport formalized** — the dead
  `ColyseusConnection.gd` SDK stub deleted; client comments/docs now
  state plainly that raw-ws → JSON bridge :2568 is the only client
  transport and the Colyseus room :2567 is a single-room legacy/dev
  path (see the T3 section above).
- **T4 client polish** — `game.gd`: HP delta flashes, reconnect
  status surface, phase-change flash.
- **`ecd4b75` confirmed-bugs sweep** — turn-end bookkeeping unified
  in `settleTurnEnd`; trap/bound-factor/draw pre-flight command
  fixes; bridge `ALREADY_JOINED`, fast-reconnect rebind, rematch
  seat/queue hardening; client dial/retry/status/rematch fixes.

### Verification gate

- `npm run typecheck` — clean.
- `npm test` — **641 passed / 3 skipped** (44 passed + 1 skipped file;
  skips are the live SymPy-service tests).
- `npm run test:coverage` — **91.29% lines / 91.29% stmts / 89.53%
  funcs / 82.83% branch**, all above the v8 floor (90/90/89/82).
- Headless client — `timeout 6 $GODOT --headless --path client/`:
  no SCRIPT ERROR / Compile Error / node not found.

### Live bridge probes (evidence: `.sisyphus/evidence/wave14-final-probes.log`)

`server/probe-w14-t5.mjs` (gitignored probe driver) against a real
`tsx src/index.ts` bridge on `BRIDGE_PORT=2596`; every wait targets a
specific message type, qa-runner not consulted. **All checks passed**:

- **§10.1 last-board loss — real eval over the wire, no state
  seeding.** A `1/(x-1) + y` board (≥2 vars keeps the isolation
  countdown from pre-empting) evals `1/0 + 1 → Infinity` at the §8.5
  auto showdown's fixed `vvc=1` → board destroyed →
  `game_over {winReason: 'undefined_integral_loss'}`, loser = the
  eval's owner, on the `game_event`, the `game_over` frame, and the
  snapshot. This exercises the `runForceEval` site live; the
  `eval_function` intent site needs a drawn Evaluate card (deck
  luck) and stays vitest-covered
  (`json-bridge.test.ts` wave-14 describe).
- **§10.1 multi-board continuation.** Same armed board plus a Second
  Foundation second board drawn and played live from the action
  deck: the forced eval destroys the main board, the second board
  stays live, NO game_over — play continues into the next draw.
- **VI limbo resolves once.** A `variable_isolation` room driven 20
  no-eval turns: soft_wipe `force_eval` events at turns 5/10/15 (no
  `resolution` field, game stays alive), turn 20 emits
  `force_eval {resolution: 'draw'}` then
  `game_over {winner: null, winReason: 'stalled'}` exactly once; a
  post-draw `end_turn` is rejected `GAME_OVER`.
- **Regression.** `joined.mode` echoes (`classic_clash` explicit,
  `nerdiclash` default); a disagreeing join → `MODE_MISMATCH` with
  the agreeing retry seating; `list_rooms` rows carry
  `{name, playerCount, connected, phase, mode}`; rematch votes reset
  the finished room to `construction` with the same sessionIds.

Probe-design note: an earlier probe run ended
`variable_isolation`-killed instead — that was a probe artifact (a
1-var armed board dies to the isolation countdown before turn 5),
not a server bug; arming a ≥2-var undefined-eval expression
(`1/(x-1) + y`) is the correct shape.

### Docs

- `docs/gameplay-flow.md` — §9 undefined-eval bullet now reads
  last-live-board + profile gate; §12 counter-2 documents the
  global-cap `stallingResolution` (VI one-time `'stalled'` draw);
  §11 ≤1-var isolation predicate + stalled-draw note; §21 table
  gains the §10.1 row and the VI global-cap draw cell.
- `AGENTS.md` — ColyseusConnection.gd stub deletion, `room_list`
  `mode` field, `stallingResolution`/§10.1 architecture bullets,
  test-count refresh (641).
- Evidence roll-up: `.sisyphus/evidence/wave-14-summary.md`.

### Open issues

- None new. The wave-13 VI-limbo open issue is **closed** by T2
  (the global cap now terminates VI matches as a draw).
- `eval_function`'s own undefined-eval site remains vitest-only on
  the wire (needs the drawn Evaluate card) — noted above, not a
  regression.
- `qa-runner.mjs` remains manual smoke tooling — the authoritative
  checks live in `npm test` + the wave14-final probes.
