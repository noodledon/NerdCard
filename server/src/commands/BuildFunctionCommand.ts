import { parseExpression } from '../math/expressions.js';
import { validateByDomain } from '../math/validation.js';
import type { BaseDomain } from '../shared/types.js';
import {
  failure, findBoard, getPlayer, success, type CommandResult, GameCommand,
} from './base.js';

export interface BuildFunctionCommandPayload {
  playerId: string;
  boardId: string;
  expression: string;
}

export class BuildFunctionCommand extends GameCommand<BuildFunctionCommandPayload> {
  execute(payload: BuildFunctionCommandPayload): CommandResult {
    const state = this.gameState();
    const player = getPlayer(state, payload.playerId);
    if (!player) return failure('player not found');
    const board = findBoard(player, payload.boardId);
    if (!board) return failure('board not found');
    const domain = board.domain as BaseDomain;
    let validation: ReturnType<typeof validateByDomain>;
    try {
      validation = validateByDomain(domain, parseExpression(payload.expression));
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'invalid expression');
    }
    if (!validation.ok) return failure(validation.reason ?? 'invalid expression');
    board.expression = payload.expression;
    this.context()?.emitGameEvent?.('build_function', payload.playerId, { boardId: payload.boardId });
    return success();
  }
}
