import { Command } from '@colyseus/command';
import { CardSchema } from '../state/schema.js';

export interface CommandResult {
  ok: boolean;
  reason?: string;
  fizzled?: boolean;
  boardDestroyed?: boolean;
  [key: string]: unknown;
}

export interface CommandCard {
  id: string;
  cardType?: string;
  subtype?: string;
  numericValue?: string;
  value?: number;
  expressionPayload?: string;
  effectParams?: Record<string, unknown>;
}

export interface CommandBoard {
  boardId?: string;
  id?: string;
  ownerSessionId?: string;
  expression: string;
  domain?: string;
  compositionDepth?: number;
  dimension?: number;
  isSingular?: boolean;
  isActive?: boolean;
  destroyed?: boolean;
}

export interface CardCollection extends Iterable<CommandCard> {
  length: number;
  [index: number]: CommandCard;
  push(card: CommandCard): number;
  splice(start: number, deleteCount?: number): CommandCard[];
}

export interface BoardCollection extends Iterable<CommandBoard> {
  length: number;
  [index: number]: CommandBoard;
  push(board: CommandBoard): number;
}

export interface CommandPlayer {
  sessionId?: string;
  id?: string;
  hp10: number;
  everGainedHP?: boolean;
  hand: CardCollection;
  handCount?: number;
  boards: BoardCollection;
  boardCount?: number;
  deckFCC?: CardCollection;
  deckNumber?: CardCollection;
  deckAction?: CardCollection;
  discardGraveyard?: CardCollection;
  graveyard?: CardCollection;
  aggressiveActionUsedThisTurn?: boolean;
  offensivePlayedThisTurn?: boolean;
  trapCardId?: string;
  boundFactor?: { numberCardId: string; spellId: string } | null;
  boundFactorNumberCardId?: string;
  boundFactorSpellId?: string;
  evaluatedThisTurn?: boolean;
  artifactTheoremActive?: boolean;
  shield10?: number;
}

interface PlayerMapLike {
  get?(id: string): CommandPlayer | undefined;
  values?(): IterableIterator<CommandPlayer>;
  [id: string]: unknown;
}

export interface CommandState {
  phase?: string;
  players: PlayerMapLike;
  forceEvalRequested?: boolean;
}

export interface EvalEngineResult {
  undefined: boolean;
  hpGain10: number;
  value?: number;
  complexity?: number;
  reason?: string;
}

export interface CommandContext {
  state?: CommandState;
  evalEngine?: {
    evaluate(
      player: CommandPlayer,
      boardIndex: number,
      vvcValue: number,
    ): EvalEngineResult;
  };
  forceEval?(state: CommandState, nominatorId?: string): unknown;
}

export abstract class GameCommand<Payload> extends Command<CommandState, Payload> {
  /** Compatibility hook for isolated command tests and the future T13 engine. */
  public roomRef?: CommandContext;

  protected gameState(): CommandState {
    return this.state;
  }

  protected context(): CommandContext | undefined {
    const room = this.room;
    return this.roomRef ?? (isCommandContext(room) ? room : undefined);
  }
}

function isCommandContext(value: unknown): value is CommandContext {
  return typeof value === 'object' && value !== null;
}

export function success(extra: Omit<CommandResult, 'ok'> = {}): CommandResult {
  return { ok: true, ...extra };
}

export function failure(reason: string): CommandResult {
  return { ok: false, reason };
}

export function getPlayer(
  state: CommandState,
  playerId: string,
): CommandPlayer | undefined {
  if (typeof state.players.get === 'function') {
    return state.players.get(playerId);
  }
  const candidate = state.players[playerId];
  return typeof candidate === 'object' && candidate !== null
    ? (candidate as CommandPlayer)
    : undefined;
}

export function playerValues(state: CommandState): CommandPlayer[] {
  if (typeof state.players.values === 'function') {
    return [...state.players.values()];
  }
  return Object.values(state.players).filter(
    (value): value is CommandPlayer =>
      typeof value === 'object' && value !== null && 'hp10' in value,
  );
}

export function getOpponent(
  state: CommandState,
  playerId: string,
  requestedId?: string,
): CommandPlayer | undefined {
  if (requestedId) return getPlayer(state, requestedId);
  return playerValues(state).find(
    (player) => (player.sessionId ?? player.id) !== playerId,
  );
}

export function findCard(
  player: CommandPlayer,
  cardId: string,
): CommandCard | undefined {
  for (const card of player.hand) {
    if (card.id === cardId) return card;
  }
  return undefined;
}

export function findBoard(
  player: CommandPlayer,
  boardId?: string,
  boardIndex?: number,
): CommandBoard | undefined {
  if (boardIndex !== undefined) return player.boards[boardIndex];
  if (boardId) {
    for (const board of player.boards) {
      if ((board.boardId ?? board.id) === boardId) return board;
    }
    return undefined;
  }
  return player.boards[0];
}

export function isBoardAlive(board: CommandBoard | undefined): boolean {
  return Boolean(board) && board?.destroyed !== true && board?.isActive !== false;
}

export function isAggressiveActionUsed(player: CommandPlayer): boolean {
  return (
    player.aggressiveActionUsedThisTurn === true ||
    player.offensivePlayedThisTurn === true
  );
}

export function markAggressiveActionUsed(player: CommandPlayer): void {
  player.aggressiveActionUsedThisTurn = true;
  player.offensivePlayedThisTurn = true;
}

export function resetAggressiveAction(player: CommandPlayer): void {
  player.aggressiveActionUsedThisTurn = false;
  player.offensivePlayedThisTurn = false;
}

export function bindFactor(
  player: CommandPlayer,
  numberCardId: string,
  spellId: string,
): void {
  player.boundFactor = { numberCardId, spellId };
  player.boundFactorNumberCardId = numberCardId;
  player.boundFactorSpellId = spellId;
}

export function unbindFactor(player: CommandPlayer): void {
  player.boundFactor = null;
  player.boundFactorNumberCardId = '';
  player.boundFactorSpellId = '';
}

export function unbindFactorOnGraveyard(
  player: CommandPlayer,
  cardId: string,
): void {
  const binding = player.boundFactor;
  const numberCardId = binding?.numberCardId ?? player.boundFactorNumberCardId;
  const spellId = binding?.spellId ?? player.boundFactorSpellId;
  if (cardId === numberCardId || cardId === spellId) unbindFactor(player);
}

export function cardNumericValue(card: CommandCard | undefined): number {
  if (!card) return 1;
  if (typeof card.value === 'number' && Number.isFinite(card.value)) {
    return card.value;
  }
  const raw = card.numericValue;
  if (raw === 'pi') return Math.PI;
  if (raw === 'e') return Math.E;
  if (raw === 'phi') return (1 + Math.sqrt(5)) / 2;
  const parsed = Number(raw);
  if (Number.isFinite(parsed)) return parsed;
  const effectValue = card.effectParams?.value;
  return typeof effectValue === 'number' && Number.isFinite(effectValue)
    ? effectValue
    : 1;
}

function discardCollection(player: CommandPlayer): CardCollection | undefined {
  return player.discardGraveyard ?? player.graveyard;
}

export function moveCardToGraveyard(
  player: CommandPlayer,
  cardId: string,
): CommandCard {
  let card: CommandCard | undefined;
  for (let index = 0; index < player.hand.length; index += 1) {
    if (player.hand[index]?.id === cardId) {
      card = player.hand.splice(index, 1)[0];
      break;
    }
  }
  if (player.handCount !== undefined) player.handCount = player.hand.length;

  if (!card) {
    const synthetic = new CardSchema();
    synthetic.id = cardId;
    card = synthetic;
  }
  discardCollection(player)?.push(card);
  unbindFactorOnGraveyard(player, cardId);
  return card;
}

export function phaseAllowed(
  state: CommandState,
  phases: readonly string[],
): boolean {
  return state.phase === undefined || phases.includes(state.phase);
}

export function requiredCard(
  player: CommandPlayer,
  cardId: string,
): CommandCard | CommandResult {
  const card = findCard(player, cardId);
  return card ?? failure(`card ${cardId} is not in player's hand`);
}

export function isFailure(value: CommandCard | CommandResult): value is CommandResult {
  return 'ok' in value;
}
