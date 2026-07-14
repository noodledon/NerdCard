import {
  failure, getPlayer, isFailure, moveCardToGraveyard, requiredCard,
  success, type CommandResult, GameCommand,
} from './base.js';

export interface PlayDefensePayload {
  playerId: string;
  cardId: string;
  targetTriggerId: string;
}

export class PlayDefenseCommand extends GameCommand<PlayDefensePayload> {
  execute(payload: PlayDefensePayload): CommandResult {
    const state = this.gameState();
    if (state.phase !== undefined && state.phase !== 'defense') return failure('defense only in defense phase');
    if (state.defenseResponseUsed) return failure('defense response already used');
    if (!state.pendingTriggerId || state.pendingTriggerId !== payload.targetTriggerId) {
      return failure('defense target trigger not found');
    }
    const player = getPlayer(state, payload.playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, payload.cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'shield' && card.cardType !== 'defense' && card.cardType !== 'trap') {
      return failure('card is not reactive defense');
    }
    moveCardToGraveyard(player, payload.cardId);
    state.defenseResponseUsed = true;
    this.context()?.emitGameEvent?.('play_defense', payload.playerId, {
      cardId: payload.cardId,
      targetTriggerId: payload.targetTriggerId,
    });
    return success();
  }
}
