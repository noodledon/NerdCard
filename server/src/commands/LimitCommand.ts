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

export interface LimitPayload {
  playerId: string;
  cardId: string;
  boardId?: string;
  /**
   * Variable Isolation overlay (doc §3.2): when the mode profile grants
   * `opp_board` scope the router resolves the target like ntTheorem — the
   * strike substitutes the chosen variable to its approach point, stripping
   * it (and any term containing it) from the opponent's board. Aggressive.
   */
  targetPlayerId?: string;
  targetBoardId?: string;
  variable?: string;
  approach?: number | string;
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

/** Applies the catalog's limit FCC to one of the player's active boards. */
export class LimitCommand extends GameCommand<LimitPayload> {
  async execute({ playerId, cardId, boardId, targetPlayerId, targetBoardId, variable, approach }: LimitPayload): Promise<CommandResult> {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('limit only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'limit') return failure('limit card required');

    const targetsOpponent = targetPlayerId !== undefined || targetBoardId !== undefined;
    let boardOwner: CommandPlayer = player;
    if (targetsOpponent) {
      const profile = this.context()?.profile ?? MODE_PROFILES[DEFAULT_MODE];
      if (profile.offensiveTargeting.limit !== 'opp_board') {
        return failure('limit cannot target opponent boards in this mode');
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

    if (!board.expression.trim()) {
      // A live but expressionless board has nothing to take a limit of — on
      // the opponent path the strike whiffs like any other dead target.
      if (targetsOpponent) {
        moveCardToGraveyard(player, cardId);
        return success({ fizzled: true, reason: 'target expression empty' });
      }
      return failure('board expression is empty');
    }

    const selectedVariable = variable?.trim()
      || listVariables(parseExpression(board.expression))[0]
      || 'x';
    const selectedApproach = approach ?? 0;

    let engineResult;
    try {
      engineResult = await Promise.resolve(mathEngine.limit(board.expression, selectedVariable, selectedApproach));
    } catch (error) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true, reason: error instanceof Error ? error.message : 'limit failed' });
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
    if (targetsOpponent) {
      markAggressiveActionUsed(player);
      this.context()?.emitGameEvent?.('play_card', playerId, {
        cardId,
        targetBoardId,
        variable: selectedVariable,
      });
    }
    moveCardToGraveyard(player, cardId);
    return success(targetsOpponent ? { targetBoardId: board.boardId } : {});
  }
}
