import {
  bindFactor,
  cardNumericValue,
  catalogParams,
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
      this.context()?.emitGameEvent?.('fizzle', payload.playerId, {
        source: 'play_card',
        cardId: payload.cardId,
        targetId: payload.targetBoardId,
        reason: 'target_gone',
      });
      return success({ fizzled: true, boardDestroyed: false });
    }

    let factor = 1;
    if (payload.numberCardId) {
      const numberCard = findCard(player, payload.numberCardId);
      if (!numberCard) return failure(`card ${payload.numberCardId} is not in player's hand`);
      factor = cardNumericValue(numberCard);
      bindFactor(player, payload.numberCardId, payload.cardId);
    }
    // Units pin: catalog `damage` is written in display HP, so ×10 lands it
    // in hp10 (damage:5 → 50). `scaleWithBoardValue` is deliberately ignored —
    // v1 damage is flat from params; board-value scaling is deferred.
    // payload.damage10 is a test-harness override only — no wire field
    // reaches it (PlayCardSchema has no such member and toCommandIntent never
    // copies one). Cards with no catalog damage keep the legacy flat 5.
    const catalogDamage = catalogParams(card)?.damage;
    const baseDamage10 = payload.damage10
      ?? (typeof catalogDamage === 'number' && Number.isFinite(catalogDamage)
        ? Math.floor(catalogDamage * 10)
        : 5);
    const damage10 = Math.max(0, Math.floor(baseDamage10 * factor));
    state.pendingAttackDamage10 = damage10;
    state.pendingAttackSourceId = payload.playerId;
    state.pendingAttackTargetId = target.sessionId ?? target.id ?? '';
    state.pendingTriggerId = `attack_t${state.turnIndex ?? 0}_${payload.cardId}`;
    markAggressiveActionUsed(player);
    moveCardToGraveyard(player, payload.cardId);
    this.context()?.emitGameEvent?.('play_card', payload.playerId, {
      cardId: payload.cardId,
      targetPlayerId: payload.targetPlayerId,
      targetBoardId: payload.targetBoardId,
      damage10,
      pending: true,
    });
    return success({ damage10, pending: true });
  }
}
