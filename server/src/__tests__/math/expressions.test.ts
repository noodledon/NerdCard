import { describe, it, expect } from 'vitest';
import {
  distinctVariablesInExpression,
  isIsolatedExpression,
} from '../../math/expressions.js';

describe('isIsolatedExpression (rulebook "single variable")', () => {
  it.each([
    'x',
    '3*x',
    'x^2',
    'x+1', // one variable plus a constant still counts
    'x*x',
    'sin(x)', // function-name symbols are not variables
    'pi*x', // built-in constants are not variables
  ])('treats %s as isolated', (expr) => {
    expect(isIsolatedExpression(expr)).toBe(true);
  });

  it.each([
    'x+y',
    'x*y',
    '5',
    'pi',
    'x+y+z',
  ])('treats %s as not isolated', (expr) => {
    expect(isIsolatedExpression(expr)).toBe(false);
  });

  it.each([
    '',
    '   ',
    'x +', // unparseable
    'foo(',
  ])('guards %s without throwing', (expr) => {
    expect(isIsolatedExpression(expr)).toBe(false);
  });

  it('guards undefined without throwing', () => {
    expect(isIsolatedExpression(undefined)).toBe(false);
  });
});

describe('distinctVariablesInExpression', () => {
  it.each([
    ['x', 1],
    ['x+y', 2],
    ['x*y + z + 1', 3],
    ['5', 0],
  ])('counts %s as %i variables', (expr, expected) => {
    expect(distinctVariablesInExpression(expr)).toBe(expected);
  });

  it.each(['', '   ', 'x +'])('returns undefined for %s', (expr) => {
    expect(distinctVariablesInExpression(expr)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(distinctVariablesInExpression(undefined)).toBeUndefined();
  });
});
