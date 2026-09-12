import { describe, expect, it } from 'vitest';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

function boardIdFor(game: NerdiClashGame, sessionId: string): string {
  const board = firstBoard(game, sessionId);
  return board.boardId;
}

function firstBoard(game: NerdiClashGame, sessionId: string): FunctionBoardSchema {
  const board = game.getPlayer(sessionId)?.boards[0];
  if (!board) throw new Error(`missing board for ${sessionId}`);
  return board;
}

function requirePlayer(game: NerdiClashGame, sessionId: string): PlayerSchema {
  const player = game.getPlayer(sessionId);
  if (!player) throw new Error(`missing player ${sessionId}`);
  return player;
}

function dispatch(game: NerdiClashGame, sessionId: string, intent: string, payload: Record<string, unknown>): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
}

/** Drive a fresh game through construction + draw into the play phase (p1's turn). */
async function gameInPlay(p1Expression = 'x^2', p2Expression = 'x^3+x'): Promise<NerdiClashGame> {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.startGame();
  await dispatch(game, 'p1', 'build_function', { boardId: boardIdFor(game, 'p1'), expression: p1Expression });
  await dispatch(game, 'p2', 'build_function', { boardId: boardIdFor(game, 'p2'), expression: p2Expression });
  await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  if (game.state.phase !== Phase.play) throw new Error(`expected play phase, got ${game.state.phase}`);
  return game;
}

/** Add a second live board (post-construction), like an addBoard play would. */
function addSpareBoard(game: NerdiClashGame, sessionId: string, expression: string): FunctionBoardSchema {
  const player = requirePlayer(game, sessionId);
  const board = new FunctionBoardSchema();
  board.boardId = `${sessionId}_board_extra`;
  board.ownerSessionId = sessionId;
  board.expression = expression;
  board.domain = 'poly';
  board.isActive = true;
  player.boards.push(board);
  player.boardCount = player.boards.length;
  return board;
}

/** Take `sessionId` through draw → play → end_turn (one full turn). */
async function passTurn(game: NerdiClashGame, sessionId: string): Promise<void> {
  const drawn = await dispatch(game, sessionId, 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  expect(drawn.ok).toBe(true);
  expect(game.state.phase).toBe(Phase.play);
  expect(game.requestEndTurn(sessionId).ok).toBe(true);
}

function timerFor(game: NerdiClashGame, sessionId: string): number | undefined {
  return game.state.variable_isolation_timers.get(sessionId);
}

describe('isolation countdown (W9-T6: one distinct variable)', () => {
  it.each(['3*x', 'x^2', 'x+1'])('starts the timer for single-variable board %s', async (expr) => {
    const game = await gameInPlay('x+y', expr);

    expect(game.requestEndTurn('p1').ok).toBe(true);

    expect(timerFor(game, 'p2')).toBe(3);
    expect(timerFor(game, 'p1')).toBeUndefined();
  });

  it('runs 3→0 over end-turns and declares the isolation win', async () => {
    const game = await gameInPlay('x+y', '3*x');

    game.requestEndTurn('p1');
    expect(timerFor(game, 'p2')).toBe(3);

    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBe(2);

    await passTurn(game, 'p1');
    expect(timerFor(game, 'p2')).toBe(1);

    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBe(0);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('variable_isolation');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('clears the timer when the board is rebuilt above one variable', async () => {
    const game = await gameInPlay('x', 'x+y');

    game.requestEndTurn('p1');
    expect(timerFor(game, 'p1')).toBe(3);

    // Rebuild p1's function back above one distinct variable.
    firstBoard(game, 'p1').expression = 'x+y';
    await passTurn(game, 'p2');

    expect(timerFor(game, 'p1')).toBeUndefined();
  });

  it('does not let a destroyed board count, and ignores it when live boards remain', async () => {
    const game = await gameInPlay('x+y', 'x*y');
    // p2's first board is dead but reads 'x'; the live second board 'x*y'
    // keeps p2 above one variable either way.
    firstBoard(game, 'p2').isActive = false;
    firstBoard(game, 'p2').expression = 'x';
    addSpareBoard(game, 'p2', 'x*y');

    game.requestEndTurn('p1');

    expect(timerFor(game, 'p2')).toBeUndefined();
  });

  it('does not false-trigger when every board is destroyed', async () => {
    const game = await gameInPlay('x+y', 'x');
    firstBoard(game, 'p2').isActive = false;

    game.requestEndTurn('p1');

    expect(timerFor(game, 'p2')).toBeUndefined();
    // With no surviving boards the dim0 loss fires instead — no isolation timer.
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('singular_board');
  });

  it('requires EVERY active board reduced to one variable (multi-board pin)', async () => {
    const game = await gameInPlay('x+y', 'x');
    // Main board 'x' alone would have started the countdown before; a second
    // active board at two variables must hold it off.
    const second = addSpareBoard(game, 'p2', 'x*y');

    game.requestEndTurn('p1');
    expect(timerFor(game, 'p2')).toBeUndefined();

    // Once the second board is also reduced, the countdown runs.
    second.expression = 'x^2';
    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBe(3);
  });

  it('guards a post-eval board (isActive with empty expression)', async () => {
    const game = await gameInPlay('x+y', 'x^2');
    // EvalCommand leaves evaluated boards active with expression=''.
    firstBoard(game, 'p2').expression = '';

    expect(game.requestEndTurn('p1').ok).toBe(true);

    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');
  });
});
