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

  it('(g) exact double does not dominate', () => {
    const result = forceEval({ players: [
      { id: 'A', hp10: 100, lastForceValue: 60, boards: [{}] },
      { id: 'B', hp10: 100, lastForceValue: 30, boards: [{}] },
    ] }, { nominatorId: 'A' });
    expect(result.winner).toBeUndefined();
  });

  it('(g) a value beyond epsilon dominates', () => {
    const result = forceEval({ players: [
      { id: 'A', hp10: 100, lastForceValue: 60.0001, boards: [{}] },
      { id: 'B', hp10: 100, lastForceValue: 30, boards: [{}] },
    ] }, { nominatorId: 'A' });
    expect(result.winner).toBe('A');
  });
});
