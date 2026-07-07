/**
 * Domain Validation — T8 (part 3 of 3)
 *
 * Predicates that decide whether a parsed expression is legal for a given
 * BaseDomain. Each returns `{ ok, reason? }`.
 *
 * Pure math util: imports only from `mathjs`, `./expressions`, `./counters`,
 * and `shared/types`. NO Colyseus, NO IO.
 */

import * as math from 'mathjs';
import { serialize, type MathNode } from './expressions.js';
import type { BaseDomain } from '../shared/types.js';

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

const OK: ValidationResult = { ok: true };

/** Extract a numeric constant value from a ConstantNode (handles unary minus). */
function constValue(node: MathNode): number | null {
  if (node.type === 'ConstantNode') {
    const raw = (node as unknown as { value: unknown }).value;
    if (typeof raw === 'number') return raw;
    const asNum = Number(String(raw));
    return Number.isNaN(asNum) ? null : asNum;
  }
  if (node.type === 'OperatorNode' && (node as unknown as { op: string }).op === 'unaryMinus') {
    const inner = constValue((node as unknown as { args: MathNode[] }).args[0]);
    return inner === null ? null : -inner;
  }
  return null;
}

/** Polynomial degree of `node` in variable `v` (symbolic walk). */
function degreeOf(node: MathNode, v: string): number {
  if (node.type === 'SymbolNode') {
    return (node as unknown as { name: string }).name === v ? 1 : 0;
  }
  if (node.type === 'ConstantNode') return 0;
  if (node.type === 'ParenthesisNode') {
    return degreeOf((node as unknown as { content: MathNode }).content, v);
  }
  if (node.type === 'OperatorNode') {
    const op = (node as unknown as { op: string }).op;
    const args = (node as unknown as { args: MathNode[] }).args;
    if (op === '+' || op === '-') return Math.max(...args.map((a) => degreeOf(a, v)));
    if (op === '*') return args.reduce((s, a) => s + degreeOf(a, v), 0);
    if (op === '^') {
      const baseDeg = degreeOf(args[0], v);
      if (baseDeg === 0) return 0; // variable not in base → degree 0
      const exp = constValue(args[1]);
      return exp === null ? baseDeg : baseDeg * exp;
    }
    return 0;
  }
  return 0; // functions, etc. → not polynomial in v
}

const TRANSCENDENTAL_FUNCS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan',
  'sinh', 'cosh', 'exp', 'log', 'log2', 'log10', 'ln', 'sqrt', 'abs',
]);

/** True if the tree contains a transcendental function or a reserved constant. */
function hasTranscendentalOrConstant(node: MathNode): boolean {
  let bad = false;
  node.traverse((n: MathNode) => {
    if (bad) return;
    if (n.type === 'FunctionNode') {
      const fn = String((n as unknown as { fn: unknown }).fn);
      if (TRANSCENDENTAL_FUNCS.has(fn)) bad = true;
    }
    if (n.type === 'SymbolNode') {
      const name = (n as unknown as { name: string }).name;
      if (['pi', 'e', 'phi', 'i', 'INF', 'NaN'].includes(name)) bad = true;
    }
  });
  return bad;
}

// ─── Rational ────────────────────────────────────────────────────────────────

/**
 * Accept a rational expression P(x)/Q(x) with integer/rational coefficients.
 * Rejects radicals (`sqrt`) and float coefficients. Uses math.rationalize.
 */
export function validateRational(node: MathNode): ValidationResult {
  let rationalized: string;
  try {
    rationalized = serialize(math_rationalize(node));
  } catch (err) {
    return { ok: false, reason: `not a rational expression: ${String(err)}` };
  }
  if (/sqrt/.test(rationalized)) {
    return { ok: false, reason: 'radicals not allowed in rational domain' };
  }
  if (/\d+\.\d+/.test(rationalized)) {
    return { ok: false, reason: 'float coefficients not allowed in rational domain' };
  }
  return OK;
}

function math_rationalize(node: MathNode): MathNode {
  return math.rationalize(node as never) as unknown as MathNode;
}

// ─── Polynomial ──────────────────────────────────────────────────────────────

export function validatePolynomial(
  node: MathNode,
  opts: { maxDegree: number },
): ValidationResult {
  // Single variable only.
  const vars = new Set<string>();
  node.traverse((n: MathNode) => {
    if (n.type === 'SymbolNode') {
      const name = (n as unknown as { name: string }).name;
      if (!['pi', 'e', 'phi', 'i', 'INF', 'NaN'].includes(name)) vars.add(name);
    }
  });
  if (vars.size > 1) {
    return { ok: false, reason: `polynomial must use a single variable, found: ${[...vars].join(', ')}` };
  }
  if (hasTranscendentalOrConstant(node)) {
    return { ok: false, reason: 'polynomial coefficients must be numeric (no transcendental constants/functions)' };
  }
  if (vars.size === 1) {
    const v = [...vars][0];
    const deg = degreeOf(node, v);
    if (deg > opts.maxDegree) {
      return { ok: false, reason: `degree ${deg} exceeds max ${opts.maxDegree}` };
    }
  }
  return OK;
}

// ─── Trig ────────────────────────────────────────────────────────────────────

const ALLOWED_TRIG = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan',
]);

export function validateTrig(node: MathNode, opts: { maxTerms: number }): ValidationResult {
  let badFn: string | null = null;
  let nested = false;
  node.traverse((n: MathNode) => {
    if (n.type === 'FunctionNode') {
      const fn = String((n as unknown as { fn: unknown }).fn);
      if (!ALLOWED_TRIG.has(fn)) {
        badFn = badFn ?? fn;
      }
      // nested composition: a function whose argument is itself a function
      const args = (n as unknown as { args: MathNode[] }).args;
      for (const arg of args) {
        if (arg.type === 'FunctionNode') nested = true;
      }
    }
  });
  if (badFn) return { ok: false, reason: `disallowed trig function: ${badFn}` };
  if (nested) return { ok: false, reason: 'nested trig composition not allowed (e.g. sin(cos(x)))' };

  const terms = countTopLevelAdd(node);
  if (terms > opts.maxTerms) {
    return { ok: false, reason: `too many terms: ${terms} > ${opts.maxTerms}` };
  }
  return OK;
}

// ─── Exp / Log ───────────────────────────────────────────────────────────────

const ALLOWED_EXPLOG = new Set(['exp', 'log2', 'log10', 'ln', 'log']);

export function validateExpLog(node: MathNode, opts: { maxTerms: number }): ValidationResult {
  let badFn: string | null = null;
  let nestedPower = false;
  node.traverse((n: MathNode) => {
    if (n.type === 'FunctionNode') {
      const fn = String((n as unknown as { fn: unknown }).fn);
      if (!ALLOWED_EXPLOG.has(fn)) badFn = badFn ?? fn;
    }
    if (n.type === 'OperatorNode' && (n as unknown as { op: string }).op === '^') {
      const args = (n as unknown as { args: MathNode[] }).args;
      // nested power, e.g. e^(x^x) — the exponent may be wrapped in parens
      const exp = args[1];
      const expInner = exp.type === 'ParenthesisNode'
        ? (exp as unknown as { content: MathNode }).content
        : exp;
      if (expInner?.type === 'OperatorNode' && (expInner as unknown as { op: string }).op === '^') {
        nestedPower = true;
      }
    }
  });
  if (badFn) return { ok: false, reason: `disallowed exp/log function: ${badFn}` };
  if (nestedPower) return { ok: false, reason: 'nested power not allowed (e.g. e^(x^x))' };

  const terms = countTopLevelAddExpLog(node);
  if (terms > opts.maxTerms) {
    return { ok: false, reason: `too many terms: ${terms} > ${opts.maxTerms}` };
  }
  return OK;
}

// ─── Matrix (rectangular check) ───────────────────────────────────────────────

export function validateMatrix(node: MathNode): ValidationResult {
  if (node.type !== 'ArrayNode') {
    // Not a matrix literal — let caller decide; here we just validate shape if it is one.
    return { ok: false, reason: 'not a matrix literal' };
  }
  const rows = (node as unknown as { items: MathNode[] }).items;
  if (rows.length === 0) return { ok: false, reason: 'empty matrix' };
  const colCount = (rows[0] as unknown as { items?: unknown[] }).items?.length ?? 0;
  for (const row of rows) {
    const items = (row as unknown as { items?: unknown[] }).items;
    if (!items || items.length !== colCount) {
      return { ok: false, reason: 'ragged matrix (rows have different lengths)' };
    }
  }
  return OK;
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export function validateByDomain(domain: BaseDomain, node: MathNode): ValidationResult {
  switch (domain) {
    case 'rational':
      return validateRational(node);
    case 'poly':
      return validatePolynomial(node, { maxDegree: 5 });
    case 'trig':
      return validateTrig(node, { maxTerms: 6 });
    case 'exp':
    case 'log':
      return validateExpLog(node, { maxTerms: 10 });
    default:
      return { ok: false, reason: `unknown domain: ${domain}` };
  }
}

// ─── Internal term counters ───────────────────────────────────────────────────

function countTopLevelAdd(node: MathNode): number {
  if (node.type === 'OperatorNode' && (node as unknown as { op: string }).op === '+') {
    return (node as unknown as { args: MathNode[] }).args.reduce(
      (s, a) => s + countTopLevelAdd(a),
      0,
    );
  }
  return 1;
}

/**
 * Exp/log term budget. A power applied to a function (e.g. ln(x)^2) counts as
 * 2 terms, per rulebook.
 */
function countTopLevelAddExpLog(node: MathNode): number {
  if (node.type === 'OperatorNode' && (node as unknown as { op: string }).op === '+') {
    return (node as unknown as { args: MathNode[] }).args.reduce(
      (s, a) => s + countTopLevelAddExpLog(a),
      0,
    );
  }
  if (node.type === 'OperatorNode' && (node as unknown as { op: string }).op === '^') {
    const base = (node as unknown as { args: MathNode[] }).args[0];
    if (base.type === 'FunctionNode') return 2;
  }
  return 1;
}
