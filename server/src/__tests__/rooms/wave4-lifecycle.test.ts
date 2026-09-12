import { afterEach, describe, expect, it, vi } from 'vitest';
import { NerdiClashRoom } from '../../rooms/NerdiClashRoom.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
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
  allowReconnection(client: TestClient, seconds: number): Promise<unknown>;
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
  const allowReconnection = vi.fn(async () => ({}));
  const room = Object.create(NerdiClashRoom.prototype) as unknown as TestRoom;
  const game = new NerdiClashGame();
  game.state.players.set('p1', p1);
  game.state.players.set('p2', p2);
  // Sync game state with room state for tests that modify room.state directly
  game.state.phase = state.phase;
  game.state.turnDeadline = state.turnDeadline;
  game.state.turnIndex = state.turnIndex;
  (room as unknown as { game: NerdiClashGame }).game = game;
  room.state = state;
  room.clients = { length: 1 };
  room.disconnect = disconnect;
  room.allowReconnection = allowReconnection;
  return { room, p1, p2, disconnect, allowReconnection };
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
    const game = (room as unknown as { game: NerdiClashGame }).game;
    game.state.phase = 'defense';
    game.state.turnDeadline = Date.now() + 5_000;
    room.state.phase = 'defense';
    room.state.turnDeadline = game.state.turnDeadline;
    p1.isConnected = false;

    await room.onJoin(client('p1', events), {});

    expect(events).toEqual([{
      type: 'game_event',
      payload: {
        event: JSON.stringify({ type: 'defense_resumed', deadline: game.state.turnDeadline }),
        actorId: 'p1',
        turnId: game.state.turnIndex,
      },
    }]);
  });
});

describe('Colyseus allowReconnection path', () => {
  it('offers a 30s reconnect window on a non-consented drop and keeps the seat', async () => {
    const { room, allowReconnection } = roomHarness();
    const dropped = client('p1');

    await room.onLeave(dropped, false);

    // The room hands Colyseus the dropped client with a 30-second window.
    expect(allowReconnection).toHaveBeenCalledWith(dropped, 30);
    // The seat is marked offline but never removed — reconnect finds it.
    const seat = room.state.players.get('p1');
    expect(seat?.isConnected).toBe(false);
    expect(room.state.players.size).toBe(2);
  });

  it('a rejoin inside the window restores the same seat object', async () => {
    const { room } = roomHarness();
    const seatBefore = room.state.players.get('p1');

    await room.onLeave(client('p1'), false);
    await room.onJoin(client('p1'), {});

    const seatAfter = room.state.players.get('p1');
    expect(seatAfter).toBe(seatBefore); // same PlayerSchema — sessionId/role intact
    expect(seatAfter?.isConnected).toBe(true);
  });

  it('schedules teardown when the window expires with everyone still gone', async () => {
    vi.useFakeTimers();
    const { room, p2, disconnect, allowReconnection } = roomHarness();
    allowReconnection.mockRejectedValue(new Error('reconnect timeout'));

    await room.onLeave(client('p1'), true); // consented — no reconnect offer
    expect(allowReconnection).not.toHaveBeenCalled();

    p2.isConnected = false;
    await room.onLeave(client('p2'), false); // drops, offer expires unclaimed

    expect(allowReconnection).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(disconnect).toHaveBeenCalledTimes(1);
    room.onDispose();
  });
});
