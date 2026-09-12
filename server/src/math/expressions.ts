import * as math from 'mathjs';
import type { MathNode } from 'mathjs';
import { countDistinctVariables } from './counters.js';

// Re-export MathNode so T8's validators (and other math modules) can import the
// node type from this single gateway module.
export type { MathNode } from 'mathjs';

/**
 * T8 (contract) — Expression parse / serialize gateway.
 *
 * The ONLY entry points callers use to turn a string into a math.js node and
 * back. Keeping serialization behind a single canonical `serialize()` function
 * guarantees the math expression strings stored in Colyseus Schema
 * (`@type("string")`) are deterministic across the whole pipeline.
 *
 * Pure: no Colyseus imports. Imports ONLY from `mathjs` + `backend/shared`.
 */

/**
 * Stable serialization config. ALL callers (schema writers via T14 handlers,
 * validators, the T9 walker round-trips) MUST use {@link serialize} so the
 * canonical string form is identical everywhere.
 */
export const SERIALIZE_OPTS = {
  implicit: 'show' as const,
  parenthesis: 'keep' as const,
};

/** Thrown when {@link parseExpression} cannot parse an input string. */
export class MathValidationError extends Error {
  public readonly input: string;
  public readonly cause?: unknown;
  constructor(message: string, input: string, cause?: unknown) {
    super(message);
    this.name = 'MathValidationError';
    this.input = input;
    this.cause = cause;
  }
}

/** Parse a string expression into a math.js AST node, throwing on failure. */
export function parseExpression(input: string): MathNode {
  if (input.trim().length === 0) {
    throw new MathValidationError('Expression is empty', input);
  }
  try {
    return math.parse(input);
  } catch (err) {
    throw new MathValidationError(
      `Failed to parse expression: ${String(err)}`,
      input,
      err,
    );
  }
}

/** Serialize a node back to its canonical string form using {@link SERIALIZE_OPTS}. */
export function serialize(node: MathNode): string {
  return node.toString(SERIALIZE_OPTS);
}

/**
 * Substitute `inner` for every SymbolNode named `variable` in `outer`,
 * returning a NEW node (the inputs are not mutated).
 *
 * AST-based replacement — never string surgery — so tokens merely containing
 * the variable name survive intact (`exp(x)` ∘ `y+1` yields `exp(y+1)`, not
 * `e(y+1)p(y+1)`). Each occurrence gets its own `ParenthesisNode(inner.clone())`
 * wrapper so precedence is preserved regardless of where the symbol sat.
 *
 * The function-name SymbolNode inside a FunctionNode (path `"fn"`, e.g. the
 * `exp` in `exp(x)`) is NOT a variable reference and is never replaced — same
 * exclusion {@link ./counters.listVariables} applies when counting variables.
 * `transform` is pre-order and does not descend into a replacement, so an
 * `inner` that itself contains `variable` terminates (f(x)=x ∘ g(x)=x+1 → x+1).
 */
export function substituteVariable(
  outer: MathNode,
  variable: string,
  inner: MathNode,
): MathNode {
  return outer.transform((node, path) =>
    node.type === 'SymbolNode'
      && path !== 'fn'
      && (node as unknown as { name?: string }).name === variable
      ? new math.ParenthesisNode(inner.clone())
      : node,
  );
}

/** Parse -> serialize -> reparse and report whether the round-trip is equal. */
export function roundtrip(input: string): {
  original: string;
  serialized: string;
  reparsed: MathNode;
  equal: boolean;
} {
  const parsed = parseExpression(input);
  const serialized = serialize(parsed);
  const reparsed = parseExpression(serialized);
  const equal =
    math.symbolicEqual(parsed, reparsed) === true ||
    serialized === serialize(reparsed);
  return { original: input, serialized, reparsed, equal };
}

/**
 * W9-T6 — "reduced to a single variable" (rulebook isolation win).
 *
 * Distinct gameplay-variable count for an expression STRING, or `undefined`
 * when the input is empty or unparseable. Post-eval boards keep
 * `expression = ''` while staying `isActive`, and this runs inside
 * `requestEndTurn`/`checkWin` — callers must never see the parse throw, so
 * the failure is reported as `undefined` instead.
 *
 * `listVariables` already excludes built-in constants (`pi`, `e`, `phi`, `i`,
 * …) and function-name symbols, so `sin(x)` counts one variable while `x+y`
 * counts two.
 */
export function distinctVariablesInExpression(expression: string | undefined): number | undefined {
  if (expression === undefined || expression.trim().length === 0) return undefined;
  try {
    return countDistinctVariables(parseExpression(expression));
  } catch {
    return undefined;
  }
}

/**
 * An expression is isolated iff it has exactly one distinct variable — any
 * form qualifies (`x`, `3*x`, `x^2`, `x+1`), not just the single-letter
 * literal the previous `/^[a-z]$/` check required. This is the single source
 * of truth for the isolation predicate: `checkWin` and the
 * `tickIsolationTimers` countdown must never drift apart again.
 */
export function isIsolatedExpression(expression: string | undefined): boolean {
  return distinctVariablesInExpression(expression) === 1;
}
