import { describe, it, expect } from 'vitest';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { Phase } from '../../logic/fsm.js';
import { getCardById } from '../../data/load-catalog.js';
import { catalogCardToSchema } from '../../state/schema.js';

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

  it('stays in construction after only one player builds', async () => {
    const game = harness();
    const boardId = boardIdFor(game, 'p1');
    const result = await Promise.resolve(game.dispatchIntent('p1', 'build_function', {
      boardId,
      expression: 'x^2',
    }));
    expect(result.ok).toBe(true);
    expect(game.state.phase).toBe(Phase.construction);
  });

  it('advances to draw after both players build', async () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const b2 = boardIdFor(game, 'p2');
    expect((await Promise.resolve(game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' }))).ok).toBe(true);
    expect((await Promise.resolve(game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' }))).ok).toBe(true);
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('writes the expression onto the board AND advances', async () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const b2 = boardIdFor(game, 'p2');
    await Promise.resolve(game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' }));
    await Promise.resolve(game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' }));
    const p1Board = [...game.getPlayer('p1')!.boards][0];
    const p2Board = [...game.getPlayer('p2')!.boards][0];
    expect(p1Board?.expression).toBe('x^2');
    expect(p2Board?.expression).toBe('x^3+x');
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('rejects an invalid expression without advancing', async () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    const result = await Promise.resolve(game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'this is not math' }));
    expect(result.ok).toBe(false);
    expect(game.state.phase).toBe(Phase.construction);
    expect(game.getPlayer('p1')?.boards[0]?.expression).toBe('');
  });
});

/**
 * Wave-10 T1: build_function is the largest authority hole — without a phase
 * or owner check, any player could rewrite their board off-turn, mid-defense,
 * or during draw. The legitimate play-phase use is rebuilding a board an eval
 * wiped (expression === ''); live expressions are only touched by cards.
 */
describe('build_function lockdown (wave-10 T1)', () => {
  function playHarness(): NerdiClashGame {
    const game = harness();
    void game.dispatchIntent('p1', 'build_function', { boardId: boardIdFor(game, 'p1'), expression: 'x^2 + y' });
    void game.dispatchIntent('p2', 'build_function', { boardId: boardIdFor(game, 'p2'), expression: 'x^3 + x' });
    void game.dispatchIntent('p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
    return game;
  }

  it('rejects build_function in waiting/draw/defense and leaves the board untouched', async () => {
    const waiting = new NerdiClashGame();
    waiting.addPlayer('p1', 'PlayerOne');
    waiting.addPlayer('p2', 'PlayerTwo');
    const waitingBoard = boardIdFor(waiting, 'p1');
    const waitingResult = await Promise.resolve(waiting.dispatchIntent('p1', 'build_function', {
      boardId: waitingBoard, expression: 'x^2',
    }));
    expect(waitingResult.ok).toBe(false);
    expect(waiting.getPlayer('p1')?.boards[0]?.expression).toBe('');

    const game = playHarness();
    expect(game.state.phase).toBe(Phase.play);
    // Force a defense window with a pending attack, then try to build.
    const p1 = game.getPlayer('p1')!;
    p1.hand.push(catalogCardToSchema(getCardById('act-offensive-001')));
    p1.handCount = p1.hand.length;
    const attack = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-offensive-001', target: { kind: 'opp', id: 'p2' },
    }));
    expect(attack.ok).toBe(true);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.phase).toBe(Phase.defense);

    for (const sessionId of ['p1', 'p2']) {
      const boardId = boardIdFor(game, sessionId);
      const before = game.getPlayer(sessionId)?.boards[0]?.expression;
      const result = await Promise.resolve(game.dispatchIntent(sessionId, 'build_function', {
        boardId, expression: 'x*y*z',
      }));
      expect(result.ok).toBe(false);
      expect(game.getPlayer(sessionId)?.boards[0]?.expression).toBe(before);
    }
  });

  it('rejects build_function during draw without mutating the board', async () => {
    const game = harness();
    const b1 = boardIdFor(game, 'p1');
    await Promise.resolve(game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' }));
    await Promise.resolve(game.dispatchIntent('p2', 'build_function', { boardId: boardIdFor(game, 'p2'), expression: 'x^3+x' }));
    expect(game.state.phase).toBe(Phase.draw);
    const result = await Promise.resolve(game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x+1' }));
    expect(result.ok).toBe(false);
    expect(game.getPlayer('p1')?.boards[0]?.expression).toBe('x^2');
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('rejects rewriting a live board in play — for either player — without mutation', async () => {
    const game = playHarness();
    for (const sessionId of ['p1', 'p2']) {
      const boardId = boardIdFor(game, sessionId);
      const before = sessionId === 'p1' ? 'x^2 + y' : 'x^3 + x';
      const result = await Promise.resolve(game.dispatchIntent(sessionId, 'build_function', {
        boardId, expression: 'x*y*z + w*v',
      }));
      expect(result.ok).toBe(false);
      expect(game.getPlayer(sessionId)?.boards[0]?.expression).toBe(before);
    }
    expect(game.state.phase).toBe(Phase.play);
  });

  it('lets only the turn owner rebuild a wiped (post-eval) board in play', async () => {
    const game = playHarness();
    const b1 = boardIdFor(game, 'p1');
    // EvalCommand leaves the evaluated board active with expression=''.
    game.getPlayer('p1')!.boards[0]!.expression = '';

    const offTurn = await Promise.resolve(game.dispatchIntent('p2', 'build_function', {
      boardId: boardIdFor(game, 'p2'), expression: 'x*y',
    }));
    expect(offTurn).toEqual({ ok: false, reason: 'not the active player' });

    const rebuilt = await Promise.resolve(game.dispatchIntent('p1', 'build_function', {
      boardId: b1, expression: 'x*y + z',
    }));
    expect(rebuilt.ok).toBe(true);
    expect(game.getPlayer('p1')?.boards[0]?.expression).toBe('x*y + z');
  });

  it('rejects rebuilding a destroyed board even when its expression is empty', async () => {
    const game = playHarness();
    const board = game.getPlayer('p1')!.boards[0]!;
    board.expression = '';
    board.isActive = false;
    (board as unknown as { destroyed: boolean }).destroyed = true;
    const result = await Promise.resolve(game.dispatchIntent('p1', 'build_function', {
      boardId: board.boardId, expression: 'x*y',
    }));
    expect(result.ok).toBe(false);
    expect(board.expression).toBe('');
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
    void game.dispatchIntent('p1', 'build_function', { boardId: b1, expression: 'x^2' });
    void game.dispatchIntent('p2', 'build_function', { boardId: b2, expression: 'x^3+x' });
    return game;
  }

  it('starts in draw after both build', () => {
    const game = drawHarness();
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('advances to play after drawing cards', async () => {
    const game = drawHarness();
    const result = await Promise.resolve(game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 1 }, { deck: 'number', count: 1 }],
    }));
    expect(result.ok).toBe(true);
    expect(game.state.phase).toBe(Phase.play);
  });

  it('puts drawn cards in the hand', async () => {
    const game = drawHarness();
    const prevHand = [...game.getPlayer('p1')!.hand].length;
    const result = await Promise.resolve(game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    }));
    expect(result.ok).toBe(true);
    expect([...game.getPlayer('p1')!.hand].length).toBe(prevHand + 2);
  });

  it('rejects draw_cards after already in play', async () => {
    const game = drawHarness();
    await Promise.resolve(game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    }));
    // Now in play — second draw should fail
    const result = await Promise.resolve(game.dispatchIntent('p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    }));
    expect(result.ok).toBe(false);
  });
});
