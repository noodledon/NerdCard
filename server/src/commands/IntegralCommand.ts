import { listVariables } from '../math/counters.js';
import { parseExpression } from '../math/expressions.js';
import { mathEngine } from '../math/index.js';
import {
  failure,
  findBoard,
  getPlayer,
  isBoardAlive,
  isFailure,
  moveCardToGraveyard,
  phaseAllowed,
  requiredCard,
  success,
  type CommandResult,
  GameCommand,
} from './base.js';

export interface IntegralPayload {
  playerId: string;
  cardId: string;
  boardId?: string;
  variable?: string;
}

const STUB_PATTERN = /Not implemented in v1/;

/** Convert a SymPy result string to a math.js-compatible board expression. */
function sympyToMathjs(expr: string): string {
  return expr
    .replace(/\*\*/g, '^')
    .replace(/\boo\b/g, 'Infinity')
    .replace(/\bzoo\b/g, 'Infinity')
    .replace(/\binf\b/g, 'Infinity');
}

/** Applies the catalog's integral FCC to one of the player's active boards. */
export class IntegralCommand extends GameCommand<IntegralPayload> {
  async execute({ playerId, cardId, boardId, variable }: IntegralPayload): Promise<CommandResult> {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('integral only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'integral') return failure('integral card required');

    const board = findBoard(player, boardId);
    if (!board || !isBoardAlive(board)) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }

    if (!board.expression.trim()) {
      return failure('board expression is empty');
    }

    const selectedVariable = variable?.trim()
      || listVariables(parseExpression(board.expression))[0]
      || 'x';

    let engineResult;
    try {
      engineResult = await Promise.resolve(mathEngine.integrate(board.expression, selectedVariable));
    } catch (error) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true, reason: error instanceof Error ? error.message : 'integrate failed' });
    }

    if (!engineResult.ok || !engineResult.supported) {
      if (engineResult.reason && STUB_PATTERN.test(engineResult.reason)) {
        return failure(engineResult.reason);
      }
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }

    const resultString = typeof engineResult.value === 'string'
      ? sympyToMathjs(engineResult.value)
      : String(engineResult.value);
    board.expression = resultString;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
