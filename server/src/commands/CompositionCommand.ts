import {
  failure, findBoard, getPlayer, isBoardAlive, isFailure, moveCardToGraveyard,
  phaseAllowed, requiredCard, success, type CommandResult, GameCommand,
} from './base.js';

export interface CompositionPayload { playerId: string; cardId: string; outerBoardId: string; innerBoardId: string; variable?: string; }

export class CompositionCommand extends GameCommand<CompositionPayload> {
  execute({ playerId, cardId, outerBoardId, innerBoardId, variable = 'x' }: CompositionPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('composition only in play');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    const outer = findBoard(player, outerBoardId);
    const inner = findBoard(player, innerBoardId);
    if (!outer || !inner || !isBoardAlive(outer) || !isBoardAlive(inner)) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }
    if ((outer.compositionDepth ?? 0) >= 2) return failure('maximum composition depth reached');
    outer.expression = outer.expression.replaceAll(variable, `(${inner.expression})`);
    outer.compositionDepth = (outer.compositionDepth ?? 0) + 1;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
