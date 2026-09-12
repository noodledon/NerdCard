import { listVariables } from '../math/counters.js';
import { parseExpression } from '../math/expressions.js';
import { mathEngine } from '../math/index.js';
import { DEFAULT_MODE, MODE_PROFILES } from '../logic/modes.js';
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
  type CommandPlayer,
  type CommandResult,
  GameCommand,
} from './base.js';

export interface DerivativePayload {
  playerId: string;
  cardId: string;
  boardId?: string;
  /**
   * Variable Isolation overlay (doc §3.2): when the mode profile grants
   * `opp_board` scope the router resolves the target like ntTheorem — the
   * strike keeps only the chosen variable's terms, so differentiating an
   * opponent's board IS the mode's isolation weapon. Counts as aggressive.
   */
  targetPlayerId?: string;
  targetBoardId?: string;
  variable?: string;
}

/** Applies the catalog's derivative FCC to one of the player's active boards. */
export class DerivativeCommand extends GameCommand<DerivativePayload> {
  execute({ playerId, cardId, boardId, targetPlayerId, targetBoardId, variable }: DerivativePayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('derivative only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'derivative') return failure('derivative card required');

    const targetsOpponent = targetPlayerId !== undefined || targetBoardId !== undefined;
    let boardOwner: CommandPlayer = player;
    if (targetsOpponent) {
      const profile = this.context()?.profile ?? MODE_PROFILES[DEFAULT_MODE];
      if (profile.offensiveTargeting.derivative !== 'opp_board') {
        return failure('derivative cannot target opponent boards in this mode');
      }
      if (isAggressiveActionUsed(player)) {
        return failure('aggressive action already used this turn');
      }
      const target = getOpponent(state, playerId, targetPlayerId);
      if (!target) return failure('target player not found');
      boardOwner = target;
    }

    const board = findBoard(boardOwner, targetsOpponent ? targetBoardId : boardId);
    if (!board || !isBoardAlive(board)) {
      moveCardToGraveyard(player, cardId);
      if (targetsOpponent) {
        this.context()?.emitGameEvent?.('fizzle', playerId, {
          source: 'play_card',
          cardId,
          targetId: targetBoardId,
          reason: 'target_gone',
        });
      }
      return success({ fizzled: true });
    }

    let selectedVariable: string;
    try {
      // The attacker picks which variable survives — forwarded from the wire,
      // falling back to the board's first variable like the v1 self path.
      selectedVariable = variable?.trim()
        || listVariables(parseExpression(board.expression))[0]
        || 'x';
      board.expression = mathEngine.derivative(board.expression, selectedVariable);
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'derivative failed');
    }

    if (targetsOpponent) {
      markAggressiveActionUsed(player);
      moveCardToGraveyard(player, cardId);
      this.context()?.emitGameEvent?.('play_card', playerId, {
        cardId,
        targetBoardId,
        variable: selectedVariable,
      });
      return success({ targetBoardId: board.boardId });
    }

    moveCardToGraveyard(player, cardId);
    return success();
  }
}
