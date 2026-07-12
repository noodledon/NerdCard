import {
  failure, getPlayer, phaseAllowed, success, type CommandCard, type CommandResult, GameCommand,
} from './base.js';

export interface DrawPayload { playerId: string; deck: 'fcc' | 'number' | 'action'; count?: number; }

export class DrawCommand extends GameCommand<DrawPayload> {
  execute({ playerId, deck, count = 1 }: DrawPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['draw'])) return failure('draw only in draw phase');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const pile = deck === 'fcc' ? player.deckFCC : deck === 'number' ? player.deckNumber : player.deckAction;
    if (!pile) return failure('deck unavailable');
    const drawn: CommandCard[] = [];
    for (let index = 0; index < Math.max(0, Math.floor(count)); index += 1) {
      const card = pile.splice(0, 1)[0];
      if (!card) break;
      player.hand.push(card);
      drawn.push(card);
    }
    if (player.handCount !== undefined) player.handCount = player.hand.length;
    return success({ drawn: drawn.length });
  }
}
