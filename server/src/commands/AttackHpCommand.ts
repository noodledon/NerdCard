import {
  bindFactor,
  cardNumericValue,
  failure,
  findCard,
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
  type CommandResult,
  GameCommand,
} from './base.js';

export interface AttackHpPayload {
  playerId: string;
  cardId: string;
  targetPlayerId?: string;
  targetBoardId?: string;
  damage10?: number;
  numberCardId?: string;
}

export class AttackHpCommand extends GameCommand<AttackHpPayload> {
  execute(payload: AttackHpPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('attack only in play');
    const player = getPlayer(state, payload.playerId);
    if (!player) return failure('player not found');
    if (isAggressiveActionUsed(player)) {
      return failure('aggressive action already used this turn');
    }
    const card = requiredCard(player, payload.cardId);
    if (isFailure(card)) return card;
    const target = getOpponent(state, payload.playerId, payload.targetPlayerId);
    if (!target) return failure('target player not found');
    const targetBoard = findBoard(target, payload.targetBoardId);
    if (payload.targetBoardId && !isBoardAlive(targetBoard)) {
      moveCardToGraveyard(player, payload.cardId);
      return success({ fizzled: true, boardDestroyed: false });
    }

    let factor = 1;
    if (payload.numberCardId) {
      const numberCard = findCard(player, payload.numberCardId);
      if (!numberCard) return failure(`card ${payload.numberCardId} is not in player's hand`);
      factor = cardNumericValue(numberCard);
      bindFactor(player, payload.numberCardId, payload.cardId);
    }
    const damage10 = Math.max(0, Math.floor((payload.damage10 ?? 5) * factor));
    target.hp10 = Math.max(0, target.hp10 - damage10);
    markAggressiveActionUsed(player);
    moveCardToGraveyard(player, payload.cardId);
    return success({ damage10 });
  }
}
