import { describe, it, expect } from 'vitest';
import * as math from 'mathjs';
import {
  parseExpression,
  serialize,
  roundtrip,
  MathValidationError,
} from '../../math/expressions.js';
import {
  countTerms,
  countDistinctVariables,
  listVariables,
} from '../../math/counters.js';
import {
  validateRational,
  validatePolynomial,
  validateTrig,
  validateExpLog,
  validateMatrix,
  validateByDomain,
} from '../../math/validation.js';

// ─── parseExpression ─────────────────────────────────────────────────────────

describe('parseExpression', () => {
  it('parses a valid expression', () => {
    const node = parseExpression('x^2 + 3*x');
    expect(node.type).toBe('OperatorNode');
  });

  it('throws MathValidationError on empty input', () => {
    expect(() => parseExpression('')).toThrow(MathValidationError);
  });

  it('throws MathValidationError on whitespace-only input', () => {
    expect(() => parseExpression('   ')).toThrow(MathValidationError);
  });

  it('throws MathValidationError on malformed syntax', () => {
    expect(() => parseExpression('x^')).toThrow(MathValidationError);
  });
});

// ─── serialize / roundtrip (capability matrix) ───────────────────────────────

describe('round-trip capability matrix (5/5)', () => {
  const samples = [
    '2*x^4 - 3*x^2 + 5', // polynomial
    'sin(x) + cos(x) + tan(x)', // trig
    '2^x + log10(x) + ln(x^2)', // exp/log
    'sin(x^2)', // composition (pre-substituted)
    '[[1,2],[3,4]]', // matrix
  ];

  for (const s of samples) {
    it(`round-trips: ${s}`, () => {
      const rt = roundtrip(s);
      expect(rt.equal).toBe(true);
      // canonical serialization is stable: re-serializing again matches
      expect(serialize(rt.reparsed)).toBe(rt.serialized);
    });
  }

  it('serialize uses a stable implicit-show / parenthesis-keep config', () => {
    // 2*x (not 2 x) and preserved parens
    expect(serialize(parseExpression('2*x^4 - 3*x^2 + 5'))).toBe(
      '2 * x ^ 4 - 3 * x ^ 2 + 5',
    );
  });
});

// ─── counters matrix ─────────────────────────────────────────────────────────

describe('counters', () => {
  it('countTerms counts top-level addition operands', () => {
    expect(countTerms(parseExpression('x^2 + 3*x + 1'))).toBe(3);
  });

  it('countTerms returns 1 for a single (non-addition) term', () => {
    expect(countTerms(parseExpression('x^2'))).toBe(1);
    expect(countTerms(parseExpression('x^2 * 3'))).toBe(1);
  });

  it('countDistinctVariables excludes math.js constants', () => {
    expect(countDistinctVariables(parseExpression('x*y + z'))).toBe(3);
    // 3 + 2i → 2*i, "i" is the imaginary unit, NOT a variable
    expect(countDistinctVariables(parseExpression('3 + 2i'))).toBe(0);
  });

  it('listVariables returns all variable symbols (order-insensitive)', () => {
    const vars = listVariables(parseExpression('a*x + b*y'));
    expect([...vars].sort()).toEqual(['a', 'b', 'x', 'y']);
  });

  it('does not count pi/e/i as variables', () => {
    expect(countDistinctVariables(parseExpression('pi * x + e'))).toBe(1);
  });
});

// ─── validation matrix (valid paths) ─────────────────────────────────────────

describe('validation — valid inputs accepted', () => {
  it('polynomial x^5 + x (deg 5) accepted', () => {
    expect(validatePolynomial(parseExpression('x^5 + x'), { maxDegree: 5 }).ok).toBe(true);
  });

  it('polynomial single variable only', () => {
    expect(validatePolynomial(parseExpression('x^5 + x'), { maxDegree: 5 }).ok).toBe(true);
  });

  it('trig sin+cos+tan + a+b+c (6 terms) accepted', () => {
    expect(
      validateTrig(parseExpression('sin(x)+cos(x)+tan(x)+a+b+c'), { maxTerms: 6 }).ok,
    ).toBe(true);
  });

  it('exp/log expression accepted', () => {
    expect(validateExpLog(parseExpression('2^x + log10(x) + ln(x^2)'), { maxTerms: 10 }).ok).toBe(
      true,
    );
  });

  it('rational expression accepted', () => {
    expect(validateRational(parseExpression('x^2 + 1')).ok).toBe(true);
    expect(validateByDomain('rational', parseExpression('(x^2 + 1) / (x - 1)')).ok).toBe(true);
  });

  it('matrix rectangular accepted', () => {
    expect(validateMatrix(parseExpression('[[1,2],[3,4]]')).ok).toBe(true);
  });

  it('validateByDomain dispatches correctly', () => {
    expect(validateByDomain('poly', parseExpression('x^3')).ok).toBe(true);
    expect(validateByDomain('trig', parseExpression('sin(x)')).ok).toBe(true);
    expect(validateByDomain('exp', parseExpression('exp(x)')).ok).toBe(true);
    expect(validateByDomain('log', parseExpression('ln(x)')).ok).toBe(true);
  });
});

// ─── validation matrix (INVALID inputs rejected with reason) ──────────────────

describe('validation — invalid inputs rejected', () => {
  it('rejects degree-6 polynomial', () => {
    const r = validatePolynomial(parseExpression('x^6 - 1'), { maxDegree: 5 });
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
    expect(r.reason!.length).toBeGreaterThan(0);
  });

  it('rejects nested trig composition sin(cos(x))', () => {
    const r = validateTrig(parseExpression('sin(cos(x))'), { maxTerms: 6 });
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  it('rejects bad-base log log_3(x)', () => {
    const r = validateExpLog(parseExpression('log_3(x)'), { maxTerms: 10 });
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  it('rejects ragged matrix', () => {
    const r = validateMatrix(parseExpression('[[1,2],[3]]'));
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe('string');
  });

  it('rejects polynomial with transcendental coefficient', () => {
    const r = validatePolynomial(parseExpression('sin(x) + 1'), { maxDegree: 5 });
    expect(r.ok).toBe(false);
  });

  it('rejects polynomial with two variables', () => {
    const r = validatePolynomial(parseExpression('x*y + 1'), { maxDegree: 5 });
    expect(r.ok).toBe(false);
  });

  it('rejects nested power e^(x^x)', () => {
    const r = validateExpLog(parseExpression('e^(x^x)'), { maxTerms: 10 });
    expect(r.ok).toBe(false);
  });
});
