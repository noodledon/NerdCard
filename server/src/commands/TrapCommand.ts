import {
  failure,
  getPlayer,
  isAggressiveActionUsed,
  markAggressiveActionUsed,
  phaseAllowed,
  requiredCard,
  success,
  type CommandResult,
  GameCommand,
  isFailure,
} from './base.js';

export interface TrapPayload {
  playerId: string;
  trapCardId: string;
}

export class TrapCommand extends GameCommand<TrapPayload> {
  execute({ playerId, trapCardId }: TrapPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('trap only in play');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    if (isAggressiveActionUsed(player)) {
      return failure('aggressive action already used this turn');
    }
    if (player.trapCardId) return failure('trap slot occupied');
    const card = requiredCard(player, trapCardId);
    if (isFailure(card)) return card;
    // Hand membership alone isn't enough — only a trap card may arm the trap
    // slot. Any other card id would otherwise become a Showdown counter.
    if (card.cardType !== 'trap') return failure('trap card required');

    player.trapCardId = trapCardId;
    markAggressiveActionUsed(player);
    return success();
  }
}
