import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame, type GameEvent } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
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

/** Give a player a second live board so a failed nomination can't end the game. */
function addSpareBoard(game: NerdiClashGame, sessionId: string, expression = 'x+1'): void {
  const player = requirePlayer(game, sessionId);
  const board = new FunctionBoardSchema();
  board.boardId = `${sessionId}_board_extra`;
  board.ownerSessionId = sessionId;
  board.expression = expression;
  board.domain = 'poly';
  board.isActive = true;
  player.boards.push(board);
  player.boardCount = player.boards.length;
}

function collectEvents(game: NerdiClashGame): GameEvent[] {
  const events: GameEvent[] = [];
  game.setEventListener((event) => events.push(event));
  return events;
}

// The FSM keeps the authoritative counters; the schema is a read mirror.
function setCounters(game: NerdiClashGame, consecutive: number, global: number): void {
  game.phaseController.fsm.state.consecutive_no_eval_turns = consecutive;
  game.phaseController.fsm.state.global_no_eval_turns = global;
}

describe('stalling force-eval (§8.5 auto-showdown)', () => {
  it('fires runForceEval when the 5th consecutive no-eval turn ends', async () => {
    // Both boards evaluate to 1 at vvc=1 → tie → failed nomination.
    const game = await gameInPlay('x^3', 'x');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 100;
    p2.hp10 = 100;
    addSpareBoard(game, 'p1');
    // Prove the automatic trigger never consumes a Force Evaluation card.
    giveCard(game, 'p1', 'act-special-force-eval-001');
    const events = collectEvents(game);
    setCounters(game, 4, 0);

    expect(game.requestEndTurn('p1').ok).toBe(true);

    expect(events).toContainEqual(expect.objectContaining({
      event: 'force_eval',
      actorId: 'p1',
      details: expect.objectContaining({ trigger: 'stalling', counter: 'consecutive' }),
    }));
    // Failed nomination: the staller's main board is destroyed, hp10 halved.
    expect(firstBoard(game, 'p1').isActive).toBe(false);
    expect(p1.hp10).toBe(50);
    expect(p2.hp10).toBe(100);
    // No card was consumed — the showdown is a phase event, not a card play.
    expect([...p1.hand].map((card) => card?.id)).toContain('act-special-force-eval-001');
    // consecutive restarts (a forced eval is an eval); global keeps counting.
    expect(game.state.consecutive_no_eval_turns).toBe(0);
    expect(game.state.global_no_eval_turns).toBe(1);
    // The spare board kept p1 alive — the turn resolved normally.
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
  });

  it('lets the global counter keep counting after the auto showdown resets consecutive', async () => {
    const game = await gameInPlay('x^3', 'x');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 100;
    p2.hp10 = 100;
    addSpareBoard(game, 'p1');
    setCounters(game, 4, 0);
    game.requestEndTurn('p1');
    expect(game.state.consecutive_no_eval_turns).toBe(0);
    expect(game.state.global_no_eval_turns).toBe(1);

    // p2's turn: draw, then a quiet end_turn — global increments again.
    await dispatch(game, 'p2', 'draw_cards', { deckChoices: [{ deck: 'number', count: 2 }] });
    expect(game.state.phase).toBe(Phase.play);
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(game.state.consecutive_no_eval_turns).toBe(1);
    expect(game.state.global_no_eval_turns).toBe(2);
  });

  it('fires the showdown via tick when the global counter reaches 20', async () => {
    const game = await gameInPlay('x^3', 'x');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 100;
    p2.hp10 = 100;
    addSpareBoard(game, 'p1');
    const events = collectEvents(game);
    // consecutive was reset mid-game (e.g., an earlier eval) — only global trips.
    setCounters(game, 0, 19);

    game.tick(game.state.turnDeadline + 1);

    expect(events).toContainEqual(expect.objectContaining({
      event: 'force_eval',
      actorId: 'p1',
      details: expect.objectContaining({ trigger: 'stalling', counter: 'global' }),
    }));
    expect(firstBoard(game, 'p1').isActive).toBe(false);
    expect(p1.hp10).toBe(50);
    expect(game.state.consecutive_no_eval_turns).toBe(0);
    expect(game.state.global_no_eval_turns).toBe(20);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
  });

  it('declares a domination win through the auto showdown', async () => {
    // At vvc=1: p1 '4*x' → 4 dominates p2 'x' → 1 (strictly > 2×).
    const game = await gameInPlay('4*x', 'x');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 100;
    p2.hp10 = 100;
    setCounters(game, 4, 7);

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('force_eval_domination');
    expect(game.state.phase).toBe(Phase.gameOver);
    expect(game.state.consecutive_no_eval_turns).toBe(0);
    expect(game.state.global_no_eval_turns).toBe(8);
  });

  it('never fires outside the play loop (construction / draw are immune)', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    const events = collectEvents(game);
    setCounters(game, 4, 19);

    // The construction deadline auto-pass ends the game — never a showdown.
    game.tick(game.state.turnDeadline + 1);
    expect(game.state.phase).toBe(Phase.gameOver);
    expect(events.filter((event) => event.event === 'force_eval')).toEqual([]);

    // Draw phase carries no deadline (turnDeadline = 0), so tick is a no-op.
    const drawGame = new NerdiClashGame();
    drawGame.addPlayer('p1', 'Player One');
    drawGame.addPlayer('p2', 'Player Two');
    drawGame.startGame();
    await dispatch(drawGame, 'p1', 'build_function', { boardId: boardIdFor(drawGame, 'p1'), expression: 'x^2' });
    await dispatch(drawGame, 'p2', 'build_function', { boardId: boardIdFor(drawGame, 'p2'), expression: 'x^2' });
    expect(drawGame.state.phase).toBe(Phase.draw);
    const drawEvents = collectEvents(drawGame);
    setCounters(drawGame, 4, 19);
    drawGame.tick(Date.now() + 120_000);
    expect(drawGame.state.phase).toBe(Phase.draw);
    expect(drawEvents.filter((event) => event.event === 'force_eval')).toEqual([]);
  });
});
