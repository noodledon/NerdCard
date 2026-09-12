import { describe, expect, it } from 'vitest';
import { evaluate, forceEval } from '../../logic/evalEngine.js';

describe('evaluation engine', () => {
  it('substitutes one VVC value into every variable and computes scaled HP', () => {
    expect(evaluate({ expression: 'x^2 + y' }, 0, 2)).toEqual({
      value: 6,
      complexity: 3,
      hpGain10: 10,
      undefined: false,
    });
  });

  it('reports non-finite evaluations as undefined', () => {
    const result = evaluate({ expression: '1 / 0' }, 0, 2);
    expect(result.undefined).toBe(true);
    expect(result.hpGain10).toBe(0);
  });

  it('requires strict domination beyond epsilon', () => {
    const a = { id: 'A', hp10: 100, lastForceValue: 60, boards: [{}] };
    const b = { id: 'B', hp10: 300, lastForceValue: 30, boards: [{}] };
    const result = forceEval({ players: [a, b] }, { nominatorId: 'A' });
    expect(result.winner).toBeUndefined();
    expect(result.nominatorBoardDestroyed).toBe(true);
    expect(a.hp10).toBe(50);
    expect(b.hp10).toBe(300);
    expect(result.redistributions).toEqual([]);
  });

  it('redistributes the nominator half to an opponent that beats its value', () => {
    const a = { id: 'A', hp10: 101, lastForceValue: 60, boards: [{}] };
    const b = { id: 'B', hp10: 200, lastForceValue: 80, boards: [{}] };
    const result = forceEval({ players: [a, b] }, { nominatorId: 'A' });
    expect(result.winner).toBeUndefined();
    expect(result.nominatorBoardDestroyed).toBe(true);
    expect(a.hp10).toBe(51);
    expect(b.hp10).toBe(250);
    expect(result.redistributions).toEqual([{ from: 'A', to: 'B', hp10Transferred: 50 }]);
  });

  it('declares the dominator the winner without transferring HP', () => {
    const a = { id: 'A', hp10: 100, lastForceValue: 100, boards: [{}] };
    const b = { id: 'B', hp10: 305, lastForceValue: 30, boards: [{}] };
    const result = forceEval({ players: [a, b] }, { nominatorId: 'A' });
    expect(result.winner).toBe('A');
    // Domination wins outright — no HP moves and no board is destroyed.
    expect(result.redistributions).toEqual([]);
    expect(result.nominatorBoardDestroyed).toBe(false);
    expect(a.hp10).toBe(100);
    expect(b.hp10).toBe(305);
  });
});
