/**
 * Exact reduced row-echelon form — pure-TS Gaussian elimination over
 * math.js `Fraction` (exact for the integer matrices the catalog produces).
 *
 * Pure math util: imports only from `mathjs`. No command calls these ops
 * (verified wave-11 T3) — they exist to close the engine stub inventory.
 */

import * as math from 'mathjs';

/**
 * Parse a matrix literal into a Fraction grid. Accepts both canonical wire
 * forms — `matrix([1,2],[3,4])` and the nested-array literal `[[1,2],[3,4]]`
 * (the shape the SymPy service takes). Returns null for anything that is not
 * a non-empty, rectangular, fully numeric 2-D matrix — callers answer with an
 * honest `supported: false` envelope rather than faking a result.
 */
export function parseMatrixToFractions(str: string): math.Fraction[][] | null {
  // The canonical wire form `matrix([1,2],[3,4])` is not a mathjs expression
  // (mathjs matrix() takes a single array) — normalize it to a nested-array
  // literal first. `matrix([[..],[..]])` and bare `[[..],[..]]` pass through.
  const trimmed = str.trim();
  let expr = trimmed;
  const wrapped = /^matrix\((.*)\)$/s.exec(trimmed);
  if (wrapped) {
    const inner = wrapped[1].trim();
    expr = inner.startsWith('[[') ? inner : `[${inner}]`;
  }
  let value: unknown;
  try {
    value = math.evaluate(expr);
  } catch {
    return null;
  }
  const arr = (math.isMatrix(value) ? (value as math.Matrix).toArray() : value) as unknown;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  if (!arr.every((row) => Array.isArray(row))) return null; // vectors/scalars are not matrices here

  const rows: math.Fraction[][] = [];
  for (const row of arr as unknown[][]) {
    const out: math.Fraction[] = [];
    for (const cell of row) {
      const n = typeof cell === 'number' ? cell : Number(cell);
      if (!Number.isFinite(n)) return null; // symbolic/complex entries stay SymPy-only
      out.push(math.fraction(n));
    }
    rows.push(out);
  }
  const width = rows[0].length;
  if (width === 0 || rows.some((r) => r.length !== width)) return null;
  return rows;
}

function isZero(f: math.Fraction): boolean {
  return Number(f) === 0;
}

/** Exact reduced row-echelon form via Gauss–Jordan elimination over Fractions. */
export function rrefFractions(input: math.Fraction[][]): math.Fraction[][] {
  const rows = input.map((r) => [...r]);
  const m = rows.length;
  const n = rows[0]?.length ?? 0;
  let r = 0;
  for (let col = 0; col < n && r < m; col++) {
    let pivot = -1;
    for (let i = r; i < m; i++) {
      if (!isZero(rows[i][col])) {
        pivot = i;
        break;
      }
    }
    if (pivot === -1) continue;
    [rows[r], rows[pivot]] = [rows[pivot], rows[r]];
    const pv = rows[r][col];
    rows[r] = rows[r].map((c) => math.divide(c, pv) as math.Fraction);
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const factor = rows[i][col];
      if (isZero(factor)) continue;
      rows[i] = rows[i].map(
        (c, j) => math.subtract(c, math.multiply(factor, rows[r][j])) as math.Fraction,
      );
    }
    r++;
  }
  return rows;
}

/** Rank = number of non-zero rows in the reduced form. */
export function rankFractions(input: math.Fraction[][]): number {
  return rrefFractions(input).filter((row) => row.some((c) => !isZero(c))).length;
}

/**
 * Serialize a Fraction grid to the canonical `matrix([..],[..])` form.
 * `Fraction.toFraction()` keeps non-integers exact (`1/3`), so the string
 * round-trips through math.evaluate without precision loss.
 */
export function matrixFractionsToString(rows: math.Fraction[][]): string {
  return 'matrix(' + rows.map((r) => '[' + r.map((c) => c.toFraction()).join(',') + ']').join(',') + ')';
}
