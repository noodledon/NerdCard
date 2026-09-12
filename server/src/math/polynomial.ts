/**
 * Polynomial algebra — shared helpers used by domain validation
 * (`validation.ts`) and the mathjs engine's polynomial fast-path
 * (`mathjs-engine.ts` integrate/limit).
 *
 * Pure math util: imports only from `mathjs` and `./expressions`.
 */

import * as math from 'mathjs';
import type { MathNode } from './expressions.js';

// ─── Shared node predicates (used by validation.ts) ──────────────────────────

/** Extract a numeric constant value from a ConstantNode (handles unary minus/parens). */
export function constValue(node: MathNode): number | null {
  if (node.type === 'ParenthesisNode') {
    return constValue((node as unknown as { content: MathNode }).content);
  }
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
export function degreeOf(node: MathNode, v: string): number {
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
export function hasTranscendentalOrConstant(node: MathNode): boolean {
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

// ─── Polynomial structure ─────────────────────────────────────────────────────

/** True if `node` references variable `v` anywhere in the tree. */
export function referencesVar(node: MathNode, v: string): boolean {
  let found = false;
  node.traverse((n: MathNode) => {
    if (!found && n.type === 'SymbolNode' && (n as unknown as { name: string }).name === v) {
      found = true;
    }
  });
  return found;
}

function isPolyNode(node: MathNode, v: string): boolean {
  if (node.type === 'ConstantNode' || node.type === 'SymbolNode') return true;
  if (node.type === 'ParenthesisNode') {
    return isPolyNode((node as unknown as { content: MathNode }).content, v);
  }
  if (node.type !== 'OperatorNode') return false; // FunctionNode, ArrayNode, etc.
  const op = (node as unknown as { op: string }).op;
  const args = (node as unknown as { args: MathNode[] }).args;
  switch (op) {
    case '+':
    case '-':
    case 'unaryMinus':
    case 'unaryPlus':
    case '*':
      return args.every((a) => isPolyNode(a, v));
    case '/':
      // denominator must be polynomial and free of `v` (a symbolic constant)
      return isPolyNode(args[0], v) && isPolyNode(args[1], v) && !referencesVar(args[1], v);
    case '^': {
      const exp = constValue(args[1]);
      return exp !== null && Number.isInteger(exp) && exp >= 0 && isPolyNode(args[0], v);
    }
    default:
      return false;
  }
}

/**
 * True if `node` is a polynomial in `v`: built only from constants, symbols
 * (other symbols act as coefficients), `+`/`-`/`*`, division by `v`-free
 * subexpressions, and `^` with non-negative integer exponents. Reserved
 * constants (`pi`, `e`, …) and all function applications disqualify it.
 */
export function isPolynomialIn(node: MathNode, v: string): boolean {
  if (hasTranscendentalOrConstant(node)) return false;
  return isPolyNode(node, v);
}

// ─── Expansion to signed terms ────────────────────────────────────────────────

/** One expanded additive term: a product of numerator factors over denominator factors. */
type PolyTerm = { num: MathNode[]; den: MathNode[] };

const MAX_EXPANDED_TERMS = 4096;
const MAX_POWER_EXPONENT = 64;

function negateTerms(terms: PolyTerm[]): PolyTerm[] {
  return terms.map((t) => ({ num: [new math.ConstantNode(-1), ...t.num], den: t.den }));
}

function multiplyTermLists(a: PolyTerm[], b: PolyTerm[]): PolyTerm[] | null {
  if (a.length * b.length > MAX_EXPANDED_TERMS) return null;
  const out: PolyTerm[] = [];
  for (const ta of a) {
    for (const tb of b) {
      out.push({ num: [...ta.num, ...tb.num], den: [...ta.den, ...tb.den] });
    }
  }
  return out;
}

function powTermLists(base: PolyTerm[], exp: number): PolyTerm[] | null {
  let acc: PolyTerm[] = [{ num: [], den: [] }];
  for (let i = 0; i < exp; i++) {
    const next = multiplyTermLists(acc, base);
    if (!next) return null;
    acc = next;
  }
  return acc;
}

/**
 * Expand `node` into a list of signed product terms (distributes `*` over
 * `+`/`-` and `^` over its base). Returns null when the shape is not
 * expandable within bounds — callers treat that as "not handled here".
 */
function expandTerms(node: MathNode, v: string): PolyTerm[] | null {
  if (node.type === 'ConstantNode' || node.type === 'SymbolNode') {
    return [{ num: [node], den: [] }];
  }
  if (node.type === 'ParenthesisNode') {
    return expandTerms((node as unknown as { content: MathNode }).content, v);
  }
  if (node.type !== 'OperatorNode') return null;
  const op = (node as unknown as { op: string }).op;
  const args = (node as unknown as { args: MathNode[] }).args;

  if (op === '+' || (op === 'unaryPlus' && args.length === 1)) {
    const out: PolyTerm[] = [];
    for (const a of args) {
      const t = expandTerms(a, v);
      if (!t || out.length + t.length > MAX_EXPANDED_TERMS) return null;
      out.push(...t);
    }
    return out;
  }
  if (op === '-' || op === 'unaryMinus') {
    if (args.length === 1) {
      const t = expandTerms(args[0], v);
      return t ? negateTerms(t) : null;
    }
    const left = expandTerms(args[0], v);
    const right = expandTerms(args[1], v);
    if (!left || !right || left.length + right.length > MAX_EXPANDED_TERMS) return null;
    return [...left, ...negateTerms(right)];
  }
  if (op === '*') {
    let acc: PolyTerm[] = [{ num: [], den: [] }];
    for (const a of args) {
      const t = expandTerms(a, v);
      if (!t) return null;
      const next = multiplyTermLists(acc, t);
      if (!next) return null;
      acc = next;
    }
    return acc;
  }
  if (op === '/') {
    const numTerms = expandTerms(args[0], v);
    if (!numTerms) return null;
    // args[1] is v-free (checked by isPolynomialIn) — keep it as one divisor.
    return numTerms.map((t) => ({ num: t.num, den: [...t.den, args[1]] }));
  }
  if (op === '^') {
    const exp = constValue(args[1]);
    if (exp === null || !Number.isInteger(exp) || exp < 0 || exp > MAX_POWER_EXPONENT) return null;
    const base = expandTerms(args[0], v);
    if (!base) return null;
    return powTermLists(base, exp);
  }
  return null;
}

// ─── Antiderivative ───────────────────────────────────────────────────────────

function productNode(factors: MathNode[]): MathNode {
  let acc: MathNode = new math.ConstantNode(1);
  for (const f of factors) {
    acc = new math.OperatorNode('*', 'multiply', [acc, f]);
  }
  return acc;
}

function divideNode(num: MathNode, den: MathNode): MathNode {
  const divisor =
    den.type === 'ConstantNode' || den.type === 'SymbolNode'
      ? den
      : new math.ParenthesisNode(den);
  return new math.OperatorNode('/', 'divide', [num, divisor]);
}

function integrateTerm(term: PolyTerm, v: string): MathNode | null {
  let vDegree = 0;
  const constFactors: MathNode[] = [];
  for (const f of term.num) {
    if (f.type === 'SymbolNode' && (f as unknown as { name: string }).name === v) {
      vDegree += 1;
    } else if (referencesVar(f, v)) {
      return null; // post-expansion a v-factor is always the bare symbol — bail defensively
    } else {
      constFactors.push(f);
    }
  }
  // c·v^k → c·v^(k+1)/(k+1); constants (k=0) → c·v
  const vPow =
    vDegree === 0
      ? new math.SymbolNode(v)
      : new math.OperatorNode('^', 'pow', [
          new math.SymbolNode(v),
          new math.ConstantNode(vDegree + 1),
        ]);
  let result = productNode([...constFactors, vPow]);
  if (vDegree > 0) result = divideNode(result, new math.ConstantNode(vDegree + 1));
  for (const d of term.den) result = divideNode(result, d);
  return result;
}

/**
 * Symbolic antiderivative of a polynomial `node` in `v`. Assumes
 * {@link isPolynomialIn}; returns null only when expansion exceeds bounds.
 * The result is an un-simplified AST — callers serialize/simplify.
 */
export function polynomialAntiderivative(node: MathNode, v: string): MathNode | null {
  const terms = expandTerms(node, v);
  if (!terms) return null;
  let acc: MathNode | null = null;
  for (const t of terms) {
    const integrated = integrateTerm(t, v);
    if (!integrated) return null;
    acc = acc === null
      ? integrated
      : new math.OperatorNode('+', 'add', [acc, integrated]);
  }
  return acc ?? new math.ConstantNode(0);
}

// ─── Substitution (for polynomial limits) ─────────────────────────────────────

/** Replace every `v` SymbolNode with a parenthesized constant `value`. */
export function substituteConstant(node: MathNode, v: string, value: number): MathNode {
  return node.transform((n: MathNode) =>
    n.type === 'SymbolNode' && (n as unknown as { name: string }).name === v
      ? new math.ParenthesisNode(new math.ConstantNode(value))
      : n,
  );
}
