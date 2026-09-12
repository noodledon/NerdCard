import { parseExpression, serialize } from '../math/expressions.js';
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

export interface ModularPayload {
  playerId: string;
  cardId: string;
  boardId?: string;
  /** Catalog `effectParams.modulus` — joined at the router (CardSchema drops it). */
  modulus: number;
}

/**
 * Mod Cage (fcc-nt-modular-001): wraps one of the caster's active board
 * expressions in `mod(·, modulus)`. Self-modifying — not an aggressive action.
 */
export class ModularCommand extends GameCommand<ModularPayload> {
  execute({ playerId, cardId, boardId, modulus }: ModularPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('modular only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'modular') return failure('modular card required');

    if (!Number.isInteger(modulus) || modulus <= 0) {
      return failure('modular modulus must be a positive integer');
    }

    const board = findBoard(player, boardId);
    if (!board || !isBoardAlive(board)) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }

    try {
      board.expression = serialize(parseExpression(`mod(${board.expression}, ${modulus})`));
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'modular transform failed');
    }

    moveCardToGraveyard(player, cardId);
    return success();
  }
}
