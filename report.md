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
wave-5 task file (`.sisyphus/drafts/wave-5-tasks.md`) and the master plan assume
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
