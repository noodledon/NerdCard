import { afterEach, describe, expect, it, vi } from 'vitest';
import { NerdiClashRoom } from '../../rooms/NerdiClashRoom.js';
import { GameRoomState, PlayerSchema } from '../../state/schema.js';

type TestClient = {
  sessionId: string;
  send(type: string, payload: unknown): void;
  leave(code?: number): void;
};

type TestRoom = {
  state: GameRoomState;
  clients: { length: number };
  disconnect(): Promise<unknown>;
  onJoin(client: TestClient, options: unknown): Promise<void>;
  onLeave(client: TestClient, consented: boolean): Promise<void>;
  onDispose(): void;
};

function makePlayer(id: string, connected = true): PlayerSchema {
  const player = new PlayerSchema();
  player.sessionId = id;
  player.isConnected = connected;
  return player;
}

function roomHarness() {
  const state = new GameRoomState();
  const p1 = makePlayer('p1');
  const p2 = makePlayer('p2');
  state.players.set('p1', p1);
  state.players.set('p2', p2);
  const disconnect = vi.fn(async () => undefined);
  const room = Object.create(NerdiClashRoom.prototype) as unknown as TestRoom;
  room.state = state;
  room.clients = { length: 1 };
  room.disconnect = disconnect;
  return { room, p1, p2, disconnect };
}

function client(id: string, events: Array<{ type: string; payload: unknown }> = []): TestClient {
  return {
    sessionId: id,
    send(type, payload) { events.push({ type, payload }); },
    leave() {},
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Wave 4 room lifecycle edges', () => {
  it('(e) waits exactly 30 seconds after both consented disconnects before disposal', async () => {
    vi.useFakeTimers();
    const { room, disconnect } = roomHarness();

    await room.onLeave(client('p1'), true);
    await room.onLeave(client('p2'), true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(disconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    room.onDispose();
  });

  it('(e) cancels the pending disposal when either player reconnects', async () => {
    vi.useFakeTimers();
    const { room, p1, disconnect } = roomHarness();

    await room.onLeave(client('p1'), true);
    await room.onLeave(client('p2'), true);
    p1.isConnected = false;
    await room.onJoin(client('p1'), {});
    await vi.advanceTimersByTimeAsync(30_000);

    expect(disconnect).not.toHaveBeenCalled();
    expect(p1.isConnected).toBe(true);
    room.onDispose();
  });

  it('(f) sends the original defense deadline when a defender reconnects', async () => {
    const { room, p1 } = roomHarness();
    const events: Array<{ type: string; payload: unknown }> = [];
    room.state.phase = 'defense';
    room.state.turnDeadline = Date.now() + 5_000;
    p1.isConnected = false;

    await room.onJoin(client('p1', events), {});

    expect(events).toEqual([{
      type: 'game_event',
      payload: {
        event: JSON.stringify({ type: 'defense_resumed', deadline: room.state.turnDeadline }),
        actorId: 'p1',
        turnId: room.state.turnIndex,
      },
    }]);
  });
});
