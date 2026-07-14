/**
 * Colyseus State Schema — T6
 *
 * CRITICAL CONSTRAINT: math.js Node objects NEVER live in Colyseus Schema.
 * Board.expression is @type("string") only — server parses the string with math.js on demand.
 * See drafts/nerdicard-overview.md:129-130.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERSION NOTE (T6 spec vs installed deps)
 * ─────────────────────────────────────────────────────────────────────────────
 * The T6 spec describes a `@view()` decorator + `client.view.add(card)` (StateView).
 * That API ships in @colyseus/schema >= 3.x. Our FROZEN stack is:
 *   colyseus@0.15.57 + @colyseus/schema@2.0.37  (see T1 package.json)
 * In v2.0.37 the equivalent privacy mechanism is `@filter()`.
 *
 * Therefore:
 *   • `hand` uses `@filter()` → only the owning client receives the cards.
 *   • Opponents receive only `handCount` (public mirror).
 *   • The `addToHand()` helper pushes to `hand` + bumps `handCount`.
 *     (No `client.view.add()` call is needed — v2 filters are evaluated
 *      automatically per-patch. See `addToHand` docstring below.)
 *
 * If/when the stack is upgraded to schema 3.x, swap `@filter()` → `@view()`
 * and add `client.view.add(card)` inside `addToHand()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Schema, type, MapSchema, ArraySchema, filter } from '@colyseus/schema';

/** Minimal client shape needed by @filter() callbacks in schema v2.0.37.
 *  (The full `ClientWithSessionId` type is not re-exported from the package index.) */
export type ClientView = { sessionId: string };

// ─── CardSchema ────────────────────────────────────────────────────────────────

export class CardSchema extends Schema {
  @type('string')
  id: string = '';

  @type('string')
  deckType: string = ''; // "FCC" | "Number" | "Action"

  @type('string')
  cardType: string = ''; // "addTerm" | "offensive" | "shield" | "trap" | "theorem" | "derivative" | "addBoard" | "forceEval" | "eval" | "constant"

  @type('string')
  subtype: string = '';

  @type('string')
  domain: string = ''; // BaseDomain enum → string

  @type('string')
  numericValue: string = ''; // for Number cards: "pi", "sqrt(2)", "2"

  /** Numeric VVC value when the card is a variable-value card. */
  @type('number')
  value: number = 0;

  @type('string')
  expressionPayload: string = ''; // FCC builder expression as math.js string

  @type('boolean')
  usableOncePerConstruction: boolean = false;

  @type('boolean')
  isFlipped: boolean = false;
}

// ─── FunctionBoardSchema ───────────────────────────────────────────────────────

export class FunctionBoardSchema extends Schema {
  @type('string')
  boardId: string = '';

  @type('string')
  ownerSessionId: string = '';

  @type('string')
  expression: string = ''; // math.js node.toString() — e.g. "x^2 + 3*x"

  @type('string')
  domain: string = ''; // BaseDomain enum → string

  @type('number')
  compositionDepth: number = 0; // 0, 1, or 2

  @type('number')
  dimension: number = 0; // matrix/vector board rank; 0 for scalar

  @type('boolean')
  isSingular: boolean = false;

  @type('boolean')
  isActive: boolean = true;
}

// ─── Bound factor ─────────────────────────────────────────────────────────────

export class BoundFactorSchema extends Schema {
  @type('string')
  numberCardId: string = '';

  @type('string')
  spellId: string = '';
}

// ─── PlayerSchema ──────────────────────────────────────────────────────────────

export class PlayerSchema extends Schema {
  @type('string')
  sessionId: string = '';

  @type('string')
  displayName: string = '';

  /** HP stored as integer ×10 for FP determinism. Display = hp10 / 10. */
  @type('number')
  hp10: number = 0;

  /** Set TRUE the first time HP rises above 0 via a successful evaluation.
   *  Gates Win Condition #1 so that starting HP=0 does not count as an immediate loss. */
  @type('boolean')
  everGainedHP: boolean = false;

  @type('boolean')
  isConnected: boolean = true;

  /**
   * PRIVATE server-side draw piles. @filter ensures only the owning client
   * receives the contents. Opponents must never see deck composition.
   */
  @filter(function (this: PlayerSchema, client: ClientView, _value: CardSchema) {
    return client.sessionId === this.sessionId;
  })
  @type([CardSchema])
  deckFCC: ArraySchema<CardSchema> = new ArraySchema();

  @filter(function (this: PlayerSchema, client: ClientView, _value: CardSchema) {
    return client.sessionId === this.sessionId;
  })
  @type([CardSchema])
  deckNumber: ArraySchema<CardSchema> = new ArraySchema();

  @filter(function (this: PlayerSchema, client: ClientView, _value: CardSchema) {
    return client.sessionId === this.sessionId;
  })
  @type([CardSchema])
  deckAction: ArraySchema<CardSchema> = new ArraySchema();

  /** Public — both players see the discard/graveyard. */
  @type([CardSchema])
  discardGraveyard: ArraySchema<CardSchema> = new ArraySchema();

  /**
   * PRIVATE to owner.
   * @filter ensures only the owning client receives the cards.
   * Opponents see only `handCount` (public mirror below).
   */
  @filter(function (this: PlayerSchema, client: ClientView, _value: CardSchema) {
    return client.sessionId === this.sessionId;
  })
  @type([CardSchema])
  hand: ArraySchema<CardSchema> = new ArraySchema();

  /** Public mirror — opponents derive hand size from this. */
  @type('number')
  handCount: number = 0;

  /**
   * PRIVATE owner resource. Only the owner sees which variables are available.
   * (Anti-cheat: leaking this would reveal strategic options.)
   */
  @filter(function (this: PlayerSchema, client: ClientView, _value: CardSchema) {
    return client.sessionId === this.sessionId;
  })
  @type([CardSchema])
  availableVariables: ArraySchema<CardSchema> = new ArraySchema();

  @type('number')
  variableUsagesLeft: number = 10;

  @type([FunctionBoardSchema])
  boards: ArraySchema<FunctionBoardSchema> = new ArraySchema();

  /** Public mirror — opponents derive board count from this. */
  @type('number')
  boardCount: number = 1;

  @type('boolean')
  baseFunctionUnlocked: boolean = false;

  @type('boolean')
  hasUsedVariableThisConstruction: boolean = false;

  /** Shared per-turn guard for offensive cards and traps. */
  @type('boolean')
  aggressiveActionUsedThisTurn: boolean = false;

  /** Compatibility mirror used by the offensive command contract. */
  @type('boolean')
  offensivePlayedThisTurn: boolean = false;

  /** At most one pending trap may be set for a player. */
  @type('string')
  trapCardId: string = '';

  @type('string')
  boundFactorNumberCardId: string = '';

  @type('string')
  boundFactorSpellId: string = '';

  @type(BoundFactorSchema)
  boundFactor: BoundFactorSchema = new BoundFactorSchema();

  @type('boolean')
  evaluatedThisTurn: boolean = false;

  @type('number')
  actionsUsedThisTurn: number = 0;
}

// ─── RoomConfigSchema ──────────────────────────────────────────────────────────

export class RoomConfigSchema extends Schema {
  @type('number')
  maxPlayers: number = 2;

  @type('number')
  turnTimeoutMs: number = 30000;

  @type('string')
  seed: string = '';
}

// ─── GameRoomState (root) ──────────────────────────────────────────────────────

export class GameRoomState extends Schema {
  @type('string')
  phase: string = 'waiting';

  @type('string')
  currentTurnPlayerId: string = '';

  @type('number')
  turnDeadline: number = 0;

  @type('string')
  pendingTriggerId: string = '';

  @type('boolean')
  defenseResponseUsed: boolean = false;

  /** True while one force-evaluation resolution is pending for this turn. */
  @type('boolean')
  forceEvalRequested: boolean = false;

  @type('number')
  turnIndex: number = 0;

  @type('number')
  roundNumber: number = 0;

  @type('string')
  winner: string = '';

  @type({ map: PlayerSchema })
  players: MapSchema<PlayerSchema> = new MapSchema();

  @type('number')
  consecutive_no_eval_turns: number = 0; // 0..5

  @type('number')
  global_no_eval_turns: number = 0; // 0..20

  @type({ map: 'number' })
  variable_isolation_timers: MapSchema<number> = new MapSchema();

  @type({ map: 'number' })
  deckCounts: MapSchema<number> = new MapSchema();

  @type(RoomConfigSchema)
  config: RoomConfigSchema = new RoomConfigSchema();
}

// ─── Hand Helper ───────────────────────────────────────────────────────────────
//
// ALL callers (T7 zone-transition callbacks, T10 FSM, T14 handlers) MUST use this
// helper instead of direct `.push()` so that `handCount` stays in sync.
//
// NOTE on StateView: the T6 spec warns that in schema >= 3.x you must also call
// `client.view.add(card)`. That is NOT required in our v2.0.37 stack — the
// `@filter()` on `hand` already gates visibility per-patch. If you upgrade to
// schema 3.x, add `client.view.add(card)` here and switch `@filter`→`@view`.
export function addToHand(player: PlayerSchema, card: CardSchema): void {
  player.hand.push(card);
  player.handCount = player.hand.length;
}
