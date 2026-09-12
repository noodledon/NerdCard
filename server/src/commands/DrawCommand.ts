import {
  failure, getPlayer, phaseAllowed, success, type CommandCard, type CommandResult, GameCommand,
} from './base.js';
import { drawFromDeck } from '../logic/deck.js';

export interface DrawPayload { playerId: string; deck: 'fcc' | 'number' | 'action'; count?: number; }

export class DrawCommand extends GameCommand<DrawPayload> {
  execute({ playerId, deck, count = 1 }: DrawPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['draw'])) return failure('draw only in draw phase');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const pile = deck === 'fcc' ? player.deckFCC : deck === 'number' ? player.deckNumber : player.deckAction;
    if (!pile) return failure('deck unavailable');
    const graveyard = player.discardGraveyard ?? player.graveyard;
    if (!graveyard) return failure('graveyard unavailable');
    // The graveyard is shared across decks: reshuffle only cards that belong
    // to this pile (deckType matches the catalog 'fcc'/'number'/'action'
    // strings). Anchors are opening hand resources and stay buried.
    const accepts = (card: CommandCard) => card.deckType === deck && card.subtype !== 'Anchor';
    const drawn: CommandCard[] = [];
    for (let index = 0; index < Math.max(0, Math.floor(count)); index += 1) {
      const result = drawFromDeck(pile, graveyard, Math.random, accepts);
      if (!result.ok) break;
      player.hand.push(result.card);
      drawn.push(result.card);
    }
    if (player.handCount !== undefined) player.handCount = player.hand.length;
    if (drawn.length === 0) return failure('deck empty');
    this.context()?.emitGameEvent?.('draw_cards', playerId, {
      deck,
      cardIds: drawn.map((card) => card.id),
    });
    return success({ drawn: drawn.length });
  }
}
