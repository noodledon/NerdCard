import { distinctVariablesInExpression, parseExpression } from '../math/expressions.js';
import { validateByDomain } from '../math/validation.js';
import { DEFAULT_MODE, MODE_PROFILES } from '../logic/modes.js';
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
    const profile = this.context()?.profile ?? MODE_PROFILES[DEFAULT_MODE];
    const alive = isBoardAlive(board);
    // OQ-7 (Variable Isolation): boardWipe is off there, so a destroyed board
    // may be rebuilt — resurrection is the only re-entry once every board is
    // dead. The live-expression gate below is bypassed for a resurrection:
    // the board is being re-entered, not edited. v1 keeps destroyed = dead.
    const resurrecting = !alive && profile.rebuildDestroyedBoards;
    if (!alive && !resurrecting) return failure('board is destroyed');
    // In play this command is the post-eval rebuild path only: a wiped board
    // (expression === '') may be rewritten — a live expression may NOT.
    // Modifying a standing function is what the FCC/effect cards are for.
    if (state.phase === 'play' && !resurrecting && board.expression !== '') {
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
    // OQ-6 (Variable Isolation): building ≤1 distinct variable is a self-own —
    // the board starts already reduced into the isolation net. The gate covers
    // construction and post-wipe rebuilds alike; 0 disables it (v1/CC).
    if (profile.constructionMinVars > 0) {
      const vars = distinctVariablesInExpression(payload.expression) ?? 0;
      if (vars < profile.constructionMinVars) {
        return failure(`build_function requires at least ${profile.constructionMinVars} distinct variables in this mode`);
      }
    }
    if (state.phase === 'construction') {
      // Write-free during construction: NerdiClashGame's post-dispatch path
      // owns the expression write once the FSM submission gate accepts, so a
      // rejected build_function leaves zero mutation behind.
      return success();
    }
    if (resurrecting) {
      board.isActive = true;
      board.isSingular = false;
      board.destroyed = false;
    }
    board.expression = payload.expression;
    this.context()?.emitGameEvent?.('build_function', payload.playerId, { boardId: payload.boardId });
    return success();
  }
}
