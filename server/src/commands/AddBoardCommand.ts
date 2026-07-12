import {
  failure, getPlayer, isFailure, moveCardToGraveyard, phaseAllowed,
  requiredCard, success, type CommandResult, GameCommand,
} from './base.js';

export interface AddBoardPayload { playerId: string; cardId: string; boardId: string; expression: string; domain?: string; }

export class AddBoardCommand extends GameCommand<AddBoardPayload> {
  execute({ playerId, cardId, boardId, expression, domain = '' }: AddBoardPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('add board only in play');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (player.boards.length >= 3) return failure('maximum board count reached');
    player.boards.push({ boardId, ownerSessionId: playerId, expression, domain, compositionDepth: 0, isActive: true });
    player.boardCount = player.boards.length;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
