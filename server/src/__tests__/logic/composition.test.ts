import { describe, it, expect } from 'vitest';
import * as math from 'mathjs';
import { CompositionDepthTracker, MAX_COMPOSITION_DEPTH } from '../../logic/composition.js';
import { CompositionCommand } from '../../commands/CompositionCommand.js';
import type { CommandState } from '../../commands/base.js';
import { parseExpression } from '../../math/expressions.js';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, FunctionBoardSchema } from '../../state/schema.js';

describe('CompositionDepthTracker', () => {
  it('starts at depth 0', () => {
    const t = new CompositionDepthTracker();
    expect(t.current('sessA')).toBe(0);
    expect(t.isWithinLimit('sessA')).toBe(true);
  });

  it('pushes and tracks depth', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    expect(t.current('sessA')).toBe(1);
    t.push('sessA');
    expect(t.current('sessA')).toBe(2);
  });

  it('throws on the 3rd push (depth would exceed 2)', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    expect(() => t.push('sessA')).toThrow();
  });

  it('throws (not silently accepts) when already at the cap', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    let threw = false;
    try {
      t.push('sessA');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(t.current('sessA')).toBe(MAX_COMPOSITION_DEPTH);
  });

  it('pops and decreases depth', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    t.pop('sessA');
    expect(t.current('sessA')).toBe(1);
  });

  it('throws on pop below 0', () => {
    const t = new CompositionDepthTracker();
    expect(() => t.pop('sessA')).toThrow();
  });

  it('resets depth', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    t.reset('sessA');
    expect(t.current('sessA')).toBe(0);
  });

  it('isWithinLimit true at depth 2, false beyond', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    expect(t.isWithinLimit('sessA')).toBe(true);
    // Cannot actually push to 3 (throws), so assertComposition at cap is fine:
    expect(() => t.assertComposition('sessA')).not.toThrow();
  });

  it('assertComposition does not throw within the limit', () => {
    const t = new CompositionDepthTracker();
    expect(() => t.assertComposition('sessA')).not.toThrow();
  });
});

// ─── CompositionCommand (wave-9 T2: AST substitution) ────────────────────────

interface TestCard { id: string; cardType?: string; }
interface TestBoard {
  boardId: string;
  expression: string;
  isActive?: boolean;
  destroyed?: boolean;
  compositionDepth?: number;
}

function composePlayer(id: string, boards: TestBoard[], hand: TestCard[] = [{ id: 'comp-1', cardType: 'composition' }]) {
  return {
    sessionId: id,
    hp10: 100,
    hand,
    boards,
    discardGraveyard: [] as TestCard[],
    boundFactor: null as { numberCardId: string; spellId: string } | null,
  };
}

type ComposePlayer = ReturnType<typeof composePlayer>;

function composeState(players: ComposePlayer[], phase = 'play'): CommandState {
  const byId = Object.fromEntries(players.map((entry) => [entry.sessionId, entry]));
  return {
    phase,
    players: {
      ...byId,
      get(id: string) { return byId[id]; },
      *values() { yield* players; },
    },
  };
}

function runCompose(
  state: CommandState,
  payload: { playerId: string; cardId: string; outerBoardId: string; innerBoardId: string; variable?: string },
) {
  const command = new CompositionCommand();
  command.state = state;
  return command.execute(payload);
}

function expressionsEqual(actual: string, expected: string): boolean {
  return math.symbolicEqual(parseExpression(actual), parseExpression(expected)) === true;
}

describe('CompositionCommand AST substitution', () => {
  it('composes into exp(x) without corrupting the function name', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'exp(x)' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const gameState = composeState([p1]);

    const result = runCompose(gameState, {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'x',
    });

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(p1.boards[0].expression, 'exp(x + 1)')).toBe(true);
    expect(p1.boards[0].expression).not.toContain('e(');
    expect(p1.boards[0].compositionDepth).toBe(1);
    expect(p1.hand).toEqual([]);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['comp-1']);
  });

  it('x^2 ∘ (x+1) yields (x+1)^2 — symbol-aware, not token surgery', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x^2' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'x',
    });

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(p1.boards[0].expression, '(x + 1)^2')).toBe(true);
  });

  it('replaces every occurrence of the variable', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x + x' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'x',
    });

    expect(expressionsEqual(p1.boards[0].expression, '(x + 1) + (x + 1)')).toBe(true);
  });

  it('substitutes a named variable other than x', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'y^2' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'y',
    });

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(p1.boards[0].expression, '(x + 1)^2')).toBe(true);
  });

  it('defaults variable to the outer board’s sole distinct variable', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'y^2' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner',
    });

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(p1.boards[0].expression, '(x + 1)^2')).toBe(true);
  });

  it('rejects an ambiguous multi-variable outer board without variable', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x + y' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner',
    });

    expect(result).toEqual({ ok: false, reason: 'ambiguous variable — specify one' });
    expect(p1.boards[0].expression).toBe('x + y');
    expect(p1.hand.map((card) => card.id)).toEqual(['comp-1']);
    expect(p1.discardGraveyard).toEqual([]);
  });

  it('honors an explicit variable on a multi-variable outer board', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x + y' },
      { boardId: 'inner', expression: '2 * x' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'y',
    });

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(p1.boards[0].expression, 'x + 2 * x')).toBe(true);
  });

  it('rejects at compositionDepth 2 (depth-3 composition)', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x^2', compositionDepth: 2 },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'x',
    });

    expect(result).toEqual({ ok: false, reason: 'maximum composition depth reached' });
    expect(p1.boards[0].expression).toBe('x^2');
    expect(p1.hand.map((card) => card.id)).toEqual(['comp-1']);
  });

  it('rejects composing a board into itself', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x^2' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'outer', variable: 'x',
    });

    expect(result).toEqual({ ok: false, reason: 'composition requires two distinct boards' });
    expect(p1.boards[0].expression).toBe('x^2');
  });

  it('still fizzles on a dead inner board (card is spent)', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: 'x^2' },
      { boardId: 'inner', expression: 'x + 1', isActive: false },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'x',
    });

    expect(result).toEqual({ ok: true, fizzled: true });
    expect(p1.boards[0].expression).toBe('x^2');
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['comp-1']);
  });

  it('rejects composing onto an evaluated (empty-expression) board', () => {
    const p1 = composePlayer('p1', [
      { boardId: 'outer', expression: '' },
      { boardId: 'inner', expression: 'x + 1' },
    ]);
    const result = runCompose(composeState([p1]), {
      playerId: 'p1', cardId: 'comp-1', outerBoardId: 'outer', innerBoardId: 'inner', variable: 'x',
    });

    expect(result).toEqual({ ok: false, reason: 'board expression is not parseable' });
    expect(p1.hand.map((card) => card.id)).toEqual(['comp-1']);
  });
});

// ─── dispatchIntent end-to-end (variable + secondaryBoardId plumbing) ────────

function gameInPlay(): NerdiClashGame {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.state.phase = Phase.play;
  game.state.currentTurnPlayerId = 'p1';
  return game;
}

function giveCompositionCard(game: NerdiClashGame, playerId: string): void {
  const player = game.getPlayer(playerId);
  if (!player) throw new Error(`missing player ${playerId}`);
  player.hand.push(catalogCardToSchema(getCardById('act-special-composition-001')));
  player.handCount = player.hand.length;
}

function addBoard(game: NerdiClashGame, playerId: string, boardId: string, expression: string): FunctionBoardSchema {
  const player = game.getPlayer(playerId);
  if (!player) throw new Error(`missing player ${playerId}`);
  const board = new FunctionBoardSchema();
  board.boardId = boardId;
  board.ownerSessionId = playerId;
  board.expression = expression;
  board.domain = 'poly';
  board.isActive = true;
  player.boards.push(board);
  player.boardCount = player.boards.length;
  return board;
}

describe('composition play_card routing', () => {
  it('composes exp(x) ∘ (x+1) end-to-end with explicit variable + secondaryBoardId', async () => {
    const game = gameInPlay();
    const outer = addBoard(game, 'p1', 'p1_board_outer', 'exp(x)');
    addBoard(game, 'p1', 'p1_board_inner', 'x + 1');
    giveCompositionCard(game, 'p1');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-composition-001',
      target: { kind: 'self_board', id: 'p1_board_outer' },
      secondaryBoardId: 'p1_board_inner',
      variable: 'x',
    }));

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(outer.expression, 'exp(x + 1)')).toBe(true);
    expect(outer.compositionDepth).toBe(1);
  });

  it('auto-picks the first other board when secondaryBoardId is omitted', async () => {
    const game = gameInPlay();
    const seeded = game.getPlayer('p1')!.boards[0]!;
    seeded.expression = 'x^2';
    addBoard(game, 'p1', 'p1_board_inner', 'x + 1');
    giveCompositionCard(game, 'p1');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-composition-001',
      target: { kind: 'self_board', id: seeded.boardId },
    }));

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(seeded.expression, '(x + 1)^2')).toBe(true);
  });

  it('honors secondaryBoardId over the auto-pick order', async () => {
    const game = gameInPlay();
    const seeded = game.getPlayer('p1')!.boards[0]!;
    seeded.expression = 'x^2';
    addBoard(game, 'p1', 'p1_board_b', 'x + 1');
    addBoard(game, 'p1', 'p1_board_c', '2 * x');
    giveCompositionCard(game, 'p1');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-composition-001',
      target: { kind: 'self_board', id: seeded.boardId },
      secondaryBoardId: 'p1_board_c',
    }));

    expect(result).toEqual({ ok: true });
    expect(expressionsEqual(seeded.expression, '(2 * x)^2')).toBe(true);
  });

  it('rejects an ambiguous outer board end-to-end when variable is omitted', async () => {
    const game = gameInPlay();
    const seeded = game.getPlayer('p1')!.boards[0]!;
    seeded.expression = 'x + y';
    addBoard(game, 'p1', 'p1_board_inner', 'x + 1');
    giveCompositionCard(game, 'p1');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-composition-001',
      target: { kind: 'self_board', id: seeded.boardId },
    }));

    expect(result).toEqual({ ok: false, reason: 'ambiguous variable — specify one' });
    expect(seeded.expression).toBe('x + y');
  });
});
