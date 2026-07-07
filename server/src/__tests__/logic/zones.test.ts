import { describe, it, expect, vi } from 'vitest';
import { moveCard } from '../../logic/zones.js';
import { ZoneType } from '../../logic/types.js';
import type { LogicState, CardData } from '../../logic/types.js';

function makeState(): LogicState {
  return {
    players: new Map(),
    decks: { fcc: [], number: [], action: [] },
    graveyard: [],
    callbacks: {},
  };
}

describe('moveCard', () => {
  it('fires both callbacks in order (rm then add)', () => {
    const calls: string[] = [];
    const state = makeState();
    state.callbacks = {
      onCardRemovedFromZone: (_c: CardData, z) => calls.push('rm:' + z),
      onCardAddedToZone: (_c: CardData, z) => calls.push('add:' + z),
    };

    moveCard(state, 'c9', ZoneType.Hand, ZoneType.Graveyard, 'sessA');

    expect(calls.join(',')).toBe('rm:Hand,add:Graveyard');
  });

  it('returns a CardMoveEvent with correct fields', () => {
    const state = makeState();
    const ev = moveCard(state, 'c9', ZoneType.Hand, ZoneType.Graveyard);
    expect(ev).toEqual({
      cardId: 'c9',
      from: ZoneType.Hand,
      to: ZoneType.Graveyard,
      ownerSessionId: '',
      timestamp: expect.any(Number),
    });
  });

  it('derives ownerSessionId from the LogicState player', () => {
    const state = makeState();
    state.players.set('sessA', {
      sessionId: 'sessA',
      displayName: 'A',
      hp10: 0,
      isConnected: true,
      hand: [{ id: 'c9', deckType: 'fcc', cardType: 'add_term', domain: 'poly' }],
      boards: [],
      availableVariables: [],
      variableUsagesLeft: 10,
      baseFunctionUnlocked: false,
      hasUsedVariableThisConstruction: false,
      handCount: 1,
      boardCount: 0,
    });

    const ev = moveCard(state, 'c9', ZoneType.Hand, ZoneType.Graveyard);
    expect(ev.ownerSessionId).toBe('sessA');
  });

  it('mutates the LogicState (removes from hand, adds to graveyard)', () => {
    const state = makeState();
    const card: CardData = { id: 'c9', deckType: 'fcc', cardType: 'add_term', domain: 'poly' };
    state.players.set('sessA', {
      sessionId: 'sessA',
      displayName: 'A',
      hp10: 0,
      isConnected: true,
      hand: [card],
      boards: [],
      availableVariables: [],
      variableUsagesLeft: 10,
      baseFunctionUnlocked: false,
      hasUsedVariableThisConstruction: false,
      handCount: 1,
      boardCount: 0,
    });

    moveCard(state, 'c9', ZoneType.Hand, ZoneType.Graveyard);

    expect(state.players.get('sessA')!.hand).toHaveLength(0);
    expect(state.graveyard).toHaveLength(1);
    expect(state.graveyard[0].id).toBe('c9');
  });

  it('uses explicit ownerSessionId when provided even if not in state', () => {
    const ev = moveCard(makeState(), 'c1', ZoneType.DeckFCC, ZoneType.Hand, 'explicit');
    expect(ev.ownerSessionId).toBe('explicit');
  });
});
