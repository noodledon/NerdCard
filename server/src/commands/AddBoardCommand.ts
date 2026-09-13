import {
  failure, getPlayer, isFailure, moveCardToGraveyard, phaseAllowed,
  requiredCard, success, type CommandResult, GameCommand,
} from './base.js';
import { FunctionBoardSchema } from '../state/schema.js';

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
    // Real schema instance (VectorCommand/MatrixCommand parity) — a POJO
    // would be missing dimension/isSingular and fails Colyseus encoding.
    const board = new FunctionBoardSchema();
    board.boardId = boardId;
    board.ownerSessionId = playerId;
    board.expression = expression;
    board.domain = domain;
    board.isActive = true;
    player.boards.push(board);
    player.boardCount = player.boards.length;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
