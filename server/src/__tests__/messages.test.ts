import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../shared/messages.js';

describe('messages', () => {
  it('build_function accepts string expression', () => {
    const payload = {
      type: 'build_function',
      boardId: 'board-1',
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
      boardId: 'board-1',
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

  it('draw_cards validates bounded deck choices', () => {
    const payload = {
      type: 'draw_cards',
      deckChoices: [{ deck: 'fcc', count: 1 }],
    };

    const result = parseClientMessage(payload);
    expect(result.ok).toBe(true);
  });

  it('accepts all ten canonical client message types', () => {
    const messages = [
      { type: 'build_function', boardId: 'board-1', expression: 'x+y' },
      { type: 'play_card', cardId: 'card-1' },
      { type: 'draw_cards', deckChoices: [{ deck: 'fcc', count: 1 }] },
      { type: 'set_trap', cardId: 'card-1', trigger: 'on_attack' },
      { type: 'play_defense', cardId: 'card-1', targetTriggerId: 'trigger-1' },
      { type: 'eval_function', boardId: 'board-1', variableValueCardId: 'vvc-1' },
      { type: 'force_eval', variableValueCardId: 'vvc-1' },
      { type: 'end_turn' },
      { type: 'ready_inst' },
      { type: 'leave_room' },
    ];

    for (const message of messages) expect(parseClientMessage(message).ok).toBe(true);
  });

  it('play_card keeps composition fields (variable, secondaryBoardId) through the schema', () => {
    const result = parseClientMessage({
      type: 'play_card',
      cardId: 'act-special-composition-001',
      target: { kind: 'self_board', id: 'board-1' },
      variable: 'y',
      secondaryBoardId: 'board-2',
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === 'play_card') {
      expect(result.message.variable).toBe('y');
      expect(result.message.secondaryBoardId).toBe('board-2');
    }
  });

  it('set_trap accepts a missing trigger (server derives it from the card)', () => {
    expect(parseClientMessage({ type: 'set_trap', cardId: 'card-1' }).ok).toBe(true);
    // A client-supplied value still validates for backward compatibility.
    expect(parseClientMessage({ type: 'set_trap', cardId: 'card-1', trigger: 'on_eval' }).ok).toBe(true);
    expect(parseClientMessage({ type: 'set_trap', cardId: 'card-1', trigger: 'bogus' }).ok).toBe(false);
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
