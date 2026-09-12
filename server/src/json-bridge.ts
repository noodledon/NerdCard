import http from 'http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { NerdiClashGame } from './rooms/NerdiClashGame.js';
import { Phase } from './logic/fsm.js';
import { ErrorCode } from './shared/ErrorCode.js';
import { parseClientMessage } from './shared/messages.js';
import type { CommandResult } from './commands/base.js';

interface JsonClient {
  ws: WebSocket;
  sessionId: string;
  role: 'p1' | 'p2';
  /** Room this seat belongs to — teardown/reclaim stay inside it. */
  slot: GameSlot;
}

/**
 * Everything one room needs — the set of state JsonBridgeServer used to hold
 * as singletons, multiplied out per room name. A slot is born on the first
 * join that names it and dies the moment its last live socket disconnects;
 * `game` is set to undefined in that drain window so queued work self-rejects.
 *
 * `socketLiveness` is deliberately NOT in the bundle: it is keyed by socket,
 * and a socket exists before it names a room, so liveness stays server-global
 * and the heartbeat sweeps `wss.clients` regardless of room membership.
 */
interface GameSlot {
  name: string;
  game: NerdiClashGame | undefined;
  clients: Map<string, JsonClient>;
  /**
   * Seat-ownership proof: sessionId → token issued at join, scoped to this
   * room — a token minted in room A must not reclaim a seat in room B.
   * sessionIds are sequential (`json-N`) and trivially guessable, so reclaim
   * requires the unguessable token the original holder received inside
   * `joined`. Entries die with the slot — a torn-down room has no
   * reclaimable seats.
   */
  reconnectTokens: Map<string, string>;
  /**
   * The room's single ordered mutation lane. SymPy-backed commands
   * (integral, limit, LA ops) await HTTP inside dispatchIntent — without
   * serialization a second intent could mutate state between the first's
   * validation and mutation. Intents and ticks for this room chain through
   * this promise so they run strictly in arrival order. Lifecycle
   * (join/leave/disconnect) deliberately bypasses it. Stale work
   * self-rejects via the `slot.game === game` guard at each call site.
   */
  intentQueue: Promise<void>;
  /** Set while a tick waits on the lane — collapses back-to-back firings. */
  tickQueued: boolean;
}

/**
 * Liveness probe cadence. A socket that fails to pong within one interval is
 * terminated at the next — dead peers free their seats within ~2 intervals.
 * Godot's WebSocketPeer answers protocol pings automatically, so no client
 * work is needed for this.
 */
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Room selected by `join_room.room` when it is missing or empty — the room
 * every pre-multi-room client already asked for, so omitting the field keeps
 * the old single-room behavior.
 */
const DEFAULT_ROOM = 'nerdiclash';

/**
 * Hard ceiling on simultaneously-live slots. Without it each distinct room
 * name in a join would spawn a game + queue forever — a one-packet memory
 * leak. 16 concurrent 2P rooms is far beyond v1's expected load.
 */
const ROOM_CAP = 16;

const ROOM_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

/** Missing/empty → the default room; anything else must match the pattern. */
function normalizeRoomName(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_ROOM;
  if (typeof raw !== 'string' || !ROOM_NAME_PATTERN.test(raw)) return null;
  return raw;
}

export class JsonBridgeServer {
  private wss: WebSocketServer | undefined;
  private readonly slots = new Map<string, GameSlot>();
  private nextSessionId = 1;
  private snapshotInterval: ReturnType<typeof setInterval> | undefined;
  private tickInterval: ReturnType<typeof setInterval> | undefined;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  private httpServer: http.Server | undefined;
  /** Last-seen-pong flag per socket for the heartbeat sweep. */
  private readonly socketLiveness = new WeakMap<WebSocket, boolean>();

  /**
   * Default-room views kept for single-room tooling and the pre-multi-room
   * bridge tests, which reach these internals directly. All live code paths
   * go through `slots`.
   */
  private get game(): NerdiClashGame | undefined {
    return this.slots.get(DEFAULT_ROOM)?.game;
  }

  private get clients(): Map<string, JsonClient> {
    return this.slots.get(DEFAULT_ROOM)?.clients ?? new Map();
  }

  start(port: number): void {
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      this.socketLiveness.set(ws, true);
      ws.on('pong', () => { this.socketLiveness.set(ws, true); });
      ws.on('message', (data) => { void this.handleMessage(ws, data); });
      ws.on('close', () => this.handleDisconnect(ws));
      ws.on('error', (err) => console.error('[JsonBridge] WebSocket error:', err));
    });

    this.httpServer.listen(port, () => {
      console.log(`[JsonBridge] Listening on ws://localhost:${port}`);
    });

    this.snapshotInterval = setInterval(() => this.broadcastSnapshots(), 100);
    this.tickInterval = setInterval(() => this.queueTick(), 250);
    this.heartbeatInterval = setInterval(() => this.runHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  /** Append work to a room's mutation lane; the chain itself never rejects. */
  private runSerialized<T>(slot: GameSlot, fn: () => T | Promise<T>): Promise<T> {
    const run = slot.intentQueue.then(fn);
    slot.intentQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Interval callback: enqueue a tick per room behind any in-flight intent.
   * Firings that arrive while a tick is already waiting collapse into it — a
   * long SymPy call produces one catch-up tick, not a pile-up of stale ones.
   * A slot with no live clients is being torn down, so it skips work.
   */
  private queueTick(): void {
    for (const slot of this.slots.values()) {
      if (!slot.game || slot.clients.size === 0 || slot.tickQueued) continue;
      slot.tickQueued = true;
      void this.runSerialized(slot, () => {
        slot.tickQueued = false;
        slot.game?.tick(Date.now());
      }).catch((err) => console.error('[JsonBridge] tick error:', err));
    }
  }

  private async handleMessage(ws: WebSocket, data: unknown): Promise<void> {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(String(data));
    } catch {
      this.send(ws, { type: 'error', code: 'INVALID_JSON', message: 'Malformed JSON' });
      return;
    }
    if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
      this.send(ws, { type: 'error', code: ErrorCode.INVALID_PAYLOAD, message: 'Message must be an object' });
      return;
    }
    const msg = parsedJson as Record<string, unknown>;
    const msgType = typeof msg.type === 'string' ? msg.type : '';

    if (msgType === 'join_room') {
      this.handleJoin(ws, msg);
      return;
    }

    const client = this.findClientByWs(ws);
    if (!client) {
      this.send(ws, { type: 'error', code: 'NOT_JOINED', message: 'Send join_room first' });
      return;
    }

    const slot = client.slot;
    if (!slot.game) {
      this.send(ws, { type: 'error', code: 'NO_GAME', message: 'Game not initialized' });
      return;
    }
    // Bind the queued work to the game that existed at arrival: if the room
    // is torn down and rebuilt before the intent runs, it must not mutate a
    // different game than the one the player joined.
    const game = slot.game;

    switch (msgType) {
      case 'ready_inst':
        this.send(ws, { type: 'ack', intent: 'ready_inst' });
        break;
      case 'end_turn': {
        const result = await this.runSerialized(slot, async (): Promise<CommandResult> => {
          if (slot.game !== game) return { ok: false, reason: 'game is gone' };
          return game.requestEndTurn(client.sessionId);
        });
        if (!result.ok) {
          this.send(ws, { type: 'error', code: this.errorCodeFor(result.reason), message: result.reason ?? 'end turn failed' });
        } else {
          this.send(ws, { type: 'ack', intent: 'end_turn' });
        }
        break;
      }
      case 'leave_room':
        // handleDisconnect performs the seat teardown on the close event.
        ws.close();
        break;
      case 'draw_cards':
      case 'build_function':
      case 'play_card':
      case 'eval_function':
      case 'force_eval':
      case 'set_trap':
      case 'play_defense': {
        const parsed = parseClientMessage(msg);
        if (!parsed.ok) {
          const path = parsed.error.issues.map((issue) => issue.path.join('.')).join('; ');
          this.send(ws, { type: 'error', code: ErrorCode.INVALID_PAYLOAD, message: path || 'invalid payload' });
          return;
        }
        const payload: Record<string, unknown> = { ...parsed.message };
        const intentType = parsed.message.type;
        const result = await this.runSerialized(slot, async (): Promise<CommandResult> => {
          if (slot.game !== game) return { ok: false, reason: 'game is gone' };
          return game.dispatchIntent(client.sessionId, intentType, payload);
        });
        if (!result.ok) {
          this.send(ws, {
            type: 'error',
            code: this.errorCodeFor(result.reason),
            message: result.reason ?? 'command rejected',
          });
        } else {
          this.send(ws, { type: 'ack', intent: parsed.message.type });
        }
        break;
      }
      default:
        this.send(ws, { type: 'error', code: 'UNKNOWN_TYPE', message: msgType });
    }
  }

  /**
   * Resolve the room a join names into a live slot, creating it under
   * ROOM_CAP. Returns undefined when the join was already answered with an
   * error (INVALID_PAYLOAD on a bad name, SERVER_FULL at the cap).
   */
  private slotForJoin(ws: WebSocket, msg: Record<string, unknown>): GameSlot | undefined {
    const room = normalizeRoomName(msg.room);
    if (room === null) {
      this.send(ws, {
        type: 'error',
        code: ErrorCode.INVALID_PAYLOAD,
        message: 'room must match [a-zA-Z0-9_-]{1,32}',
      });
      return undefined;
    }
    const existing = this.slots.get(room);
    if (existing) return existing;
    if (this.slots.size >= ROOM_CAP) {
      this.send(ws, {
        type: 'error',
        code: ErrorCode.SERVER_FULL,
        message: `Server room cap (${ROOM_CAP}) reached`,
      });
      ws.close();
      return undefined;
    }
    const slot: GameSlot = {
      name: room,
      game: undefined,
      clients: new Map(),
      reconnectTokens: new Map(),
      intentQueue: Promise.resolve(),
      tickQueued: false,
    };
    this.slots.set(room, slot);
    return slot;
  }

  private handleJoin(ws: WebSocket, msg: Record<string, unknown>): void {
    const slot = this.slotForJoin(ws, msg);
    if (!slot) return;

    if (!slot.game) {
      slot.game = new NerdiClashGame();
      slot.game.setEventListener((ev) => this.broadcastGameEvent(slot, ev));
    }
    const game = slot.game;

    const displayName = typeof msg.displayName === 'string' ? msg.displayName : undefined;

    // Reconnection: if the client sends back a sessionId that belongs to a
    // currently-disconnected player in THIS room AND the reconnectToken
    // issued with that seat, restore the seat instead of rejecting the join
    // as ROOM_FULL. This mirrors the Colyseus room's reconnection window
    // (allowReconnection) which the raw JSON path otherwise lacks. The token
    // is required because sessionIds are sequential and guessable — without
    // it any third connection could claim a dropped seat and receive its
    // private hand.
    const rejoinId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
    const rejoinToken = typeof msg.reconnectToken === 'string' ? msg.reconnectToken : undefined;
    const seatToken = rejoinId ? slot.reconnectTokens.get(rejoinId) : undefined;
    if (rejoinId && seatToken !== undefined && rejoinToken === seatToken && !slot.clients.has(rejoinId)) {
      const existing = game.getPlayer(rejoinId);
      if (existing && !existing.isConnected) {
        game.reconnectPlayer(rejoinId, displayName);
        const role: 'p1' | 'p2' = [...game.state.players.keys()][0] === rejoinId ? 'p1' : 'p2';
        slot.clients.set(rejoinId, { ws, sessionId: rejoinId, role, slot });
        this.send(ws, { type: 'joined', sessionId: rejoinId, role, reconnectToken: seatToken });
        this.sendDefenseResumedIfNeeded(ws, slot);
        this.broadcastSnapshots(slot);
        return;
      }
    }

    if (game.playerCount() >= 2) {
      this.send(ws, { type: 'error', code: 'ROOM_FULL', message: 'Game already has 2 players' });
      ws.close();
      return;
    }

    const sessionId = `json-${this.nextSessionId++}`;
    const reconnectToken = randomUUID();
    const role: 'p1' | 'p2' = game.playerCount() === 0 ? 'p1' : 'p2';

    game.addPlayer(sessionId, displayName ?? sessionId);
    slot.reconnectTokens.set(sessionId, reconnectToken);
    slot.clients.set(sessionId, { ws, sessionId, role, slot });

    this.send(ws, { type: 'joined', sessionId, role, reconnectToken });
    this.sendDefenseResumedIfNeeded(ws, slot);

    if (game.playerCount() === 2) {
      game.startGame();
      // Force an immediate snapshot so both clients receive the construction
      // phase right away instead of waiting for the next 100ms interval tick.
      this.broadcastSnapshots(slot);
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.findClientByWs(ws);
    if (!client) return;
    const slot = client.slot;

    slot.game?.removePlayer(client.sessionId);
    slot.clients.delete(client.sessionId);

    // Retire the room only once every live connection is gone. Tearing it
    // down while a player is still connected would strand them, and keying
    // off the connected-client count (not playerCount, which lingers as
    // disconnected player state) lets a fresh room start cleanly on the
    // next join. Deleting the slot frees the whole game + queue + tokens.
    if (slot.clients.size === 0) {
      slot.game = undefined;
      slot.reconnectTokens.clear();
      this.slots.delete(slot.name);
    }
  }

  /**
   * Ping every socket; terminate any that failed to pong since the last
   * sweep. terminate() fires the socket's 'close' event, so a dead peer
   * flows through handleDisconnect like a clean drop — its seat becomes
   * reclaimable and the all-disconnected teardown can still trigger.
   */
  private runHeartbeat(): void {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      if (this.socketLiveness.get(ws) === false) {
        ws.terminate();
        continue;
      }
      this.socketLiveness.set(ws, false);
      ws.ping();
    }
  }

  // Mirrors NerdiClashRoom's game_event broadcast — the Colyseus path wraps
  // details into a JSON string; the JSON bridge sends them natively.
  private broadcastGameEvent(
    slot: GameSlot,
    ev: { event: string; actorId: string; details: Record<string, unknown> },
  ): void {
    if (!slot.game) return;
    const payload = {
      type: 'game_event',
      event: ev.event,
      actorId: ev.actorId,
      turnId: slot.game.state.turnIndex,
      details: ev.details,
    };
    // A declared winner also rides out as the dedicated GameOverSchema frame
    // so clients don't have to snapshot-diff to detect game end. The raw
    // game_event still flows — the event stream stays complete.
    const gameOver = ev.event === 'game_over'
      ? {
          type: 'game_over',
          winnerId: typeof ev.details.winner === 'string' ? ev.details.winner : null,
          winReason: typeof ev.details.winReason === 'string' ? ev.details.winReason : null,
        }
      : undefined;
    for (const client of slot.clients.values()) {
      this.send(client.ws, payload);
      if (gameOver) this.send(client.ws, gameOver);
    }
  }

  // A (re)joining defender needs the open window + deadline — mirrors the
  // room's onJoin defense_resumed event.
  private sendDefenseResumedIfNeeded(ws: WebSocket, slot: GameSlot): void {
    if (!slot.game) return;
    if (slot.game.state.phase === Phase.defense && slot.game.state.turnDeadline > Date.now()) {
      this.send(ws, {
        type: 'game_event',
        event: 'defense_resumed',
        actorId: '',
        turnId: slot.game.state.turnIndex,
        details: { deadline: slot.game.state.turnDeadline },
      });
    }
  }

  /**
   * Push a per-player-filtered snapshot to every client. Called with a slot
   * to fan out just that room (join/startGame immediacy); called with no
   * argument by the 100ms interval to fan out all rooms.
   */
  private broadcastSnapshots(onlySlot?: GameSlot): void {
    const targets = onlySlot ? [onlySlot] : this.slots.values();
    for (const slot of targets) {
      if (!slot.game) continue;
      for (const client of slot.clients.values()) {
        const snapshot = slot.game.getStateSnapshotForPlayer(client.sessionId);
        this.send(client.ws, { type: 'state_snapshot', state: snapshot });
      }
    }
  }

  private send(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private findClientByWs(ws: WebSocket): JsonClient | undefined {
    for (const slot of this.slots.values()) {
      for (const client of slot.clients.values()) {
        if (client.ws === ws) return client;
      }
    }
    return undefined;
  }

  private errorCodeFor(reason: string | undefined): string {
    if (reason?.includes('active player') || reason?.includes('defending player')) return ErrorCode.NOT_YOUR_TURN;
    if (reason?.includes('only in') || reason?.includes('phase')) return ErrorCode.NOT_PHASE_NOT_DRAW;
    if (reason?.includes('deckChoices') || reason?.includes('invalid draw choices')) return ErrorCode.INVALID_PAYLOAD;
    if (reason?.includes('aggressive action')) return ErrorCode.OFFENSIVE_LIMIT_EXCEEDED;
    if (reason?.includes('not in player')) return ErrorCode.CARD_NOT_IN_HAND;
    if (reason?.includes('maximum') || reason?.includes('already used')) return ErrorCode.TOO_MANY_ACTIONS;
    if (reason?.includes('deck empty')) return ErrorCode.INVALID_TARGET;
    if (reason?.includes('player not found')) return ErrorCode.INVALID_TARGET;
    return ErrorCode.INVALID_TARGET;
  }

  dispose(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = undefined;
    }
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
    this.wss?.close();
    this.wss = undefined;
    this.httpServer?.close();
    this.httpServer = undefined;
    for (const slot of this.slots.values()) {
      for (const client of slot.clients.values()) {
        client.ws.close();
      }
      slot.reconnectTokens.clear();
      slot.game = undefined;
    }
    this.slots.clear();
  }
}
