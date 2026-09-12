import { isMatrixExpression } from '../math/linalg.js';
import { mathEngine } from '../math/index.js';
import {
  failure,
  findBoard,
  getOpponent,
  getPlayer,
  isAggressiveActionUsed,
  isBoardAlive,
  isFailure,
  markAggressiveActionUsed,
  moveCardToGraveyard,
  phaseAllowed,
  requiredCard,
  success,
  type CommandResult,
  GameCommand,
} from './base.js';

export interface EigenvaluePayload {
  playerId: string;
  cardId: string;
  targetPlayerId?: string;
  targetBoardId?: string;
}

const SINGULAR_EPS = 1e-9;

/**
 * A matrix is singular iff det == 0, equivalently iff SOME eigenvalue is 0.
 * det is the primary check (exact); when the determinant can't be computed
 * the eigenvalue list is the fallback.
 */
function isSingularMatrix(expression: string): boolean {
  try {
    return Math.abs(mathEngine.det(expression)) < SINGULAR_EPS;
  } catch {
    const eigs = mathEngine.eigs(expression);
    const values = eigs.value;
    if (!eigs.ok || !Array.isArray(values)) return false;
    return values.some((lambda) => typeof lambda === 'number' && Math.abs(lambda) < SINGULAR_EPS);
  }
}

/**
 * Eigen Lance (fcc-la-eigenvalue-001): attacks an opponent's matrix board.
 * A singular target is destroyed (isActive=false + isSingular=true, which the
 * win engine reads as the `singular`/`dim0` condition when no boards
 * survive). A non-singular target survives — the card is still spent.
 * Aggressive — counts against the one-aggressive-action-per-turn rule.
 */
export class EigenvalueCommand extends GameCommand<EigenvaluePayload> {
  execute(payload: EigenvaluePayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('eigenvalue only in play');
    const player = getPlayer(state, payload.playerId);
    if (!player) return failure('player not found');
    if (isAggressiveActionUsed(player)) {
      return failure('aggressive action already used this turn');
    }
    const card = requiredCard(player, payload.cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'eigenvalue') return failure('eigenvalue card required');

    const target = getOpponent(state, payload.playerId, payload.targetPlayerId);
    if (!target) return failure('target player not found');
    const targetBoard = findBoard(target, payload.targetBoardId);
    if (!targetBoard || !isBoardAlive(targetBoard) || !isMatrixExpression(targetBoard.expression)) {
      moveCardToGraveyard(player, payload.cardId);
      this.context()?.emitGameEvent?.('fizzle', payload.playerId, {
        source: 'play_card',
        cardId: payload.cardId,
        targetId: payload.targetBoardId,
        reason: 'not_matrix',
      });
      return success({ fizzled: true, boardDestroyed: false });
    }

    const singular = isSingularMatrix(targetBoard.expression);
    if (singular) {
      targetBoard.isActive = false;
      targetBoard.isSingular = true;
    }
    markAggressiveActionUsed(player);
    moveCardToGraveyard(player, payload.cardId);
    this.context()?.emitGameEvent?.('play_card', payload.playerId, {
      cardId: payload.cardId,
      targetPlayerId: payload.targetPlayerId,
      targetBoardId: payload.targetBoardId,
      boardDestroyed: singular,
    });
    return singular
      ? success({ boardDestroyed: true, targetBoardId: targetBoard.boardId })
      : success({ survived: true, boardDestroyed: false, targetBoardId: targetBoard.boardId });
  }
}
