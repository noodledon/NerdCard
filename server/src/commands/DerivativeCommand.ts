import { listVariables } from '../math/counters.js';
import { parseExpression } from '../math/expressions.js';
import { mathjsEngine } from '../math/mathjs-engine.js';
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

export interface DerivativePayload {
  playerId: string;
  cardId: string;
  boardId?: string;
  variable?: string;
}

/** Applies the catalog's derivative FCC to one of the player's active boards. */
export class DerivativeCommand extends GameCommand<DerivativePayload> {
  execute({ playerId, cardId, boardId, variable }: DerivativePayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('derivative only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'derivative') return failure('derivative card required');

    const board = findBoard(player, boardId);
    if (!board || !isBoardAlive(board)) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }

    try {
      const selectedVariable = variable?.trim()
        || listVariables(parseExpression(board.expression))[0]
        || 'x';
      board.expression = mathjsEngine.derivative(board.expression, selectedVariable);
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'derivative failed');
    }

    moveCardToGraveyard(player, cardId);
    return success();
  }
}
