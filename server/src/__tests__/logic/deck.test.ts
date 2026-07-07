import { describe, it, expect } from 'vitest';
import { Deck, seededRng } from '../../logic/deck.js';
import type { CardData } from '../../logic/types.js';

function makeCards(n: number): CardData[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    deckType: 'action',
    cardType: 'offensive',
    domain: 'rational',
  }));
}

describe('Deck', () => {
  it('initializes with given cards', () => {
    const deck = new Deck('fcc', makeCards(2));
    expect(deck.size()).toBe(2);
  });

  it('draws cards from the top', () => {
    const cards = makeCards(2);
    const deck = new Deck('fcc', cards);
    expect(deck.draw()?.id).toBe('c0');
    expect(deck.size()).toBe(1);
    expect(deck.draw()?.id).toBe('c1');
    expect(deck.draw()).toBeNull();
    expect(deck.size()).toBe(0);
  });

  it('drawN draws up to n cards', () => {
    const deck = new Deck('fcc', makeCards(3));
    const drawn = deck.drawN(2);
    expect(drawn).toHaveLength(2);
    expect(drawn[0].id).toBe('c0');
    expect(drawn[1].id).toBe('c1');
    expect(deck.size()).toBe(1);
  });

  it('draw on empty returns null (does not throw)', () => {
    const deck = new Deck('fcc', []);
    expect(deck.draw()).toBeNull();
    expect(deck.drawN(3)).toEqual([]);
  });

  it('peeks at top card without removing', () => {
    const deck = new Deck('fcc', makeCards(2));
    expect(deck.peek()?.id).toBe('c0');
    expect(deck.size()).toBe(2);
  });

  it('toArray returns a copy', () => {
    const cards = makeCards(2);
    const deck = new Deck('fcc', cards);
    const arr = deck.toArray();
    expect(arr).toEqual(cards);
    arr.push(makeCards(1)[0]);
    expect(deck.size()).toBe(2);
  });
});

describe('seededRng', () => {
  it('produces a deterministic sequence for the same seed', () => {
    const a = seededRng('seed-XYZ-123');
    const b = seededRng('seed-XYZ-123');
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = seededRng('seed-A');
    const b = seededRng('seed-B');
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const r = seededRng('range');
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('Deck.shuffle', () => {
  it('reproduces byte-identical order for the same seed', () => {
    const a = new Deck('action', makeCards(20), seededRng('seed-XYZ-123'));
    const b = new Deck('action', makeCards(20), seededRng('seed-XYZ-123'));
    a.shuffle('seed-XYZ-123');
    b.shuffle('seed-XYZ-123');
    expect(JSON.stringify(a.toArray())).toBe(JSON.stringify(b.toArray()));
  });

  it('is a valid permutation of the same multiset', () => {
    const original = makeCards(20);
    const deck = new Deck('action', original, seededRng('seed-XYZ-123'));
    deck.shuffle('seed-XYZ-123');
    const sortedShuffled = [...deck.toArray()].sort((x, y) => x.id.localeCompare(y.id));
    const sortedOriginal = [...original].sort((x, y) => x.id.localeCompare(y.id));
    expect(JSON.stringify(sortedShuffled)).toBe(JSON.stringify(sortedOriginal));
  });

  it('diverges for different seeds', () => {
    const a = new Deck('action', makeCards(20), seededRng('seed-A'));
    const b = new Deck('action', makeCards(20), seededRng('seed-B'));
    a.shuffle('seed-A');
    b.shuffle('seed-B');
    expect(JSON.stringify(a.toArray())).not.toBe(JSON.stringify(b.toArray()));
  });
});
