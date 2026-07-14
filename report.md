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
