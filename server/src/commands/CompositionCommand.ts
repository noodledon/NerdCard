import {
  failure, findBoard, getPlayer, isBoardAlive, isFailure, moveCardToGraveyard,
  phaseAllowed, requiredCard, success, type CommandResult, GameCommand,
} from './base.js';
import {
  parseExpression, serialize, substituteVariable, type MathNode,
} from '../math/expressions.js';
import { listVariables } from '../math/counters.js';

export interface CompositionPayload { playerId: string; cardId: string; outerBoardId: string; innerBoardId: string; variable?: string; }

export class CompositionCommand extends GameCommand<CompositionPayload> {
  execute({ playerId, cardId, outerBoardId, innerBoardId, variable }: CompositionPayload): CommandResult {
    const state = this.gameState();
    if (!phaseAllowed(state, ['play'])) return failure('composition only in play');
    const player = getPlayer(state, playerId);
    if (!player) return failure('player not found');
    const card = requiredCard(player, cardId);
    if (isFailure(card)) return card;
    const outer = findBoard(player, outerBoardId);
    const inner = findBoard(player, innerBoardId);
    if (!outer || !inner || !isBoardAlive(outer) || !isBoardAlive(inner)) {
      moveCardToGraveyard(player, cardId);
      return success({ fizzled: true });
    }
    if (outer === inner) return failure('composition requires two distinct boards');
    if ((outer.compositionDepth ?? 0) >= 2) return failure('maximum composition depth reached');
    let outerNode: MathNode;
    let innerNode: MathNode;
    try {
      outerNode = parseExpression(outer.expression);
      innerNode = parseExpression(inner.expression);
    } catch {
      // Evaluated boards stay isActive with expression='' — alive but with
      // nothing to substitute into.
      return failure('board expression is not parseable');
    }
    // Wave-9 T2 pin: `variable` names the symbol to substitute. When omitted,
    // an outer board with exactly one distinct variable implies it; anything
    // else (0 or >=2 variables) must be named explicitly.
    let resolvedVariable = variable === '' ? undefined : variable;
    if (resolvedVariable === undefined) {
      const vars = listVariables(outerNode);
      if (vars.length !== 1) return failure('ambiguous variable — specify one');
      resolvedVariable = vars[0];
    }
    outer.expression = serialize(substituteVariable(outerNode, resolvedVariable, innerNode));
    outer.compositionDepth = (outer.compositionDepth ?? 0) + 1;
    moveCardToGraveyard(player, cardId);
    return success();
  }
}
