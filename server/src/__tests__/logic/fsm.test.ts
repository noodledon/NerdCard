import { describe, expect, it } from 'vitest';
import {
  CONSTRUCTION_MS,
  createFSMState,
  DEFENSE_MS,
  legalTransitions,
  onEvalTurn,
  onNoEvalTurn,
  Phase,
  PhaseFSM,
  PLAY_MS,
  submitBuildFunction,
  type FSMState,
} from '../../logic/fsm.js';

const ALL_PHASES = Object.values(Phase);

function fsmIn(phase: Phase, now = 1_000_000): { fsm: PhaseFSM; state: FSMState } {
  const state = createFSMState(now);
  state.phase = phase;
  return { fsm: new PhaseFSM(state), state };
}

describe('legalTransitions matrix', () => {
  it('accepts every enumerated transition and stamps the deadline', () => {
    for (const [from, targets] of Object.entries(legalTransitions) as Array<[Phase, Phase[]]>) {
      for (const target of targets) {
        const now = 2_000_000;
        const { fsm, state } = fsmIn(from, now);
        const result = fsm.requestTransition(target, now);
        expect(result, `${from}→${target}`).toEqual({ ok: true });
        expect(state.phase).toBe(target);
        expect(state.lastPhaseChangeAt).toBe(now);
      }
    }
  });

  it('rejects every non-enumerated transition without mutating state', () => {
    for (const from of ALL_PHASES) {
      const legal = new Set(legalTransitions[from]);
      for (const target of ALL_PHASES) {
        if (legal.has(target)) continue;
        const { fsm, state } = fsmIn(from);
        state.turnDeadline = 123_456;
        const result = fsm.requestTransition(target, 9_000_000);
        expect(result.ok, `${from}→${target}`).toBe(false);
        expect(result.reason).toBe(`illegal transition ${from}→${target}`);
        expect(state.phase).toBe(from);
        expect(state.turnDeadline).toBe(123_456);
        expect(state.lastPhaseChangeAt).not.toBe(9_000_000);
      }
    }
  });

  it('pins the load-bearing rejections the game relies on', () => {
    // resolution→defense must stay illegal: the play-deadline intercept in
    // NerdiClashGame.tick exists only because the FSM cannot jump
    // resolution→defense after an auto-pass.
    expect(fsmIn(Phase.resolution).fsm.requestTransition(Phase.defense).ok).toBe(false);
    // gameOver is terminal — no outgoing edges at all.
    expect(legalTransitions[Phase.gameOver]).toEqual([]);
    for (const target of ALL_PHASES) {
      expect(fsmIn(Phase.gameOver).fsm.requestTransition(target).ok).toBe(false);
    }
    // No skipping construction or the draw step.
    expect(fsmIn(Phase.waiting).fsm.requestTransition(Phase.play).ok).toBe(false);
    expect(fsmIn(Phase.waiting).fsm.requestTransition(Phase.draw).ok).toBe(false);
    expect(fsmIn(Phase.construction).fsm.requestTransition(Phase.play).ok).toBe(false);
    expect(fsmIn(Phase.draw).fsm.requestTransition(Phase.resolution).ok).toBe(false);
    // No going backwards.
    expect(fsmIn(Phase.play).fsm.requestTransition(Phase.draw).ok).toBe(false);
    expect(fsmIn(Phase.defense).fsm.requestTransition(Phase.play).ok).toBe(false);
  });
});

describe('phase deadlines', () => {
  it('exports the documented constants', () => {
    expect(PLAY_MS).toBe(30_000);
    expect(DEFENSE_MS).toBe(15_000);
    expect(CONSTRUCTION_MS).toBe(60_000);
  });

  it.each([
    [Phase.waiting, Phase.construction, CONSTRUCTION_MS],
    [Phase.draw, Phase.play, PLAY_MS],
    [Phase.play, Phase.defense, DEFENSE_MS],
  ] as Array<[Phase, Phase, number]>)('%s→%s sets turnDeadline = now + %s', (from, target, expectedMs) => {
    const now = 5_000_000;
    const { fsm, state } = fsmIn(from);
    expect(fsm.requestTransition(target, now).ok).toBe(true);
    expect(state.turnDeadline).toBe(now + expectedMs);
  });

  it('clears the deadline entering untimed phases and gameOver', () => {
    const now = 5_000_000;
    const { fsm, state } = fsmIn(Phase.defense);
    expect(fsm.requestTransition(Phase.resolution, now).ok).toBe(true);
    expect(state.turnDeadline).toBe(0);
    expect(fsm.requestTransition(Phase.draw, now).ok).toBe(true);
    expect(state.turnDeadline).toBe(0);

    const over = fsmIn(Phase.play);
    expect(over.fsm.requestTransition(Phase.gameOver, now).ok).toBe(true);
    expect(over.state.turnDeadline).toBe(0);
  });
});

describe('turn counter', () => {
  it('increments only on resolution→draw', () => {
    const { fsm, state } = fsmIn(Phase.waiting);
    expect(fsm.requestTransition(Phase.construction).ok).toBe(true);
    expect(fsm.requestTransition(Phase.draw).ok).toBe(true);
    expect(state.currentTurn).toBe(0); // construction→draw does not count a turn
    expect(fsm.requestTransition(Phase.play).ok).toBe(true);
    expect(fsm.requestTransition(Phase.resolution).ok).toBe(true);
    expect(state.currentTurn).toBe(0);
    expect(fsm.requestTransition(Phase.draw).ok).toBe(true);
    expect(state.currentTurn).toBe(1);
    expect(fsm.requestTransition(Phase.play).ok).toBe(true);
    expect(fsm.requestTransition(Phase.defense).ok).toBe(true);
    expect(fsm.requestTransition(Phase.resolution).ok).toBe(true);
    expect(fsm.requestTransition(Phase.draw).ok).toBe(true);
    expect(state.currentTurn).toBe(2);
  });
});

describe('submitBuildFunction both-submitted gate', () => {
  const build = (state: FSMState, playerId: string, expression = 'x^2') =>
    submitBuildFunction(state, playerId, { expression, domain: 'poly' });

  it('rejects outside construction', () => {
    const { state } = fsmIn(Phase.play);
    expect(build(state, 'p1')).toEqual({
      ok: false,
      reason: 'build_function is only valid in construction',
    });
  });

  it('rejects an unparseable expression without recording a submission', () => {
    const { state } = fsmIn(Phase.construction);
    const result = build(state, 'p1', 'x +*');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^invalid expression/);
    expect(state.buildSubmissions?.size ?? 0).toBe(0);
    expect(state.phase).toBe(Phase.construction);
  });

  it('rejects a domain-invalid expression', () => {
    const { state } = fsmIn(Phase.construction);
    // poly caps degree at 5 per variable — x^6 is a domain violation, not a parse error.
    const result = build(state, 'p1', 'x^6');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^invalid poly expression/);
    expect(state.phase).toBe(Phase.construction);
  });

  it('stays in construction until every expected player submits', () => {
    const now = 7_000_000;
    const { state } = fsmIn(Phase.construction);

    expect(build(state, 'p1')).toEqual({ ok: true });
    expect(state.phase).toBe(Phase.construction);
    expect(state.buildSubmissions?.get('p1')).toBe(true);
    expect(state.buildDomains?.get('p1')).toBe('poly');

    expect(submitBuildFunction(state, 'p2', { expression: 'x + 1', domain: 'poly' }, now)).toEqual({ ok: true });
    expect(state.phase).toBe(Phase.draw);
    expect(state.turnDeadline).toBe(0); // draw is untimed
    expect(state.lastPhaseChangeAt).toBe(now);
  });

  it('honors expectedPlayers when the room seats differ from two', () => {
    const { state } = fsmIn(Phase.construction);
    state.expectedPlayers = 3;
    expect(build(state, 'p1').ok).toBe(true);
    expect(build(state, 'p2').ok).toBe(true);
    expect(state.phase).toBe(Phase.construction);
    expect(build(state, 'p3').ok).toBe(true);
    expect(state.phase).toBe(Phase.draw);
  });
});

describe('stalling counters', () => {
  it('increments both counters and caps them at 5 / 20', () => {
    const { state } = fsmIn(Phase.play);
    state.consecutive_no_eval_turns = 4;
    state.global_no_eval_turns = 19;

    // 5th consecutive trips force-eval; 20th global does not double-fire.
    expect(onNoEvalTurn(state)).toEqual(['force-eval']);
    expect(state.consecutive_no_eval_turns).toBe(5);
    expect(state.global_no_eval_turns).toBe(20);

    // Counters are pinned at their bounds — further no-eval turns re-signal
    // (consecutive stays 5 → still === 5) but never overflow.
    const events = onNoEvalTurn(state);
    expect(state.consecutive_no_eval_turns).toBe(5);
    expect(state.global_no_eval_turns).toBe(20);
    expect(events).toEqual(['force-eval']);
  });

  it('fires force-eval exactly when each cap is reached', () => {
    const { state } = fsmIn(Phase.play);
    const fired: number[] = [];
    for (let turn = 1; turn <= 4; turn += 1) {
      expect(onNoEvalTurn(state)).toEqual([]);
    }
    expect(onNoEvalTurn(state)).toEqual(['force-eval']); // consecutive hits 5

    state.consecutive_no_eval_turns = 0; // a real eval turn resets it
    state.global_no_eval_turns = 19;
    expect(onNoEvalTurn(state)).toEqual(['force-eval']); // global hits 20
  });

  it('onEvalTurn resets consecutive but never the global counter', () => {
    const { state } = fsmIn(Phase.play);
    state.consecutive_no_eval_turns = 4;
    state.global_no_eval_turns = 19;
    expect(onEvalTurn(state)).toEqual([]);
    expect(state.consecutive_no_eval_turns).toBe(0);
    expect(state.global_no_eval_turns).toBe(19);
  });

  it('clamps out-of-range counters at construction and on increment', () => {
    const state = createFSMState();
    state.consecutive_no_eval_turns = 99;
    state.global_no_eval_turns = -7;
    const fsm = new PhaseFSM(state);
    expect(fsm.state.consecutive_no_eval_turns).toBe(5);
    expect(fsm.state.global_no_eval_turns).toBe(0);

    fsm.state.consecutive_no_eval_turns = -3;
    onNoEvalTurn(fsm.state);
    // Negative inputs floor at 0 before the +1 is clamped in — -3 + 1 = -2 → 0.
    expect(fsm.state.consecutive_no_eval_turns).toBe(0);
  });
});

describe('tick auto-pass edges', () => {
  it('does nothing while the deadline is in the future or unset', () => {
    const { fsm, state } = fsmIn(Phase.play);
    state.turnDeadline = 0;
    expect(fsm.tick(999_999_999)).toEqual([]);
    state.turnDeadline = 1_000_000;
    expect(fsm.tick(999_999)).toEqual([]);
    expect(state.phase).toBe(Phase.play);
  });

  it.each([Phase.play, Phase.defense] as const)(
    'auto-passes %s into resolution at the deadline and counts a no-eval turn',
    (phase) => {
      const now = 3_000_000;
      const { fsm, state } = fsmIn(phase, now - PLAY_MS);
      state.turnDeadline = now;
      state.consecutive_no_eval_turns = 2;
      state.global_no_eval_turns = 9;

      expect(fsm.tick(now)).toEqual(['auto-pass']);
      expect(state.phase).toBe(Phase.resolution);
      expect(state.turnDeadline).toBe(0);
      expect(state.consecutive_no_eval_turns).toBe(3);
      expect(state.global_no_eval_turns).toBe(10);
    },
  );

  it('emits force-eval alongside auto-pass when a stalling cap trips', () => {
    const { fsm, state } = fsmIn(Phase.play);
    state.turnDeadline = 500;
    state.consecutive_no_eval_turns = 4;

    expect(fsm.tick(500)).toEqual(['auto-pass', 'force-eval']);
    expect(state.phase).toBe(Phase.resolution);
  });

  it('ends the game when the construction deadline elapses (AFK safeguard)', () => {
    const { fsm, state } = fsmIn(Phase.construction);
    state.turnDeadline = 100;

    expect(fsm.tick(100)).toEqual(['game-over']);
    expect(state.phase).toBe(Phase.gameOver);
    expect(state.turnDeadline).toBe(0);
  });

  it.each([Phase.waiting, Phase.draw, Phase.resolution, Phase.gameOver] as const)(
    'clears a stale deadline in %s without firing events',
    (phase) => {
      const { fsm, state } = fsmIn(phase);
      state.turnDeadline = 50;
      expect(fsm.tick(50)).toEqual([]);
      expect(state.turnDeadline).toBe(0);
      expect(state.phase).toBe(phase);
    },
  );
});
