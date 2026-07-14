import { describe, expect, it } from 'vitest';
import { ErrorCode } from '../../shared/ErrorCode.js';
import { registerHandlers, type HandlerClient, type HandlerRoom } from '../../rooms/handlers.js';

function harness() {
  const errors: Array<{ code: ErrorCode; message: string }> = [];
  const dispatches: Array<{ intent: string; payload: Record<string, unknown> }> = [];
  const handlers = new Map<string, (client: HandlerClient, payload: unknown) => Promise<void>>();
  const p1 = {
    sessionId: 'p1',
    hand: [{ id: 'card-1' }, { id: 'vvc-1' }, { id: 'defense-1' }],
    boards: [{ boardId: 'board-1', isActive: true }],
  };
  const p2 = {
    sessionId: 'p2',
    hand: [{ id: 'card-2' }],
    boards: [{ boardId: 'board-2', isActive: true }],
  };
  const players = new Map([['p1', p1], ['p2', p2]]);
  const room: HandlerRoom = {
    state: {
      phase: 'play',
      currentTurnPlayerId: 'p1',
      pendingTriggerId: 'trigger-1',
      defenseResponseUsed: false,
      players,
    },
    async dispatchIntent(_client, intent, payload) {
      dispatches.push({ intent, payload });
    },
    async requestEndTurn() {
      dispatches.push({ intent: 'end_turn', payload: {} });
    },
  };
  const client: HandlerClient = {
    sessionId: 'p1',
    send(_type, payload) {
      errors.push(payload);
    },
  };
  registerHandlers(room, (type, handler) => handlers.set(type, handler));
  return { client, dispatches, errors, handlers, p1, p2, room };
}

async function invoke(
  h: ReturnType<typeof harness>,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const handler = h.handlers.get(type);
  if (!handler) throw new Error(`missing handler: ${type}`);
  await handler(h.client, payload);
}

describe('room message handlers', () => {
  it('registers all ten canonical messages', () => {
    expect([...harness().handlers.keys()]).toEqual([
      'build_function', 'play_card', 'draw_cards', 'set_trap', 'play_defense',
      'eval_function', 'force_eval', 'end_turn', 'ready_inst', 'leave_room',
    ]);
  });

  it('rejects invalid payloads before dispatch', async () => {
    const h = harness();
    await invoke(h, 'play_card', { cardId: 4 });
    expect(h.errors[0]?.code).toBe(ErrorCode.INVALID_PAYLOAD);
    expect(h.dispatches).toEqual([]);
  });

  it('rejects illegal phase before card validation', async () => {
    const h = harness();
    h.room.state.phase = 'defense';
    await invoke(h, 'play_card', { type: 'play_card', cardId: 'not-in-hand' });
    expect(h.errors[0]?.code).toBe(ErrorCode.NOT_PHASE_NOT_DRAW);
  });

  it('rejects a non-turn owner', async () => {
    const h = harness();
    h.room.state.currentTurnPlayerId = 'p2';
    await invoke(h, 'play_card', { type: 'play_card', cardId: 'card-1' });
    expect(h.errors[0]?.code).toBe(ErrorCode.NOT_YOUR_TURN);
  });

  it('rejects batched draws that do not total exactly two cards', async () => {
    const h = harness();
    h.room.state.phase = 'draw';
    await invoke(h, 'draw_cards', {
      type: 'draw_cards', deckChoices: [{ deck: 'fcc', count: 1 }],
    });
    expect(h.errors[0]?.code).toBe(ErrorCode.INVALID_PAYLOAD);
    expect(h.dispatches).toEqual([]);
  });

  it('rejects a target that does not resolve to a live object', async () => {
    const h = harness();
    await invoke(h, 'play_card', {
      type: 'play_card',
      cardId: 'card-1',
      target: { kind: 'opp_board', id: 'destroyed-board' },
    });
    expect(h.errors[0]?.code).toBe(ErrorCode.INVALID_TARGET);
    expect(h.dispatches).toEqual([]);
  });

  it('allows construction submissions from both players without requiring the turn owner', async () => {
    const h = harness();
    h.room.state.phase = 'construction';
    const p2: HandlerClient = {
      sessionId: 'p2',
      send(_type, payload) { h.errors.push(payload); },
    };
    const handler = h.handlers.get('build_function');
    if (!handler) throw new Error('build_function handler missing');
    await handler(p2, {
      type: 'build_function', boardId: 'board-2', expression: 'x^2', variableIds: [], numberCardIds: [],
    });
    expect(h.errors).toEqual([]);
    expect(h.dispatches).toEqual([{
      intent: 'build_function',
      payload: {
        type: 'build_function', boardId: 'board-2', expression: 'x^2', variableIds: [], numberCardIds: [],
      },
    }]);
  });

  it('dispatches every canonical non-lifecycle intent after its validation contract', async () => {
    const h = harness();
    await invoke(h, 'build_function', {
      type: 'build_function', boardId: 'board-1', expression: 'x^2', variableIds: [], numberCardIds: [],
    });
    await invoke(h, 'play_card', { type: 'play_card', cardId: 'card-1', target: { kind: 'none' } });

    h.room.state.phase = 'draw';
    await invoke(h, 'draw_cards', {
      type: 'draw_cards', deckChoices: [{ deck: 'fcc', count: 1 }, { deck: 'action', count: 1 }],
    });

    h.room.state.phase = 'play';
    await invoke(h, 'set_trap', { type: 'set_trap', cardId: 'card-1', trigger: 'on_attack' });
    await invoke(h, 'eval_function', {
      type: 'eval_function', boardId: 'board-1', variableValueCardId: 'vvc-1',
    });
    await invoke(h, 'force_eval', { type: 'force_eval', variableValueCardId: 'vvc-1' });
    await invoke(h, 'end_turn', { type: 'end_turn' });

    h.room.state.phase = 'defense';
    await invoke(h, 'play_defense', {
      type: 'play_defense', cardId: 'defense-1', targetTriggerId: 'trigger-1',
    });

    h.room.state.phase = 'waiting';
    await invoke(h, 'ready_inst', { type: 'ready_inst' });

    expect(h.errors).toEqual([]);
    expect(h.dispatches.map(({ intent }) => intent)).toEqual([
      'build_function', 'play_card', 'draw_cards', 'set_trap', 'eval_function',
      'force_eval', 'end_turn', 'play_defense', 'ready_inst',
    ]);
  });

  it('rejects a defense response for an unknown trigger before dispatch', async () => {
    const h = harness();
    h.room.state.phase = 'defense';
    await invoke(h, 'play_defense', {
      type: 'play_defense', cardId: 'defense-1', targetTriggerId: 'unknown-trigger',
    });
    expect(h.errors[0]?.code).toBe(ErrorCode.INVALID_TARGET);
    expect(h.dispatches).toEqual([]);
  });
});
