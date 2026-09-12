import { describe, expect, it } from 'vitest';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame, type GameEvent } from '../../rooms/NerdiClashGame.js';
import type { CommandResult } from '../../commands/base.js';

/**
 * Wave-10 T5: the FSM's construction-deadline safeguard moved the phase to
 * gameOver but nobody consumed the 'game-over' event — the room sat in
 * gameOver with no winner and no winReason. tick() must now resolve the
 * abandonment: a lone submitter wins; zero submissions is a documented draw.
 */

function boardIdFor(game: NerdiClashGame, sessionId: string): string {
  const board = game.getPlayer(sessionId)?.boards[0];
  if (!board) throw new Error(`missing board for ${sessionId}`);
  return board.boardId;
}

function dispatch(game: NerdiClashGame, sessionId: string, intent: string, payload: Record<string, unknown> = {}): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
}

function newGameInConstruction(): { game: NerdiClashGame; events: GameEvent[] } {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  const events: GameEvent[] = [];
  game.setEventListener((event) => events.push(event));
  game.startGame();
  return { game, events };
}

describe('construction AFK deadline', () => {
  it('ends a fully-abandoned game with no winner and winReason abandoned', async () => {
    const { game, events } = newGameInConstruction();
    expect(game.state.phase).toBe(Phase.construction);

    game.tick(game.state.turnDeadline);

    expect(game.state.phase).toBe(Phase.gameOver);
    expect(game.state.winner).toBe('');
    expect(game.state.winReason).toBe('abandoned');
    const over = events.filter((event) => event.event === 'game_over');
    expect(over).toHaveLength(1);
    expect(over[0]?.details).toEqual({ winner: null, loser: '', winReason: 'abandoned' });

    // A winnerless gameOver still refuses intents.
    const result = await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
    expect(result).toEqual({ ok: false, reason: 'game is over' });
    // end_turn goes through requestEndTurn, which must refuse with the same
    // game-over reason (not a phase error) when winner is empty.
    expect(game.requestEndTurn('p1')).toEqual({ ok: false, reason: 'game is over' });
  });

  it('awards the game to the lone submitter when the other player never builds', async () => {
    const { game, events } = newGameInConstruction();
    const result = await dispatch(game, 'p1', 'build_function', {
      boardId: boardIdFor(game, 'p1'),
      expression: 'x^2',
    });
    expect(result.ok).toBe(true);
    expect(game.state.phase).toBe(Phase.construction);

    game.tick(game.state.turnDeadline);

    expect(game.state.phase).toBe(Phase.gameOver);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('abandoned');
    const over = events.filter((event) => event.event === 'game_over');
    expect(over).toHaveLength(1);
    expect(over[0]?.details).toEqual({ winner: 'p1', loser: 'p2', winReason: 'abandoned' });
  });
});
