// Pure composition-depth tracker — T7.
//
// CRITICAL: ZERO imports from @colyseus/schema or colyseus.js.
//
// Rulebook cap: cross-domain composition depth <= 2. The tracker throws on any
// push that would exceed depth 2 (assertComposition enforces the same invariant).

export const MAX_COMPOSITION_DEPTH = 2;

export class CompositionDepthTracker {
  private depths = new Map<string, number>();

  current(sessionId: string): number {
    return this.depths.get(sessionId) ?? 0;
  }

  /** +1. Throws if this would exceed MAX_COMPOSITION_DEPTH. */
  push(sessionId: string): void {
    const next = this.current(sessionId) + 1;
    if (next > MAX_COMPOSITION_DEPTH) {
      throw new Error(
        `Composition depth ${next} exceeds maximum of ${MAX_COMPOSITION_DEPTH} for ${sessionId}`,
      );
    }
    this.depths.set(sessionId, next);
  }

  /** -1. Throws if already at 0 (underflow guard). */
  pop(sessionId: string): void {
    const current = this.current(sessionId);
    if (current <= 0) {
      throw new Error(`Cannot pop composition depth below 0 for ${sessionId}`);
    }
    this.depths.set(sessionId, current - 1);
  }

  reset(sessionId: string): void {
    this.depths.set(sessionId, 0);
  }

  isWithinLimit(sessionId: string): boolean {
    return this.current(sessionId) <= MAX_COMPOSITION_DEPTH;
  }

  /** Throws if the current depth is already over the limit. */
  assertComposition(sessionId: string): void {
    if (!this.isWithinLimit(sessionId)) {
      throw new Error(
        `Composition depth limit (max ${MAX_COMPOSITION_DEPTH}) exceeded for ${sessionId}`,
      );
    }
  }
}
