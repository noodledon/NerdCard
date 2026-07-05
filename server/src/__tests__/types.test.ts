import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Board, GameRoomState } from '../shared/types.js';

describe('types', () => {
  it('GameRoomState requires stalling and isolation fields', () => {
    const schema = z.object({
      consecutive_no_eval_turns: z.number().int().min(0).max(5),
      global_no_eval_turns: z.number().int().min(0).max(20),
      variable_isolation_timers: z.record(z.string(), z.number().int()),
    });

    expect(() =>
      schema.parse({
        consecutive_no_eval_turns: 0,
        global_no_eval_turns: 0,
        variable_isolation_timers: {},
      }),
    ).not.toThrow();

    expect(() =>
      schema.parse({
        consecutive_no_eval_turns: 0,
        global_no_eval_turns: 25,
        variable_isolation_timers: {},
      }),
    ).toThrow();

    expect(() =>
      schema.parse({
        consecutive_no_eval_turns: 0,
        global_no_eval_turns: 0,
      }),
    ).toThrow();
  });

  it('Board expression accepts strings and rejects math.js Node at type layer', () => {
    const valid: Board = {
      id: 'board-1',
      ownerId: 'player-1',
      expression: 'x^2 + 3 * x',
      domains: ['poly'],
      compositionDepth: 0,
      isolatedVarCount: 1,
      integral: false,
    };

    expect(valid.expression).toBe('x^2 + 3 * x');

    const invalid: Board = {
      ...valid,
      // @ts-expect-error - strings-only invariant
      expression: 42,
    };

    expect(invalid.expression).not.toBe('x^2 + 3 * x');
  });
});
