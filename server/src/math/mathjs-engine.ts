import * as math from 'mathjs';
import type { MathEngine, EngineNode, EngineResult } from './engine.js';
import { serialize, type MathNode } from './expressions.js';
import {
  isPolynomialIn,
  polynomialAntiderivative,
  substituteConstant,
} from './polynomial.js';
import {
  parseMatrixToFractions,
  rrefFractions,
  rankFractions,
  matrixFractionsToString,
} from './rref.js';
import {
  INTEGRATE_STUB,
  LIMIT_STUB,
  CONTINUITY_STUB,
} from './stubs.js';

type InternalNode = { _tag: 'EngineNode'; _node: math.MathNode | math.Complex };

function wrap(node: math.MathNode | math.Complex): EngineNode {
  return { _tag: 'EngineNode', _node: node as unknown };
}

function unwrap(node: EngineNode): math.MathNode | math.Complex {
  return (node as unknown as InternalNode)._node;
}

function parseMatrixString(str: string): math.Matrix {
  const idx = str.indexOf('(');
  if (idx === -1) {
    throw new Error(`Invalid matrix format: ${str}`);
  }
  const inner = str.slice(idx + 1, str.lastIndexOf(')'));
  const jsonStr = '[' + inner + ']';
  try {
    const rows = JSON.parse(jsonStr) as number[][];
    return math.matrix(rows);
  } catch {
    throw new Error(`Failed to parse matrix string: ${str}`);
  }
}

function matrixToString(mat: math.Matrix): string {
  const arr = mat.toArray() as number[][];
  const rows = arr.map((row) => '[' + row.join(',') + ']');
  return 'matrix(' + rows.join(',') + ')';
}

function collectionToMatrix(c: math.MathCollection): math.Matrix {
  return c as math.Matrix;
}

function toNumberArray(values: math.MathCollection): number[] {
  const arr = (values as unknown as math.Matrix).toArray() as unknown as number[];
  return arr.flat();
}

function eigsResult(values: number[], partial: boolean): EngineResult {
  return {
    ok: true,
    supported: true,
    partial,
    value: values,
  };
}

/** Canonical string for a computed node — simplified when possible. */
function serializeSimplified(node: MathNode): string {
  try {
    return serialize(math.simplify(node));
  } catch {
    return serialize(node);
  }
}

/**
 * Resolve a limit's approach point to a finite number. Numeric strings and
 * constant expressions ('1/2', 'pi') are evaluated; anything non-numeric or
 * non-finite ('Infinity', 'x') returns null so the caller can stay honest.
 */
function resolveFiniteApproach(approach: number | string): number | null {
  if (typeof approach === 'number') {
    return Number.isFinite(approach) ? approach : null;
  }
  const trimmed = approach.trim();
  if (!trimmed) return null;
  try {
    const value = math.evaluate(trimmed) as unknown;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export const mathjsEngine = {
  parse(expr: string): EngineNode {
    return wrap(math.parse(expr));
  },

  toString(node: EngineNode): string {
    const inner = unwrap(node);
    if (math.isComplex(inner) || math.typeOf(inner) === 'Complex') {
      return (inner as math.Complex).toString();
    }
    return (inner as math.MathNode).toString();
  },

  evaluate(
    expr: string,
    scope: Record<string, number | EngineNode>,
  ): number | EngineNode {
    const resolvedScope: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(scope)) {
      if (typeof val === 'number') {
        resolvedScope[key] = val;
      } else {
        resolvedScope[key] = unwrap(val);
      }
    }
    const node = math.parse(expr);
    const compiled = node.compile();
    const result = compiled.evaluate(resolvedScope);
    if (typeof result === 'number') {
      return result;
    }
    if (math.isMatrix(result)) {
      return wrap(math.parse(matrixToString(result as math.Matrix)));
    }
    if (math.typeOf(result) === 'Complex' || math.isComplex(result)) {
      return wrap(result as math.Complex);
    }
    return wrap(math.parse(String(result)));
  },

  derivative(expr: string, variable: string): string {
    const node = math.parse(expr);
    const result = math.derivative(node, variable);
    return result.toString();
  },

  integrate(expr: string, variable: string): EngineResult {
    const node = math.parse(expr);
    if (!isPolynomialIn(node, variable)) return INTEGRATE_STUB;
    const anti = polynomialAntiderivative(node, variable);
    if (!anti) return INTEGRATE_STUB;
    return { ok: true, supported: true, value: serializeSimplified(anti) };
  },

  limit(
    expr: string,
    variable: string,
    approach: number | string,
  ): EngineResult {
    const node = math.parse(expr);
    if (!isPolynomialIn(node, variable)) return LIMIT_STUB;
    const point = resolveFiniteApproach(approach);
    if (point === null) return LIMIT_STUB;
    // A polynomial is continuous — its limit is plain substitution.
    return {
      ok: true,
      supported: true,
      value: serializeSimplified(substituteConstant(node, variable, point)),
    };
  },

  // Pinned v1 answer: a polynomial is continuous at every point of ℝ —
  // "continuous" iff `expr` is a polynomial in `variable`. Anything else
  // (denominator zeros, domain analysis) is honestly not decidable here and
  // stays SymPy-only via the hybrid engine.
  continuityCheck(
    expr: string,
    variable: string,
    _point: number,
  ): EngineResult {
    let node: math.MathNode;
    try {
      node = math.parse(expr);
    } catch {
      return CONTINUITY_STUB;
    }
    if (!isPolynomialIn(node, variable)) return CONTINUITY_STUB;
    return { ok: true, supported: true, value: 'true' };
  },

  simplify(expr: string): string {
    const node = math.parse(expr);
    const result = math.simplify(node);
    return result.toString();
  },

  rationalize(expr: string): string {
    const node = math.parse(expr);
    const result = math.rationalize(node);
    return result.toString();
  },

  symbolicEqual(a: string, b: string): boolean {
    const nodeA = math.parse(a);
    const nodeB = math.parse(b);
    return math.symbolicEqual(nodeA, nodeB);
  },

  det(matrixStr: string): number {
    const M = parseMatrixString(matrixStr);
    return math.det(M);
  },

  inv(matrixStr: string): string {
    const M = parseMatrixString(matrixStr);
    const result = math.inv(M);
    return matrixToString(result as math.Matrix);
  },

  lup(matrixStr: string): { L: string; U: string; P: string } {
    const M = parseMatrixString(matrixStr);
    const result = math.lup(M);
    return {
      L: matrixToString(collectionToMatrix(result.L)),
      U: matrixToString(collectionToMatrix(result.U)),
      P: '[' + result.p.join(',') + ']',
    };
  },

  qr(matrixStr: string): { Q: string; R: string } {
    const M = parseMatrixString(matrixStr);
    const result = math.qr(M);
    return {
      Q: matrixToString(collectionToMatrix(result.Q)),
      R: matrixToString(collectionToMatrix(result.R)),
    };
  },

  svd(matrixStr: string): { U: string; S: string; V: string } {
    const M = parseMatrixString(matrixStr);
    const arr = M.toArray() as number[][];
    const m = arr.length;
    const n = arr[0]?.length ?? 0;

    const AT = math.transpose(M);
    const ATA = math.multiply(AT, M);
    const AAT = math.multiply(M, AT);

    try {
      const eigAAT = math.eigs(AAT);
      const eigATA = math.eigs(ATA);

      const rawValues = toNumberArray(eigAAT.values);
      const sigma = rawValues
        .map((v: number) => Math.sqrt(Math.max(0, v)))
        .sort((a: number, b: number) => b - a);

      const Srows: number[][] = [];
      for (let i = 0; i < m; i++) {
        const row = new Array<number>(n).fill(0);
        if (i < sigma.length) row[i] = sigma[i];
        Srows.push(row);
      }
      const S = matrixToString(math.matrix(Srows));

      const eVecsAAT = eigAAT.eigenvectors.map(
        (e) => collectionToMatrix(e.vector),
      );
      const eVecsATA = eigATA.eigenvectors.map(
        (e) => collectionToMatrix(e.vector),
      );

      const Ucols = eVecsAAT.slice(0, m).map(
        (v) => (v.toArray() as number[]).flat(),
      );
      const Umat = math.matrix(Ucols);
      const UT = math.transpose(Umat);
      const U = matrixToString(collectionToMatrix(UT));

      const Vcols = eVecsATA.slice(0, n).map(
        (v) => (v.toArray() as number[]).flat(),
      );
      const VmatT = math.matrix(Vcols);
      const Vresult = math.transpose(VmatT);
      const V = matrixToString(collectionToMatrix(Vresult));

      return { U, S, V };
    } catch {
      return {
        U: matrixToString(math.identity(m) as math.Matrix),
        S: matrixToString(math.zeros(m, n) as math.Matrix),
        V: matrixToString(math.identity(n) as math.Matrix),
      };
    }
  },

  eigs(matrixStr: string): EngineResult {
    try {
      const M = parseMatrixString(matrixStr);
      const result = math.eigs(M);
      if (!result || !result.values) {
        return {
          ok: false,
          supported: false,
          reason: 'math.js eigs failed — no values returned',
        };
      }
      const values = toNumberArray(result.values);
      values.sort((a: number, b: number) => a - b);
      try {
        return eigsResult(values, false);
      } catch {
        return {
          ok: false,
          supported: false,
          reason: 'math.js eigs failed on defective matrix',
        };
      }
    } catch {
      return {
        ok: false,
        supported: false,
        reason: 'math.js eigs failed',
      };
    }
  },

  expm(matrixStr: string): string {
    const M = parseMatrixString(matrixStr);
    const result = math.expm(M);
    return matrixToString(result as math.Matrix);
  },

  sqrtm(matrixStr: string): string {
    const M = parseMatrixString(matrixStr);
    const result = math.sqrtm(M);
    return matrixToString(result as math.Matrix);
  },

  lusolve(matrixStr: string, bStr: string): string {
    const M = parseMatrixString(matrixStr);
    const b = parseMatrixString(bStr);
    const result = math.lusolve(M, b as math.MathCollection);
    return matrixToString(result as math.Matrix);
  },

  rref(matrixStr: string): EngineResult {
    const rows = parseMatrixToFractions(matrixStr);
    if (!rows) {
      return {
        ok: false,
        supported: false,
        reason: 'rref expects a non-empty numeric 2-D matrix literal',
      };
    }
    return {
      ok: true,
      supported: true,
      value: matrixFractionsToString(rrefFractions(rows)),
    };
  },

  rank(matrixStr: string): EngineResult {
    const rows = parseMatrixToFractions(matrixStr);
    if (!rows) {
      return {
        ok: false,
        supported: false,
        reason: 'rank expects a non-empty numeric 2-D matrix literal',
      };
    }
    return { ok: true, supported: true, value: String(rankFractions(rows)) };
  },

  gcd(a: number, b: number): number {
    return math.gcd(a, b);
  },

  lcm(a: number, b: number): number {
    return math.lcm(a, b);
  },

  mod(a: number, b: number): number {
    return math.mod(a, b);
  },

  invmod(a: number, m: number): number {
    const result = math.xgcd(a, m) as unknown as number[];
    const gcd = result[0];
    const x = result[1];
    if (gcd !== 1) {
      throw new Error(`Modular inverse does not exist: gcd(${a}, ${m}) = ${gcd}`);
    }
    return ((x % m) + m) % m;
  },

  isPrime(n: number): boolean {
    return math.isPrime(n) as boolean;
  },

  polynomialRoot(...coeffs: number[]): number[] {
    const reversed = [...coeffs].reverse();
    let results: (number | math.Complex)[];
    switch (reversed.length) {
      case 1:
        results = [reversed[0]];
        break;
      case 2:
        results = math.polynomialRoot(reversed[0], reversed[1]);
        break;
      case 3:
        results = math.polynomialRoot(reversed[0], reversed[1], reversed[2]);
        break;
      case 4:
        results = math.polynomialRoot(
          reversed[0],
          reversed[1],
          reversed[2],
          reversed[3],
        );
        break;
      default:
        results = [];
    }
    return results.map((r) => {
      if (typeof r === 'number') return r;
      return (r as math.Complex).re;
    });
  },

  complex(re: number, im: number): EngineNode {
    return wrap(math.complex(re, im));
  },

  complexToString(node: EngineNode): string {
    const inner = unwrap(node);
    return (inner as math.Complex).toString();
  },
};
