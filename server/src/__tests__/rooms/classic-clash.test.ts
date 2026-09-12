import { describe, expect, it } from 'vitest';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { MODE_PROFILES, type GameMode } from '../../logic/modes.js';
import { FunctionBoardSchema, addToHand, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

/**
 * Wave-13 M2 — Classic Clash ("v1 with the isolation path off", doc §4.1).
 * Per-win-path gating through the real game object: the isolation countdown
 * never runs in a CC game and an expired timer cannot kill, while the hp_zero,
 * force_eval_domination and board-wipe paths all still land. The closing
 * describe pins the v1 regression — a 'nerdiclash'-profile game reproduces the
 * shipped countdown→kill sequence on identical board shapes.
 *
 * Wire-level coverage (snapshots, game_over frames) lives in
 * json-bridge.test.ts's 'classic clash' describe.
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
  await dispatch(game, 'p1', 'build_function', { boardId: firstBoard(game, 'p1').boardId, expression: p1Expression });
  await dispatch(game, 'p2', 'build_function', { boardId: firstBoard(game, 'p2').boardId, expression: p2Expression });
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

describe('classic clash mode (wave-13 M2)', () => {
  it('never starts the isolation countdown, even with every board reduced', async () => {
    // 'x' vs 'x' — the exact shape that starts both countdowns in v1. Three
    // no-eval turns stay safely under the §8.5 consecutive cap of 5.
    const game = await gameInPlay('classic_clash', 'x', 'x');

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.variable_isolation_timers.size).toBe(0);

    await passTurn(game, 'p2');
    expect(game.state.variable_isolation_timers.size).toBe(0);

    await passTurn(game, 'p1');
    expect(game.state.variable_isolation_timers.size).toBe(0);
    expect(game.state.winner).toBe('');
    expect(game.getStateSnapshot().variable_isolation_timers).toEqual({});
  });

  it('lets an isolated opponent survive a forced timer-0 — the kill branch is off', async () => {
    const game = await gameInPlay('classic_clash', 'x+y', 'x');

    // Adversarial state: even a live, expired timer cannot kill in CC — the
    // isolation branch of checkWin is profile-gated before it ever reads it.
    game.state.variable_isolation_timers.set('p2', 0);

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.winner).toBe('');
    // The turn resolved normally — p2's draw, game continues.
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');

    await passTurn(game, 'p2');
    expect(game.state.winner).toBe('');
    expect(game.state.phase).not.toBe(Phase.gameOver);
  });

  it('still lands the hp_zero win', async () => {
    const game = await gameInPlay('classic_clash', 'x+y', 'x*y');
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 0;
    p2.everGainedHP = true;

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('hp_zero');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('still lands force_eval_domination — the Showdown card stays live (OQ-9)', async () => {
    // vvc-4 (=10): 'x*y + x' → 110 strictly dominates 'x - y' → 0.
    const game = await gameInPlay('classic_clash', 'x*y + x', 'x - y');
    seedHand(game, 'p1', 'act-special-force-eval-001');

    const result = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(result.ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('force_eval_domination');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('still lands the board-wipe win (all boards dead → singular_board)', async () => {
    const game = await gameInPlay('classic_clash', 'x+y', 'x*y');
    firstBoard(game, 'p2').isActive = false;

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('singular_board');
    expect(game.state.phase).toBe(Phase.gameOver);
  });
});

describe('v1 regression — nerdiclash keeps shipped semantics (wave-13 M2)', () => {
  it('resolves the same profile whether the mode is explicit or defaulted', () => {
    expect(new NerdiClashGame().profile).toBe(MODE_PROFILES.nerdiclash);
    expect(new NerdiClashGame('nerdiclash').profile).toBe(MODE_PROFILES.nerdiclash);
  });

  it('still runs the full 3→0 isolation countdown into a variable_isolation win', async () => {
    // The shipped v1 sequence, unchanged: the reduced player is isolated the
    // turn their own countdown hits 0.
    const game = await gameInPlay('nerdiclash', 'x+y', '3*x');

    game.requestEndTurn('p1');
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

  it('still kills on a timer-0 state that Classic Clash survives', async () => {
    // Same forced state as the CC survival test — mode is the only difference.
    const game = await gameInPlay('nerdiclash', 'x+y', 'x');
    game.state.variable_isolation_timers.set('p2', 0);

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('variable_isolation');
  });
});
