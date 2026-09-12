import { MAX_BOARD_COUNT } from '../logic/limits.js';
import { isMatrixExpression, matrixRowCount } from '../math/linalg.js';
import { mathEngine } from '../math/index.js';
import { FunctionBoardSchema } from '../state/schema.js';
import {
  failure,
  getPlayer,
  isFailure,
  moveCardToGraveyard,
  phaseAllowed,
  requiredCard,
  success,
  type CommandResult,
  GameCommand,
} from './base.js';

export interface MatrixPayload {
  playerId: string;
  cardId: string;
  /** Fresh board id minted by the router (`<sessionId>_board_<n>`). */
  boardId: string;
  /** Matrix literal like 'matrix([1,0],[0,1])' — catalog effectParams.expr. */
  expression: string;
}

/**
 * Matrix Weave (fcc-la-matrix-001): creates a matrix-valued board on the
 * caster. Same creation contract as Vector Shift — cap rejects, not fizzles.
 */
export class MatrixCommand extends GameCommand<MatrixPayload> {
  execute({ playerId, cardId, boardId, expression }: MatrixPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('matrix only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'matrix') return failure('matrix card required');

    if (player.boards.length >= MAX_BOARD_COUNT) return failure('board limit reached');

    if (!isMatrixExpression(expression)) return failure('matrix expression unavailable');
    const dimension = matrixRowCount(expression) ?? 0;

    const board = new FunctionBoardSchema();
    board.boardId = boardId;
    board.ownerSessionId = playerId;
    board.expression = expression;
    board.domain = 'matrix';
    board.dimension = dimension;
    // A square matrix that starts singular is born dead to the win engine.
    try {
      board.isSingular = Math.abs(mathEngine.det(expression)) < 1e-9;
    } catch {
      board.isSingular = false; // non-square matrices have no determinant
    }
    board.isActive = true;
    player.boards.push(board);
    player.boardCount = player.boards.length;

    moveCardToGraveyard(player, cardId);
    return success({ boardId });
  }
}
