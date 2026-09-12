import { isMatrixExpression } from '../math/linalg.js';
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

export interface TransformPayload {
  playerId: string;
  cardId: string;
  boardId?: string;
  /** Catalog `effectParams.kind` — joined at the router. v1 supports 'lup'. */
  kind: string;
}

/**
 * Transform Lens (fcc-la-transform-001): rewrites one of the caster's matrix
 * boards to a decomposition factor. `kind: 'lup'` sets the expression to U.
 * Self-modifying — not aggressive. Fizzles on dead or non-matrix boards.
 */
export class TransformCommand extends GameCommand<TransformPayload> {
  execute({ playerId, cardId, boardId, kind }: TransformPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('transform only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'transform') return failure('transform card required');

    if (kind !== 'lup') return failure(`unsupported transform ${kind}`);

    const board = findBoard(player, boardId);
    if (!board || !isBoardAlive(board) || !isMatrixExpression(board.expression)) {
      moveCardToGraveyard(player, cardId);
      this.context()?.emitGameEvent?.('fizzle', playerId, {
        source: 'play_card',
        cardId,
        targetId: boardId,
        reason: 'not_matrix',
      });
      return success({ fizzled: true });
    }

    try {
      board.expression = mathEngine.lup(board.expression).U;
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'transform failed');
    }

    moveCardToGraveyard(player, cardId);
    return success({ boardId: board.boardId });
  }
}
