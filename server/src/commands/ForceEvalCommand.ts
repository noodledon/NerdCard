import {
  failure, findCard, getPlayer, isFailure, moveCardToGraveyard, phaseAllowed,
  playerValues, requiredCard, success, type CommandResult, GameCommand,
} from './base.js';
import { DEFAULT_MODE, MODE_PROFILES } from '../logic/modes.js';

export interface ForceEvalPayload { playerId: string; cardId: string; vvcCardId: string; }

export class ForceEvalCommand extends GameCommand<ForceEvalPayload> {
  execute({ playerId, cardId, vvcCardId }: ForceEvalPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play', 'resolution'])) return failure('force eval only in play/resolution');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'forceEval' && card.subtype !== 'Force Evaluation') {
      return failure('force evaluation card required');
    }
    // OQ-10: Showdown is a dead card in Variable Isolation — its domination
    // win is off and the failed nomination would be pure self-harm, so the
    // profile rejects the play outright (decks stay unified, OQ-14).
    const profile = this.context()?.profile ?? MODE_PROFILES[DEFAULT_MODE];
    if (!profile.forceEvalCard) {
      return failure('Showdown has no effect in Variable Isolation');
    }
    if (state.forceEvalRequested) {
      this.context()?.emitGameEvent?.('fizzle', playerId, {
        source: 'force_eval',
        cardId,
        reason: 'already_resolved',
      });
      return success({ fizzled: true });
    }
    const vvc = findCard(player, vvcCardId);
    if (!vvc) return failure(`card ${vvcCardId} is not in player's hand`);
    if (vvc.subtype !== 'Anchor') return failure('valid variable-value card required');
    const defender = playerValues(state).find(
      (opp) => (opp.sessionId ?? opp.id) !== playerId && Boolean(opp.trapCardId),
    );
    if (defender) {
      const trapCardId = defender.trapCardId ?? '';
      moveCardToGraveyard(defender, trapCardId);
      defender.trapCardId = '';
      moveCardToGraveyard(player, cardId);
      moveCardToGraveyard(player, vvcCardId);
      this.context()?.emitGameEvent?.('trap_triggered', defender.sessionId ?? defender.id ?? '', {
        trapCardId,
        countered: 'force_eval',
        attackerId: playerId,
      });
      return success({ fizzled: true, countered: true });
    }
    state.forceEvalRequested = true;
    moveCardToGraveyard(player, cardId);
    moveCardToGraveyard(player, vvcCardId);
    this.context()?.emitGameEvent?.('force_eval', playerId, { cardId });
    this.context()?.forceEval?.(state, playerId, vvc.value ?? 0);
    return success();
  }
}
