import { describe, expect, it } from 'vitest';
import { checkWin } from '../../logic/winEngine.js';

describe('win engine', () => {
  it('does not treat starting zero HP as a loss', () => {
    const result = checkWin({
      players: [
        { id: 'A', hp10: 0, everGainedHP: false },
        { id: 'B', hp10: 0, everGainedHP: false },
      ],
    });
    expect(result.winner).toBeUndefined();
  });

  it('declares an HP loss after a player has gained HP', () => {
    expect(checkWin({
      players: [
        { id: 'A', hp10: 0, everGainedHP: true },
        { id: 'B', hp10: 300, everGainedHP: true },
      ],
    })).toMatchObject({ winner: 'B', loser: 'A', reason: 'hp0' });
  });

  it('declares isolation only after the timer expires', () => {
    expect(checkWin({
      players: [
        { id: 'A', hp10: 100, mainBoardExpr: 'x' },
        { id: 'B', hp10: 100, mainBoardExpr: 'x+y' },
      ],
      variableIsolationTimers: new Map([['A', 0]]),
    })).toMatchObject({ winner: 'B', loser: 'A', reason: 'isolation' });
  });

  it.each(['3*x', 'x^2', 'x+1'])(
    'declares isolation for any single-variable form: %s',
    (mainBoardExpr) => {
      expect(checkWin({
        players: [
          { id: 'A', hp10: 100, mainBoardExpr },
          { id: 'B', hp10: 100, mainBoardExpr: 'x+y' },
        ],
        variableIsolationTimers: new Map([['A', 0]]),
      })).toMatchObject({ winner: 'B', loser: 'A', reason: 'isolation' });
    },
  );

  it.each(['', '5', 'x +', 'x*y'])(
    'does not declare isolation for a non-single-variable board: %s',
    (mainBoardExpr) => {
      const result = checkWin({
        players: [
          { id: 'A', hp10: 100, mainBoardExpr },
          { id: 'B', hp10: 100, mainBoardExpr: 'x+y' },
        ],
        variableIsolationTimers: new Map([['A', 0]]),
      });
      expect(result.winner).toBeUndefined();
    },
  );

  it('does not end the game when a secondary board is destroyed', () => {
    const result = checkWin({
      players: [
        { id: 'A', hp10: 100, boards: [{ isActive: true }, { isSingular: true }] },
        { id: 'B', hp10: 100, boards: [{ isActive: true }] },
      ],
    });
    expect(result.winner).toBeUndefined();
    expect(result.destroyedPlayerBoards).toEqual(['A']);
  });
});
