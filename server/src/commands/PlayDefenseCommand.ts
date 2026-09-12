import {
  catalogParams, failure, getPlayer, isFailure, moveCardToGraveyard,
  requiredCard, success, type CommandResult, GameCommand,
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
    if (player.trapCardId === payload.cardId) player.trapCardId = '';
    // Absorb is catalog-sourced, display HP ×10 = hp10 (absorb:10 → 100).
    // The pending hit drops by the absorb value — residual damage over the
    // shield still lands. Cards with no absorb rating (an armed trap spent
    // reactively, off-catalog test cards) keep the legacy full negate.
    // `expiresNextTurn` is documented-but-unimplemented flavor: shields are
    // reactive-only in v1 — they exist solely as this defense-window play.
    const pending = state.pendingAttackDamage10 ?? 0;
    const absorbParam = catalogParams(card)?.absorb;
    const absorb10 = typeof absorbParam === 'number' && Number.isFinite(absorbParam)
      ? Math.max(0, Math.floor(absorbParam * 10))
      : pending;
    state.pendingAttackDamage10 = Math.max(0, pending - absorb10);
    state.defenseResponseUsed = true;
    this.context()?.emitGameEvent?.('play_defense', payload.playerId, {
      cardId: payload.cardId,
      targetTriggerId: payload.targetTriggerId,
    });
    return success();
  }
}
