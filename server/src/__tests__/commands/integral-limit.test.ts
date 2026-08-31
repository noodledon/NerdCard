import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, type FunctionBoardSchema } from '../../state/schema.js';

function gameInPlay(): NerdiClashGame {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.state.phase = Phase.play;
  game.state.currentTurnPlayerId = 'p1';
  return game;
}

function giveCard(game: NerdiClashGame, playerId: string, cardId: string): void {
  const player = game.getPlayer(playerId);
  if (!player) throw new Error(`missing player ${playerId}`);
  player.hand.push(catalogCardToSchema(getCardById(cardId)));
  player.handCount = player.hand.length;
}

function firstBoard(game: NerdiClashGame, playerId: string): FunctionBoardSchema {
  const board = game.getPlayer(playerId)?.boards[0];
  if (!board) throw new Error(`missing board for ${playerId}`);
  return board;
}

describe.skipIf(process.env.USE_SYMPY === 'true')(
  'IntegralCommand and LimitCommand (default mathjs stub)',
  () => {
  it('integral returns ok:false on the stub without graveyarding the card', async () => {
    const game = gameInPlay();
    const p1 = game.getPlayer('p1');
    if (!p1) throw new Error('player missing');
    firstBoard(game, 'p1').expression = 'x^2';
    giveCard(game, 'p1', 'fcc-calc-integral-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-integral-001',
      target: { kind: 'none' },
    }));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Not implemented in v1/);
    const handIds = [...p1.hand].map((c) => c?.id);
    expect(handIds).toContain('fcc-calc-integral-001');
  });

  it('limit returns ok:false on the stub without graveyarding the card', async () => {
    const game = gameInPlay();
    const p1 = game.getPlayer('p1');
    if (!p1) throw new Error('player missing');
    firstBoard(game, 'p1').expression = 'x^2';
    giveCard(game, 'p1', 'fcc-calc-limit-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-limit-001',
      target: { kind: 'none' },
    }));

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Not implemented in v1/);
    const handIds = [...p1.hand].map((c) => c?.id);
    expect(handIds).toContain('fcc-calc-limit-001');
  });

  it('integral fizzles (ok:true, fizzled:true) when board is dead', async () => {
    const game = gameInPlay();
    const p1 = game.getPlayer('p1');
    if (!p1) throw new Error('player missing');
    firstBoard(game, 'p1').isActive = false;
    giveCard(game, 'p1', 'fcc-calc-integral-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-integral-001',
      target: { kind: 'none' },
    }));

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
  });

  it('limit fizzles (ok:true, fizzled:true) when board is dead', async () => {
    const game = gameInPlay();
    const p1 = game.getPlayer('p1');
    if (!p1) throw new Error('player missing');
    firstBoard(game, 'p1').isActive = false;
    giveCard(game, 'p1', 'fcc-calc-limit-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-limit-001',
      target: { kind: 'none' },
    }));

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
  });
  },
);
