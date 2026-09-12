import http from 'http';
import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { NerdiClashGame } from './rooms/NerdiClashGame.js';
import { Phase } from './logic/fsm.js';
import { ErrorCode, errorCodeForReason } from './shared/ErrorCode.js';
import { parseClientMessage } from './shared/messages.js';
import type { CommandResult } from './commands/base.js';

interface JsonClient {
  ws: WebSocket;
  sessionId: string;
  role: 'p1' | 'p2';
}

/**
 * Liveness probe cadence. A socket that fails to pong within one interval is
 * terminated at the next — dead peers free their seats within ~2 intervals.
 * Godot's WebSocketPeer answers protocol pings automatically, so no client
 * work is needed for this.
 */
const HEARTBEAT_INTERVAL_MS = 10_000;

export class JsonBridgeServer {
  private wss: WebSocketServer | undefined;
  private game: NerdiClashGame | undefined;
  private clients = new Map<string, JsonClient>();
  private nextSessionId = 1;
  private snapshotInterval: ReturnType<typeof setInterval> | undefined;
  private tickInterval: ReturnType<typeof setInterval> | undefined;
  private heartbeatInterval: ReturnType<typeof setInterval> | undefined;
  private httpServer: http.Server | undefined;
  /**
   * Seat-ownership proof: sessionId → token issued at join. sessionIds are
   * sequential (`json-N`) and trivially guessable, so reclaim requires the
   * unguessable token the original holder received inside `joined`. Entries
   * die with the game — a torn-down room has no reclaimable seats.
   */
  private readonly reconnectTokens = new Map<string, string>();
  /** Last-seen-pong flag per socket for the heartbeat sweep. */
  private readonly socketLiveness = new WeakMap<WebSocket, boolean>();
  /**
   * Single ordered mutation lane. SymPy-backed commands (integral, limit, LA
   * ops) await HTTP inside dispatchIntent — without serialization a second
   * intent could mutate state between the first's validation and mutation.
   * Intents and ticks chain through this promise so they run strictly in
   * arrival order. Lifecycle (join/leave/disconnect) deliberately bypasses
   * it. The queue spans game instances harmlessly: stale work self-rejects
   * via the `this.game === game` guard at each call site.
   */
  private intentQueue: Promise<void> = Promise.resolve();
  /** Set while a tick waits on the lane — collapses back-to-back firings. */
  private tickQueued = false;

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

  /** Append work to the mutation lane; the chain itself never rejects. */
  private runSerialized<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.intentQueue.then(fn);
    this.intentQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  /**
   * Interval callback: enqueue the tick behind any in-flight intent. Firings
   * that arrive while a tick is already waiting collapse into it — a long
   * SymPy call produces one catch-up tick, not a pile-up of stale ones.
   */
  private queueTick(): void {
    if (this.tickQueued) return;
    this.tickQueued = true;
    void this.runSerialized(() => {
      this.tickQueued = false;
      this.game?.tick(Date.now());
    }).catch((err) => console.error('[JsonBridge] tick error:', err));
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

    if (!this.game) {
      this.send(ws, { type: 'error', code: 'NO_GAME', message: 'Game not initialized' });
      return;
    }
    // Bind the queued work to the game that existed at arrival: if the room
    // is torn down and rebuilt before the intent runs, it must not mutate a
    // different game than the one the player joined.
    const game = this.game;

    switch (msgType) {
      case 'ready_inst':
        this.send(ws, { type: 'ack', intent: 'ready_inst' });
        break;
      case 'end_turn': {
        const result = await this.runSerialized(async (): Promise<CommandResult> => {
          if (this.game !== game) return { ok: false, reason: 'game is gone' };
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
        const result = await this.runSerialized(async (): Promise<CommandResult> => {
          if (this.game !== game) return { ok: false, reason: 'game is gone' };
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

  private handleJoin(ws: WebSocket, msg: Record<string, unknown>): void {
    if (!this.game) {
      this.game = new NerdiClashGame();
      this.game.setEventListener((ev) => this.broadcastGameEvent(ev));
    }

    const displayName = typeof msg.displayName === 'string' ? msg.displayName : undefined;

    // Reconnection: if the client sends back a sessionId that belongs to a
    // currently-disconnected player AND the reconnectToken issued with that
    // seat, restore the seat instead of rejecting the join as ROOM_FULL.
    // This mirrors the Colyseus room's reconnection window (allowReconnection)
    // which the raw JSON path otherwise lacks. The token is required because
    // sessionIds are sequential and guessable — without it any third
    // connection could claim a dropped seat and receive its private hand.
    const rejoinId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
    const rejoinToken = typeof msg.reconnectToken === 'string' ? msg.reconnectToken : undefined;
    const seatToken = rejoinId ? this.reconnectTokens.get(rejoinId) : undefined;
    if (rejoinId && seatToken !== undefined && rejoinToken === seatToken && !this.clients.has(rejoinId)) {
      const existing = this.game.getPlayer(rejoinId);
      if (existing && !existing.isConnected) {
        this.game.reconnectPlayer(rejoinId, displayName);
        const role: 'p1' | 'p2' = [...this.game.state.players.keys()][0] === rejoinId ? 'p1' : 'p2';
        this.clients.set(rejoinId, { ws, sessionId: rejoinId, role });
        this.send(ws, { type: 'joined', sessionId: rejoinId, role, reconnectToken: seatToken });
        this.sendDefenseResumedIfNeeded(ws);
        this.broadcastSnapshots();
        return;
      }
    }

    if (this.game.playerCount() >= 2) {
      this.send(ws, { type: 'error', code: 'ROOM_FULL', message: 'Game already has 2 players' });
      ws.close();
      return;
    }

    const sessionId = `json-${this.nextSessionId++}`;
    const reconnectToken = randomUUID();
    const role: 'p1' | 'p2' = this.game.playerCount() === 0 ? 'p1' : 'p2';

    this.game.addPlayer(sessionId, displayName ?? sessionId);
    this.reconnectTokens.set(sessionId, reconnectToken);
    this.clients.set(sessionId, { ws, sessionId, role });

    this.send(ws, { type: 'joined', sessionId, role, reconnectToken });
    this.sendDefenseResumedIfNeeded(ws);

    if (this.game.playerCount() === 2) {
      this.game.startGame();
      // Force an immediate snapshot so both clients receive the construction
      // phase right away instead of waiting for the next 100ms interval tick.
      this.broadcastSnapshots();
    }
  }

  private handleDisconnect(ws: WebSocket): void {
    const client = this.findClientByWs(ws);
    if (!client) return;

    this.game?.removePlayer(client.sessionId);
    this.clients.delete(client.sessionId);

    // Reset the game only once every live connection is gone. Tearing it down
    // while a player is still connected would strand them, and keying off the
    // connected-client count (not playerCount, which lingers as disconnected
    // player state) lets a fresh game start cleanly on the next join.
    if (this.clients.size === 0) {
      this.game = undefined;
      this.reconnectTokens.clear();
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
  private broadcastGameEvent(ev: { event: string; actorId: string; details: Record<string, unknown> }): void {
    if (!this.game) return;
    const payload = {
      type: 'game_event',
      event: ev.event,
      actorId: ev.actorId,
      turnId: this.game.state.turnIndex,
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
    for (const client of this.clients.values()) {
      this.send(client.ws, payload);
      if (gameOver) this.send(client.ws, gameOver);
    }
  }

  // A (re)joining defender needs the open window + deadline — mirrors the
  // room's onJoin defense_resumed event.
  private sendDefenseResumedIfNeeded(ws: WebSocket): void {
    if (!this.game) return;
    if (this.game.state.phase === Phase.defense && this.game.state.turnDeadline > Date.now()) {
      this.send(ws, {
        type: 'game_event',
        event: 'defense_resumed',
        actorId: '',
        turnId: this.game.state.turnIndex,
        details: { deadline: this.game.state.turnDeadline },
      });
    }
  }

  private broadcastSnapshots(): void {
    if (!this.game) return;

    for (const client of this.clients.values()) {
      const snapshot = this.game.getStateSnapshotForPlayer(client.sessionId);
      this.send(client.ws, { type: 'state_snapshot', state: snapshot });
    }
  }

  private send(ws: WebSocket, payload: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  private findClientByWs(ws: WebSocket): JsonClient | undefined {
    for (const client of this.clients.values()) {
      if (client.ws === ws) return client;
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
    this.reconnectTokens.clear();
    this.wss?.close();
    this.wss = undefined;
    this.httpServer?.close();
    this.httpServer = undefined;
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.game = undefined;
  }
}
