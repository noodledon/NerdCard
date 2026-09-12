import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import {
  catalogCardToSchema,
  FunctionBoardSchema,
  type PlayerSchema,
} from '../../state/schema.js';
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

function boardAt(game: NerdiClashGame, sessionId: string, index: number): FunctionBoardSchema {
  const board = requirePlayer(game, sessionId).boards[index];
  if (!board) throw new Error(`missing board ${index} for ${sessionId}`);
  return board;
}

/** Append an extra live board (scalar unless specified) to a player. */
function addBoard(game: NerdiClashGame, sessionId: string, expression = 'x', dimension = 0): FunctionBoardSchema {
  const player = requirePlayer(game, sessionId);
  const board = new FunctionBoardSchema();
  board.boardId = `${sessionId}_board_${player.boards.length + 1}`;
  board.ownerSessionId = sessionId;
  board.expression = expression;
  board.domain = dimension > 0 ? 'matrix' : 'poly';
  board.dimension = dimension;
  board.isActive = true;
  player.boards.push(board);
  player.boardCount = player.boards.length;
  return board;
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

describe('Vector Shift (vector)', () => {
  it('creates a vector board on the caster', async () => {
    const game = gameInPlay();
    giveCard(game, 'p1', 'fcc-la-vector-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-vector-001',
      target: { kind: 'none' },
    });

    expect(result).toEqual({ ok: true, boardId: 'p1_board_2' });
    const board = boardAt(game, 'p1', 1);
    expect(board.boardId).toBe('p1_board_2');
    expect(board.ownerSessionId).toBe('p1');
    expect(board.expression).toBe('[1, 0]');
    expect(board.domain).toBe('vector');
    expect(board.dimension).toBe(2);
    expect(board.isActive).toBe(true);
    expect(requirePlayer(game, 'p1').boardCount).toBe(2);
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-vector-001');
  });
});

describe('Matrix Weave (matrix)', () => {
  it('creates a matrix board on the caster', async () => {
    const game = gameInPlay();
    giveCard(game, 'p1', 'fcc-la-matrix-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-matrix-001',
      target: { kind: 'none' },
    });

    expect(result).toEqual({ ok: true, boardId: 'p1_board_2' });
    const board = boardAt(game, 'p1', 1);
    expect(board.expression).toBe('matrix([1,0],[0,1])');
    expect(board.domain).toBe('matrix');
    expect(board.dimension).toBe(2);
    expect(board.isSingular).toBe(false);
    expect(board.isActive).toBe(true);
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-matrix-001');
  });
});

describe('LA board cap', () => {
  it('rejects creation at the 3-board cap and keeps the card', async () => {
    const game = gameInPlay();
    addBoard(game, 'p1');
    addBoard(game, 'p1');
    expect(requirePlayer(game, 'p1').boards.length).toBe(3);
    giveCard(game, 'p1', 'fcc-la-vector-001');
    giveCard(game, 'p1', 'fcc-la-matrix-001');

    const vector = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-vector-001',
      target: { kind: 'none' },
    });
    const matrix = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-matrix-001',
      target: { kind: 'none' },
    });

    expect(vector).toEqual({ ok: false, reason: 'board limit reached' });
    expect(matrix).toEqual({ ok: false, reason: 'board limit reached' });
    expect(requirePlayer(game, 'p1').boards.length).toBe(3);
    expect(handIds(game, 'p1')).toContain('fcc-la-vector-001');
    expect(handIds(game, 'p1')).toContain('fcc-la-matrix-001');
    expect(graveyardIds(game, 'p1')).toEqual([]);
  });
});

describe('Transform Lens (transform)', () => {
  it('rewrites an own matrix board to its LUP U factor', async () => {
    const game = gameInPlay();
    const matrixBoard = addBoard(game, 'p1', 'matrix([2,1],[4,3])', 2);
    giveCard(game, 'p1', 'fcc-la-transform-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-transform-001',
      target: { kind: 'self_board', id: matrixBoard.boardId },
    });

    expect(result.ok).toBe(true);
    // lup([[2,1],[4,3]]) → U = [[4,3],[0,-0.5]] in the engine's matrix() form.
    expect(matrixBoard.expression).toBe('matrix([4,3],[0,-0.5])');
    expect(matrixBoard.isActive).toBe(true);
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-transform-001');
  });

  it('fizzles on a non-matrix board', async () => {
    const game = gameInPlay();
    const scalar = firstBoard(game, 'p1');
    scalar.expression = 'x^2';
    giveCard(game, 'p1', 'fcc-la-transform-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-transform-001',
      target: { kind: 'self_board', id: scalar.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
    expect(scalar.expression).toBe('x^2');
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-transform-001');
  });

  it('fizzles on a 1-D vector board', async () => {
    const game = gameInPlay();
    const vectorBoard = addBoard(game, 'p1', '[1, 0]', 2);
    giveCard(game, 'p1', 'fcc-la-transform-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-transform-001',
      target: { kind: 'self_board', id: vectorBoard.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
    expect(vectorBoard.expression).toBe('[1, 0]');
  });
});

/** Real phase flow (construction → draw → play) so declareWinner's
 *  play→gameOver FSM transition is legal — phaseController tracks phase
 *  internally, so a direct state.phase write leaves it stale. */
async function gameInPlayReal(): Promise<NerdiClashGame> {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.startGame();
  await dispatch(game, 'p1', 'build_function', { boardId: boardIdFor(game, 'p1'), expression: 'x^2' });
  await dispatch(game, 'p2', 'build_function', { boardId: boardIdFor(game, 'p2'), expression: 'x^3 + x' });
  await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  if (game.state.phase !== Phase.play) throw new Error(`expected play phase, got ${game.state.phase}`);
  return game;
}

describe('Eigen Lance (eigenvalue)', () => {
  it('destroys a singular opponent matrix board and wins singular_board', async () => {
    const game = await gameInPlayReal();
    // p2's only board becomes a singular 2x2 matrix (det = 0).
    const target = firstBoard(game, 'p2');
    target.expression = 'matrix([1,2],[2,4])';
    target.domain = 'matrix';
    target.dimension = 2;
    giveCard(game, 'p1', 'fcc-la-eigenvalue-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-eigenvalue-001',
      target: { kind: 'opp_board', id: target.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.boardDestroyed).toBe(true);
    expect(target.isActive).toBe(false);
    expect(target.isSingular).toBe(true);
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(true);
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-eigenvalue-001');
    // All of p2's boards destroyed → existing winEngine path ends the game.
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('singular_board');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('resolves without a kill on a non-singular matrix', async () => {
    const game = gameInPlay();
    const target = firstBoard(game, 'p2');
    target.expression = 'matrix([2,0],[0,3])'; // det = 6
    target.domain = 'matrix';
    target.dimension = 2;
    giveCard(game, 'p1', 'fcc-la-eigenvalue-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-eigenvalue-001',
      target: { kind: 'opp_board', id: target.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.survived).toBe(true);
    expect(result.boardDestroyed).toBe(false);
    expect(target.isActive).toBe(true);
    expect(target.isSingular).toBe(false);
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(true);
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-eigenvalue-001');
    expect(game.state.winner).toBe('');
  });

  it('fizzles on a scalar opponent board', async () => {
    const game = gameInPlay();
    const target = firstBoard(game, 'p2');
    target.expression = 'x^2';
    giveCard(game, 'p1', 'fcc-la-eigenvalue-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-eigenvalue-001',
      target: { kind: 'opp_board', id: target.boardId },
    });

    expect(result.ok).toBe(true);
    expect(result.fizzled).toBe(true);
    expect(target.isActive).toBe(true);
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(false);
    expect(graveyardIds(game, 'p1')).toContain('fcc-la-eigenvalue-001');
  });

  it('blocks a second aggressive play in the same turn', async () => {
    const game = gameInPlay();
    const target = firstBoard(game, 'p2');
    target.expression = 'matrix([2,0],[0,3])';
    target.dimension = 2;
    giveCard(game, 'p1', 'fcc-la-eigenvalue-001');
    giveCard(game, 'p1', 'act-offensive-001');

    const first = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-eigenvalue-001',
      target: { kind: 'opp_board', id: target.boardId },
    });
    expect(first.ok).toBe(true);

    const second = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(second).toEqual({ ok: false, reason: 'aggressive action already used this turn' });
    expect(handIds(game, 'p1')).toContain('act-offensive-001');
  });

  it('is rejected outside the play phase', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    giveCard(game, 'p1', 'fcc-la-eigenvalue-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-la-eigenvalue-001',
      target: { kind: 'opp_board', id: boardIdFor(game, 'p2') },
    });

    expect(result.ok).toBe(false);
    expect(handIds(game, 'p1')).toContain('fcc-la-eigenvalue-001');
  });
});
