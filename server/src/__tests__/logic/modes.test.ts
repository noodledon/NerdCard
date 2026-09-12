import { describe, expect, it } from 'vitest';
import { checkWin } from '../../logic/winEngine.js';
import { DEFAULT_MODE, GAME_MODES, MODE_PROFILES, isGameMode, type GameMode } from '../../logic/modes.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { addToHand, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

/**
 * Wave-13 M1 — game-mode plumbing unit tests. Covers the MODE_PROFILES
 * shape, isGameMode validation, checkWin's per-path win.* gating, and the
 * two NerdiClashGame-level gates that read the profile (isolation timers
 * and force-eval domination). The wire-level half (join_room.mode,
 * MODE_MISMATCH, joined/snapshot/room_list echo, rematch inheritance) lives
 * in json-bridge.test.ts's 'game modes' describe.
 */

const V1 = MODE_PROFILES.nerdiclash;
const VI = MODE_PROFILES.variable_isolation;
const CC = MODE_PROFILES.classic_clash;

function dispatch(game: NerdiClashGame, sessionId: string, intent: string, payload: Record<string, unknown>): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
}

function requirePlayer(game: NerdiClashGame, sessionId: string): PlayerSchema {
  const player = game.getPlayer(sessionId);
  if (!player) throw new Error(`missing player ${sessionId}`);
  return player;
}

function firstBoardId(game: NerdiClashGame, sessionId: string): string {
  const board = requirePlayer(game, sessionId).boards[0];
  if (!board) throw new Error(`missing board for ${sessionId}`);
  return board.boardId;
}

/** Drive a fresh game of `mode` through construction + draw into play (p1's turn). */
async function gameInPlay(mode: GameMode, p1Expression: string, p2Expression: string): Promise<NerdiClashGame> {
  const game = new NerdiClashGame(mode);
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.startGame();
  await dispatch(game, 'p1', 'build_function', { boardId: firstBoardId(game, 'p1'), expression: p1Expression });
  await dispatch(game, 'p2', 'build_function', { boardId: firstBoardId(game, 'p2'), expression: p2Expression });
  await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  if (game.state.phase !== Phase.play) throw new Error(`expected play phase, got ${game.state.phase}`);
  return game;
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

describe('mode profiles', () => {
  it('defines a profile for every GameMode and defaults to nerdiclash', () => {
    expect(DEFAULT_MODE).toBe('nerdiclash');
    for (const mode of GAME_MODES) {
      expect(MODE_PROFILES[mode], `profile for ${mode}`).toBeDefined();
    }
    expect(new NerdiClashGame().state.config.mode).toBe('nerdiclash');
    expect(new NerdiClashGame().profile).toBe(MODE_PROFILES.nerdiclash);
  });

  it('isGameMode accepts only the three wire modes', () => {
    for (const mode of GAME_MODES) {
      expect(isGameMode(mode)).toBe(true);
    }
    for (const junk of ['', 'deathmatch', 'NERDICLASH', 42, null, undefined, {}]) {
      expect(isGameMode(junk)).toBe(false);
    }
  });

  it('keeps v1 nerdiclash as the all-paths-on profile', () => {
    expect(V1.win).toEqual({ hpZero: true, isolation: true, forceDomination: true, boardWipe: true });
    expect(V1.isolationMaxVars).toBe(1);
    expect(V1.isolationRebuildTurns).toBe(3);
    expect(V1.forceEvalCard).toBe(true);
    expect(V1.stallingEval).toBe('standard');
    expect(V1.offensiveTargeting).toEqual({});
  });
});

describe('checkWin profile gating', () => {
  const hp0State = {
    players: [
      { id: 'A', hp10: 0, everGainedHP: true },
      { id: 'B', hp10: 300, everGainedHP: true },
    ],
  };
  const isolationState = {
    players: [
      { id: 'A', hp10: 100, mainBoardExpr: 'x' },
      { id: 'B', hp10: 100, mainBoardExpr: 'x+y' },
    ],
    variableIsolationTimers: new Map([['A', 0]]),
  };
  const wipeState = {
    players: [
      { id: 'A', hp10: 100, boards: [{ isActive: false }] },
      { id: 'B', hp10: 100, boards: [{ isActive: true }] },
    ],
  };

  it('suppresses the hp_zero branch when profile.win.hpZero is off (VI)', () => {
    expect(checkWin(hp0State, VI).winner).toBeUndefined();
    expect(checkWin(hp0State, V1)).toMatchObject({ winner: 'B', reason: 'hp0' });
    expect(checkWin(hp0State, CC)).toMatchObject({ winner: 'B', reason: 'hp0' });
  });

  it('suppresses the isolation branch when profile.win.isolation is off (CC)', () => {
    expect(checkWin(isolationState, CC).winner).toBeUndefined();
    expect(checkWin(isolationState, V1)).toMatchObject({ winner: 'B', reason: 'isolation' });
    expect(checkWin(isolationState, VI)).toMatchObject({ winner: 'B', reason: 'isolation' });
  });

  it('suppresses the board-wipe branch when profile.win.boardWipe is off (VI)', () => {
    const wiped = checkWin(wipeState, VI);
    expect(wiped.winner).toBeUndefined();
    expect(wiped.destroyedPlayerBoards).toEqual([]);
    expect(checkWin(wipeState, V1).winner).toBe('B');
    expect(checkWin(wipeState, CC).winner).toBe('B');
  });
});

describe('NerdiClashGame profile gating', () => {
  it('writes the mode onto state.config and resolves its profile', () => {
    const cc = new NerdiClashGame('classic_clash');
    expect(cc.state.config.mode).toBe('classic_clash');
    expect(cc.profile).toBe(MODE_PROFILES.classic_clash);
    expect(cc.getStateSnapshot().mode).toBe('classic_clash');
  });

  it('never starts the isolation countdown in Classic Clash', async () => {
    const cc = await gameInPlay('classic_clash', 'x+y', 'x');
    expect(cc.requestEndTurn('p1').ok).toBe(true);
    expect(cc.state.variable_isolation_timers.get('p2')).toBeUndefined();
    expect(cc.state.variable_isolation_timers.size).toBe(0);

    // Contrast on the same board shapes: VI still runs the countdown.
    const vi = await gameInPlay('variable_isolation', 'x+y', 'x');
    expect(vi.requestEndTurn('p1').ok).toBe(true);
    expect(vi.state.variable_isolation_timers.get('p2')).toBe(3);
  });

  it('does not declare a force_eval_domination winner in Variable Isolation', async () => {
    // vvc-4 (=10): 'x*y + x' → 110 strictly dominates 'x - y' → 0 — a
    // domination result the profile must refuse to convert into a win.
    const vi = await gameInPlay('variable_isolation', 'x*y + x', 'x - y');
    seedHand(vi, 'p1', 'act-special-force-eval-001');

    const result = await dispatch(vi, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(result.ok).toBe(true);
    expect(vi.state.winner).toBe('');
    expect(vi.state.phase).not.toBe(Phase.gameOver);

    // Same showdown in v1 still lands the domination win.
    const nc = await gameInPlay('nerdiclash', 'x*y + x', 'x - y');
    seedHand(nc, 'p1', 'act-special-force-eval-001');
    const v1Result = await dispatch(nc, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(v1Result.ok).toBe(true);
    expect(nc.state.winner).toBe('p1');
    expect(nc.state.winReason).toBe('force_eval_domination');
  });

  it('does not lose on hp0 in Variable Isolation, still loses in Classic Clash', async () => {
    const vi = await gameInPlay('variable_isolation', 'x+y', 'x*y');
    const viP2 = requirePlayer(vi, 'p2');
    viP2.hp10 = 0;
    viP2.everGainedHP = true;
    expect(vi.requestEndTurn('p1').ok).toBe(true);
    expect(vi.state.winner).toBe('');

    const cc = await gameInPlay('classic_clash', 'x+y', 'x*y');
    const ccP2 = requirePlayer(cc, 'p2');
    ccP2.hp10 = 0;
    ccP2.everGainedHP = true;
    expect(cc.requestEndTurn('p1').ok).toBe(true);
    expect(cc.state.winner).toBe('p1');
    expect(cc.state.winReason).toBe('hp_zero');
  });
});
