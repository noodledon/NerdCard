import { distinctVariablesInExpression } from '../math/expressions.js';
import type { ModeProfile } from './modes.js';

export type WinReason = 'hp0' | 'isolation' | 'force-dom' | 'singular' | 'dim0';

export interface WinBoard {
  destroyed?: boolean;
  isActive?: boolean;
  isSingular?: boolean;
  dimension?: number;
}

export interface WinPlayer {
  id: string;
  hp10: number;
  everGainedHP?: boolean;
  mainBoardExpr?: string;
  boards?: WinBoard[];
}

export interface WinState {
  players: Iterable<WinPlayer>;
  variableIsolationTimers?: Map<string, number> | Record<string, number>;
}

export interface WinResult {
  winner?: string;
  loser?: string;
  reason?: WinReason;
  destroyedPlayerBoards: string[];
}

function timerFor(state: WinState, playerId: string): number | undefined {
  const timers = state.variableIsolationTimers;
  if (!timers) return undefined;
  return timers instanceof Map ? timers.get(playerId) : timers[playerId];
}

function opponentId(players: WinPlayer[], loserId: string): string | undefined {
  return players.find((player) => player.id !== loserId)?.id;
}

/**
 * Win adjudication. `profile.win` gates each branch independently — a mode
 * with a path switched off never emits its reason (e.g. Classic Clash has
 * `isolation: false`, so an expired timer can't kill). The force-domination
 * path is NOT here — runForceEval adjudicates it and reads
 * `profile.win.forceDomination` at the declaration site.
 */
export function checkWin(state: WinState, profile: ModeProfile): WinResult {
  const players = [...state.players];
  const base: WinResult = { destroyedPlayerBoards: [] };

  if (profile.win.hpZero) {
    for (const player of players) {
      if (player.everGainedHP === true && player.hp10 <= 0) {
        return { ...base, winner: opponentId(players, player.id), loser: player.id, reason: 'hp0' };
      }
    }
  }

  if (profile.win.isolation) {
    for (const player of players) {
      // Kill predicate: the main board's distinct-variable count must land in
      // [isolationMinVars, isolationMaxVars]. v1's 1..1 reproduces the shipped
      // isIsolatedExpression (exactly-1) check; VI's 0..1 also lets a
      // constant-only board die — more isolated, not less (doc §3.4 / OQ-4).
      const vars = distinctVariablesInExpression(player.mainBoardExpr);
      if (
        vars !== undefined
        && vars >= profile.isolationMinVars
        && vars <= profile.isolationMaxVars
        && timerFor(state, player.id) === 0
      ) {
        return { ...base, winner: opponentId(players, player.id), loser: player.id, reason: 'isolation' };
      }
    }
  }

  if (profile.win.boardWipe) {
    for (const player of players) {
      const boards = player.boards ?? [];
      const destroyed = boards.filter(
        (board) => board.destroyed === true || board.isActive === false || board.isSingular === true || board.dimension === 0,
      );
      if (destroyed.length === 0) continue;
      base.destroyedPlayerBoards.push(player.id);
      const surviving = boards.filter((board) => !destroyed.includes(board));
      if (boards.length > 0 && surviving.length === 0) {
        const singular = destroyed.some((board) => board.isSingular === true);
        return {
          ...base,
          winner: opponentId(players, player.id),
          loser: player.id,
          reason: singular ? 'singular' : 'dim0',
        };
      }
    }
  }

  return base;
}
