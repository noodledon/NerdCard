// Pure graveyard ("3rd Dimension") accounting — T7.
//
// CRITICAL: ZERO imports from @colyseus/schema or colyseus.js.

import type { CardData } from './types.js';

export class Graveyard {
  private cards: CardData[];

  constructor(initial: CardData[] = []) {
    this.cards = [...initial];
  }

  /** Send a card to the graveyard. */
  bury(card: CardData): void {
    this.cards.push(card);
  }

  /** Permanently remove a card from the graveyard (exile). */
  exile(cardId: string): void {
    this.cards = this.cards.filter((c) => c.id !== cardId);
  }

  /** Pull a card back out of the graveyard (resurrect). Returns null if absent. */
  resurrect(cardId: string): CardData | null {
    const idx = this.cards.findIndex((c) => c.id === cardId);
    if (idx === -1) return null;
    const [card] = this.cards.splice(idx, 1);
    return card;
  }

  size(): number {
    return this.cards.length;
  }

  contains(cardId: string): boolean {
    return this.cards.some((c) => c.id === cardId);
  }

  toArray(): CardData[] {
    return [...this.cards];
  }
}
