import { computeEligibleComplexity } from '../math/complexity.js';
import { listVariables } from '../math/counters.js';
import { parseExpression } from '../math/expressions.js';

export const DOMINATE_EPSILON = 1e-9;

export interface EvalInput {
  expression: string;
}

export interface EvalResult {
  value: number;
  complexity: number;
  hpGain10: number;
  undefined: boolean;
  reason?: string;
}

export interface ForceEvalBoard {
  destroyed?: boolean;
  isActive?: boolean;
}

export interface ForceEvalPlayer {
  id: string;
  hp10: number;
  lastForceValue: number;
  boards?: ForceEvalBoard[];
}

export interface ForceEvalState {
  players: Iterable<ForceEvalPlayer>;
  consecutive_no_eval_turns?: number;
  global_no_eval_turns?: number;
}

export interface ForceEvalOptions {
  nominatorId: string;
}

export interface ForceEvalResult {
  winner?: string;
  draw?: boolean;
  nominatorBoardDestroyed: boolean;
  redistributions: Array<{ from: string; to: string; hp10Transferred: number }>;
}

/**
 * A Variable Value Card supplies one value for every distinct variable in the
 * expression. For example, VVC=2 evaluates x^2 + y using { x: 2, y: 2 }.
 */
export function evaluate(
  player: EvalInput,
  _boardIndex: number,
  vvcValue: number,
): EvalResult {
  try {
    const node = parseExpression(player.expression);
    const scope: Record<string, number> = {};
    for (const variable of listVariables(node)) scope[variable] = vvcValue;

    const evaluated = node.compile().evaluate(scope);
    if (typeof evaluated !== 'number' || !Number.isFinite(evaluated)) {
      return {
        value: Number.NaN,
        complexity: 0,
        hpGain10: 0,
        undefined: true,
        reason: 'evaluation is not a finite real number',
      };
    }

    const complexity = computeEligibleComplexity(node);
    return {
      value: evaluated,
      complexity,
      hpGain10: Math.floor((evaluated * complexity) / 10) * 10,
      undefined: false,
    };
  } catch (error) {
    return {
      value: Number.NaN,
      complexity: 0,
      hpGain10: 0,
      undefined: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Resolve a two-player force evaluation using strict domination with epsilon. */
export function forceEval(
  state: ForceEvalState,
  { nominatorId }: ForceEvalOptions,
): ForceEvalResult {
  const players = [...state.players];
  const nominator = players.find((player) => player.id === nominatorId);
  if (!nominator) {
    return { nominatorBoardDestroyed: false, redistributions: [] };
  }

  const opponents = players.filter((player) => player.id !== nominatorId);
  const dominates = opponents.length > 0 && opponents.every(
    (opponent) => nominator.lastForceValue > 2 * opponent.lastForceValue + DOMINATE_EPSILON,
  );

  if (dominates) {
    const redistributions: ForceEvalResult['redistributions'] = [];
    for (const opponent of opponents) {
      const transfer = Math.floor(opponent.hp10 / 2 / opponents.length) * 10;
      opponent.hp10 = Math.max(0, opponent.hp10 - transfer);
      nominator.hp10 += transfer;
      redistributions.push({ from: opponent.id, to: nominator.id, hp10Transferred: transfer });
    }
    state.consecutive_no_eval_turns = 0;
    return { winner: nominator.id, nominatorBoardDestroyed: false, redistributions };
  }

  const mainBoard = nominator.boards?.[0];
  if (mainBoard) {
    mainBoard.destroyed = true;
    mainBoard.isActive = false;
  }
  state.consecutive_no_eval_turns = 0;
  return { nominatorBoardDestroyed: true, redistributions: [] };
}
