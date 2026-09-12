import { parseExpression, serialize, type MathNode } from '../math/expressions.js';
import { mathEngine } from '../math/index.js';
import {
  failure,
  findBoard,
  getOpponent,
  getPlayer,
  isAggressiveActionUsed,
  isBoardAlive,
  isFailure,
  markAggressiveActionUsed,
  moveCardToGraveyard,
  phaseAllowed,
  requiredCard,
  success,
  type CommandResult,
  GameCommand,
} from './base.js';

export interface NtTheoremPayload {
  playerId: string;
  cardId: string;
  targetPlayerId?: string;
  targetBoardId?: string;
  /** Catalog `effectParams.theorem` — joined at the router (CardSchema drops it). */
  theorem: string;
}

/**
 * The prime each catalog theorem reduces by. The catalog names the theorem
 * (`effectParams.theorem`) but carries no modulus — the modulus is part of the
 * theorem's pinned v1 semantics, not a tunable parameter.
 */
const THEOREM_MODULUS: Record<string, number> = {
  fermat_little: 7,
};

/** Numeric literal a ConstantNode encodes; folds unaryMinus(ConstantNode). */
function constantValue(node: MathNode): number | undefined {
  if (node.type === 'ConstantNode') {
    const value = (node as unknown as { value?: unknown }).value;
    return typeof value === 'number' ? value : undefined;
  }
  if (node.type === 'OperatorNode') {
    const op = node as unknown as { fn?: string; args?: MathNode[] };
    if (op.fn === 'unaryMinus' && op.args?.length === 1) {
      const inner = constantValue(op.args[0]!);
      return inner === undefined ? undefined : -inner;
    }
  }
  return undefined;
}

/**
 * Fermat Echo (fcc-nt-theorem-001): rewrites an opponent board's expression,
 * reducing every numeric constant modulo the theorem's prime (e.g.
 * 'x^2 + 8*x + 7' → 'x ^ 2 + 1 * x + 0' for fermat_little mod 7).
 * Aggressive — counts against the one-aggressive-action-per-turn rule.
 */
export class NtTheoremCommand extends GameCommand<NtTheoremPayload> {
  execute(payload: NtTheoremPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('nt theorem only in play');
    const player = getPlayer(state, payload.playerId);
    if (!player) return failure('player not found');
    if (isAggressiveActionUsed(player)) {
      return failure('aggressive action already used this turn');
    }
    const card = requiredCard(player, payload.cardId);
    if (isFailure(card)) return card;
    if (card.cardType !== 'ntTheorem') return failure('nt theorem card required');

    const modulus = THEOREM_MODULUS[payload.theorem];
    if (modulus === undefined) return failure(`unknown theorem ${payload.theorem}`);

    const target = getOpponent(state, payload.playerId, payload.targetPlayerId);
    if (!target) return failure('target player not found');
    const targetBoard = findBoard(target, payload.targetBoardId);
    if (!targetBoard || !isBoardAlive(targetBoard)) {
      moveCardToGraveyard(player, payload.cardId);
      this.context()?.emitGameEvent?.('fizzle', payload.playerId, {
        source: 'play_card',
        cardId: payload.cardId,
        targetId: payload.targetBoardId,
        reason: 'target_gone',
      });
      return success({ fizzled: true, boardDestroyed: false });
    }

    try {
      const reduced = parseExpression(targetBoard.expression).transform((node) => {
        const value = constantValue(node);
        return value === undefined
          ? node
          : parseExpression(String(mathEngine.mod(value, modulus)));
      });
      targetBoard.expression = serialize(reduced);
    } catch (error) {
      return failure(error instanceof Error ? error.message : 'nt theorem transform failed');
    }

    markAggressiveActionUsed(player);
    moveCardToGraveyard(player, payload.cardId);
    this.context()?.emitGameEvent?.('play_card', payload.playerId, {
      cardId: payload.cardId,
      targetBoardId: payload.targetBoardId,
      theorem: payload.theorem,
      modulus,
    });
    return success({ targetBoardId: targetBoard.boardId });
  }
}
