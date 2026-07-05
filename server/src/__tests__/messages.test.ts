import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../shared/messages.js';

describe('messages', () => {
  it('build_function accepts string expression', () => {
    const payload = {
      type: 'build_function',
      expression: 'x^2 + 3 * x',
      variableIds: [1, 2],
      numberCardIds: [],
    };

    const result = parseClientMessage(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('build_function');
    }
  });

  it('build_function rejects non-string expression', () => {
    const payload = {
      type: 'build_function',
      expression: {},
      variableIds: [],
      numberCardIds: [],
    };

    const result = parseClientMessage(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues[0].path[0]).toBe('expression');
    }
  });

  it('draw_cards is shape-valid when total count is less than 2', () => {
    const payload = {
      type: 'draw_cards',
      deckChoices: [{ deck: 'fcc', count: 1 }],
    };

    const result = parseClientMessage(payload);
    expect(result.ok).toBe(true);
  });

  it('parseClientMessage returns structured error for unknown type', () => {
    const payload = { type: 'unknown_intent' };

    const result = parseClientMessage(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
