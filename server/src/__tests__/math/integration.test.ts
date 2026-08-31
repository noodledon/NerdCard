import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { mathEngine } from '../../math/index.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, type FunctionBoardSchema } from '../../state/schema.js';

function firstBoard(game: NerdiClashGame): FunctionBoardSchema {
  const board = game.getPlayer('p1')?.boards[0];
  if (!board) throw new Error('missing p1 board');
  return board;
}

function gameWithCard(cardId: string, expression: string): NerdiClashGame {
  const game = new NerdiClashGame();
  const player = game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.state.phase = Phase.play;
  game.state.currentTurnPlayerId = 'p1';
  firstBoard(game).expression = expression;
  player.hand.push(catalogCardToSchema(getCardById(cardId)));
  player.handCount = player.hand.length;
  return game;
}

describe.skipIf(process.env.USE_SYMPY !== 'true')('SymPy integration', () => {
  it('executes all five SymPy-backed operations', async () => {
    await expect(mathEngine.integrate('x^2', 'x')).resolves.toMatchObject({
      ok: true,
      supported: true,
      value: 'x**3/3',
    });
    await expect(mathEngine.limit('sin(x)/x', 'x', 0)).resolves.toMatchObject({
      ok: true,
      supported: true,
      value: '1',
    });
    await expect(mathEngine.continuityCheck('x^2', 'x', 0)).resolves.toMatchObject({
      ok: true,
      supported: true,
      value: 'true',
    });
    await expect(mathEngine.rref('[[1,2],[2,4]]')).resolves.toMatchObject({
      ok: true,
      supported: true,
    });
    await expect(mathEngine.rank('[[1,2],[2,4]]')).resolves.toMatchObject({
      ok: true,
      supported: true,
      value: '1',
    });
  });

  it.each([
    ['fcc-calc-integral-001', 'x^2', 'x^3/3'],
    ['fcc-calc-limit-001', 'sin(x) / x', '1'],
  ])('resolves catalog card %s through the active engine', async (cardId, expression, expected) => {
    const game = gameWithCard(cardId, expression);

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId,
      target: { kind: 'none' },
    }));

    expect(result).toEqual({ ok: true });
    expect(firstBoard(game).expression).toBe(expected);
  });
});
