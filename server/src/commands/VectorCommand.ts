import { MAX_BOARD_COUNT } from '../logic/limits.js';
import { FunctionBoardSchema } from '../state/schema.js';
import {
  failure,
  getPlayer,
  isFailure,
  moveCardToGraveyard,
  phaseAllowed,
  requiredCard,
  success,
  type CommandResult,
  GameCommand,
} from './base.js';

export interface VectorPayload {
  playerId: string;
  cardId: string;
  /** Fresh board id minted by the router (`<sessionId>_board_<n>`). */
  boardId: string;
  /** Vector literal like '[1, 0]' — built from catalog effectParams.values. */
  expression: string;
  /** Catalog effectParams.dim — the board's rank marker (schema.dimension). */
  dimension: number;
}

/**
 * Vector Shift (fcc-la-vector-001): creates a vector-valued board on the
 * caster. Creation is a play, not a fizzle — at the 3-board cap the play is
 * rejected and the player keeps the card.
 */
export class VectorCommand extends GameCommand<VectorPayload> {
  execute({ playerId, cardId, boardId, expression, dimension }: VectorPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('vector only in play');

    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');

    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'vector') return failure('vector card required');

    if (player.boards.length >= MAX_BOARD_COUNT) return failure('board limit reached');

    const board = new FunctionBoardSchema();
    board.boardId = boardId;
    board.ownerSessionId = playerId;
    board.expression = expression;
    // BaseDomain has no linear-algebra member — LA boards carry their shape
    // ('vector'/'matrix') as the domain string so clients can route on it.
    board.domain = 'vector';
    board.dimension = dimension;
    board.isActive = true;
    player.boards.push(board);
    player.boardCount = player.boards.length;

    moveCardToGraveyard(player, cardId);
    return success({ boardId });
  }
}
