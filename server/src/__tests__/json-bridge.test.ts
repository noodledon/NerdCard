import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { WebSocket } from 'ws';
import { JsonBridgeServer } from '../json-bridge.js';
import { ErrorCode } from '../shared/ErrorCode.js';
import { Phase } from '../logic/fsm.js';
import { mathEngine } from '../math/index.js';
import type { EngineResult } from '../math/index.js';
import type { NerdiClashGame } from '../rooms/NerdiClashGame.js';
import { CardSchema, addToHand } from '../state/schema.js';

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
  c1: BridgeClient; c2: BridgeClient; sid1: string; sid2: string; tok1: string; tok2: string;
}> {
  const c1 = await connect();
  const j1 = await joinRoom(c1);
  expect(j1.type).toBe('joined');
  const c2 = await connect();
  const j2 = await joinRoom(c2);
  expect(j2.type).toBe('joined');
  return {
    c1, c2,
    sid1: String(j1.sessionId), sid2: String(j2.sessionId),
    tok1: String(j1.reconnectToken), tok2: String(j2.reconnectToken),
  };
}

describe('JsonBridgeServer', () => {
  it('answers join_room with joined {sessionId, role, reconnectToken}', async () => {
    const client = await connect();
    const joined = await joinRoom(client);
    expect(joined.type).toBe('joined');
    expect(typeof joined.sessionId).toBe('string');
    expect(joined.role).toBe('p1');
    expect(typeof joined.reconnectToken).toBe('string');
    expect(String(joined.reconnectToken).length).toBeGreaterThan(0);
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

  it('restores the seat when a disconnected client rejoins with sessionId + reconnectToken', async () => {
    const { c1, sid1, sid2, tok1 } = await joinTwoPlayers();
    await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');

    await c1.close();

    const { client: rejoined, msg } = await joinRoomWithRetry({ sessionId: sid1, reconnectToken: tok1, displayName: 'tester' });
    expect(msg.type).toBe('joined');
    expect(msg.sessionId).toBe(sid1);
    expect(msg.role).toBe('p1');

    const snap = await rejoined.waitForNext(isSnapshot, 3000, 'state_snapshot');
    const players = snapshotState(snap).players ?? {};
    expect(Object.keys(players)).toEqual([sid1, sid2]);
    expect(players[sid1]?.isConnected).toBe(true);
  });

  it('rejects a seat reclaim that omits the reconnectToken — and keeps the seat reserved', async () => {
    const { c1, sid1, tok1 } = await joinTwoPlayers();
    await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    await c1.close();

    // A bare sessionId is guessable (json-N) — it must NOT reclaim the seat.
    // The rejection surfaces as ROOM_FULL, identical to any other fresh join
    // against a full room, so a probe learns nothing about the seat's state.
    const attacker = await connect();
    const resp = await joinRoom(attacker, { sessionId: sid1 });
    expect(resp.type).toBe('error');
    expect(resp.code).toBe(ErrorCode.ROOM_FULL);

    const { msg } = await joinRoomWithRetry({ sessionId: sid1, reconnectToken: tok1 });
    expect(msg.type).toBe('joined');
    expect(msg.sessionId).toBe(sid1);
  });

  it('rejects a seat reclaim with a wrong reconnectToken', async () => {
    const { c1, sid1, tok1 } = await joinTwoPlayers();
    await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    await c1.close();

    const attacker = await connect();
    const resp = await joinRoom(attacker, { sessionId: sid1, reconnectToken: 'forged-token' });
    expect(resp.type).toBe('error');
    expect(resp.code).toBe(ErrorCode.ROOM_FULL);

    const { msg } = await joinRoomWithRetry({ sessionId: sid1, reconnectToken: tok1 });
    expect(msg.type).toBe('joined');
    expect(msg.sessionId).toBe(sid1);
  });

  it('keeps live sockets and terminates dead ones in the heartbeat sweep', async () => {
    const { c1, c2, sid1, tok1 } = await joinTwoPlayers();
    await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');

    const internals = bridge as unknown as {
      clients: Map<string, { ws: WebSocket }>;
      socketLiveness: WeakMap<WebSocket, boolean>;
      runHeartbeat(): void;
    };
    const ws1 = internals.clients.get(sid1)?.ws;
    expect(ws1).toBeDefined();

    // A responsive client pongs automatically between sweeps and survives.
    // Each sweep marks every socket false and pings; the sleep lets the
    // auto-pongs flip them back to true before the next sweep checks.
    internals.runHeartbeat();
    await sleep(50);
    internals.runHeartbeat();
    expect(ws1?.readyState).toBe(WebSocket.OPEN);
    await sleep(50);

    // Simulate a half-open peer: the last interval's pong never arrived, so
    // the next sweep terminates the socket and frees the seat. The flag set
    // and the sweep are synchronous — no in-flight pong can interleave.
    internals.socketLiveness.set(ws1 as WebSocket, false);
    internals.runHeartbeat();
    await c1.close();

    const gone = await c2.waitForNext(
      (msg) => isSnapshot(msg) && snapshotState(msg).players?.[sid1]?.isConnected === false,
      3000,
      'disconnect snapshot',
    );
    expect(gone.type).toBe('state_snapshot');

    const { msg } = await joinRoomWithRetry({ sessionId: sid1, reconnectToken: tok1 });
    expect(msg.type).toBe('joined');
    expect(msg.sessionId).toBe(sid1);
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

  /**
   * Wave-10 T2: drive a joined pair through construction into the draw phase
   * and report which client owns the turn.
   */
  async function driveToDraw(): Promise<{
    turnClient: BridgeClient; offClient: BridgeClient; turnId: string;
  }> {
    const { c1, c2, sid1, sid2 } = await joinTwoPlayers();
    const conSnap = await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    const players = snapshotState(conSnap).players ?? {};
    const board1 = players[sid1]?.boards?.[0]?.boardId;
    const board2 = players[sid2]?.boards?.[0]?.boardId;
    c1.send({ type: 'build_function', boardId: board1, expression: 'x' });
    c2.send({ type: 'build_function', boardId: board2, expression: 'x' });
    await c1.waitFor(isResponse, 3000, 'build_function response');
    await c2.waitFor(isResponse, 3000, 'build_function response');

    const drawSnap = await c1.waitFor(snapshotPhase('draw'), 3000, 'draw snapshot');
    const turnId = String(snapshotState(drawSnap).currentTurnPlayerId);
    return {
      turnClient: turnId === sid1 ? c1 : c2,
      offClient: turnId === sid1 ? c2 : c1,
      turnId,
    };
  }

  it('rejects draw batches that do not total exactly 2 with INVALID_PAYLOAD', async () => {
    const { turnClient } = await driveToDraw();

    for (const deckChoices of [
      [{ deck: 'fcc', count: 1 }],
      [{ deck: 'fcc', count: 2 }, { deck: 'action', count: 2 }],
      [{ deck: 'fcc', count: 2 }, { deck: 'number', count: 1 }],
    ]) {
      turnClient.send({ type: 'draw_cards', deckChoices });
      const resp = await turnClient.waitFor(isResponse, 3000, 'draw_cards response');
      expect(resp.type).toBe('error');
      expect(resp.code).toBe(ErrorCode.INVALID_PAYLOAD);
    }

    // The exact-2 batch still works afterwards — nothing mutated.
    turnClient.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
    const draw = await turnClient.waitFor(isResponse, 3000, 'draw_cards response');
    expect(draw).toMatchObject({ type: 'ack', intent: 'draw_cards' });
  });

  it('surfaces NOT_YOUR_TURN for an off-turn end_turn and NOT_PHASE_NOT_DRAW in draw', async () => {
    const { turnClient, offClient } = await driveToDraw();

    // Draw phase: even the turn owner can't end a turn that hasn't started —
    // the phase check precedes the owner check, matching the handler order.
    turnClient.send({ type: 'end_turn' });
    const wrongPhase = await turnClient.waitFor(isResponse, 3000, 'end_turn response');
    expect(wrongPhase.type).toBe('error');
    expect(wrongPhase.code).toBe(ErrorCode.NOT_PHASE_NOT_DRAW);

    turnClient.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
    await turnClient.waitFor(isResponse, 3000, 'draw_cards response');
    await offClient.waitFor(snapshotPhase('play'), 3000, 'play snapshot');

    offClient.send({ type: 'end_turn' });
    const offResp = await offClient.waitFor(isResponse, 3000, 'end_turn response');
    expect(offResp.type).toBe('error');
    expect(offResp.code).toBe(ErrorCode.NOT_YOUR_TURN);
  });

  it('rejects a build_function rewrite of a live board during play', async () => {
    const { turnClient, offClient, turnId } = await driveToDraw();

    turnClient.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
    await turnClient.waitFor(isResponse, 3000, 'draw_cards response');
    const playSnap = await turnClient.waitFor(snapshotPhase('play'), 3000, 'play snapshot');
    const players = snapshotState(playSnap).players ?? {};
    const turnBoard = players[turnId]?.boards?.[0]?.boardId;

    turnClient.send({ type: 'build_function', boardId: turnBoard, expression: 'x*y*z' });
    const resp = await turnClient.waitFor(isResponse, 3000, 'build_function response');
    expect(resp.type).toBe('error');

    const next = await offClient.waitForNext(isSnapshot, 3000, 'state_snapshot');
    expect(snapshotState(next).players?.[turnId]?.boards?.[0]).toMatchObject({
      boardId: turnBoard, expression: 'x',
    });
  });

  /**
   * Wave-10 T4: intents and ticks share one FIFO lane. With the math engine
   * stalled mid-`play_card`, neither a following `end_turn` nor an expired
   * play deadline (which the 250ms interval tick would otherwise consume)
   * may mutate state until the in-flight intent resolves.
   */
  it('serializes intents and ticks — a slow engine cannot interleave', async () => {
    const { c1, c2, sid1, sid2 } = await joinTwoPlayers();

    const conSnap = await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
    const players = snapshotState(conSnap).players ?? {};
    const board1 = players[sid1]?.boards?.[0]?.boardId;
    const board2 = players[sid2]?.boards?.[0]?.boardId;

    c1.send({ type: 'build_function', boardId: board1, expression: 'x' });
    c2.send({ type: 'build_function', boardId: board2, expression: 'x' });
    await c1.waitFor(isResponse, 3000, 'build_function response');
    await c2.waitFor(isResponse, 3000, 'build_function response');

    const drawSnap = await c1.waitFor(snapshotPhase('draw'), 3000, 'draw snapshot');
    const turnId = String(snapshotState(drawSnap).currentTurnPlayerId);
    const turnClient = turnId === sid1 ? c1 : c2;

    turnClient.send({ type: 'draw_cards', deckChoices: [{ deck: 'action', count: 2 }] });
    const draw = await turnClient.waitFor(isResponse, 3000, 'draw_cards response');
    expect(draw).toMatchObject({ type: 'ack', intent: 'draw_cards' });
    await turnClient.waitFor(snapshotPhase('play'), 3000, 'play snapshot');

    // Hand the turn player an Integral card straight into state — the FCC
    // draw is shuffled, so seeding beats drawing and praying.
    const game = (bridge as unknown as { game?: NerdiClashGame }).game;
    expect(game).toBeDefined();
    const player = game?.state.players.get(turnId);
    expect(player).toBeDefined();
    const integral = new CardSchema();
    integral.id = 'fcc-calc-integral-001';
    integral.cardType = 'integral';
    integral.subtype = 'Integral';
    integral.deckType = 'fcc';
    addToHand(player as NonNullable<typeof player>, integral);

    let release!: (result: EngineResult) => void;
    const gate = new Promise<EngineResult>((resolve) => { release = resolve; });
    const spy = vi.spyOn(mathEngine, 'integrate').mockImplementation(() => gate);

    try {
      turnClient.send({ type: 'play_card', cardId: integral.id, target: { kind: 'none' } });
      turnClient.send({ type: 'end_turn' });

      // Wait long enough for the intent to be in-flight, then let the play
      // deadline lapse and outlast several tick intervals — an unqueued tick
      // would auto-pass play→resolution→draw and rotate the turn owner.
      await sleep(50);
      if (game) game.state.turnDeadline = Date.now() - 1;
      await sleep(600);

      expect(game?.state.phase).toBe('play');
      expect(game?.state.currentTurnPlayerId).toBe(turnId);

      release({ ok: true, supported: true, value: 'x^2/2' });

      const playResp = await turnClient.waitFor(isResponse, 3000, 'play_card response');
      expect(playResp).toMatchObject({ type: 'ack', intent: 'play_card' });
      const endResp = await turnClient.waitFor(isResponse, 3000, 'end_turn response');
      expect(endResp).toMatchObject({ type: 'ack', intent: 'end_turn' });

      const next = await turnClient.waitFor(snapshotPhase('draw'), 3000, 'post-resolve draw');
      expect(snapshotState(next).currentTurnPlayerId).not.toBe(turnId);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * Wave-11 T1: the bridge multiplexes independent 2P rooms selected by
   * `join_room.room`. A missing/empty field routes to the 'nerdiclash'
   * default; names are validated; slots die with their last socket.
   */
  describe('multi-room', () => {
    it('runs two rooms as independent games on one bridge', async () => {
      const a1 = await connect();
      const ja1 = await joinRoom(a1, { room: 'alpha' });
      expect(ja1.type).toBe('joined');
      expect(ja1.role).toBe('p1');

      const b1 = await connect();
      const jb1 = await joinRoom(b1, { room: 'beta' });
      expect(jb1.type).toBe('joined');
      expect(jb1.role).toBe('p1');

      const a2 = await connect();
      const ja2 = await joinRoom(a2, { room: 'alpha' });
      expect(ja2.type).toBe('joined');
      expect(ja2.role).toBe('p2');

      // Alpha fills and starts; its snapshot only ever knows its own seats.
      const snapA = await a1.waitFor(snapshotPhase('construction'), 3000, 'alpha construction');
      const playersA = Object.keys(snapshotState(snapA).players ?? {});
      expect(playersA).toEqual([String(ja1.sessionId), String(ja2.sessionId)]);
      expect(playersA).not.toContain(String(jb1.sessionId));

      // Beta's lone joiner still waits — alpha's start did not advance it.
      const snapB = await b1.waitForNext(isSnapshot, 3000, 'beta snapshot');
      expect(snapshotState(snapB).phase).toBe('waiting');
      expect(Object.keys(snapshotState(snapB).players ?? {})).toEqual([String(jb1.sessionId)]);

      const b2 = await connect();
      const jb2 = await joinRoom(b2, { room: 'beta' });
      expect(jb2.type).toBe('joined');
      expect(jb2.role).toBe('p2');

      const snapB2 = await b1.waitFor(snapshotPhase('construction'), 3000, 'beta construction');
      expect(Object.keys(snapshotState(snapB2).players ?? {})).toEqual([
        String(jb1.sessionId),
        String(jb2.sessionId),
      ]);
    });

    it('keeps an omitted or empty room field on the nerdiclash default', async () => {
      const c1 = await connect();
      c1.send({ type: 'join_room', displayName: 'tester' });
      const j1 = await c1.waitFor(
        (msg) => msg.type === 'joined' || msg.type === 'error',
        3000,
        'joined|error',
      );
      expect(j1.type).toBe('joined');
      expect(j1.role).toBe('p1');

      const c2 = await connect();
      const j2 = await joinRoom(c2, { room: '' });
      expect(j2.type).toBe('joined');
      // Empty room routed to the same default room — this is its second seat.
      expect(j2.role).toBe('p2');

      // And an explicit 'nerdiclash' join now finds that default room full.
      const c3 = await connect();
      const j3 = await joinRoom(c3);
      expect(j3.type).toBe('error');
      expect(j3.code).toBe(ErrorCode.ROOM_FULL);
    });

    it('rejects an invalid room name with INVALID_PAYLOAD', async () => {
      const client = await connect();
      for (const room of ['bad room!', 'x'.repeat(33), 'dot.name']) {
        const resp = await joinRoom(client, { room });
        expect(resp.type).toBe('error');
        expect(resp.code).toBe(ErrorCode.INVALID_PAYLOAD);
      }
      // The socket stays usable — a good join on it still lands.
      const ok = await joinRoom(client, { room: 'fine_room-1' });
      expect(ok.type).toBe('joined');
    });

    it('answers SERVER_FULL once ROOM_CAP rooms are live', async () => {
      for (let i = 0; i < 16; i += 1) {
        const client = await connect();
        const joined = await joinRoom(client, { room: `cap-${i}` });
        expect(joined.type).toBe('joined');
      }

      const extra = await connect();
      const resp = await joinRoom(extra, { room: 'cap-16' });
      expect(resp.type).toBe('error');
      expect(resp.code).toBe(ErrorCode.SERVER_FULL);

      // The cap only blocks NEW rooms — an existing one still seats players.
      const seat = await connect();
      const joined = await joinRoom(seat, { room: 'cap-0' });
      expect(joined.type).toBe('joined');
      expect(joined.role).toBe('p2');
    });

    it('tears down one room without disturbing another', async () => {
      const a1 = await connect();
      const a2 = await connect();
      await joinRoom(a1, { room: 'alpha' });
      await joinRoom(a2, { room: 'alpha' });
      await a1.waitFor(snapshotPhase('construction'), 3000, 'alpha construction');

      const b1 = await connect();
      const jb1 = await joinRoom(b1, { room: 'beta' });
      expect(jb1.type).toBe('joined');

      await Promise.all([a1.close(), a2.close()]);

      // Room alpha is gone: a fresh alpha join lands in a new lone game.
      const { client: fresh, msg } = await joinRoomWithRetry({ room: 'alpha' });
      expect(msg.type).toBe('joined');
      expect(msg.role).toBe('p1');
      const snapF = await fresh.waitForNext(isSnapshot, 3000, 'fresh snapshot');
      expect(Object.keys(snapshotState(snapF).players ?? {})).toHaveLength(1);

      // Room beta's seat and game survived the teardown next door.
      const snapB = await b1.waitForNext(isSnapshot, 3000, 'beta snapshot');
      expect(snapshotState(snapB).phase).toBe('waiting');
      expect(Object.keys(snapshotState(snapB).players ?? {})).toEqual([String(jb1.sessionId)]);
    });

    it('does not let a reconnect token reclaim a seat in a different room', async () => {
      const a1 = await connect();
      const ja1 = await joinRoom(a1, { room: 'alpha' });
      const a2 = await connect();
      await joinRoom(a2, { room: 'alpha' });
      await a1.waitFor(snapshotPhase('construction'), 3000, 'alpha construction');
      await a1.close();

      // Presenting alpha's sessionId+token to room beta must not move the
      // seat — tokens are minted per slot — so this is a fresh beta join.
      const b = await connect();
      const jb = await joinRoom(b, {
        room: 'beta',
        sessionId: ja1.sessionId,
        reconnectToken: ja1.reconnectToken,
      });
      expect(jb.type).toBe('joined');
      expect(jb.sessionId).not.toBe(ja1.sessionId);
      expect(jb.role).toBe('p1');

      // The alpha seat is still reclaimable — through room alpha only.
      const { msg } = await joinRoomWithRetry({
        room: 'alpha',
        sessionId: ja1.sessionId,
        reconnectToken: ja1.reconnectToken,
      });
      expect(msg.type).toBe('joined');
      expect(msg.sessionId).toBe(ja1.sessionId);
    });
  });

  /**
   * Wave-11 T2: `rematch` is a transport-level room intent — both seated
   * players must vote while the game is over; the second vote swaps a fresh
   * NerdiClashGame in with the same sessionIds/roles/tokens. Tests force
   * gameOver by writing state directly — the vote protocol is the surface
   * under test, not the win engine.
   */
  describe('rematch', () => {
    /** Joins two players into the default room and drops the game to gameOver. */
    async function joinFinishedGame(): Promise<{
      c1: BridgeClient; c2: BridgeClient; sid1: string; sid2: string; tok2: string;
    }> {
      const { c1, c2, sid1, sid2, tok2 } = await joinTwoPlayers();
      await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');
      const game = (bridge as unknown as { game?: NerdiClashGame }).game;
      if (!game) throw new Error('default-room game missing after two joins');
      game.state.winner = sid1;
      game.state.phase = Phase.gameOver;
      return { c1, c2, sid1, sid2, tok2 };
    }

    it('rejects rematch before gameOver with NOT_PHASE_NOT_DRAW', async () => {
      const { c1 } = await joinTwoPlayers();
      await c1.waitFor(snapshotPhase('construction'), 3000, 'construction snapshot');

      c1.send({ type: 'rematch' });
      const resp = await c1.waitFor(isResponse, 3000, 'rematch response');
      expect(resp.type).toBe('error');
      expect(resp.code).toBe(ErrorCode.NOT_PHASE_NOT_DRAW);
    });

    it('does not reset on a single vote — both players must opt in', async () => {
      const { c1, c2, sid1 } = await joinFinishedGame();

      c1.send({ type: 'rematch' });
      const resp = await c1.waitFor(isResponse, 3000, 'rematch response');
      expect(resp).toMatchObject({ type: 'ack', intent: 'rematch' });

      // The opponent sees the vote as a game_event — the "wants a rematch" UI.
      const ev = await c2.waitFor(
        (msg) => msg.type === 'game_event' && msg.event === 'rematch',
        3000,
        'rematch game_event',
      );
      expect(ev.actorId).toBe(sid1);

      // One vote changes nothing: still gameOver.
      const snap = await c1.waitForNext(isSnapshot, 3000, 'state_snapshot');
      expect(snapshotState(snap).phase).toBe('gameOver');
    });

    it('resets to a fresh construction game on the second vote, same seats', async () => {
      const { c1, c2, sid1, sid2 } = await joinFinishedGame();

      c1.send({ type: 'rematch' });
      await c1.waitFor(isResponse, 3000, 'rematch response');
      c2.send({ type: 'rematch' });
      const resp2 = await c2.waitFor(isResponse, 3000, 'rematch response');
      expect(resp2).toMatchObject({ type: 'ack', intent: 'rematch' });

      const snap = await c1.waitFor(snapshotPhase('construction'), 3000, 'rematch construction');
      const players = snapshotState(snap).players ?? {};
      expect(Object.keys(players)).toEqual([sid1, sid2]);
      // Fresh game evidence: construction boards exist again for both seats.
      expect(players[sid1]?.boards?.length).toBeGreaterThan(0);
      expect(players[sid2]?.boards?.length).toBeGreaterThan(0);

      // Votes cleared with the swap — a rematch in the new game is a phase error.
      c1.send({ type: 'rematch' });
      const resp3 = await c1.waitForNext(isResponse, 3000, 'post-reset rematch');
      expect(resp3.type).toBe('error');
      expect(resp3.code).toBe(ErrorCode.NOT_PHASE_NOT_DRAW);
    });

    it('waits for a disconnected opponent — their vote after rejoin completes it', async () => {
      const { c1, c2, sid2, tok2 } = await joinFinishedGame();
      await c2.close();

      c1.send({ type: 'rematch' });
      const resp = await c1.waitFor(isResponse, 3000, 'rematch response');
      expect(resp).toMatchObject({ type: 'ack', intent: 'rematch' });

      const snap = await c1.waitForNext(isSnapshot, 3000, 'state_snapshot');
      expect(snapshotState(snap).phase).toBe('gameOver');

      const { client: rejoined, msg } = await joinRoomWithRetry({ sessionId: sid2, reconnectToken: tok2 });
      expect(msg.type).toBe('joined');
      expect(msg.sessionId).toBe(sid2);

      rejoined.send({ type: 'rematch' });
      const resp2 = await rejoined.waitFor(isResponse, 3000, 'rematch response');
      expect(resp2).toMatchObject({ type: 'ack', intent: 'rematch' });

      const reset = await c1.waitFor(snapshotPhase('construction'), 3000, 'rematch construction');
      expect(Object.keys(snapshotState(reset).players ?? {})).toHaveLength(2);
    });
  });
});
