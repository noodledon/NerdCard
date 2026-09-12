import { describe, it, expect } from 'vitest';
import { mathjsEngine } from '../math/mathjs-engine.js';
import type { EngineNode } from '../math/engine.js';

describe('mathjsEngine', () => {
  describe('derivative', () => {
    it('computes derivative of x^2 by x', () => {
      const result = mathjsEngine.derivative('x^2', 'x');
      expect(mathjsEngine.symbolicEqual(result, '2 * x')).toBe(true);
    });
  });

  describe('det', () => {
    it('computes determinant of 2x2 matrix', () => {
      const result = mathjsEngine.det('matrix([1,2],[3,4])');
      expect(result).toBe(-2);
    });
  });

  describe('eigs', () => {
    it('returns eigenvalues of diagonal matrix', () => {
      const result = mathjsEngine.eigs('matrix([4,0],[0,1])');
      expect(result.ok).toBe(true);
      expect(result.supported).toBe(true);
      expect(result.partial).toBe(false);
      const values = result.value as number[];
      expect(values).toBeDefined();
      const sorted = [...values].sort((a, b) => a - b);
      expect(sorted).toEqual([1, 4]);
    });
  });

  describe('integrate (polynomial fast-path)', () => {
    it('integrates a polynomial term-by-term', () => {
      const result = mathjsEngine.integrate('x^2', 'x');
      expect(result.ok).toBe(true);
      expect(result.supported).toBe(true);
      expect(mathjsEngine.symbolicEqual(String(result.value), 'x^3/3')).toBe(true);
    });

    it('returns the honest stub for non-polynomial input', () => {
      const result = mathjsEngine.integrate('sin(x)', 'x');
      expect(result.ok).toBe(false);
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/Not implemented in v1/);
    });
  });

  describe('limit (polynomial fast-path)', () => {
    it('evaluates a polynomial limit by substitution', () => {
      const result = mathjsEngine.limit('x^2', 'x', 0);
      expect(result.ok).toBe(true);
      expect(result.supported).toBe(true);
      expect(result.value).toBe('0');
    });

    it('returns unsupported stub for non-polynomial input', () => {
      const result = mathjsEngine.limit('1/x', 'x', 0);
      expect(result.ok).toBe(false);
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/Not implemented in v1/);
    });
  });

  describe('dormant ops (wave-11 T3)', () => {
    // rref/rank run exact Fraction elimination on the mathjs engine; no
    // in-catalog card reaches them (the LA commands use det/lup/eigs/lusolve).
    // The live SymPy expectations for the same ops sit in
    // math/integration.test.ts.
    it('rref reduces an invertible matrix to the identity', () => {
      const result = mathjsEngine.rref('matrix([1,2],[3,4])');
      expect(result).toMatchObject({
        ok: true,
        supported: true,
        value: 'matrix([1,0],[0,1])',
      });
    });

    it('rref accepts the nested-array literal form', () => {
      const result = mathjsEngine.rref('[[1,2],[2,4]]');
      expect(result).toMatchObject({
        ok: true,
        supported: true,
        value: 'matrix([1,2],[0,0])',
      });
    });

    it('rref keeps non-integer entries exact as fractions', () => {
      const result = mathjsEngine.rref('matrix([2,1],[4,2])');
      expect(result.ok).toBe(true);
      expect(result.value).toBe('matrix([1,1/2],[0,0])');
    });

    it('rref rejects non-numeric input honestly', () => {
      const result = mathjsEngine.rref('matrix([x,2],[3,4])');
      expect(result.ok).toBe(false);
      expect(result.supported).toBe(false);
    });

    it('rank counts non-zero rref rows', () => {
      expect(mathjsEngine.rank('matrix([1,2],[2,4])')).toMatchObject({
        ok: true,
        supported: true,
        value: '1',
      });
      expect(mathjsEngine.rank('matrix([1,2],[3,4])')).toMatchObject({
        ok: true,
        supported: true,
        value: '2',
      });
    });

    it('continuityCheck answers continuous for polynomials', () => {
      const result = mathjsEngine.continuityCheck('x^2', 'x', 0);
      expect(result).toMatchObject({ ok: true, supported: true, value: 'true' });
    });

    it('continuityCheck returns the pinned not-decidable stub otherwise', () => {
      const result = mathjsEngine.continuityCheck('1/x', 'x', 0);
      expect(result.ok).toBe(false);
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/Not implemented in v1/);
    });
  });

  describe('round-trip strings-only', () => {
    it('toString(parse(...)) returns a string', () => {
      const node = mathjsEngine.parse('x^2 + 3*x');
      const str = mathjsEngine.toString(node);
      expect(typeof str).toBe('string');
      expect(str.length).toBeGreaterThan(0);
      // Verify via simplify comparison
      expect(mathjsEngine.symbolicEqual(str, 'x^2 + 3 * x')).toBe(true);
    });
  });

  describe('opaque EngineNode blocks string assignment', () => {
    it('prevents string assignment at compile time', () => {
      const node: EngineNode = mathjsEngine.parse('x');
      // @ts-expect-error: EngineNode is NOT assignable to string — this is the opaque guard
      const _leak: string = node;
      // The line above MUST produce a TS error. If it compiles, the guard is broken.
      // We only reach here if @ts-expect-error suppressed the error (which is desired).
      expect(_leak).toBeDefined();
    });
  });
});
