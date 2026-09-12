import type { MathNode } from 'mathjs';
import { parseExpression } from './expressions.js';

/**
 * Linear-algebra expression predicates — T-wave-8 LA cards.
 *
 * Board expressions stay strings on the wire/schema; LA boards carry one of
 * two canonical matrix forms:
 *   - `matrix([1,0],[0,1])` — what mathjsEngine emits (see matrixToString)
 *     and what the Matrix Weave catalog card stores as effectParams.expr
 *   - `[[1,0],[0,1]]` — a nested mathjs array literal
 * A flat `[1, 0]` vector literal is NOT a matrix for these purposes.
 *
 * Pure: no Colyseus imports. mathjs AST inspection only.
 */

function arrayItems(node: MathNode): MathNode[] | undefined {
  if (node.type !== 'ArrayNode') return undefined;
  return (node as unknown as { items?: MathNode[] }).items;
}

/** Row nodes of a matrix-structured AST, or undefined for scalars/vectors. */
function matrixRows(node: MathNode): MathNode[] | undefined {
  if (node.type === 'FunctionNode') {
    const fn = (node as unknown as { fn?: { name?: string } }).fn;
    if (fn?.name !== 'matrix') return undefined;
    const args = (node as unknown as { args?: MathNode[] }).args ?? [];
    return args.length > 0 && args.every((arg) => arg.type === 'ArrayNode') ? args : undefined;
  }
  const items = arrayItems(node);
  if (items && items.length > 0 && items.every((item) => item.type === 'ArrayNode')) {
    return items;
  }
  return undefined;
}

/** True when the expression parses to a 2-D matrix literal or `matrix(...)` call. */
export function isMatrixExpression(expression: string): boolean {
  try {
    return matrixRows(parseExpression(expression)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * Row count of a matrix expression — the board `dimension` marker for LA
 * boards (rank for the non-singular catalog matrices). Undefined when the
 * expression isn't a matrix.
 */
export function matrixRowCount(expression: string): number | undefined {
  try {
    const rows = matrixRows(parseExpression(expression));
    return rows ? rows.length : undefined;
  } catch {
    return undefined;
  }
}
