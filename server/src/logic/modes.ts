/**
 * Wave-13 M1 — game-mode plumbing.
 *
 * A mode is rules configuration, not a subclass: one GameRoomState schema,
 * one FSM, one command set — mode = data. `GameMode` names the mode on the
 * wire (`join_room.mode`, `joined.mode`, snapshot `mode`, `room_list` rows);
 * `ModeProfile` is the per-mode rules overlay the game resolves once at
 * construction; `MODE_PROFILES` holds the frozen v1 defaults.
 *
 * Profile values are the recommendations of docs/game-modes.md — v1
 * ('nerdiclash') keeps every shipped semantic so existing behavior is
 * byte-identical under the default mode.
 */

export const GAME_MODES = ['nerdiclash', 'variable_isolation', 'classic_clash'] as const;

export type GameMode = (typeof GAME_MODES)[number];

/** Mode assigned when `join_room.mode` is missing or empty — v1 rooms. */
export const DEFAULT_MODE: GameMode = 'nerdiclash';

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === 'string' && (GAME_MODES as readonly string[]).includes(value);
}

export interface ModeProfile {
  /**
   * Per-win-path switches. checkWin reads hpZero/isolation/boardWipe;
   * runForceEval's domination → declareWinner reads forceDomination (the
   * failed-domination penalty path is NOT gated — HP still moves).
   */
  win: {
    hpZero: boolean;
    isolation: boolean;
    forceDomination: boolean;
    boardWipe: boolean;
  };
  /**
   * Isolation predicate bound: 1 = v1's reduced-board semantic (a board
   * counts toward isolation at ≤1 distinct variable). The countdown timer
   * keys off this bound only.
   */
  isolationMaxVars: number;
  /**
   * Kill-side lower bound on the main board's distinct-variable count —
   * checkWin's isolation branch fires when the count lands in
   * [isolationMinVars, isolationMaxVars] at timer 0. v1's 1 keeps the
   * shipped exactly-1 semantic (isIsolatedExpression); VI's 0 also counts
   * constant boards — a board reduced to a constant is MORE isolated, not
   * less (doc §3.4 / OQ-4).
   */
  isolationMinVars: number;
  /** Turns an isolated player gets to rebuild (v1: 3, counted in game-turns). */
  isolationRebuildTurns: number;
  /**
   * Minimum distinct variables a build_function expression must contain
   * (OQ-6 — VI: 2, so nobody constructs or rebuilds straight into the
   * isolation net; 0 = no gate beyond domain validity).
   */
  constructionMinVars: number;
  /**
   * Whether build_function may resurrect a destroyed board (OQ-7 — VI needs
   * it because boardWipe is off: without re-entry a zero-board player can
   * never be isolated; v1 keeps destroyed = permanent).
   */
  rebuildDestroyedBoards: boolean;
  /** Whether the Showdown card is playable (its domination win aside). */
  forceEvalCard: boolean;
  /** Behavior of the §8.5 auto showdown: 'standard' | 'soft_wipe'. */
  stallingEval: 'standard' | 'soft_wipe';
  /**
   * Cards allowed to target opp_board beyond their v1 scope (mode overlay —
   * catalog targetRules stay frozen). Keyed by cardType. Consumed by the VI
   * rules task; empty maps mean v1 targeting.
   */
  offensiveTargeting: Readonly<Record<string, 'opp_board'>>;
}

export const MODE_PROFILES: Record<GameMode, ModeProfile> = {
  // v1 — all four shipped win paths live, 3-turn isolation countdown,
  // standard §8.5 showdown, v1 card targeting. Byte-identical behavior.
  nerdiclash: {
    win: { hpZero: true, isolation: true, forceDomination: true, boardWipe: true },
    isolationMaxVars: 1,
    isolationMinVars: 1,
    isolationRebuildTurns: 3,
    constructionMinVars: 0,
    rebuildDestroyedBoards: false,
    forceEvalCard: true,
    stallingEval: 'standard',
    offensiveTargeting: {},
  },
  // Doc §3 — "win only by isolating opponent's variables". HP stays live but
  // non-decisive (OQ-2); Showdown is a dead card (OQ-10); §8.5 soft-wipes
  // instead of destroying the staller's board so they stay isolatable
  // (§3.3/OQ-11); derivative/limit gain the opp_board arsenal overlay (OQ-3).
  variable_isolation: {
    win: { hpZero: false, isolation: true, forceDomination: false, boardWipe: false },
    isolationMaxVars: 1,
    isolationMinVars: 0,
    isolationRebuildTurns: 3,
    constructionMinVars: 2,
    rebuildDestroyedBoards: true,
    forceEvalCard: false,
    stallingEval: 'soft_wipe',
    offensiveTargeting: { derivative: 'opp_board', limit: 'opp_board' },
  },
  // Doc §4 — "pure HP attack mode". Isolation off; force-dom and board-wipe
  // stay on per OQ-9 (disabling them dead-cards Showdown / creates zombie
  // states); everything else unchanged from v1.
  classic_clash: {
    win: { hpZero: true, isolation: false, forceDomination: true, boardWipe: true },
    isolationMaxVars: 1,
    isolationMinVars: 1,
    isolationRebuildTurns: 3,
    constructionMinVars: 0,
    rebuildDestroyedBoards: false,
    forceEvalCard: true,
    stallingEval: 'standard',
    offensiveTargeting: {},
  },
};
