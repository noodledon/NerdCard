// Pure deck engine — T7.
//
// CRITICAL: ZERO imports from @colyseus/schema or colyseus.js. Testable in plain
// Node. RNG is injectable so seeded tests are deterministic across Node versions.

import type { CardData, DeckType } from './types.js';

/**
 * Deterministic seeded PRNG (mulberry32).
 * Identical seed -> byte-identical sequence across Node versions.
 */
export function seededRng(seed: string): () => number {
  // Hash the seed string into 4 32-bit state words.
  let h1 = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h1 ^= seed.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  let h2 = h1 ^ 0x9e3779b9;
  let h3 = h2 ^ 0x85ebca6b;
  let h4 = h3 ^ 0xc2b2ae35;

  return function next(): number {
    // mulberry32 step on h1, rotate state through h2/h3/h4
    h1 = (h1 + 0x6d2b79f5) | 0;
    let t = Math.imul(h1 ^ (h1 >>> 15), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    const x = (t ^ (t >>> 16)) >>> 0;

    h4 = (h4 + 0x9e3779b9) | 0;
    h3 = (h3 + 0x85ebca6b) | 0;
    h2 = (h2 + 0x6d2b79f5) | 0;

    return x / 0x100000000;
  };
}

export class Deck {
  private cards: CardData[];
  private rng: () => number;

  constructor(
    public readonly deckType: DeckType,
    initialCards: CardData[],
    rng?: () => number,
  ) {
    this.cards = [...initialCards];
    this.rng = rng ?? Math.random;
  }

  /** Fisher-Yates using the (possibly seeded) RNG. */
  shuffle(seed?: string): void {
    if (seed !== undefined) {
      this.rng = seededRng(seed);
    }
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const tmp = this.cards[i];
      this.cards[i] = this.cards[j];
      this.cards[j] = tmp;
    }
  }

  /** Draw the top card, or null when empty (never throws). */
  draw(): CardData | null {
    return this.cards.length > 0 ? (this.cards.shift() as CardData) : null;
  }

  drawN(n: number): CardData[] {
    const drawn: CardData[] = [];
    for (let i = 0; i < n && this.cards.length > 0; i++) {
      drawn.push(this.cards.shift() as CardData);
    }
    return drawn;
  }

  /** Peek at the top card without removing it. */
  peek(): CardData | null {
    return this.cards.length > 0 ? { ...this.cards[0] } : null;
  }

  size(): number {
    return this.cards.length;
  }

  isEmpty(): boolean {
    return this.cards.length === 0;
  }

  toArray(): CardData[] {
    return [...this.cards];
  }
}
