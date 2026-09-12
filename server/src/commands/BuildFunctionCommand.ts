import { parseExpression } from '../math/expressions.js';
import { validateByDomain } from '../math/validation.js';
import type { BaseDomain } from '../shared/types.js';
import {
  failure, findBoard, getPlayer, isBoardAlive, phaseAllowed, success, type CommandResult, GameCommand,
} from './base.js';

export interface BuildFunctionCommandPayload {
  playerId: string;
  boardId: string;
  expression: string;
}

export class BuildFunctionCommand extends GameCommand<BuildFunctionCommandPayload> {
  execute(payload: BuildFunctionCommandPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['construction', 'play'])) {
      return failure('build_function only in construction or play phase');
    }
    const player = getPlayer(state, payload.playerId);
    if (!player) return failure('player not found');
    const board = findBoard(player, payload.boardId);
    if (!board) return failure('board not found');
    if (!isBoardAlive(board)) return failure('board is destroyed');
    // In play this command is the post-eval rebuild path only: a wiped board
    // (expression === '') may be rewritten — a live expression may NOT.
    // Modifying a standing function is what the FCC/effect cards are for.
    if (state.phase === 'play' && board.expression !== '') {
      return failure('board already has a live expression');
    }
    const domain = board.domain as BaseDomain;
    let validation: ReturnType<typeof validateByDomain>;
    try {
      validation = validateByDomain(domain, parseExpression(payload.expression));
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'invalid expression');
    }
    if (!validation.ok) return failure(validation.reason ?? 'invalid expression');
    if (state.phase === 'construction') {
      // Write-free during construction: NerdiClashGame's post-dispatch path
      // owns the expression write once the FSM submission gate accepts, so a
      // rejected build_function leaves zero mutation behind.
      return success();
    }
    board.expression = payload.expression;
    this.context()?.emitGameEvent?.('build_function', payload.playerId, { boardId: payload.boardId });
    return success();
  }
}
