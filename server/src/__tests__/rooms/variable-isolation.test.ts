import { describe, expect, it } from 'vitest';
import { Phase } from '../../logic/fsm.js';
import { MODE_PROFILES, type GameMode } from '../../logic/modes.js';
import { distinctVariablesInExpression } from '../../math/expressions.js';
import { DerivativeCommand } from '../../commands/DerivativeCommand.js';
import { NerdiClashGame, type GameEvent } from '../../rooms/NerdiClashGame.js';
import { addToHand, FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult, CommandState } from '../../commands/base.js';

/**
 * Wave-13 M4 — Variable Isolation rules (docs/game-modes.md §3).
 *
 * Per-mechanic coverage for the mode overlay: derivative/limit gain
 * `opp_board` scope with `variable` forwarding and aggressive marking
 * (§3.2/OQ-3); construction requires ≥2 distinct vars (OQ-6); destroyed
 * boards may be rebuilt (OQ-7); Showdown is rejected (OQ-10); §8.5 runs the
 * soft_wipe variant (§3.3/OQ-11); the kill predicate accepts ≤1 var
 * including constants (§3.4/OQ-4); and the shared §10.1/§10.2 fixes —
 * tickIsolationTimers on the deadline auto-pass path and `variable`
 * forwarding in toCommandIntent.
 *
 * Wire-level coverage lives in the wave13-task-4 evidence probe; the
 * Classic Clash counterpart gating is in classic-clash.test.ts.
 */

function dispatch(game: NerdiClashGame, sessionId: string, intent: string, payload: Record<string, unknown>): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
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

/** Drive a fresh game of `mode` through construction + draw into play (p1's turn). */
async function gameInPlay(mode: GameMode, p1Expression: string, p2Expression: string): Promise<NerdiClashGame> {
  const game = new NerdiClashGame(mode);
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.startGame();
  const b1 = await dispatch(game, 'p1', 'build_function', { boardId: firstBoard(game, 'p1').boardId, expression: p1Expression });
  const b2 = await dispatch(game, 'p2', 'build_function', { boardId: firstBoard(game, 'p2').boardId, expression: p2Expression });
  if (!b1.ok || !b2.ok) throw new Error(`construction rejected: ${b1.reason ?? ''} ${b2.reason ?? ''}`);
  await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  if (game.state.phase !== Phase.play) throw new Error(`expected play phase, got ${game.state.phase}`);
  return game;
}

/** Take `sessionId` through draw → play → end_turn (one full turn). */
async function passTurn(game: NerdiClashGame, sessionId: string): Promise<void> {
  const drawn = await dispatch(game, sessionId, 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  expect(drawn.ok).toBe(true);
  expect(game.state.phase).toBe(Phase.play);
  expect(game.requestEndTurn(sessionId).ok).toBe(true);
}

/** Move a catalog card out of the player's decks into their hand. */
function seedHand(game: NerdiClashGame, sessionId: string, cardId: string): void {
  const player = requirePlayer(game, sessionId);
  if ([...player.hand].some((card) => card?.id === cardId)) return;
  for (const pile of [player.deckFCC, player.deckNumber, player.deckAction]) {
    const index = [...pile].findIndex((card) => card?.id === cardId);
    if (index >= 0) {
      const card = pile.splice(index, 1)[0];
      if (card) addToHand(player, card);
      return;
    }
  }
  throw new Error(`card ${cardId} not in ${sessionId}'s decks`);
}

function collectEvents(game: NerdiClashGame): GameEvent[] {
  const events: GameEvent[] = [];
  game.setEventListener((event) => events.push(event));
  return events;
}

/** Board expression for `sessionId` as the snapshot layer reports it. */
function snapshotBoardExpr(game: NerdiClashGame, sessionId: string): string {
  const players = game.getStateSnapshot().players as Record<string, { boards: Array<{ expression: string }> }>;
  return players[sessionId]?.boards[0]?.expression ?? '<missing>';
}

/** Expire the live play/defense deadline on BOTH mirrors — the tick()
 * intercept reads schema state, the FSM reads its own. */
function expireDeadline(game: NerdiClashGame): void {
  const past = Date.now() - 1;
  game.state.turnDeadline = past;
  game.phaseController.fsm.state.turnDeadline = past;
}

describe('variable isolation rules (wave-13 M4)', () => {
  it('lets derivative strike an opp_board and cut it to one variable', async () => {
    const game = await gameInPlay('variable_isolation', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'x',
    });

    expect(result).toMatchObject({ ok: true, targetBoardId: firstBoard(game, 'p2').boardId });
    // d/dx (x^2 + y) = 2*x — every other variable eliminated from the target.
    const expr = snapshotBoardExpr(game, 'p2');
    expect(distinctVariablesInExpression(expr)).toBe(1);
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(true);
    expect([...requirePlayer(game, 'p1').hand].map((card) => card?.id)).not.toContain('fcc-calc-derivative-001');
  });

  it('forwards `variable` so the attacker picks which variable survives', async () => {
    // d/dy (x^2 + y) = 1 — choosing the OTHER variable strips x entirely.
    const game = await gameInPlay('variable_isolation', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'y',
    });

    expect(result.ok).toBe(true);
    expect(distinctVariablesInExpression(snapshotBoardExpr(game, 'p2'))).toBe(0);
  });

  it('forwards `variable` on the v1 self path too (doc §10.2 fix)', async () => {
    const game = await gameInPlay('nerdiclash', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'self_board', id: firstBoard(game, 'p1').boardId },
      variable: 'y',
    });

    expect(result.ok).toBe(true);
    // Without forwarding the engine would default to the first var ('x').
    expect(distinctVariablesInExpression(snapshotBoardExpr(game, 'p1'))).toBe(0);
  });

  it('marks the opp-board strike aggressive — a second aggressive play is blocked', async () => {
    const game = await gameInPlay('variable_isolation', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');
    seedHand(game, 'p1', 'fcc-calc-limit-001');
    seedHand(game, 'p1', 'act-offensive-001');

    const strike = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'x',
    });
    expect(strike.ok).toBe(true);

    // A second VI strike hits the same gate inside the limit command.
    const secondStrike = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-limit-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'y',
    });
    expect(secondStrike).toEqual({ ok: false, reason: 'aggressive action already used this turn' });

    const attack = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(attack).toEqual({ ok: false, reason: 'aggressive action already used this turn' });
  });

  it('blocks a second opp-board strike inside the command (defense in depth)', async () => {
    const game = await gameInPlay('variable_isolation', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');
    requirePlayer(game, 'p1').aggressiveActionUsedThisTurn = true;

    const command = new DerivativeCommand();
    command.state = game.state as unknown as CommandState;
    command.roomRef = { profile: MODE_PROFILES.variable_isolation };

    const result = command.execute({
      playerId: 'p1',
      cardId: 'fcc-calc-derivative-001',
      targetBoardId: firstBoard(game, 'p2').boardId,
    });

    expect(result).toEqual({ ok: false, reason: 'aggressive action already used this turn' });
  });

  it('lets limit strike an opp_board and strip the chosen variable', async () => {
    const game = await gameInPlay('variable_isolation', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-limit-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-limit-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'y',
    });

    expect(result.ok).toBe(true);
    // lim y→0 (x^2 + y) = x^2 — 1 var, and the play marked aggressive.
    expect(distinctVariablesInExpression(snapshotBoardExpr(game, 'p2'))).toBe(1);
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(true);
  });

  it('fizzles the opp-board strike when the target board is dead', async () => {
    const game = await gameInPlay('variable_isolation', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');
    const targetBoard = firstBoard(game, 'p2');
    targetBoard.isActive = false;
    const events = collectEvents(game);

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'opp_board', id: targetBoard.boardId },
      variable: 'x',
    });

    expect(result).toMatchObject({ ok: true, fizzled: true });
    expect(events).toContainEqual(expect.objectContaining({
      event: 'fizzle',
      actorId: 'p1',
      details: expect.objectContaining({ cardId: 'fcc-calc-derivative-001', reason: 'target_gone' }),
    }));
    expect([...requirePlayer(game, 'p1').hand].map((card) => card?.id)).not.toContain('fcc-calc-derivative-001');
  });

  it('keeps v1 targeting: an opp_board derivative ignores the overlay and hits the own board', async () => {
    const game = await gameInPlay('nerdiclash', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'x',
    });

    // v1 routing never forwards targetBoardId for derivative — the play lands
    // on the attacker's own board like any other self-scope card.
    expect(result.ok).toBe(true);
    expect(snapshotBoardExpr(game, 'p2')).toBe('x^2 + y');
    expect(distinctVariablesInExpression(snapshotBoardExpr(game, 'p1'))).toBe(1);
  });

  it('rejects an opp-board route at the command when the profile does not grant it', async () => {
    // The router only emits targetBoardId under the VI overlay, but a direct
    // dispatch in v1 must still refuse the scope — defense in depth.
    const game = await gameInPlay('nerdiclash', 'x^2 + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');
    const command = new DerivativeCommand();
    command.state = game.state as unknown as CommandState;
    command.roomRef = { profile: MODE_PROFILES.nerdiclash };

    const result = command.execute({
      playerId: 'p1',
      cardId: 'fcc-calc-derivative-001',
      targetBoardId: firstBoard(game, 'p2').boardId,
    });

    expect(result).toEqual({ ok: false, reason: 'derivative cannot target opponent boards in this mode' });
  });

  it('requires ≥2 distinct variables on a VI construction build', async () => {
    const game = new NerdiClashGame('variable_isolation');
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();

    const rejected = await dispatch(game, 'p1', 'build_function', {
      boardId: firstBoard(game, 'p1').boardId,
      expression: 'x',
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/at least 2 distinct variables/);

    const accepted = await dispatch(game, 'p1', 'build_function', {
      boardId: firstBoard(game, 'p1').boardId,
      expression: 'x + y',
    });
    expect(accepted.ok).toBe(true);

    // v1 contrast: a 1-var construction stays legal in nerdiclash.
    const v1 = new NerdiClashGame('nerdiclash');
    v1.addPlayer('p1', 'Player One');
    v1.addPlayer('p2', 'Player Two');
    v1.startGame();
    const v1Build = await dispatch(v1, 'p1', 'build_function', {
      boardId: firstBoard(v1, 'p1').boardId,
      expression: 'x',
    });
    expect(v1Build.ok).toBe(true);
  });

  it('lets a destroyed board be rebuilt in VI but not in v1', async () => {
    const vi = await gameInPlay('variable_isolation', 'x + y', 'x * y');
    const board = firstBoard(vi, 'p1');
    board.isActive = false;
    board.isSingular = true;
    (board as FunctionBoardSchema & { destroyed?: boolean }).destroyed = true;

    const rebuilt = await dispatch(vi, 'p1', 'build_function', {
      boardId: board.boardId,
      expression: 'x * y',
    });
    expect(rebuilt.ok).toBe(true);
    expect(board.isActive).toBe(true);
    expect(board.isSingular).toBe(false);
    expect((board as FunctionBoardSchema & { destroyed?: boolean }).destroyed).toBe(false);
    expect(board.expression).toBe('x * y');

    const v1 = await gameInPlay('nerdiclash', 'x + y', 'x * y');
    const v1Board = firstBoard(v1, 'p1');
    v1Board.isActive = false;
    const denied = await dispatch(v1, 'p1', 'build_function', {
      boardId: v1Board.boardId,
      expression: 'x * y',
    });
    expect(denied).toEqual({ ok: false, reason: 'board is destroyed' });
  });

  it('rejects the Showdown card in VI with a reason, keeping it in hand', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x * y');
    seedHand(game, 'p1', 'act-special-force-eval-001');

    const forced = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-3' });
    expect(forced).toEqual({ ok: false, reason: 'Showdown has no effect in Variable Isolation' });

    const played = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-special-force-eval-001',
      target: { kind: 'none' },
    });
    expect(played).toEqual({ ok: false, reason: 'Showdown has no effect in Variable Isolation' });
    expect([...requirePlayer(game, 'p1').hand].map((card) => card?.id)).toContain('act-special-force-eval-001');
  });

  it('soft_wipes every active board on the §8.5 trigger — no HP, no destruction', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x * y');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 50;
    p2.hp10 = 70;
    // A second live board and a dead one — the wipe hits every ACTIVE board
    // and must leave the dead one untouched.
    const spare = new FunctionBoardSchema();
    spare.boardId = 'p2_board_extra';
    spare.ownerSessionId = 'p2';
    spare.expression = 't + 2';
    spare.domain = 'poly';
    spare.isActive = true;
    p2.boards.push(spare);
    p2.boardCount = p2.boards.length;
    const dead = new FunctionBoardSchema();
    dead.boardId = 'p2_board_dead';
    dead.ownerSessionId = 'p2';
    dead.expression = 'x';
    dead.domain = 'poly';
    dead.isActive = false;
    p2.boards.push(dead);
    p2.boardCount = p2.boards.length;

    const events = collectEvents(game);
    game.phaseController.fsm.state.consecutive_no_eval_turns = 4;

    expect(game.requestEndTurn('p1').ok).toBe(true);

    expect(events).toContainEqual(expect.objectContaining({
      event: 'force_eval',
      actorId: 'p1',
      details: expect.objectContaining({ trigger: 'stalling', counter: 'consecutive' }),
    }));
    expect(firstBoard(game, 'p1').expression).toBe('');
    expect(firstBoard(game, 'p2').expression).toBe('');
    expect(spare.expression).toBe('');
    expect(dead.expression).toBe('x');
    expect(firstBoard(game, 'p1').isActive).toBe(true);
    expect(firstBoard(game, 'p2').isActive).toBe(true);
    expect(p1.hp10).toBe(50);
    expect(p2.hp10).toBe(70);
    expect(game.state.winner).toBe('');
    // The forced eval still counts as an eval: consecutive restarts, global keeps counting.
    expect(game.state.consecutive_no_eval_turns).toBe(0);
    expect(game.state.global_no_eval_turns).toBe(1);
  });

  it('advances the isolation countdown on the deadline auto-pass path (§10.1)', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x + y');
    // As if an attacker's derivative already reduced p2's board mid-turn.
    firstBoard(game, 'p2').expression = 'x';

    expireDeadline(game);
    game.tick(Date.now());

    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
    expect(game.state.variable_isolation_timers.get('p2')).toBe(3);

    // Same fix benefits v1 — the countdown no longer freezes on a timeout.
    const v1 = await gameInPlay('nerdiclash', 'x + y', 'x');
    expireDeadline(v1);
    v1.tick(Date.now());
    expect(v1.state.variable_isolation_timers.get('p2')).toBe(3);
  });

  it('counts a constant-only main board toward the VI kill (≤1), v1 stays exactly-1', async () => {
    const vi = await gameInPlay('variable_isolation', 'x + y', 'x + y');
    firstBoard(vi, 'p2').expression = '5';
    vi.state.variable_isolation_timers.set('p2', 0);

    expect(vi.requestEndTurn('p1').ok).toBe(true);
    expect(vi.state.winner).toBe('p1');
    expect(vi.state.winReason).toBe('variable_isolation');
    expect(vi.state.phase).toBe(Phase.gameOver);

    const v1 = await gameInPlay('nerdiclash', 'x + y', 'x + y');
    firstBoard(v1, 'p2').expression = '5';
    v1.state.variable_isolation_timers.set('p2', 0);

    expect(v1.requestEndTurn('p1').ok).toBe(true);
    expect(v1.state.winner).toBe('');
    expect(v1.state.phase).toBe(Phase.draw);
  });

  it('runs the full isolate → 3-turn countdown → kill loop in VI', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    seedHand(game, 'p1', 'fcc-calc-derivative-001');

    const strike = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001',
      target: { kind: 'opp_board', id: firstBoard(game, 'p2').boardId },
      variable: 'x',
    });
    expect(strike.ok).toBe(true);
    expect(distinctVariablesInExpression(snapshotBoardExpr(game, 'p2'))).toBe(1);

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.variable_isolation_timers.get('p2')).toBe(3);

    await passTurn(game, 'p2');
    expect(game.state.variable_isolation_timers.get('p2')).toBe(2);
    await passTurn(game, 'p1');
    expect(game.state.variable_isolation_timers.get('p2')).toBe(1);
    await passTurn(game, 'p2');
    expect(game.state.variable_isolation_timers.get('p2')).toBe(0);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('variable_isolation');
    expect(game.state.phase).toBe(Phase.gameOver);
  });
});
