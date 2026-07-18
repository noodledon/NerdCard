import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema } from '../../state/schema.js';

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

describe('play_card routing', () => {
  it('rejects a raw play_card payload without target instead of throwing', () => {
    const game = gameInPlay();

    expect(() => game.dispatchIntent('p1', 'play_card', {
      cardId: 'not-in-hand',
    })).not.toThrow();
    expect(game.dispatchIntent('p1', 'play_card', {
      cardId: 'not-in-hand',
    })).toEqual({ ok: false, reason: 'unsupported intent play_card' });
  });

  it('routes Add Term to the board modifier rather than HP damage', () => {
    const game = gameInPlay();
    const p1 = game.getPlayer('p1');
    const p2 = game.getPlayer('p2');
    if (!p1 || !p2) throw new Error('players missing');
    p1.boards[0]!.expression = 'x^2';
    p2.hp10 = 100;
    giveCard(game, 'p1', 'fcc-add-term-001');

    const result = game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-add-term-001',
      target: { kind: 'none' },
    });

    expect(result).toEqual({ ok: true });
    expect(p1.boards[0]!.expression).toBe('(x^2) + (t)');
    expect(p2.hp10).toBe(100);
  });

  it('routes Derivative to the board modifier rather than HP damage', () => {
    const game = gameInPlay();
    const p1 = game.getPlayer('p1');
    const p2 = game.getPlayer('p2');
    if (!p1 || !p2) throw new Error('players missing');
    p1.boards[0]!.expression = 'x^2';
    p2.hp10 = 100;
    giveCard(game, 'p1', 'fcc-calc-derivative-001');

    const result = game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'none' },
    });

    expect(result).toEqual({ ok: true });
    expect(p1.boards[0]!.expression).toBe('2 * x');
    expect(p2.hp10).toBe(100);
  });

  it('rejects unsupported integral and limit cards without changing opponent HP', () => {
    const game = gameInPlay();
    const p2 = game.getPlayer('p2');
    if (!p2) throw new Error('opponent missing');
    p2.hp10 = 100;
    giveCard(game, 'p1', 'fcc-calc-integral-001');
    giveCard(game, 'p1', 'fcc-calc-limit-001');

    const integral = game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-integral-001',
      target: { kind: 'none' },
    });
    const limit = game.dispatchIntent('p1', 'play_card', {
      cardId: 'fcc-calc-limit-001',
      target: { kind: 'none' },
    });

    expect(integral.ok).toBe(false);
    expect(limit.ok).toBe(false);
    expect(p2.hp10).toBe(100);
  });

  it('gives every player the five documented Variable Anchor cards at setup', () => {
    const game = new NerdiClashGame();
    const player = game.addPlayer('p1', 'Player One');

    expect([...player.hand].filter((card) => card?.subtype === 'Anchor').map((card) => card?.id).sort())
      .toEqual(['vvc-1', 'vvc-2', 'vvc-3', 'vvc-4', 'vvc-5']);
    expect([...player.deckNumber].some((card) => card?.subtype === 'Anchor')).toBe(false);
    expect(player.handCount).toBe(5);
  });
});
