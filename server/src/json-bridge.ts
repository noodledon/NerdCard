import http from 'http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { NerdiClashGame } from './rooms/NerdiClashGame.js';
import { Phase } from './logic/fsm.js';
import { DEFAULT_MODE, GAME_MODES, isGameMode, type GameMode } from './logic/modes.js';
import { ErrorCode, errorCodeForReason } from './shared/ErrorCode.js';
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
  /**
   * The room's GameMode — captured from the creating join's `join_room.mode`,
   * fixed for the slot's life. A later join naming this room with a different
   * mode is rejected MODE_MISMATCH; seat reclaim ignores the field entirely
   * (the seat's mode is the room's).
   */
  mode: GameMode;
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
  /**
   * sessionIds that voted `rematch` on the finished game. Reset only fires
   * once every seated player has opted in; votes clear on each fresh game
   * and die with the slot. A vote while the opponent is disconnected just
   * waits — their seat (and their vote) is theirs if they rejoin.
   */
  rematchVotes: Set<string>;
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

/**
 * Missing/empty → the default mode (pre-modes clients keep v1 rooms);
 * anything else must name a GameMode or the join is INVALID_PAYLOAD.
 */
function normalizeMode(raw: unknown): GameMode | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_MODE;
  return isGameMode(raw) ? raw : null;
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
    // Idempotent — a second start() would otherwise stack duplicate
    // intervals and a second WSS on a new http server, orphaning the first.
    if (this.wss) return;
    this.httpServer = http.createServer();
    // 64 KiB ceiling: legit frames are small JSON intents — the ws default
    // (100 MiB) lets one socket buffer-bomb the process.
    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: 64 * 1024 });

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
    if (msgType === 'list_rooms') {
      // Lobby-level like join_room: any connected socket may browse the
      // directory — a seat in a room is not required to ask what exists.
      this.handleListRooms(ws);
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
        let result: CommandResult;
        try {
          result = await this.runSerialized(slot, async (): Promise<CommandResult> => {
            if (slot.game !== game) return { ok: false, reason: 'game is gone' };
            // The seat may have changed while this intent waited on the
            // lane (leave_room, reclaim rebind, socket drop) — the queued
            // work must not mutate for a seat the socket no longer holds.
            if (slot.clients.get(client.sessionId)?.ws !== ws) {
              return { ok: false, reason: 'seat is gone' };
            }
            return game.requestEndTurn(client.sessionId);
          });
        } catch (err) {
          console.error('[JsonBridge] end_turn error:', err);
          this.send(ws, { type: 'error', code: ErrorCode.INTERNAL, message: 'internal error' });
          return;
        }
        if (!result.ok) {
          this.send(ws, { type: 'error', code: this.errorCodeFor(result.reason), message: result.reason ?? 'end turn failed' });
        } else {
          this.send(ws, { type: 'ack', intent: 'end_turn' });
        }
        break;
      }
      case 'leave_room': {
        // Leave-to-lobby: unseat exactly like a drop — the seat stays
        // reclaimable via sessionId + reconnectToken while the room lives —
        // but the socket stays open for lobby browsing or a fresh join.
        // A last-leaver still kills the room: an unseated socket is not a
        // client of the slot, so the clients.size === 0 teardown fires.
        this.unseat(client);
        this.send(ws, { type: 'left_room' });
        break;
      }
      case 'rematch': {
        // Runs on the room's lane so the game swap can't interleave with an
        // in-flight intent on the old game (those self-reject via the
        // slot.game guard).
        let result: CommandResult;
        try {
          result = await this.runSerialized(slot, (): CommandResult => {
            if (slot.game !== game) return { ok: false, reason: 'game is gone' };
            if (slot.clients.get(client.sessionId)?.ws !== ws) {
              return { ok: false, reason: 'seat is gone' };
            }
            return this.voteRematch(slot, client.sessionId);
          });
        } catch (err) {
          console.error('[JsonBridge] rematch error:', err);
          this.send(ws, { type: 'error', code: ErrorCode.INTERNAL, message: 'internal error' });
          return;
        }
        if (!result.ok) {
          this.send(ws, { type: 'error', code: this.errorCodeFor(result.reason), message: result.reason ?? 'rematch failed' });
        } else {
          this.send(ws, { type: 'ack', intent: 'rematch' });
        }
        break;
      }
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
        let result: CommandResult;
        try {
          result = await this.runSerialized(slot, async (): Promise<CommandResult> => {
            if (slot.game !== game) return { ok: false, reason: 'game is gone' };
            if (slot.clients.get(client.sessionId)?.ws !== ws) {
              return { ok: false, reason: 'seat is gone' };
            }
            return game.dispatchIntent(client.sessionId, intentType, payload);
          });
        } catch (err) {
          console.error('[JsonBridge] intent error:', err);
          this.send(ws, { type: 'error', code: ErrorCode.INTERNAL, message: 'internal error' });
          return;
        }
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
  private slotForJoin(ws: WebSocket, msg: Record<string, unknown>, mode: GameMode): GameSlot | undefined {
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
      mode,
      game: undefined,
      clients: new Map(),
      reconnectTokens: new Map(),
      intentQueue: Promise.resolve(),
      tickQueued: false,
      rematchVotes: new Set(),
    };
    this.slots.set(room, slot);
    return slot;
  }

  private handleJoin(ws: WebSocket, msg: Record<string, unknown>): void {
    // One seat per socket: a socket that already holds one (in ANY room)
    // must leave_room before joining again — otherwise a second join could
    // seat the same socket twice (dual-seat ghost that receives both hands
    // and can never let the room tear down).
    if (this.findClientByWs(ws)) {
      this.send(ws, {
        type: 'error',
        code: ErrorCode.ALREADY_JOINED,
        message: 'socket already seated — leave_room before joining again',
      });
      return;
    }
    const mode = normalizeMode(msg.mode);
    if (mode === null) {
      this.send(ws, {
        type: 'error',
        code: ErrorCode.INVALID_PAYLOAD,
        message: `mode must be one of ${GAME_MODES.join(' | ')}`,
      });
      return;
    }
    const slot = this.slotForJoin(ws, msg, mode);
    if (!slot) return;

    if (!slot.game) {
      try {
        slot.game = new NerdiClashGame(slot.mode);
      } catch (err) {
        // A constructor throw must not strand a clientless slot — it would
        // consume ROOM_CAP forever (no live socket ever triggers teardown).
        this.slots.delete(slot.name);
        console.error('[JsonBridge] game init failed:', err);
        this.send(ws, { type: 'error', code: ErrorCode.INTERNAL, message: 'game init failed' });
        return;
      }
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
    if (rejoinId && seatToken !== undefined && rejoinToken === seatToken) {
      const existing = game.getPlayer(rejoinId);
      if (existing) {
        // Token match is the seat-ownership proof — reclaim regardless of a
        // lingering client entry or isConnected flag: a fast reconnect can
        // arrive before the old socket's close event fires (the heartbeat
        // sweep is ~10s behind). Rebind FIRST, then close the stale socket —
        // its 'close' → handleDisconnect then finds no client for that ws,
        // so it can't unseat the new entry.
        const prior = slot.clients.get(rejoinId);
        const role: 'p1' | 'p2' = [...game.state.players.keys()][0] === rejoinId ? 'p1' : 'p2';
        slot.clients.set(rejoinId, { ws, sessionId: rejoinId, role, slot });
        prior?.ws.close();
        game.reconnectPlayer(rejoinId, displayName);
        this.send(ws, { type: 'joined', sessionId: rejoinId, role, reconnectToken: seatToken, mode: slot.mode });
        this.sendDefenseResumedIfNeeded(ws, slot);
        this.broadcastSnapshots(slot);
        return;
      }
    }

    // A fresh seat on a live room must agree with the mode the room was
    // created with — silently absorbing a mismatched mode would seat the
    // client in a game it did not ask for. Seat reclaim above ignores mode.
    if (slot.mode !== mode) {
      this.send(ws, {
        type: 'error',
        code: ErrorCode.MODE_MISMATCH,
        message: `mode mismatch: room '${slot.name}' is ${slot.mode}`,
      });
      return;
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

    this.send(ws, { type: 'joined', sessionId, role, reconnectToken, mode: slot.mode });
    this.sendDefenseResumedIfNeeded(ws, slot);

    if (game.playerCount() === 2) {
      game.startGame();
      // Force an immediate snapshot so both clients receive the construction
      // phase right away instead of waiting for the next 100ms interval tick.
      this.broadcastSnapshots(slot);
    }
  }

  /**
   * Room directory pull — a snapshot read of the slot map, not a
   * subscription (clients re-ask to refresh). playerCount counts seated
   * players including dropped-but-reclaimable seats; connected counts only
   * live sockets. Aggregate fields only: no sessionIds, tokens, or hand
   * data ever cross this boundary.
   */
  private handleListRooms(ws: WebSocket): void {
    const rooms = [...this.slots.values()].map((slot) => ({
      name: slot.name,
      playerCount: slot.game?.playerCount() ?? 0,
      connected: slot.clients.size,
      phase: slot.game?.state.phase ?? Phase.waiting,
      mode: slot.mode,
    }));
    this.send(ws, { type: 'room_list', rooms });
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.findClientByWs(ws);
    if (!client) return;
    this.unseat(client);
  }

  /**
   * Free a socket's seat: the player flips to isConnected=false (the seat
   * itself lingers, reclaimable via its reconnect token) and the socket
   * leaves the slot. Shared by socket close and leave_room — a voluntary
   * leave is exactly a drop with the socket kept open.
   *
   * Retire the room only once every live client is gone. Tearing it down
   * while a player is still connected would strand them, and keying off
   * the connected-client count (not playerCount, which lingers as
   * disconnected player state) lets a fresh room start cleanly on the
   * next join. Deleting the slot frees the whole game + queue + tokens.
   */
  private unseat(client: JsonClient): void {
    const slot = client.slot;

    slot.game?.removePlayer(client.sessionId);
    slot.clients.delete(client.sessionId);

    if (slot.clients.size === 0) {
      slot.game = undefined;
      slot.reconnectTokens.clear();
      this.slots.delete(slot.name);
    }
  }

  /**
   * One player's rematch vote. Valid only in gameOver; the second vote swaps
   * in a fresh NerdiClashGame — never reuse the finished object (stale FSM,
   * queue and timer residue). Seats keep sessionIds, roles and reconnect
   * tokens: the same slots.clients map keeps streaming, so no socket churn.
   */
  private voteRematch(slot: GameSlot, sessionId: string): CommandResult {
    const game = slot.game;
    if (!game || game.state.phase !== Phase.gameOver) {
      return { ok: false, reason: 'rematch only in gameOver phase' };
    }
    if (!game.state.players.has(sessionId)) {
      return { ok: false, reason: 'player not found' };
    }
    if (!slot.rematchVotes.has(sessionId)) {
      slot.rematchVotes.add(sessionId);
      // Lets each client render "opponent wants a rematch" off the event
      // stream rather than a snapshot diff.
      this.broadcastGameEvent(slot, {
        event: 'rematch',
        actorId: sessionId,
        details: { votes: slot.rematchVotes.size, needed: game.state.players.size },
      });
    }
    const allVoted = [...game.state.players.keys()].every((id) => slot.rematchVotes.has(id));
    if (!allVoted) return { ok: true };

    const seats = [...game.state.players.values()].map((p) => ({
      sessionId: p.sessionId,
      displayName: p.displayName,
    }));
    const fresh = new NerdiClashGame(slot.mode);
    fresh.setEventListener((ev) => this.broadcastGameEvent(slot, ev));
    slot.game = fresh;
    slot.rematchVotes.clear();
    for (const seat of seats) {
      const freshPlayer = fresh.addPlayer(seat.sessionId, seat.displayName);
      // addPlayer marks every seat connected — a seat with no live socket
      // must stay reclaimable, or the absent player's own rejoin reads the
      // ghost seat as occupied and falls through to ROOM_FULL forever.
      if (!slot.clients.has(seat.sessionId)) freshPlayer.isConnected = false;
    }
    fresh.startGame();
    // Same immediacy as a filled room on join: push the construction
    // snapshot now instead of waiting for the next 100ms interval.
    this.broadcastSnapshots(slot);
    return { ok: true };
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
    return errorCodeForReason(reason);
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
