import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame, type GameEvent } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, type FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
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

function collectEvents(game: NerdiClashGame): GameEvent[] {
  const events: GameEvent[] = [];
  game.setEventListener((event) => events.push(event));
  return events;
}

function gameOverEvents(events: GameEvent[]): GameEvent[] {
  return events.filter((event) => event.event === 'game_over');
}

describe('game_over event', () => {
  it('fires exactly once for an hp0 win with winner/loser/winReason details', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 5;
    p2.everGainedHP = true;
    giveCard(game, 'p1', 'act-offensive-001');
    const events = collectEvents(game);

    const attack = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(attack.ok).toBe(true);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.requestEndTurn('p2').ok).toBe(true);

    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('hp_zero');
    const over = gameOverEvents(events);
    expect(over).toHaveLength(1);
    expect(over[0]).toEqual({
      event: 'game_over',
      actorId: 'p1',
      details: { winner: 'p1', loser: 'p2', winReason: 'hp_zero' },
    });
  });

  it('fires exactly once for a force_eval domination win', async () => {
    const game = await gameInPlay('x^3', 'x');
    requirePlayer(game, 'p1').hp10 = 100;
    requirePlayer(game, 'p2').hp10 = 100;
    giveCard(game, 'p1', 'act-special-force-eval-001');
    const events = collectEvents(game);

    const result = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(result.ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('force_eval_domination');
    const over = gameOverEvents(events);
    expect(over).toHaveLength(1);
    expect(over[0]?.details).toEqual({ winner: 'p1', loser: 'p2', winReason: 'force_eval_domination' });
  });

  it('fires once when a failed force_eval destroys the nominator board', async () => {
    // runForceEval finds no dominator, then the chained runCheckWin declares
    // the win — the two call sites must still produce a single event.
    const game = await gameInPlay('x*y', 'x^2+y');
    requirePlayer(game, 'p1').hp10 = 100;
    requirePlayer(game, 'p2').hp10 = 100;
    giveCard(game, 'p1', 'act-special-force-eval-001');
    const events = collectEvents(game);

    const result = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(result.ok).toBe(true);
    expect(firstBoard(game, 'p1').isActive).toBe(false);
    expect(game.state.winner).toBe('p2');
    expect(game.state.winReason).toBe('singular_board');
    const over = gameOverEvents(events);
    expect(over).toHaveLength(1);
    expect(over[0]?.details).toEqual({ winner: 'p2', loser: 'p1', winReason: 'singular_board' });
  });

  it('emits nothing when runCheckWin runs again after a winner is set', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 5;
    p2.everGainedHP = true;
    giveCard(game, 'p1', 'act-offensive-001');
    const events = collectEvents(game);

    await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    game.requestEndTurn('p1');
    game.requestEndTurn('p2');
    expect(game.state.winner).toBe('p1');
    expect(gameOverEvents(events)).toHaveLength(1);

    // Every later win check — via tick, intent, or end_turn — must not
    // re-emit. The game is already over.
    game.tick(Date.now() + 120_000);
    expect(game.requestEndTurn('p1')).toEqual({ ok: false, reason: 'game is over' });
    expect(await dispatch(game, 'p1', 'end_turn', {})).toEqual({ ok: false, reason: 'game is over' });
    expect(gameOverEvents(events)).toHaveLength(1);
  });
});
