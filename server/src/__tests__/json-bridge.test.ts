import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { JsonBridgeServer } from '../json-bridge.js';
import { ErrorCode } from '../shared/ErrorCode.js';

/**
 * In-repo smoke coverage for the JSON bridge — the only transport the Godot
 * client uses. Each test boots a fresh JsonBridgeServer on an OS-assigned
 * ephemeral port (`start(0)`), so the suite never collides with a dev server
 * on :2567/:2568 or another vitest process.
 *
 * The bridge streams a `state_snapshot` every 100ms. Every message wait goes
 * through `waitFor`/`waitForNext`, which match on type or predicate and ignore
 * non-matching frames — never wait for "any" message or a snapshot wins.
 */

interface BridgeMessage {
  type: string;
  [key: string]: unknown;
}

interface SnapshotPlayer {
  hand?: Array<{ id: string; cardType?: string }>;
  boards?: Array<{ boardId: string }>;
  isConnected?: boolean;
  [key: string]: unknown;
}

interface SnapshotState {
  phase?: string;
  currentTurnPlayerId?: string;
  players?: Record<string, SnapshotPlayer>;
}

type MessagePred = (msg: BridgeMessage) => boolean;

const ofType = (type: string): MessagePred => (msg) => msg.type === type;
const isSnapshot = (msg: BridgeMessage): boolean => msg.type === 'state_snapshot';
const isResponse = (msg: BridgeMessage): boolean => msg.type === 'ack' || msg.type === 'error';
const snapshotPhase = (phase: string): MessagePred =>
  (msg) => isSnapshot(msg) && (msg.state as SnapshotState | undefined)?.phase === phase;

function snapshotState(msg: BridgeMessage): SnapshotState {
  return (msg.state ?? {}) as SnapshotState;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class BridgeClient {
  private readonly ws: WebSocket;
  private readonly received: BridgeMessage[] = [];
  private readonly waiters: Array<{
    pred: MessagePred;
    resolve: (msg: BridgeMessage) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private readonly closed: Promise<void>;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.closed = new Promise((resolve) => ws.once('close', () => resolve()));
    ws.on('message', (data) => this.onMessage(data));
    ws.on('error', () => { /* surfaces through 'close' / waiter rejection */ });
    ws.on('close', () => {
      for (const waiter of this.waiters.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('socket closed while waiting'));
      }
    });
  }

  static connect(url: string): Promise<BridgeClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.once('open', () => resolve(new BridgeClient(ws)));
      ws.once('error', reject);
    });
  }

  send(msg: Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  /** First buffered-or-future message matching `pred`; non-matches stay buffered. */
  waitFor(pred: MessagePred, timeoutMs = 3000, label = 'message'): Promise<BridgeMessage> {
    const idx = this.received.findIndex(pred);
    if (idx >= 0) {
      const [msg] = this.received.splice(idx, 1);
      return Promise.resolve(msg);
    }
    return this.enqueue(pred, timeoutMs, label);
  }

  /** Like waitFor but ignores the buffer — for state observed after an action. */
  waitForNext(pred: MessagePred, timeoutMs = 3000, label = 'message'): Promise<BridgeMessage> {
    return this.enqueue(pred, timeoutMs, label);
  }

  close(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
    return this.closed;
  }

  private enqueue(pred: MessagePred, timeoutMs: number, label: string): Promise<BridgeMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`timed out waiting for ${label} (${timeoutMs}ms)`));
      }, timeoutMs);
      this.waiters.push({ pred, resolve, reject, timer });
    });
  }

  private onMessage(data: unknown): void {
    const msg = JSON.parse(String(data)) as BridgeMessage;
    const idx = this.waiters.findIndex((w) => w.pred(msg));
    if (idx >= 0) {
      const [waiter] = this.waiters.splice(idx, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(msg);
      return;
    }
    if (isSnapshot(msg)) {
      // Collapse buffered snapshots: only the newest is ever worth asserting.
      const old = this.received.findIndex(isSnapshot);
      if (old >= 0) this.received.splice(old, 1);
    }
    this.received.push(msg);
  }
}

let bridge: JsonBridgeServer;
let bridgeUrl: string;
let clients: BridgeClient[];

beforeEach(async () => {
  bridge = new JsonBridgeServer();
  bridge.start(0);
  // start() creates the http server synchronously but binds async; the test
  // reaches the ephemeral port through the (private) server so no fixed port
  // is ever bound.
  const server = (bridge as unknown as { httpServer?: http.Server }).httpServer;
  if (!server) throw new Error('JsonBridgeServer did not create its http server');
  if (!server.listening) {
    await new Promise<void>((resolve) => server.once('listening', resolve));
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('JsonBridgeServer is not bound to a TCP port');
  }
  bridgeUrl = `ws://localhost:${address.port}`;
  clients = [];
});

afterEach(async () => {
  for (const client of clients.splice(0)) {
    await client.close();
  }
  bridge.dispose();
});

async function connect(): Promise<BridgeClient> {
  const client = await BridgeClient.connect(bridgeUrl);
  clients.push(client);
  return client;
}

function joinRoom(client: BridgeClient, extra: Record<string, unknown> = {}): Promise<BridgeMessage> {
  client.send({ type: 'join_room', room: 'nerdiclash', displayName: 'tester', ...extra });
  return client.waitFor(
    (msg) => msg.type === 'joined' || msg.type === 'error',
    3000,
    'joined|error',
  );
}

/**
 * Join, retrying while the room reports ROOM_FULL. Disconnect teardown and
 * seat reclaim happen on the server-side close event, which can lag the
 * client's own 'close' by a few ms — a ROOM_FULL reply mutates nothing, so
 * polling with fresh sockets is a safe way to wait for it.
 */
async function joinRoomWithRetry(
  extra: Record<string, unknown> = {},
  attempts = 25,
): Promise<{ client: BridgeClient; msg: BridgeMessage }> {
  let client = await connect();
  let msg = await joinRoom(client, extra);
  for (
    let i = 1;
    i < attempts && msg.type === 'error' && msg.code === ErrorCode.ROOM_FULL;
    i += 1
  ) {
    await client.close();
    await sleep(50);
    client = await connect();
    msg = await joinRoom(client, extra);
  }
  return { client, msg };
}

async function joinTwoPlayers(): Promise<{
  c1: BridgeClient; c2: BridgeClient; sid1: string; sid2: string;
}> {
  const c1 = await connect();
  const j1 = await joinRoom(c1);
  expect(j1.type).toBe('joined');
  const c2 = await connect();
  const j2 = await joinRoom(c2);
  expect(j2.type).toBe('joined');
  return { c1, c2, sid1: String(j1.sessionId), sid2: String(j2.sessionId) };
}

describe('JsonBridgeServer', () => {
  it('answers join_room with joined {sessionId, role}', async () => {
    const client = await connect();
    const joined = await joinRoom(client);
    expect(joined.type).toBe('joined');
    expect(typeof joined.sessionId).toBe('string');
    expect(joined.role).toBe('p1');
  });

  it('assigns p2 to the second join and broadcasts the construction snapshot', async () => {
    const { c1, sid1, sid2 } = await joinTwoPlayers();

    const snap = await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    const state = snapshotState(snap);
    expect(state.phase).toBe('construction');
    expect(state.currentTurnPlayerId).toBe(sid1);
    expect(Object.keys(state.players ?? {})).toEqual([sid1, sid2]);
  });

  it('rejects a third join with ROOM_FULL', async () => {
    await joinTwoPlayers();

    const third = await connect();
    const resp = await joinRoom(third);
    expect(resp.type).toBe('error');
    expect(resp.code).toBe(ErrorCode.ROOM_FULL);
  });

  it('replies INVALID_JSON to malformed frames', async () => {
    const client = await connect();
    client.sendRaw('not valid json {{{');
    const resp = await client.waitFor(ofType('error'), 3000, 'error');
    expect(resp.code).toBe('INVALID_JSON');
  });

  it('replies INVALID_PAYLOAD with the failing path to schema-invalid intents', async () => {
    const client = await connect();
    const joined = await joinRoom(client);
    expect(joined.type).toBe('joined');

    client.send({ type: 'play_card' });
    const resp = await client.waitFor(ofType('error'), 3000, 'error');
    expect(resp.code).toBe(ErrorCode.INVALID_PAYLOAD);
    expect(String(resp.message)).toContain('cardId');
  });

  it('acks a valid intent with its intent name', async () => {
    const client = await connect();
    const joined = await joinRoom(client);
    expect(joined.type).toBe('joined');

    client.send({ type: 'ready_inst' });
    const resp = await client.waitFor(ofType('ack'), 3000, 'ack');
    expect(resp.intent).toBe('ready_inst');
  });

  it('hides opponent hand and decks in state_snapshot', async () => {
    const { c1, c2, sid1, sid2 } = await joinTwoPlayers();

    const snap = await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    const players = snapshotState(snap).players ?? {};

    const mine = players[sid1];
    const theirs = players[sid2];
    expect(mine).toBeDefined();
    expect(theirs).toBeDefined();
    expect(Array.isArray(mine?.hand)).toBe(true);
    expect((mine?.hand ?? []).length).toBeGreaterThan(0);
    for (const key of ['hand', 'deckFCC', 'deckNumber', 'deckAction', 'availableVariables']) {
      expect(theirs).not.toHaveProperty(key);
    }

    const snap2 = await c2.waitFor(isSnapshot, 3000, 'state_snapshot');
    const players2 = snapshotState(snap2).players ?? {};
    expect(players2[sid1]).not.toHaveProperty('hand');
    expect(Array.isArray(players2[sid2]?.hand)).toBe(true);
  });

  it('restores the seat when a disconnected client rejoins with its sessionId', async () => {
    const { c1, sid1, sid2 } = await joinTwoPlayers();
    await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');

    await c1.close();

    const { client: rejoined, msg } = await joinRoomWithRetry({ sessionId: sid1, displayName: 'tester' });
    expect(msg.type).toBe('joined');
    expect(msg.sessionId).toBe(sid1);
    expect(msg.role).toBe('p1');

    const snap = await rejoined.waitForNext(isSnapshot, 3000, 'state_snapshot');
    const players = snapshotState(snap).players ?? {};
    expect(Object.keys(players)).toEqual([sid1, sid2]);
    expect(players[sid1]?.isConnected).toBe(true);
  });

  it('tears the game down once every client disconnects', async () => {
    const { c1, c2 } = await joinTwoPlayers();
    await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');

    await Promise.all([c1.close(), c2.close()]);

    const { client: fresh, msg } = await joinRoomWithRetry();
    expect(msg.type).toBe('joined');
    expect(msg.role).toBe('p1');

    // A torn-down room starts a brand-new game: the first joiner is alone.
    const snap = await fresh.waitForNext(isSnapshot, 3000, 'state_snapshot');
    expect(Object.keys(snapshotState(snap).players ?? {})).toHaveLength(1);
  });

  it('rejects an off-turn play_card with NOT_YOUR_TURN', async () => {
    const { c1, c2, sid1, sid2 } = await joinTwoPlayers();

    const conSnap = await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    const players = snapshotState(conSnap).players ?? {};
    const board1 = players[sid1]?.boards?.[0]?.boardId;
    const board2 = players[sid2]?.boards?.[0]?.boardId;
    expect(board1).toBeTruthy();
    expect(board2).toBeTruthy();

    c1.send({ type: 'build_function', boardId: board1, expression: 'x' });
    const b1 = await c1.waitFor(isResponse, 3000, 'build_function response');
    expect(b1).toMatchObject({ type: 'ack', intent: 'build_function' });
    c2.send({ type: 'build_function', boardId: board2, expression: 'x' });
    const b2 = await c2.waitFor(isResponse, 3000, 'build_function response');
    expect(b2).toMatchObject({ type: 'ack', intent: 'build_function' });

    const drawSnap = await c1.waitFor(snapshotPhase('draw'), 3000, 'draw snapshot');
    const turnId = snapshotState(drawSnap).currentTurnPlayerId;
    const turnClient = turnId === sid1 ? c1 : c2;
    const offClient = turnId === sid1 ? c2 : c1;
    const offSid = turnId === sid1 ? sid2 : sid1;

    turnClient.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
    const draw = await turnClient.waitFor(isResponse, 3000, 'draw_cards response');
    expect(draw).toMatchObject({ type: 'ack', intent: 'draw_cards' });

    const playSnap = await offClient.waitFor(snapshotPhase('play'), 3000, 'play snapshot');
    const offState = snapshotState(playSnap).players?.[offSid];
    const cardId = offState?.hand?.[0]?.id;
    expect(cardId).toBeTruthy();

    offClient.send({ type: 'play_card', cardId, target: { kind: 'none' } });
    const resp = await offClient.waitFor(isResponse, 3000, 'play_card response');
    expect(resp.type).toBe('error');
    expect(resp.code).toBe(ErrorCode.NOT_YOUR_TURN);
  });
});
