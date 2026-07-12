import type { GameRoomState } from '../state/schema.js';
import {
  createFSMState,
  onEvalTurn,
  onNoEvalTurn,
  Phase,
  PhaseFSM,
  type FSMEvent,
  type Phase as FSMPhase,
  type TransitionResult,
} from '../logic/fsm.js';

/** Thin schema ↔ pure-FSM bridge. Game rules remain in logic/fsm.ts. */
export class PhaseController {
  public readonly fsm: PhaseFSM;

  constructor(private readonly schemaState: GameRoomState) {
    const initial = createFSMState();
    initial.phase = schemaState.phase === 'waiting' ? Phase.waiting : Phase.waiting;
    initial.currentTurn = schemaState.turnIndex;
    initial.turnDeadline = schemaState.turnDeadline;
    initial.consecutive_no_eval_turns = schemaState.consecutive_no_eval_turns;
    initial.global_no_eval_turns = schemaState.global_no_eval_turns;
    this.fsm = new PhaseFSM(initial);
  }

  requestTransition(target: FSMPhase, now = Date.now()): TransitionResult {
    const result = this.fsm.requestTransition(target, now);
    if (result.ok) this.mirror();
    return result;
  }

  get phase(): FSMPhase {
    return this.fsm.state.phase;
  }

  tick(now = Date.now()): FSMEvent[] {
    const events = this.fsm.tick(now);
    this.mirror();
    return events;
  }

  onEvalTurn(): void {
    onEvalTurn(this.fsm.state);
    this.mirror();
  }

  onNoEvalTurn(): FSMEvent[] {
    const events = onNoEvalTurn(this.fsm.state);
    this.mirror();
    return events;
  }

  private mirror(): void {
    this.schemaState.phase = this.fsm.state.phase;
    this.schemaState.turnDeadline = this.fsm.state.turnDeadline;
    this.schemaState.turnIndex = this.fsm.state.currentTurn;
    this.schemaState.consecutive_no_eval_turns = this.fsm.state.consecutive_no_eval_turns;
    this.schemaState.global_no_eval_turns = this.fsm.state.global_no_eval_turns;
  }
}
