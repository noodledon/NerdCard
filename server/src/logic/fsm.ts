/**
 * T11 — pure NerdiClash turn state machine.
 *
 * This module deliberately has no Colyseus dependency. The room keeps a small
 * FSMState mirror and copies the resulting phase/timer/counter values into its
 * schema state at the integration boundary.
 */

import { parseExpression } from '../math/expressions.js';
import { validateByDomain } from '../math/validation.js';
import type { BaseDomain } from '../shared/types.js';

export const Phase = {
  waiting: 'waiting',
  construction: 'construction',
  draw: 'draw',
  play: 'play',
  defense: 'defense',
  resolution: 'resolution',
  gameOver: 'gameOver',
} as const;

export type Phase = (typeof Phase)[keyof typeof Phase];

export const PLAY_MS = 30_000;
export const DEFENSE_MS = 15_000;
export const CONSTRUCTION_MS = 60_000;

export const legalTransitions: Record<Phase, Phase[]> = {
  waiting: [Phase.construction],
  construction: [Phase.draw, Phase.gameOver],
  draw: [Phase.play, Phase.gameOver],
  play: [Phase.defense, Phase.resolution, Phase.gameOver],
  defense: [Phase.resolution, Phase.gameOver],
  resolution: [Phase.draw, Phase.gameOver],
  gameOver: [],
};

export type FSMEvent = 'force-eval' | 'auto-pass' | 'game-over';

export interface FSMState {
  phase: Phase;
  currentTurn: number;
  turnDeadline: number;
  consecutive_no_eval_turns: number;
  global_no_eval_turns: number;
  lastPhaseChangeAt: number;
  /** Construction submissions are intentionally kept outside the schema. */
  buildSubmissions?: Map<string, boolean>;
  /** Optional domain metadata used by submitBuildFunction callers. */
  buildDomains?: Map<string, BaseDomain>;
  /** Defaults to two players for NerdiClash. */
  expectedPlayers?: number;
}

export interface BuildFunctionPayload {
  expression: string;
  domain: BaseDomain;
}

export interface TransitionResult {
  ok: boolean;
  reason?: string;
}

function deadlineFor(phase: Phase, now: number): number {
  switch (phase) {
    case Phase.construction:
      return now + CONSTRUCTION_MS;
    case Phase.play:
      return now + PLAY_MS;
    case Phase.defense:
      return now + DEFENSE_MS;
    default:
      return 0;
  }
}

/** Reset both the current-turn stalling counter and nothing else. */
export function onEvalTurn(state: FSMState): FSMEvent[] {
  state.consecutive_no_eval_turns = 0;
  return [];
}

/** Increment the bounded stalling counters and signal forced evaluation at caps. */
export function onNoEvalTurn(state: FSMState): FSMEvent[] {
  state.consecutive_no_eval_turns = Math.min(
    5,
    Math.max(0, state.consecutive_no_eval_turns + 1),
  );
  state.global_no_eval_turns = Math.min(
    20,
    Math.max(0, state.global_no_eval_turns + 1),
  );

  const events: FSMEvent[] = [];
  if (
    state.consecutive_no_eval_turns === 5 ||
    state.global_no_eval_turns === 20
  ) {
    events.push('force-eval');
  }
  return events;
}

export class PhaseFSM {
  public readonly state: FSMState;

  constructor(state: FSMState) {
    this.state = state;
    this.state.consecutive_no_eval_turns = Math.min(
      5,
      Math.max(0, this.state.consecutive_no_eval_turns),
    );
    this.state.global_no_eval_turns = Math.min(
      20,
      Math.max(0, this.state.global_no_eval_turns),
    );
  }

  requestTransition(target: Phase, now = Date.now()): TransitionResult {
    const allowed = legalTransitions[this.state.phase] ?? [];
    if (!allowed.includes(target)) {
      return {
        ok: false,
        reason: `illegal transition ${this.state.phase}→${target}`,
      };
    }

    const previous = this.state.phase;
    this.state.phase = target;
    this.state.lastPhaseChangeAt = now;
    this.state.turnDeadline = deadlineFor(target, now);

    if (previous === Phase.resolution && target === Phase.draw) {
      this.state.currentTurn += 1;
    }
    if (target === Phase.gameOver) {
      this.state.turnDeadline = 0;
    }

    return { ok: true };
  }

  tick(now: number): FSMEvent[] {
    if (this.state.turnDeadline <= 0 || now < this.state.turnDeadline) {
      return [];
    }

    const events: FSMEvent[] = [];
    switch (this.state.phase) {
      case Phase.play:
      case Phase.defense:
        events.push('auto-pass');
        events.push(...onNoEvalTurn(this.state));
        this.requestTransition(Phase.resolution, now);
        break;
      case Phase.construction:
        events.push('game-over');
        this.requestTransition(Phase.gameOver, now);
        break;
      default:
        this.state.turnDeadline = 0;
        break;
    }
    return events;
  }
}

/**
 * Validate and record one initial function submission. Once all expected
 * players have submitted, construction advances synchronously to draw.
 */
export function submitBuildFunction(
  state: FSMState,
  playerId: string,
  payload: BuildFunctionPayload,
  now = Date.now(),
): TransitionResult {
  if (state.phase !== Phase.construction) {
    return { ok: false, reason: 'build_function is only valid in construction' };
  }

  try {
    const node = parseExpression(payload.expression);
    const validation = validateByDomain(payload.domain, node);
    if (!validation.ok) {
      return {
        ok: false,
        reason: `invalid ${payload.domain} expression: ${validation.reason ?? 'validation failed'}`,
      };
    }
  } catch (error) {
    return { ok: false, reason: `invalid expression: ${String(error)}` };
  }

  const submissions = state.buildSubmissions ?? new Map<string, boolean>();
  state.buildSubmissions = submissions;
  submissions.set(playerId, true);

  const domains = state.buildDomains ?? new Map<string, BaseDomain>();
  state.buildDomains = domains;
  domains.set(playerId, payload.domain);

  const expected = state.expectedPlayers ?? 2;
  if (submissions.size >= expected) {
    return new PhaseFSM(state).requestTransition(Phase.draw, now);
  }
  return { ok: true };
}

/** Convenience constructor for room/controller glue and tests. */
export function createFSMState(now = Date.now()): FSMState {
  return {
    phase: Phase.waiting,
    currentTurn: 0,
    turnDeadline: 0,
    consecutive_no_eval_turns: 0,
    global_no_eval_turns: 0,
    lastPhaseChangeAt: now,
    expectedPlayers: 2,
  };
}
