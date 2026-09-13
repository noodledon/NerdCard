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
 * ('nerdiclash') keeps the shipped semantics except the two W14 fidelity
 * corrections (§10.1 undefined-eval loss armed; §10.3 isolationMinVars 0
 * so the kill and countdown share the ≤1 predicate).
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
   * declaration sites read forceDomination (runForceEval's domination) and
   * undefinedIntegralLoss (§10.1 eval-undefined-on-last-board — the
   * failed-domination penalty path is NOT gated — HP still moves).
   */
  win: {
    hpZero: boolean;
    isolation: boolean;
    forceDomination: boolean;
    boardWipe: boolean;
    /**
     * Rulebook §10.1 — an undefined/infinite eval that destroys the
     * player's last live board is an immediate loss
     * ('undefined_integral_loss'). Off in Variable Isolation: isolation is
     * the only win path there, so an eval-mishap board is merely dead, not
     * fatal (doc §3/OQ-12).
     */
    undefinedIntegralLoss: boolean;
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
   * [isolationMinVars, isolationMaxVars] at timer 0. Every shipped profile
   * uses 0 so the kill shares the countdown's ≤1 semantics (W14 §10.3:
   * v1's old 1..1 band let constant-only boards stall the win forever —
   * a board reduced to a constant is MORE isolated, not less, doc §3.4 /
   * OQ-4). A nonzero value would restore a stricter band for a future mode.
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
   * §8.5 endgame resolution — what a stalling trigger does once
   * `global_no_eval_turns` sits at its cap (STALLING_GLOBAL_LIMIT). The
   * consecutive cap and every sub-cap trip keep the per-trip `stallingEval`;
   * this field only governs the never-resetting global cap, where a
   * non-terminal answer fires every turn forever (wave-14 T2 / OQ-8: VI's
   * every-turn soft_wipe left no win path — an unterminable limbo).
   *
   * - 'soft_wipe': no terminal resolution — the mode's `stallingEval` keeps
   *   running on each tripped turn (v1 default: v1 modes need none because
   *   their standard showdown is already decisive — a failed nomination
   *   keeps costing boards and hp0/domination/board-wipe still end the
   *   match).
   * - 'showdown': run the standard force-eval showdown (evaluate both mains
   *   at vvc=1, domination/penalty outcome). Does not by itself guarantee
   *   termination — a mode with `win.forceDomination` off never declares
   *   the domination branch, so a failed nomination just costs a board.
   * - 'draw': declare the match a draw once — game over, no winner,
   *   winReason 'stalled'.
   */
  stallingResolution: 'soft_wipe' | 'showdown' | 'draw';
  /**
   * Cards allowed to target opp_board beyond their v1 scope (mode overlay —
   * catalog targetRules stay frozen). Keyed by cardType. Consumed by the VI
   * rules task; empty maps mean v1 targeting.
   */
  offensiveTargeting: Readonly<Record<string, 'opp_board'>>;
}

export const MODE_PROFILES: Record<GameMode, ModeProfile> = {
  // v1 — all shipped win paths live, 3-turn isolation countdown, standard
  // §8.5 showdown, v1 card targeting. W14 fidelity: isolationMinVars 0 so
  // the kill matches the countdown's ≤1 semantics (§10.3), and the §10.1
  // undefined-eval loss is armed — the two deliberate departures from the
  // pre-fidelity shipped semantics.
  nerdiclash: {
    win: { hpZero: true, isolation: true, forceDomination: true, boardWipe: true, undefinedIntegralLoss: true },
    isolationMaxVars: 1,
    isolationMinVars: 0,
    isolationRebuildTurns: 3,
    constructionMinVars: 0,
    rebuildDestroyedBoards: false,
    forceEvalCard: true,
    stallingEval: 'standard',
    stallingResolution: 'soft_wipe',
    offensiveTargeting: {},
  },
  // Doc §3 — "win only by isolating opponent's variables". HP stays live but
  // non-decisive (OQ-2); Showdown is a dead card (OQ-10); §8.5 soft-wipes
  // instead of destroying the staller's board so they stay isolatable
  // (§3.3/OQ-11); derivative/limit gain the opp_board arsenal overlay (OQ-3);
  // an undefined eval still destroys its board but cannot win (OQ-12).
  // W14 T2: past the global stalling cap the match draws — a showdown could
  // not end it (domination is gated off; a failed nomination only leaves the
  // nominator un-isolatable), so 'draw' is the resolution that guarantees no
  // unterminable limbo while keeping isolation the only way to WIN.
  variable_isolation: {
    win: { hpZero: false, isolation: true, forceDomination: false, boardWipe: false, undefinedIntegralLoss: false },
    isolationMaxVars: 1,
    isolationMinVars: 0,
    isolationRebuildTurns: 3,
    constructionMinVars: 2,
    rebuildDestroyedBoards: true,
    forceEvalCard: false,
    stallingEval: 'soft_wipe',
    stallingResolution: 'draw',
    offensiveTargeting: { derivative: 'opp_board', limit: 'opp_board' },
  },
  // Doc §4 — "pure HP attack mode". Isolation off; force-dom and board-wipe
  // stay on per OQ-9 (disabling them dead-cards Showdown / creates zombie
  // states); the §10.1 undefined-eval loss stays on with them; everything
  // else unchanged from v1 (isolationMinVars is dormant while the path is
  // off but shares the corrected ≤1 semantics).
  classic_clash: {
    win: { hpZero: true, isolation: false, forceDomination: true, boardWipe: true, undefinedIntegralLoss: true },
    isolationMaxVars: 1,
    isolationMinVars: 0,
    isolationRebuildTurns: 3,
    constructionMinVars: 0,
    rebuildDestroyedBoards: false,
    forceEvalCard: true,
    stallingEval: 'standard',
    stallingResolution: 'soft_wipe',
    offensiveTargeting: {},
  },
};
