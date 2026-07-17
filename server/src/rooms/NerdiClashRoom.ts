import colyseus from 'colyseus';
import { GameRoomState, PlayerSchema } from '../state/schema.js';
import { Phase, type Phase as FSMPhase } from '../logic/fsm.js';
import { ErrorCode } from '../shared/ErrorCode.js';
import { registerHandlers, type HandlerClient } from './handlers.js';
import { NerdiClashGame } from './NerdiClashGame.js';

interface NerdiClashClient {
  sessionId: string;
  send(type: string, payload: unknown): void;
  leave(code?: number): void;
  view?: { add(value: unknown): void };
}

interface RoomBase {
  state: GameRoomState;
  clients: { length: number };
  maxClients: number;
  patchRate: number;
  autoDispose: boolean;
  maxMessagesPerSecond: number;
  locked: boolean;
  setState(state: GameRoomState): void;
  setPatchRate(milliseconds: number): void;
  setMetadata(metadata: Record<string, string>): Promise<void>;
  setSimulationInterval(callback: (deltaTime: number) => void, delay?: number): void;
  lock(): Promise<void>;
  disconnect(): Promise<unknown>;
  allowReconnection(client: NerdiClashClient, seconds: number): Promise<unknown>;
  onMessage(messageType: string, callback: (client: NerdiClashClient, payload: unknown) => void): void;
  broadcast(type: string, payload: unknown): void;
}

type RoomConstructor = new (...args: never[]) => RoomBase;
const ColyseusRoom = (colyseus as unknown as { Room: RoomConstructor }).Room;

type JoinOptions = { displayName?: string };

/**
 * T10 — Colyseus transport wrapper for NerdiClash.
 *
 * All game logic lives in NerdiClashGame. This class only handles:
 * - Colyseus room lifecycle (onCreate, onJoin, onLeave)
 * - Client transport (broadcast, private views, reconnection)
 * - Delegating intents to the game instance
 */
export class NerdiClashRoom extends ColyseusRoom {
  private game!: NerdiClashGame;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;

  async onCreate(_options: unknown): Promise<void> {
    this.game = new NerdiClashGame();
    this.setState(this.game.state);

    this.maxClients = 2;
    this.patchRate = 50;
    this.autoDispose = true;
    this.maxMessagesPerSecond = 10;

    this.game.setEventListener((ev) => {
      this.broadcast('game_event', {
        event: JSON.stringify({ type: ev.event, ...ev.details }),
        actorId: ev.actorId,
        turnId: this.game.state.turnIndex,
      });
    });

    await this.setMetadata({ mode: 'nerdiclash' });

    this.onMessage('ping', () => undefined);
    registerHandlers(this, (type, handler) => {
      this.onMessage(type, (client, payload) => handler(client, payload));
    });
    this.setSimulationInterval(() => {
      this.game.tick(Date.now());
    }, 250);
  }

  onAuth(_client: NerdiClashClient, _options: unknown, _request: unknown): boolean {
    return true;
  }

  async onJoin(
    client: NerdiClashClient,
    options: unknown,
    _auth?: unknown,
  ): Promise<void> {
    this.cancelScheduledDisconnect();
    const joinOptions = this.readJoinOptions(options);
    const player = this.game.addPlayer(client.sessionId, joinOptions.displayName ?? client.sessionId);

    this.registerPrivateView(client, player);
    if (this.game.state.phase === Phase.defense && this.game.state.turnDeadline > Date.now()) {
      client.send('game_event', {
        event: JSON.stringify({ type: 'defense_resumed', deadline: this.game.state.turnDeadline }),
        actorId: client.sessionId,
        turnId: this.game.state.turnIndex,
      });
    }

    if (this.clients.length === 2) {
      await this.lock();
      this.game.startGame();
    }
  }

  async onLeave(client: NerdiClashClient, consented: boolean): Promise<void> {
    this.game.removePlayer(client.sessionId);
    this.scheduleDisconnectWhenBothPlayersAreDisconnected();
    if (consented) return;

    try {
      await this.allowReconnection(client, 30);
    } catch {
      this.scheduleDisconnectWhenBothPlayersAreDisconnected();
    }
  }

  onDispose(): void {
    this.cancelScheduledDisconnect();
  }

  async dispatchIntent(client: HandlerClient, intent: string, payload: Record<string, unknown>): Promise<void> {
    if (intent === 'ready_inst') return;

    if (intent === 'draw_cards') {
      const result = this.game.dispatchIntent(client.sessionId, intent, payload);
      if (!result.ok) {
        client.send('error', {
          code: this.errorCodeFor(result.reason),
          message: result.reason ?? 'draw rejected',
        });
      }
      return;
    }

    const result = this.game.dispatchIntent(client.sessionId, intent, payload);
    if (!result.ok) {
      client.send('error', { code: this.errorCodeFor(result.reason), message: result.reason ?? 'command rejected' });
      return;
    }
  }

  async requestEndTurn(client: HandlerClient): Promise<void> {
    const result = this.game.requestEndTurn(client.sessionId);
    if (!result.ok) {
      client.send('error', { code: ErrorCode.INTERNAL, message: result.reason ?? 'end turn failed' });
    }
  }

  private errorCodeFor(reason: string | undefined): ErrorCode {
    if (reason?.includes('aggressive action')) return ErrorCode.OFFENSIVE_LIMIT_EXCEEDED;
    if (reason?.includes('not in player')) return ErrorCode.CARD_NOT_IN_HAND;
    if (reason?.includes('maximum') || reason?.includes('already used')) return ErrorCode.TOO_MANY_ACTIONS;
    if (reason?.includes('deck empty')) return ErrorCode.INVALID_TARGET;
    return ErrorCode.INVALID_TARGET;
  }

  private registerPrivateView(client: NerdiClashClient, player: PlayerSchema): void {
    if (!client.view) return;
    client.view.add(player);
    for (const card of player.hand) client.view.add(card);
  }

  private allPlayersAreDisconnected(): boolean {
    return this.game.allPlayersAreDisconnected();
  }

  private scheduleDisconnectWhenBothPlayersAreDisconnected(): void {
    if (!this.allPlayersAreDisconnected() || this.disconnectTimer) return;
    this.disconnectTimer = setTimeout(() => {
      this.disconnectTimer = undefined;
      void this.disconnectIfBothPlayersAreStillDisconnected();
    }, 30_000);
  }

  private async disconnectIfBothPlayersAreStillDisconnected(): Promise<void> {
    if (this.allPlayersAreDisconnected()) await this.disconnect();
  }

  private cancelScheduledDisconnect(): void {
    if (!this.disconnectTimer) return;
    clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
  }

  private readJoinOptions(options: unknown): JoinOptions {
    if (typeof options !== 'object' || options === null) return {};
    const candidate = options as { displayName?: unknown };
    return typeof candidate.displayName === 'string'
      ? { displayName: candidate.displayName }
      : {};
  }
}

export type NerdiClashPhase = FSMPhase;
