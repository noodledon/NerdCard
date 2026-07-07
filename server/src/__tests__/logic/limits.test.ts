import { describe, it, expect } from 'vitest';
import {
  enforceHandSize,
  enforceBoardCount,
  canAddBoard,
} from '../../logic/limits.js';
import type { PlayerLogic } from '../../logic/types.js';

function makePlayer(opts: Partial<PlayerLogic> = {}): PlayerLogic {
  return {
    sessionId: 'sessA',
    displayName: 'A',
    hp10: 0,
    isConnected: true,
    hand: [],
    boards: [],
    availableVariables: [],
    variableUsagesLeft: 10,
    baseFunctionUnlocked: false,
    hasUsedVariableThisConstruction: false,
    handCount: 0,
    boardCount: 0,
    ...opts,
  };
}

describe('enforceHandSize', () => {
  it('allows a hand at the cap', () => {
    const p = makePlayer({ hand: Array(7).fill({}) as any });
    expect(enforceHandSize(p).ok).toBe(true);
  });

  it('rejects a hand over the cap', () => {
    const p = makePlayer({ hand: Array(8).fill({}) as any });
    const r = enforceHandSize(p);
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  it('respects a custom cap', () => {
    const p = makePlayer({ hand: Array(5).fill({}) as any });
    expect(enforceHandSize(p, 5).ok).toBe(true);
    expect(enforceHandSize(p, 4).ok).toBe(false);
  });
});

describe('enforceBoardCount', () => {
  it('allows boards at the cap', () => {
    const p = makePlayer({ boards: Array(3).fill({}) as any });
    expect(enforceBoardCount(p).ok).toBe(true);
  });

  it('rejects boards over the cap', () => {
    const p = makePlayer({ boards: Array(4).fill({}) as any });
    const r = enforceBoardCount(p);
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
  });
});

describe('canAddBoard', () => {
  it('true when under the cap', () => {
    expect(canAddBoard(makePlayer({ boards: Array(2).fill({}) as any }))).toBe(true);
  });

  it('false at the cap', () => {
    expect(canAddBoard(makePlayer({ boards: Array(3).fill({}) as any }))).toBe(false);
  });
});
