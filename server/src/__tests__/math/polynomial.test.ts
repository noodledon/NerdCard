import { describe, it, expect } from 'vitest';
import { parseExpression } from '../../math/expressions.js';
import {
  isPolynomialIn,
  degreeOf,
} from '../../math/polynomial.js';
import { mathjsEngine } from '../../math/mathjs-engine.js';
import type { EngineResult } from '../../math/engine.js';

function integrate(expr: string, v: string): EngineResult {
  return mathjsEngine.integrate(expr, v) as EngineResult;
}

function limit(expr: string, v: string, approach: number | string): EngineResult {
  return mathjsEngine.limit(expr, v, approach) as EngineResult;
}

describe('isPolynomialIn', () => {
  it.each([
    'x^2 + 3*x',
    '5',
    'x',
    'x^2/3', // constant denominator is a coefficient
    '(x+1)^2 * (x-1)',
    'x*y + y^2', // other symbols are coefficients
    'x^(2)',
    'x^0',
  ])('accepts %s', (expr) => {
    expect(isPolynomialIn(parseExpression(expr), 'x')).toBe(true);
  });

  it.each([
    'sin(x)', // transcendental
    'x^-1', // negative exponent → rational
    '2^x', // variable exponent → exponential
    'x^0.5', // fractional exponent → radical
    'x^x',
    '1/(x+1)', // v in denominator
    'x/(x-1)',
    'pi*x', // reserved constant
    'e^x',
    'log10(x)',
    'max(x, 1)', // arbitrary functions rejected, not just transcendentals
  ])('rejects %s', (expr) => {
    expect(isPolynomialIn(parseExpression(expr), 'x')).toBe(false);
  });

  it('is scoped to the integration variable', () => {
    // 'y' is a coefficient w.r.t. x — but 'x/y' stays polynomial while
    // 'x^y' does not (y is the exponent).
    expect(isPolynomialIn(parseExpression('x/y'), 'x')).toBe(true);
    expect(isPolynomialIn(parseExpression('x^y'), 'x')).toBe(false);
  });
});

describe('mathjsEngine.integrate (polynomial fast-path)', () => {
  it('integrates x^2 + 3*x term-by-term', () => {
    const r = integrate('x^2 + 3*x', 'x');
    expect(r).toMatchObject({ ok: true, supported: true });
    expect(
      mathjsEngine.symbolicEqual(String(r.value), 'x^3/3 + 3*x^2/2'),
    ).toBe(true);
  });

  it('integrates a constant to c*v', () => {
    const r = integrate('5', 'x');
    expect(r.ok).toBe(true);
    expect(mathjsEngine.symbolicEqual(String(r.value), '5*x')).toBe(true);
  });

  it('keeps exact rational coefficients (x^2/3 → x^3/9)', () => {
    const r = integrate('x^2/3', 'x');
    expect(r.ok).toBe(true);
    expect(mathjsEngine.symbolicEqual(String(r.value), 'x^3/9')).toBe(true);
  });

  it('expands products before integrating ((x+1)^2 → x^3/3 + x^2 + x)', () => {
    const r = integrate('(x+1)^2', 'x');
    expect(r.ok).toBe(true);
    expect(
      mathjsEngine.symbolicEqual(String(r.value), 'x^3/3 + x^2 + x'),
    ).toBe(true);
  });

  it('treats other variables as coefficients', () => {
    const r = integrate('x*y + y^2', 'x');
    expect(r.ok).toBe(true);
    expect(
      mathjsEngine.symbolicEqual(String(r.value), 'y*x^2/2 + y^2*x'),
    ).toBe(true);
  });

  it('handles subtraction and unary minus', () => {
    const r = integrate('2*x^3 - x + 5', 'x');
    expect(r.ok).toBe(true);
    expect(
      mathjsEngine.symbolicEqual(String(r.value), 'x^4/2 - x^2/2 + 5*x'),
    ).toBe(true);
  });

  it.each(['sin(x)', 'x^-1', '2^x', 'x^0.5', '1/(x+1)', 'pi*x'])(
    'returns the unchanged stub for %s',
    (expr) => {
      const r = integrate(expr, 'x');
      expect(r.ok).toBe(false);
      expect(r.supported).toBe(false);
      expect(r.reason).toMatch(/Not implemented in v1/);
    },
  );
});

describe('mathjsEngine.limit (polynomial fast-path)', () => {
  it('limit(x^2, x, 0) → 0 by substitution', () => {
    const r = limit('x^2', 'x', 0);
    expect(r).toMatchObject({ ok: true, supported: true, value: '0' });
  });

  it('evaluates at a nonzero finite point', () => {
    const r = limit('x^2 + 3*x', 'x', 2);
    expect(r.ok).toBe(true);
    expect(r.value).toBe('10');
  });

  it('keeps residual symbols for multi-variable polynomials', () => {
    const r = limit('x^2 + y', 'x', 0);
    expect(r.ok).toBe(true);
    expect(String(r.value)).toBe('y');
  });

  it('resolves constant-expression approach strings', () => {
    const r = limit('x^2', 'x', '1/2');
    expect(r.ok).toBe(true);
    expect(mathjsEngine.symbolicEqual(String(r.value), '1/4')).toBe(true);
  });

  it.each(['sin(x)/x', '1/x', 'exp(x)'])(
    'returns the unchanged stub for non-polynomial %s',
    (expr) => {
      const r = limit(expr, 'x', 0);
      expect(r.ok).toBe(false);
      expect(r.supported).toBe(false);
      expect(r.reason).toMatch(/Not implemented in v1/);
    },
  );

  it.each(['Infinity', 'x', ''])(
    'returns the stub for unresolvable approach %j',
    (approach) => {
      const r = limit('x^2', 'x', approach);
      expect(r.ok).toBe(false);
      expect(r.supported).toBe(false);
      expect(r.reason).toMatch(/Not implemented in v1/);
    },
  );

  it('returns the stub for non-finite numeric approach', () => {
    const r = limit('x^2', 'x', Infinity);
    expect(r.ok).toBe(false);
    expect(r.supported).toBe(false);
  });
});

describe('degreeOf (shared helper, moved from validation)', () => {
  it('still computes degrees for validation', () => {
    expect(degreeOf(parseExpression('x^2 + 3*x'), 'x')).toBe(2);
    expect(degreeOf(parseExpression('x^2 + y'), 'y')).toBe(1);
  });
});
