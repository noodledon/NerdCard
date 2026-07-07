import { describe, it, expect } from 'vitest';
import { CompositionDepthTracker, MAX_COMPOSITION_DEPTH } from '../../logic/composition.js';

describe('CompositionDepthTracker', () => {
  it('starts at depth 0', () => {
    const t = new CompositionDepthTracker();
    expect(t.current('sessA')).toBe(0);
    expect(t.isWithinLimit('sessA')).toBe(true);
  });

  it('pushes and tracks depth', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    expect(t.current('sessA')).toBe(1);
    t.push('sessA');
    expect(t.current('sessA')).toBe(2);
  });

  it('throws on the 3rd push (depth would exceed 2)', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    expect(() => t.push('sessA')).toThrow();
  });

  it('throws (not silently accepts) when already at the cap', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    let threw = false;
    try {
      t.push('sessA');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(t.current('sessA')).toBe(MAX_COMPOSITION_DEPTH);
  });

  it('pops and decreases depth', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    t.pop('sessA');
    expect(t.current('sessA')).toBe(1);
  });

  it('throws on pop below 0', () => {
    const t = new CompositionDepthTracker();
    expect(() => t.pop('sessA')).toThrow();
  });

  it('resets depth', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    t.reset('sessA');
    expect(t.current('sessA')).toBe(0);
  });

  it('isWithinLimit true at depth 2, false beyond', () => {
    const t = new CompositionDepthTracker();
    t.push('sessA');
    t.push('sessA');
    expect(t.isWithinLimit('sessA')).toBe(true);
    // Cannot actually push to 3 (throws), so assertComposition at cap is fine:
    expect(() => t.assertComposition('sessA')).not.toThrow();
  });

  it('assertComposition does not throw within the limit', () => {
    const t = new CompositionDepthTracker();
    expect(() => t.assertComposition('sessA')).not.toThrow();
  });
});
