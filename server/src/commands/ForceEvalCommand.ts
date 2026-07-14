import {
  failure, getPlayer, isFailure, moveCardToGraveyard, phaseAllowed,
  requiredCard, success, type CommandResult, GameCommand,
} from './base.js';

export interface ForceEvalPayload { playerId: string; cardId: string; }

export class ForceEvalCommand extends GameCommand<ForceEvalPayload> {
  execute({ playerId, cardId }: ForceEvalPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play', 'resolution'])) return failure('force eval only in play/resolution');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'forceEval' && card.subtype !== 'force_eval') {
      return failure('force evaluation card required');
    }
    if (state.forceEvalRequested) {
      this.context()?.emitGameEvent?.('fizzle', playerId, {
        source: 'force_eval',
        cardId,
        reason: 'already_resolved',
      });
      return success({ fizzled: true });
    }
    state.forceEvalRequested = true;
    moveCardToGraveyard(player, cardId);
    this.context()?.emitGameEvent?.('force_eval', playerId, { cardId });
    this.context()?.forceEval?.(state, playerId);
    return success();
  }
}
