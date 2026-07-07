import type { MathNode } from 'mathjs';

/**
 * T8 (contract) — Expression counters.
 *
 * Small pure helpers that the T9 complexity walker (and T8's validators) depend
 * on. Kept as the SINGLE SOURCE OF TRUTH for variable/term collection so the
 * walker never recomputes them.
 *
 * Pure: no Colyseus imports, no IO. Operates on math.js `MathNode` only.
 */

/**
 * Math.js SymbolNode names that are built-in constants, NOT gameplay variables.
 * These must never be counted as distinct variables in the complexity walker.
 */
export const CONSTANT_SYMBOLS = new Set<string>([
  'pi',
  'e',
  'phi',
  'tau',
  'i',
  'INF',
  'NaN',
  'true',
  'false',
]);

function symbolName(node: MathNode): string | undefined {
  return (node as unknown as { name?: string }).name;
}

function opOf(node: MathNode): string | undefined {
  return (node as unknown as { op?: string }).op;
}

/**
 * Collect the distinct variable symbol names referenced by a parsed expression.
 *
 * A symbol counts as a variable iff:
 *  - it is NOT a built-in constant (see {@link CONSTANT_SYMBOLS}), and
 *  - it is NOT a function-name reference — the SymbolNode at path `"fn"` inside a
 *    FunctionNode (e.g. the `f` in `f(x)` or the `sin` in `sin(x)`).
 *
 * The math.js `traverse` visitor reports the function-name SymbolNode of every
 * FunctionNode at path `"fn"` (verified for both top-level and nested calls such
 * as `g(f(x))`), so a simple `path !== 'fn'` filter excludes them correctly.
 */
export function listVariables(node: MathNode): string[] {
  const vars = new Set<string>();
  node.traverse((child, path) => {
    if (child.type === 'SymbolNode' && path !== 'fn') {
      const name = symbolName(child);
      if (name && !CONSTANT_SYMBOLS.has(name)) {
        vars.add(name);
      }
    }
  });
  return [...vars];
}

/** Number of distinct variable symbols in the expression. */
export function countDistinctVariables(node: MathNode): number {
  return listVariables(node).length;
}

/**
 * Count the top-level addition operands of an expression.
 *
 * Walks the top-level chain of `OperatorNode` with `op === '+'` and counts the
 * leaf operands (each non-`+` sub-expression counts as one term). If the root is
 * not a top-level addition, the expression is a single term → returns 1.
 *
 * Examples:
 *   "x"                 -> 1
 *   "x^2 + 3*x"         -> 2
 *   "x*y + z + 1"       -> 3
 *   "sin(x)"            -> 1   (root is a FunctionNode, not '+')
 *   "[[1,2],[3,4]]"     -> 1   (root is an ArrayNode, not '+')
 */
export function countTerms(node: MathNode): number {
  if (node.type === 'OperatorNode' && opOf(node) === '+') {
    let count = 0;
    const collect = (n: MathNode): void => {
      if (n.type === 'OperatorNode' && opOf(n) === '+') {
        for (const arg of (n as unknown as { args: MathNode[] }).args) {
          collect(arg);
        }
      } else {
        count += 1;
      }
    };
    for (const arg of (node as unknown as { args: MathNode[] }).args) {
      collect(arg);
    }
    return count;
  }
  return 1;
}
