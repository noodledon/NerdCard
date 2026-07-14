import { AddBoardCommand, type AddBoardPayload } from './AddBoardCommand.js';
import { AddTermCommand, type AddTermPayload } from './AddTermCommand.js';
import { BuildFunctionCommand, type BuildFunctionCommandPayload } from './BuildFunctionCommand.js';
import { AttackHpCommand, type AttackHpPayload } from './AttackHpCommand.js';
import { CompositionCommand, type CompositionPayload } from './CompositionCommand.js';
import { DrawCommand, type DrawPayload } from './DrawCommand.js';
import { EvalCommand, type EvalPayload } from './EvalCommand.js';
import { ForceEvalCommand, type ForceEvalPayload } from './ForceEvalCommand.js';
import { TheoremArtifactCommand, type TheoremArtifactPayload } from './TheoremArtifactCommand.js';
import { TheoremMartialCommand } from './TheoremMartialCommand.js';
import { TrapCommand, type TrapPayload } from './TrapCommand.js';
import { PlayDefenseCommand, type PlayDefensePayload } from './PlayDefenseCommand.js';
import type { CommandContext, CommandResult, CommandState, GameCommand } from './base.js';

export type CommandIntent =
  | { intent: 'add-term'; payload: AddTermPayload }
  | { intent: 'attack-hp'; payload: AttackHpPayload }
  | { intent: 'trap'; payload: TrapPayload }
  | { intent: 'theorem-martial'; payload: AttackHpPayload }
  | { intent: 'theorem-artifact'; payload: TheoremArtifactPayload }
  | { intent: 'add-board'; payload: AddBoardPayload }
  | { intent: 'composition'; payload: CompositionPayload }
  | { intent: 'force-eval'; payload: ForceEvalPayload }
  | { intent: 'eval'; payload: EvalPayload }
  | { intent: 'draw'; payload: DrawPayload }
  | { intent: 'build-function'; payload: BuildFunctionCommandPayload }
  | { intent: 'play-defense'; payload: PlayDefensePayload };

export class CommandDispatcher {
  dispatch(state: CommandState, context: CommandContext | undefined, intent: CommandIntent): CommandResult {
    const command = this.create(intent) as GameCommand<unknown>;
    command.state = state;
    command.roomRef = context;
    return command.execute(intent.payload) as CommandResult;
  }

  private create(intent: CommandIntent): GameCommand<unknown> {
    switch (intent.intent) {
      case 'add-term': return new AddTermCommand() as GameCommand<unknown>;
      case 'attack-hp': return new AttackHpCommand() as GameCommand<unknown>;
      case 'trap': return new TrapCommand() as GameCommand<unknown>;
      case 'theorem-martial': return new TheoremMartialCommand() as GameCommand<unknown>;
      case 'theorem-artifact': return new TheoremArtifactCommand() as GameCommand<unknown>;
      case 'add-board': return new AddBoardCommand() as GameCommand<unknown>;
      case 'composition': return new CompositionCommand() as GameCommand<unknown>;
      case 'force-eval': return new ForceEvalCommand() as GameCommand<unknown>;
      case 'eval': return new EvalCommand() as GameCommand<unknown>;
      case 'draw': return new DrawCommand() as GameCommand<unknown>;
      case 'build-function': return new BuildFunctionCommand() as GameCommand<unknown>;
      case 'play-defense': return new PlayDefenseCommand() as GameCommand<unknown>;
    }
  }
}
