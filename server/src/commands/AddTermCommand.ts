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

export interface AddTermPayload { playerId: string; cardId: string; boardId?: string; term: string; }

export class AddTermCommand extends GameCommand<AddTermPayload> {
  execute({ playerId, cardId, boardId, term }: AddTermPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('add term only in play');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    const board = findBoard(player, boardId);
    if (!board || !isBoardAlive(board)) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }
    if (!term.trim()) return failure('term is required');
    board.expression = `(${board.expression}) + (${term})`;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
