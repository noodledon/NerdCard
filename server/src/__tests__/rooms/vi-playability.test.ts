import { describe, expect, it } from 'vitest';
import { Phase } from '../../logic/fsm.js';
import type { GameMode } from '../../logic/modes.js';
import { distinctVariablesInExpression } from '../../math/expressions.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { addToHand, FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

/**
 * Wave-13 M5 — Variable Isolation playability pass (docs/game-modes.md §3).
 *
 * End-to-end coverage of the isolation siege as a whole — per-mechanic rules
 * live in variable-isolation.test.ts (M4). Here: the timer only arms once
 * EVERY active board is reduced; each documented escape (§3.2 — Term Surge,
 * Evaluate, Second Foundation, build_function resurrection) breaks the
 * countdown; the kill lands when the defense holds for 3 game-turns; and the
 * §10.1 deadline auto-pass path advances the countdown to the kill (the M4
 * shared fix — previously only requestEndTurn ticked the timers).
 */

function dispatch(game: NerdiClashGame, sessionId: string, intent: string, payload: Record<string, unknown>): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
}

function requirePlayer(game: NerdiClashGame, sessionId: string): PlayerSchema {
  const player = game.getPlayer(sessionId);
  if (!player) throw new Error(`missing player ${sessionId}`);
  return player;
}

function boardAt(game: NerdiClashGame, sessionId: string, index: number): FunctionBoardSchema {
  const board = requirePlayer(game, sessionId).boards[index];
  if (!board) throw new Error(`missing board ${index} for ${sessionId}`);
  return board;
}

function firstBoard(game: NerdiClashGame, sessionId: string): FunctionBoardSchema {
  return boardAt(game, sessionId, 0);
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

/** The open draw step for `sessionId` → play phase. Caller then plays/ends. */
async function drawToPlay(game: NerdiClashGame, sessionId: string): Promise<void> {
  const drawn = await dispatch(game, sessionId, 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  expect(drawn.ok).toBe(true);
  expect(game.state.phase).toBe(Phase.play);
  expect(game.state.currentTurnPlayerId).toBe(sessionId);
}

/** Take `sessionId` through draw → play → end_turn (one full turn, no plays). */
async function passTurn(game: NerdiClashGame, sessionId: string): Promise<void> {
  await drawToPlay(game, sessionId);
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

/** Push an extra LIVE board onto a player (a Second Foundation outcome). */
function addLiveBoard(game: NerdiClashGame, sessionId: string, expression: string): FunctionBoardSchema {
  const player = requirePlayer(game, sessionId);
  const board = new FunctionBoardSchema();
  board.boardId = `${sessionId}_board_extra_${player.boards.length}`;
  board.ownerSessionId = sessionId;
  board.expression = expression;
  board.domain = 'poly';
  board.isActive = true;
  player.boards.push(board);
  player.boardCount = player.boards.length;
  return board;
}

/** Push an extra DESTROYED board onto a player (an Eigen Lance / undefined-eval outcome). */
function addDeadBoard(game: NerdiClashGame, sessionId: string): FunctionBoardSchema {
  const board = addLiveBoard(game, sessionId, 'x');
  board.isActive = false;
  board.isSingular = true;
  (board as FunctionBoardSchema & { destroyed?: boolean }).destroyed = true;
  return board;
}

/** Expire the live play/defense deadline on BOTH mirrors — the tick()
 * intercept reads schema state, the FSM reads its own. */
function expireDeadline(game: NerdiClashGame): void {
  const past = Date.now() - 1;
  game.state.turnDeadline = past;
  game.phaseController.fsm.state.turnDeadline = past;
}

function timerFor(game: NerdiClashGame, sessionId: string): number | undefined {
  return game.state.variable_isolation_timers.get(sessionId);
}

/** p1 strikes `boardId` on p2 with the named FCC, forwarding `variable`. */
async function strike(game: NerdiClashGame, cardId: string, boardId: string, variable: string): Promise<void> {
  seedHand(game, 'p1', cardId);
  const result = await dispatch(game, 'p1', 'play_card', {
    cardId,
    target: { kind: 'opp_board', id: boardId },
    variable,
  });
  expect(result.ok).toBe(true);
}

describe('VI playability — end-to-end isolation siege (wave-13 M5)', () => {
  it('arms the countdown only once EVERY active board is reduced, then kills at 0', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    // Second Foundation gave p2 a second live board — the siege must cover both.
    const extra = addLiveBoard(game, 'p2', 't^2 + s');

    // Strike 1 reduces only the main board — the spare keeps p2 out of the net.
    await strike(game, 'fcc-calc-derivative-001', firstBoard(game, 'p2').boardId, 'x');
    expect(distinctVariablesInExpression(firstBoard(game, 'p2').expression)).toBe(1);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();

    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBeUndefined();

    // Strike 2 (next turn — one aggressive action per turn) reduces the spare.
    await drawToPlay(game, 'p1');
    await strike(game, 'fcc-calc-limit-001', extra.boardId, 't');
    expect(distinctVariablesInExpression(extra.expression)).toBe(1);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBe(3);

    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBe(2);

    // §8.5 pressure on the siege: four consecutive no-eval turns have elapsed,
    // so a fifth would soft_wipe BOTH players' boards — a free escape for p2.
    // The attacker's answer is evaluating their own board (not in p2's net):
    // a real eval resets the shared counter while the countdown keeps ticking.
    expect(game.state.consecutive_no_eval_turns).toBe(4);
    await drawToPlay(game, 'p1');
    seedHand(game, 'p1', 'act-eval-001');
    const evaled = await dispatch(game, 'p1', 'eval_function', {
      boardId: firstBoard(game, 'p1').boardId,
      variableValueCardId: 'vvc-1',
    });
    expect(evaled.ok).toBe(true);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.consecutive_no_eval_turns).toBe(0);
    expect(timerFor(game, 'p2')).toBe(1);

    // Held through the last game-turn → the kill lands.
    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBe(0);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('variable_isolation');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('Term Surge escape: adding a variable breaks the countdown — and the siege can re-arm', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    await strike(game, 'fcc-calc-derivative-001', firstBoard(game, 'p2').boardId, 'x');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBe(3);

    // p2's own turn: Term Surge appends +t → 2 distinct vars → timer clears.
    await drawToPlay(game, 'p2');
    seedHand(game, 'p2', 'fcc-add-term-001');
    const escaped = await dispatch(game, 'p2', 'play_card', {
      cardId: 'fcc-add-term-001',
      target: { kind: 'self_board', id: firstBoard(game, 'p2').boardId },
    });
    expect(escaped.ok).toBe(true);
    expect(distinctVariablesInExpression(firstBoard(game, 'p2').expression)).toBe(2);
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');

    // The escape bought time, not immunity: a second strike re-arms the timer.
    // (The derivative card is spent — the limit card is the second weapon.)
    await drawToPlay(game, 'p1');
    // lim x→0 (2*x + t) = t — 1 var, back inside VI's ≤1 net.
    await strike(game, 'fcc-calc-limit-001', firstBoard(game, 'p2').boardId, 'x');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBe(3);
  });

  it('Evaluate escape: eval wipes the board to an unparseable state and clears the countdown', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    await strike(game, 'fcc-calc-derivative-001', firstBoard(game, 'p2').boardId, 'x');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBe(3);

    // p2 evaluates the reduced board (VVC + Evaluate card consumed): the
    // board stays active at expression='' → unparseable → outside the net.
    await drawToPlay(game, 'p2');
    seedHand(game, 'p2', 'act-eval-001');
    const evaled = await dispatch(game, 'p2', 'eval_function', {
      boardId: firstBoard(game, 'p2').boardId,
      variableValueCardId: 'vvc-1',
    });
    expect(evaled.ok).toBe(true);
    expect(firstBoard(game, 'p2').expression).toBe('');
    // A real eval: the card pair is spent and the turn counts as evaluated.
    expect(requirePlayer(game, 'p2').evaluatedThisTurn).toBe(true);
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');

    // The wiped board is the post-eval rebuild path (§3.1): build_function
    // re-enters it next turn — VI's ≥2-var gate applies here too.
    await passTurn(game, 'p1');
    await drawToPlay(game, 'p2');
    const thin = await dispatch(game, 'p2', 'build_function', {
      boardId: firstBoard(game, 'p2').boardId,
      expression: 'x',
    });
    expect(thin.ok).toBe(false);
    const rebuilt = await dispatch(game, 'p2', 'build_function', {
      boardId: firstBoard(game, 'p2').boardId,
      expression: 'x + y',
    });
    expect(rebuilt.ok).toBe(true);
    expect(firstBoard(game, 'p2').expression).toBe('x + y');
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');
  });

  it('Second Foundation escape: a fresh active board clears the countdown', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    await strike(game, 'fcc-calc-derivative-001', firstBoard(game, 'p2').boardId, 'x');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBe(3);

    // The timer needs EVERY active board ≤1 var — a fresh '' board breaks it.
    await drawToPlay(game, 'p2');
    seedHand(game, 'p2', 'act-special-add-board-001');
    const added = await dispatch(game, 'p2', 'play_card', {
      cardId: 'act-special-add-board-001',
      target: { kind: 'none' },
    });
    expect(added.ok).toBe(true);
    expect(requirePlayer(game, 'p2').boards.length).toBe(2);
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');

    // Balance flag (OQ-8): an unbuilt spare is a PERMANENT immunity slot —
    // '' never parses, so while p2 declines to rebuild it the net can never
    // close again, no matter how often the main board is re-isolated.
    await drawToPlay(game, 'p1');
    await strike(game, 'fcc-calc-limit-001', firstBoard(game, 'p2').boardId, 'x');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();
    await passTurn(game, 'p2');
    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');
  });

  it('build_function escape: resurrecting a destroyed board re-breaks the net', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    const corpse = addDeadBoard(game, 'p2');
    await strike(game, 'fcc-calc-derivative-001', firstBoard(game, 'p2').boardId, 'x');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    // Dead boards are outside the net — the one live board is reduced, so the
    // countdown is already running against p2.
    expect(timerFor(game, 'p2')).toBe(3);

    // OQ-7 resurrection: the rebuild produces a ≥2-var live board → cleared.
    await drawToPlay(game, 'p2');
    const rebuilt = await dispatch(game, 'p2', 'build_function', {
      boardId: corpse.boardId,
      expression: 'x * y',
    });
    expect(rebuilt.ok).toBe(true);
    expect(corpse.isActive).toBe(true);
    expect(corpse.expression).toBe('x * y');
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(timerFor(game, 'p2')).toBeUndefined();
    expect(game.state.winner).toBe('');
  });

  it('advances the countdown to the kill entirely on deadline auto-passes (§10.1)', async () => {
    const game = await gameInPlay('variable_isolation', 'x + y', 'x^2 + y');
    // As if an attacker's derivative already reduced p2's board mid-turn.
    firstBoard(game, 'p2').expression = 'x';

    // Four timed-out play phases: arm (3) → 2 → 1 → 0 → kill. Each auto-pass
    // must tick the timer exactly like requestEndTurn — the M4 shared fix.
    for (const [turnOwner, expected] of [['p1', 3], ['p2', 2], ['p1', 1]] as const) {
      expect(game.state.currentTurnPlayerId).toBe(turnOwner);
      expireDeadline(game);
      game.tick(Date.now());
      expect(game.state.phase).toBe(Phase.draw);
      expect(timerFor(game, 'p2')).toBe(expected);
      if (expected > 0) {
        const next = turnOwner === 'p1' ? 'p2' : 'p1';
        expect(game.state.currentTurnPlayerId).toBe(next);
        await drawToPlay(game, next);
      }
    }

    // Final timed-out turn: timer 1→0 inside tick, and the same tick's
    // runCheckWin lands the kill — before this fix the countdown froze here.
    expect(game.state.currentTurnPlayerId).toBe('p2');
    expireDeadline(game);
    game.tick(Date.now());
    expect(timerFor(game, 'p2')).toBe(0);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('variable_isolation');
    expect(game.state.phase).toBe(Phase.gameOver);
  });
});
