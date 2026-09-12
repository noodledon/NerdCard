import { describe, expect, it } from 'vitest';
import { drawFromDeck } from '../../logic/deck.js';
import { forceEval } from '../../logic/evalEngine.js';

describe('Wave 4 edge cases', () => {
  it('(a) reshuffles the graveyard before drawing from an empty deck', () => {
    const deck: number[] = [];
    const graveyard = [1, 2, 3];
    const result = drawFromDeck(deck, graveyard, () => 0.5);
    expect(result.ok).toBe(true);
    expect(deck).toHaveLength(2);
    expect(graveyard).toHaveLength(0);
  });

  it('(b) returns DECK_EMPTY without mutation when both zones are empty', () => {
    const deck: number[] = [];
    const graveyard: number[] = [];
    expect(drawFromDeck(deck, graveyard)).toEqual({ ok: false, code: 'DECK_EMPTY' });
    expect(deck).toEqual([]);
    expect(graveyard).toEqual([]);
  });

  it('(a2) reshuffles only cards the accepts predicate allows', () => {
    const deck: number[] = [];
    const graveyard = [1, 2, 3, 4];
    const result = drawFromDeck(deck, graveyard, () => 0.5, (card) => card % 2 === 0);
    expect(result.ok).toBe(true);
    expect(deck).toHaveLength(1); // [2,4] shuffled in, one drawn
    expect(graveyard).toEqual([1, 3]);
  });

  it('(a3) reports DECK_EMPTY when the graveyard holds no acceptable cards', () => {
    const deck: number[] = [];
    const graveyard = [1, 3, 5];
    const result = drawFromDeck(deck, graveyard, Math.random, (card) => card % 2 === 0);
    expect(result).toEqual({ ok: false, code: 'DECK_EMPTY' });
    expect(deck).toEqual([]);
    expect(graveyard).toEqual([1, 3, 5]);
  });

  it('(g) exact double does not dominate', () => {
    const a = { id: 'A', hp10: 100, lastForceValue: 60, boards: [{}] };
    const b = { id: 'B', hp10: 100, lastForceValue: 30, boards: [{}] };
    const result = forceEval({ players: [a, b] }, { nominatorId: 'A' });
    expect(result.winner).toBeUndefined();
    expect(result.nominatorBoardDestroyed).toBe(true);
    expect(a.hp10).toBe(50);
    expect(b.hp10).toBe(100);
    expect(result.redistributions).toEqual([]);
  });

  it('(g) a value beyond epsilon dominates', () => {
    const result = forceEval({ players: [
      { id: 'A', hp10: 100, lastForceValue: 60.0001, boards: [{}] },
      { id: 'B', hp10: 100, lastForceValue: 30, boards: [{}] },
    ] }, { nominatorId: 'A' });
    expect(result.winner).toBe('A');
  });
});
