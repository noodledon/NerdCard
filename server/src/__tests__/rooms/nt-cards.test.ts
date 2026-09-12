import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { evaluate } from '../../logic/evalEngine.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, type FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

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

function requirePlayer(game: NerdiClashGame, sessionId: string): PlayerSchema {
  const player = game.getPlayer(sessionId);
  if (!player) throw new Error(`missing player ${sessionId}`);
  return player;
}

function firstBoard(game: NerdiClashGame, sessionId: string): FunctionBoardSchema {
  const board = requirePlayer(game, sessionId).boards[0];
  if (!board) throw new Error(`missing board for ${sessionId}`);
  return board;
}

function boardIdFor(game: NerdiClashGame, sessionId: string): string {
  return firstBoard(game, sessionId).boardId;
}

function handIds(game: NerdiClashGame, sessionId: string): string[] {
  return [...requirePlayer(game, sessionId).hand]
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .map((card) => card.id);
}

function graveyardIds(game: NerdiClashGame, sessionId: string): string[] {
  return [...requirePlayer(game, sessionId).discardGraveyard]
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .map((card) => card.id);
}

function dispatch(
  game: NerdiClashGame,
  sessionId: string,
  intent: string,
  payload: Record<string, unknown>,
): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
}

describe('Mod Cage (modular)', () => {
  it('wraps the own board expression in mod(·, 7) and graveyards the card', async () => {
    const game = gameInPlay();
    firstBoard(game, 'p1').expression = 'x^2 + 3*x';
    giveCard(game, 'p1', 'fcc-nt-modular-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-modular-001',
      target: { kind: 'self_board', id: boardIdFor(game, 'p1') },
    });

    expect(result).toEqual({ ok: true });
    const expression = firstBoard(game, 'p1').expression;
    expect(expression.startsWith('mod(')).toBe(true);
    expect(expression.endsWith(', 7)')).toBe(true);
    expect(expression).toBe('mod(x ^ 2 + 3 * x, 7)');
    expect(handIds(game, 'p1')).not.toContain('fcc-nt-modular-001');
    expect(graveyardIds(game, 'p1')).toContain('fcc-nt-modular-001');
  });

  it('still evaluates as a finite number after the wrap', async () => {
    const game = gameInPlay();
    firstBoard(game, 'p1').expression = 'x^2 + 3*x';
    giveCard(game, 'p1', 'fcc-nt-modular-001');

    await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-modular-001',
      target: { kind: 'self_board', id: boardIdFor(game, 'p1') },
    });

    // mod(2^2 + 3*2, 7) = mod(10, 7) = 3 — the wrapped expression must stay
    // evaluable or the card would soft-lock the board out of the HP game.
    const evaluated = evaluate({ expression: firstBoard(game, 'p1').expression }, 0, 2);
    expect(evaluated.undefined).toBe(false);
    expect(evaluated.value).toBe(3);
  });

  it('fizzles on a dead board (card graveyards, board untouched)', async () => {
    const game = gameInPlay();
    const board = firstBoard(game, 'p1');
    board.expression = 'x^2';
    board.isActive = false;
    giveCard(game, 'p1', 'fcc-nt-modular-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-modular-001',
      target: { kind: 'self_board', id: board.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
    expect(board.expression).toBe('x^2');
    expect(graveyardIds(game, 'p1')).toContain('fcc-nt-modular-001');
  });

  it('is rejected outside the play phase', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    expect(game.state.phase).toBe(Phase.construction);
    giveCard(game, 'p1', 'fcc-nt-modular-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-modular-001',
      target: { kind: 'self_board', id: boardIdFor(game, 'p1') },
    });

    expect(result.ok).toBe(false);
    expect(handIds(game, 'p1')).toContain('fcc-nt-modular-001');
  });
});

describe('Fermat Echo (ntTheorem)', () => {
  it('reduces the opponent board constants mod 7', async () => {
    const game = gameInPlay();
    firstBoard(game, 'p2').expression = 'x^2 + 8*x + 7';
    giveCard(game, 'p1', 'fcc-nt-theorem-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-theorem-001',
      target: { kind: 'opp_board', id: boardIdFor(game, 'p2') },
    });

    expect(result.ok).toBe(true);
    expect(firstBoard(game, 'p2').expression).toBe('x ^ 2 + 1 * x + 0');
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(true);
    expect(graveyardIds(game, 'p1')).toContain('fcc-nt-theorem-001');
  });

  it('can also reach the opponent board via a plain opp target', async () => {
    const game = gameInPlay();
    firstBoard(game, 'p2').expression = 'x^2 + 8*x + 7';
    giveCard(game, 'p1', 'fcc-nt-theorem-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-theorem-001',
      target: { kind: 'opp', id: 'p2' },
    });

    expect(result.ok).toBe(true);
    expect(firstBoard(game, 'p2').expression).toBe('x ^ 2 + 1 * x + 0');
  });

  it('blocks a second aggressive play in the same turn', async () => {
    const game = gameInPlay();
    firstBoard(game, 'p2').expression = 'x^2 + 8*x + 7';
    giveCard(game, 'p1', 'fcc-nt-theorem-001');
    giveCard(game, 'p1', 'act-offensive-001');

    const first = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-theorem-001',
      target: { kind: 'opp_board', id: boardIdFor(game, 'p2') },
    });
    expect(first.ok).toBe(true);

    const second = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(second).toEqual({ ok: false, reason: 'aggressive action already used this turn' });
    expect(handIds(game, 'p1')).toContain('act-offensive-001');
    expect(game.state.pendingAttackTargetId).toBe('');
  });

  it('fizzles on a dead opponent board without spending the aggressive slot', async () => {
    const game = gameInPlay();
    const target = firstBoard(game, 'p2');
    target.expression = 'x^2 + 8*x + 7';
    target.isActive = false;
    giveCard(game, 'p1', 'fcc-nt-theorem-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-theorem-001',
      target: { kind: 'opp_board', id: target.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
    expect(target.expression).toBe('x^2 + 8*x + 7');
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(false);
    expect(graveyardIds(game, 'p1')).toContain('fcc-nt-theorem-001');
  });

  it('is rejected outside the play phase', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    giveCard(game, 'p1', 'fcc-nt-theorem-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-theorem-001',
      target: { kind: 'opp_board', id: boardIdFor(game, 'p2') },
    });

    expect(result.ok).toBe(false);
    expect(handIds(game, 'p1')).toContain('fcc-nt-theorem-001');
  });
});
