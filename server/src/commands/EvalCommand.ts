import {
  failure, findCard, findBoard, getPlayer, isBoardAlive, phaseAllowed,
  success, type CommandResult, GameCommand,
} from './base.js';

export interface EvalPayload { playerId: string; boardIndex: number; vvcCardId: string; }

export class EvalCommand extends GameCommand<EvalPayload> {
  execute({ playerId, boardIndex, vvcCardId }: EvalPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play', 'resolution'])) return failure('eval only in play/resolution');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const vvc = findCard(player, vvcCardId);
    if (!vvc || vvc.subtype !== 'variable-value') return failure('valid variable-value card required');
    const board = findBoard(player, undefined, boardIndex);
    if (!board || !isBoardAlive(board)) return success({ fizzled: true });
    const engine = this.context()?.evalEngine;
    if (!engine) return failure('evaluation engine unavailable');
    const result = engine.evaluate(player, boardIndex, vvc.value ?? 0);
    if (result.undefined) {
      board.destroyed = true;
      board.isActive = false;
      return success({ boardDestroyed: true });
    }
    player.hp10 += Math.floor(result.hpGain10);
    if (result.hpGain10 > 0) player.everGainedHP = true;
    player.evaluatedThisTurn = true;
    return success({ hpGain10: result.hpGain10 });
  }
}
