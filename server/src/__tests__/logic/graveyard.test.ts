import { describe, it, expect } from 'vitest';
import { Graveyard } from '../../logic/graveyard.js';
import type { CardData } from '../../logic/types.js';

function card(id: string): CardData {
  return { id, deckType: 'fcc', cardType: 'add_term', domain: 'poly' };
}

describe('Graveyard', () => {
  it('starts empty', () => {
    expect(new Graveyard().size()).toBe(0);
  });

  it('buries a card', () => {
    const g = new Graveyard();
    g.bury(card('1'));
    expect(g.size()).toBe(1);
  });

  it('exiles a card', () => {
    const g = new Graveyard();
    g.bury(card('1'));
    g.bury(card('2'));
    g.exile('1');
    expect(g.size()).toBe(1);
    expect(g.contains('1')).toBe(false);
  });

  it('resurrects a card', () => {
    const g = new Graveyard();
    g.bury(card('1'));
    const r = g.resurrect('1');
    expect(r?.id).toBe('1');
    expect(g.size()).toBe(0);
  });

  it('resurrect returns null for missing card', () => {
    expect(new Graveyard().resurrect('nope')).toBeNull();
  });

  it('contains check', () => {
    const g = new Graveyard();
    g.bury(card('1'));
    expect(g.contains('1')).toBe(true);
    expect(g.contains('2')).toBe(false);
  });

  it('toArray returns a copy', () => {
    const g = new Graveyard();
    g.bury(card('1'));
    g.bury(card('2'));
    const arr = g.toArray();
    expect(arr).toHaveLength(2);
    arr.push(card('3'));
    expect(g.size()).toBe(2);
  });
});
