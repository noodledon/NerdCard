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

  describe('integrate (stub)', () => {
    it('returns unsupported stub', () => {
      const result = mathjsEngine.integrate('x^2', 'x');
      expect(result.ok).toBe(false);
      expect(result.supported).toBe(false);
      expect(result.reason).toMatch(/Not implemented in v1/);
    });
  });

  describe('limit (stub)', () => {
    it('returns unsupported stub', () => {
      const result = mathjsEngine.limit('1/x', 'x', 0);
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
