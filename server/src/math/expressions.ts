import * as math from 'mathjs';
import type { MathNode } from 'mathjs';

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
