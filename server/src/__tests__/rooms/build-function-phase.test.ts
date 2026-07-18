import { describe, it, expect } from 'vitest';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { Phase } from '../../logic/fsm.js';

/**
 * Regression: build_function must drive the FSM submission so construction
 * advances to draw once both players have built. Before the fix, the JSON
 * bridge only wrote the expression onto the board via BuildFunctionCommand
 * and never called submitBuildFunction, leaving buildSubmissions empty.
 */
function harness(): NerdiClashGame {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'PlayerOne');
  game.addPlayer('p2', 'PlayerTwo');
  game.startGame(); // waiting → construction
  return game;
}

function boardIdFor(game: NerdiClashGame, sessionId: string): string {
  const player = game.getPlayer(sessionId);
  if (!player) throw new Error(`player ${sessionId} missing`);
  const board = [...player.boards][0];
  if (!board) throw new Error(`board missing for ${sessionId}`);
  return board.boardId;
}

describe('build_function → construction → draw', () => {
  it('starts in construction after startGame', () => {
    const game = harness();
    expect(game.state.phase).toBe(Phase.construction);
  });

  it('stays in construction after only one player builds', () => {
    const game = harness();
    const boardId = boardIdFor(game, 'p1');
    const result = game.dispatchIntent('p1', 'build_function', {
      boardId,
      expression: 'x^2',
    });
    expect(result.ok).toBe(true);
    expect(game.state.phase).toBe(Phase.construction);
  });

  it('advances to draw after both players build', () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const b2 = boardIdFor(game, 'p2');
    expect(game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' }).ok).toBe(true);
    expect(game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' }).ok).toBe(true);
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('writes the expression onto the board AND advances', () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const b2 = boardIdFor(game, 'p2');
    game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' });
    game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' });
    const p1Board = [...game.getPlayer('p1')!.boards][0];
    const p2Board = [...game.getPlayer('p2')!.boards][0];
    expect(p1Board?.expression).toBe('x^2');
    expect(p2Board?.expression).toBe('x^3+x');
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('rejects build_function outside construction', () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const b2 = boardIdFor(game, 'p2');
    game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' });
    game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' });
    // now in draw — a further build should fail
    const result = game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x+1' });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid expression without advancing', () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const result = game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'this is not math' });
    expect(result.ok).toBe(false);
    expect(game.state.phase).toBe(Phase.construction);
  });
});

describe('draw_cards → draw → play', () => {
  function drawHarness(): NerdiClashGame {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'PlayerOne');
    game.addPlayer('p2', 'PlayerTwo');
    game.startGame(); // waiting → construction
    const b1 = boardIdFor(game, 'p1');
    const b2 = boardIdFor(game, 'p2');
    // Both build to advance to draw
    game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' });
    game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' });
    return game;
  }

  it('starts in draw after both build', () => {
    const game = drawHarness();
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('advances to play after drawing cards', () => {
    const game = drawHarness();
    const result = game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 1 }, { deck: 'number', count: 1 }],
    });
    expect(result.ok).toBe(true);
    expect(game.state.phase).toBe(Phase.play);
  });

  it('puts drawn cards in the hand', () => {
    const game = drawHarness();
    const prevHand = [...game.getPlayer('p1')!.hand].length;
    const result = game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    });
    expect(result.ok).toBe(true);
    expect([...game.getPlayer('p1')!.hand].length).toBe(prevHand + 2);
  });

  it('rejects draw_cards after already in play', () => {
    const game = drawHarness();
    game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    });
    // Now in play — second draw should fail
    const result = game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    });
    expect(result.ok).toBe(false);
  });
});
