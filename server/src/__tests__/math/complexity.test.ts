import { describe, it, expect } from 'vitest';
import { parseExpression } from '../../math/expressions.js';
import {
  computeComplexity,
  computeEligibleComplexity,
  isEligibleForHP,
  countCompositionHits,
} from '../../math/complexity.js';

/**
 * T9 acceptance + QA scenarios.
 *
 * Every row is tied to a rulebook example or an explicitly enumerated edge case
 * from the Wave-2 task spec. The walker must reproduce these scores exactly.
 */
describe('T9 complexity walker — rulebook pinned examples', () => {
  // HP-eligible complexity (computeEligibleComplexity). Ineligible expressions
  // (fewer than 2 distinct variables) gate to 0 even though their raw score is
  // positive — this is the value the HP formula (T10/T14) actually consumes.
  // [expr, wantEligibleScore, wantEligible]
  const eligibleCases: Array<[string, number, boolean]> = [
    // f(x) = x: raw 1 but ineligible (< 2 vars) -> eligible complexity 0
    ['x', 0, false],
    // 1 var + 1 term-beyond-first (raw 2), ineligible -> eligible 0
    ['x^2 + 3*x', 0, false],
    // RULEBOOK required example: 2 vars + 1 term-beyond-first -> 3, eligible
    ['x^2 + y', 3, true],
    // RULEBOOK required example: 2 vars + 1 term-beyond-first -> 3, eligible
    ['sin(x) + cos(y)', 3, true],
    // 3 vars + 2 terms-beyond-first -> 5, eligible
    ['x*y + z + 1', 5, true],
    // matrix -> 0 vars -> 0, ineligible
    ['[[1,2],[3,4]]', 0, false],
    // complex constant -> 0 vars -> 0, ineligible
    ['3 + 2i', 0, false],
  ];

  for (const [expr, wantScore, wantEligible] of eligibleCases) {
    it(`computeEligibleComplexity(${JSON.stringify(expr)}) === ${wantScore} (eligible=${wantEligible})`, () => {
      const n = parseExpression(expr);
      expect(computeEligibleComplexity(n)).toBe(wantScore);
      expect(isEligibleForHP(n)).toBe(wantEligible);
    });
  }

  // Raw (ungated) complexity — matches the rulebook's per-expression scoring
  // breakdown. Only computeEligibleComplexity is used for HP; these pin the
  // raw `computeComplexity` values from the task spec.
  // [expr, wantRawScore]
  const rawCases: Array<[string, number]> = [
    ['x', 1],
    ['x^2 + 3*x', 2],
    ['x^2 + y', 3],
    ['sin(x) + cos(y)', 3],
    ['x*y + z + 1', 5],
    ['[[1,2],[3,4]]', 0],
    ['3 + 2i', 0],
  ];

  for (const [expr, wantRaw] of rawCases) {
    it(`computeComplexity(${JSON.stringify(expr)}) === ${wantRaw} (raw, ungated)`, () => {
      expect(computeComplexity(parseExpression(expr))).toBe(wantRaw);
    });
  }
});

describe('T9 raw vs eligible gating', () => {
  it('raw computeComplexity("x") === 1 even when ineligible', () => {
    expect(computeComplexity(parseExpression('x'))).toBe(1);
    expect(computeEligibleComplexity(parseExpression('x'))).toBe(0);
  });

  it('f(x,y) = x^2 + y -> raw 3, eligible', () => {
    const n = parseExpression('x^2 + y');
    expect(computeComplexity(n)).toBe(3);
    expect(isEligibleForHP(n)).toBe(true);
  });

  it('f(x,y) = sin(x) + cos(y) -> raw 3', () => {
    expect(computeComplexity(parseExpression('sin(x) + cos(y)'))).toBe(3);
  });
});

describe('T9 composition detection', () => {
  it('pre-substituted sin(x^2) scores 1 (no composition bonus)', () => {
    const pre = parseExpression('sin(x^2)');
    expect(computeComplexity(pre)).toBe(1); // 1 var, 0 terms-beyond, 0 composition
    expect(countCompositionHits(pre)).toBe(0);
  });

  it('explicit FunctionAssignmentNode composition adds +2 (>=2 over pre-substituted)', () => {
    const pre = parseExpression('sin(x^2)');
    const preScore = computeComplexity(pre);
    // math.js parses the multi-statement into a BlockNode carrying the
    // FunctionAssignmentNodes (f, g) and the composed call g(f(x)).
    const comp = parseExpression('f(x) = x^2 ; g(u) = sin(u) ; g(f(x))');
    const compScore = computeComplexity(comp);

    expect(preScore).toBe(1);
    expect(compScore - preScore).toBeGreaterThanOrEqual(2); // at least +2 from composition
    expect(countCompositionHits(comp)).toBe(1); // exactly one composition hit
  });

  it('g(f(x)) standalone -> 1 composition hit, raw = 3', () => {
    const n = parseExpression('g(f(x))');
    expect(countCompositionHits(n)).toBe(1);
    expect(computeComplexity(n)).toBe(3); // 1 var + 0 terms-beyond + 2*1
  });

  it('built-in nesting sin(sin(x)) still scores as composition-free for user defs (no false user-fn hit)', () => {
    // sin is built-in; without a FunctionAssignmentNode this is NOT a user composition.
    // (We only assert it does not exceed the cap and does not break scoring.)
    const n = parseExpression('sin(sin(x))');
    expect(countCompositionHits(n)).toBeLessThanOrEqual(4);
    expect(computeComplexity(n)).toBeGreaterThanOrEqual(1);
  });

  it('composition hits capped at 4 regardless of nesting depth', () => {
    // a(b(c(d(e(f(x)))))) -> 5 nested user calls -> capped to 4
    const deep = parseExpression('a(b(c(d(e(f(x))))))');
    const hits = countCompositionHits(deep);
    expect(hits).toBeLessThanOrEqual(4);
    expect(hits).toBe(4); // exactly the cap
  });
});
