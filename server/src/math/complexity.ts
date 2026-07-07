import type { MathNode } from 'mathjs';
import {
  countDistinctVariables,
  countTerms,
} from './counters.js';

/**
 * T9 — Complexity Score AST Walker (rulebook §HP Gain).
 *
 *   Score = 1 * distinctVars + 1 * termsBeyondFirst + 2 * compositionHits
 *
 * Eligibility: an expression only contributes HP if it has >= 2 distinct
 * variables. `computeEligibleComplexity` returns 0 when ineligible; raw
 * `computeComplexity` always returns the full score (callers pick which one —
 * the HP formula in T10/T14 MUST use `computeEligibleComplexity`).
 *
 * Pure: no Colyseus imports, no IO. Reuses the single-source-of-truth counters
 * from `./counters` (T8) for variable/term collection. Composition detection
 * lives HERE (T8 explicitly defers it).
 *
 * NOTE: T8 (`counters.ts` / `expressions.ts`) had not yet landed when T9 was
 * implemented, so the small shared helper modules this task depends on are
 * provided here as the agreed API contract. `validation.ts` (domain validators)
 * remains T8's remaining piece and is intentionally NOT part of T9.
 */

/** Rulebook caps cross-domain composition depth at <= 2 → at most +4 from composition. */
export const COMPOSITION_SCORE_CAP = 4;

function functionName(node: MathNode): string | undefined {
  return (node as unknown as { fn?: { name?: string } }).fn?.name;
}

function argsOf(node: MathNode): MathNode[] {
  return (node as unknown as { args?: MathNode[] }).args ?? [];
}

/**
 * An expression is HP-eligible only when it has at least 2 distinct variables.
 */
export function isEligibleForHP(node: MathNode): boolean {
  return countDistinctVariables(node) >= 2;
}

/**
 * Count nested-function compositions in the expression (capped at
 * {@link COMPOSITION_SCORE_CAP}).
 *
 * Two mechanisms, both detecting USER-DEFINED function composition:
 *
 *   A) A `FunctionNode` whose argument is itself a `FunctionNode`
 *      (e.g. `g(f(x))`). Pre-substituted forms like `sin(x^2)` have a
 *      non-`FunctionNode` argument → NOT counted.
 *
 *   B) A `FunctionAssignmentNode` (`f(x) = ...`) whose BODY is a `FunctionNode`
 *      that references another DEFINED function (e.g. `h(x) = f(x)`). Built-in
 *      bodies such as `g(u) = sin(u)` do NOT count — `sin` is not user-defined.
 *
 * Composition is detected from the AST present only; fully-substituted
 * expressions carry no FunctionAssignmentNode / nested FunctionNode form and
 * therefore score 0 composition hits.
 */
export function countCompositionHits(node: MathNode): number {
  // 1) Collect names of user-defined functions declared via `f(x) = ...`.
  const userFns = new Set<string>();
  node.traverse((n) => {
    if (n.type === 'FunctionAssignmentNode') {
      const name = (n as unknown as { name?: string }).name;
      if (name) userFns.add(name);
    }
  });

  let hits = 0;
  node.traverse((n) => {
    // Mechanism A: nested function-call argument.
    if (n.type === 'FunctionNode') {
      const hasNestedFnArg = argsOf(n).some((a) => a && a.type === 'FunctionNode');
      if (hasNestedFnArg) hits += 1;
    }
    // Mechanism B: assignment body that is a user-defined function call.
    if (n.type === 'FunctionAssignmentNode') {
      const expr = (n as unknown as { expr?: MathNode }).expr;
      if (
        expr &&
        expr.type === 'FunctionNode' &&
        userFns.has(functionName(expr) ?? '')
      ) {
        hits += 1;
      }
    }
  });

  return Math.min(hits, COMPOSITION_SCORE_CAP);
}

/**
 * Raw complexity score (integer). Does NOT apply the HP eligibility cutoff —
 * callers that gate HP on eligibility MUST use {@link computeEligibleComplexity}.
 */
export function computeComplexity(node: MathNode): number {
  const distinctVars = countDistinctVariables(node);

  // Terms-beyond-first only count when the expression actually has variables.
  // A pure constant (e.g. `"3 + 2i"`) has 0 distinct vars → 0 terms-beyond-first,
  // so its score stays 0 (it is not a function and is HP-ineligible anyway).
  // Expressions that DO contain variables keep every top-level addition operand
  // (e.g. `"x*y + z + 1"` → 3 terms → 2 beyond first).
  const termsBeyondFirst =
    distinctVars === 0 ? 0 : Math.max(0, countTerms(node) - 1);

  const compositionHits = countCompositionHits(node);

  return 1 * distinctVars + 1 * termsBeyondFirst + 2 * compositionHits;
}

/**
 * Complexity score used by the HP formula: returns the raw score ONLY when the
 * expression is HP-eligible (>= 2 distinct variables), otherwise 0.
 */
export function computeEligibleComplexity(node: MathNode): number {
  return isEligibleForHP(node) ? computeComplexity(node) : 0;
}
