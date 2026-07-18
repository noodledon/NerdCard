import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { NerdiClashGame } from './rooms/NerdiClashGame.js';
import { ErrorCode } from './shared/ErrorCode.js';
import { parseClientMessage } from './shared/messages.js';

interface JsonClient {
  ws: WebSocket;
  sessionId: string;
  role: 'p1' | 'p2';
}

export class JsonBridgeServer {
  private wss: WebSocketServer | undefined;
  private game: NerdiClashGame | undefined;
  private clients = new Map<string, JsonClient>();
  private nextSessionId = 1;
  private snapshotInterval: ReturnType<typeof setInterval> | undefined;
  private httpServer: http.Server | undefined;

  start(port: number): void {
    this.httpServer = http.createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      ws.on('message', (data) => this.handleMessage(ws, data));
      ws.on('close', () => this.handleDisconnect(ws));
      ws.on('error', (err) => console.error('[JsonBridge] WebSocket error:', err));
    });

    this.httpServer.listen(port, () => {
      console.log(`[JsonBridge] Listening on ws://localhost:${port}`);
    });

    this.snapshotInterval = setInterval(() => this.broadcastSnapshots(), 100);
  }

  private handleMessage(ws: WebSocket, data: unknown): void {
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

    switch (msgType) {
      case 'ready_inst':
        this.send(ws, { type: 'ack', intent: 'ready_inst' });
        break;
      case 'end_turn': {
        const result = this.game.requestEndTurn(client.sessionId);
        if (!result.ok) {
          this.send(ws, { type: 'error', code: 'INVALID_TARGET', message: result.reason ?? 'end turn failed' });
        } else {
          this.send(ws, { type: 'ack', intent: 'end_turn' });
        }
        break;
      }
      case 'draw_cards':
      case 'build_function':
      case 'play_card':
      case 'eval_function':
      case 'force_eval':
      case 'set_trap':
      case 'play_defense':
      case 'leave_room': {
        const parsed = parseClientMessage(msg);
        if (!parsed.ok) {
          const path = parsed.error.issues.map((issue) => issue.path.join('.')).join('; ');
          this.send(ws, { type: 'error', code: ErrorCode.INVALID_PAYLOAD, message: path || 'invalid payload' });
          return;
        }
        const payload: Record<string, unknown> = { ...parsed.message };
        const result = this.game.dispatchIntent(client.sessionId, parsed.message.type, payload);
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
    }

    const displayName = typeof msg.displayName === 'string' ? msg.displayName : undefined;

    // Reconnection: if the client sends back a sessionId that belongs to a
    // currently-disconnected player, restore their seat instead of rejecting
    // the join as ROOM_FULL. This mirrors the Colyseus room's reconnection
    // window (allowReconnection) which the raw JSON path otherwise lacks.
    const rejoinId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined;
    if (rejoinId && !this.clients.has(rejoinId)) {
      const existing = this.game.getPlayer(rejoinId);
      if (existing && !existing.isConnected) {
        this.game.reconnectPlayer(rejoinId, displayName);
        const role: 'p1' | 'p2' = [...this.game.state.players.keys()][0] === rejoinId ? 'p1' : 'p2';
        this.clients.set(rejoinId, { ws, sessionId: rejoinId, role });
        this.send(ws, { type: 'joined', sessionId: rejoinId, role });
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
    const role: 'p1' | 'p2' = this.game.playerCount() === 0 ? 'p1' : 'p2';

    this.game.addPlayer(sessionId, displayName ?? sessionId);
    this.clients.set(sessionId, { ws, sessionId, role });

    this.send(ws, { type: 'joined', sessionId, role });

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
    this.wss?.close();
    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();
    this.game = undefined;
  }
}
