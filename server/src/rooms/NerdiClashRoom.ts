import colyseus from 'colyseus';
import { GameRoomState, PlayerSchema } from '../state/schema.js';
import { Phase, type Phase as FSMPhase } from '../logic/fsm.js';
import { PhaseController } from './phaseController.js';

interface NerdiClashClient {
  sessionId: string;
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
}

type RoomConstructor = new (...args: never[]) => RoomBase;
const ColyseusRoom = (colyseus as unknown as { Room: RoomConstructor }).Room;

type JoinOptions = { displayName?: string };

/**
 * T10 — authoritative two-player NerdiClash room.
 *
 * The installed schema version is Colyseus 0.15/@colyseus-schema 2.x, where
 * private hands use @filter(). The optional client.view registration below is
 * retained for schema 3-compatible clients and for explicit privacy tests.
 */
export class NerdiClashRoom extends ColyseusRoom {
  public phaseController!: PhaseController;

  async onCreate(_options: unknown): Promise<void> {
    const state = new GameRoomState();
    state.phase = Phase.waiting;
    this.setState(state);

    this.maxClients = 2;
    this.patchRate = 50;
    this.autoDispose = true;
    this.maxMessagesPerSecond = 10;
    this.phaseController = new PhaseController(this.state);

    await this.setMetadata({ mode: 'nerdiclash' });

    this.onMessage('ping', () => undefined);
    this.setSimulationInterval(() => {
      if (!this.phaseController) return;
      const previousPhase = this.phaseController.phase;
      this.phaseController.tick(Date.now());
      if (previousPhase === Phase.resolution && this.phaseController.phase === Phase.draw) {
        this.rotateTurnOwner();
      }
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
    const joinOptions = this.readJoinOptions(options);
    let player = this.state.players.get(client.sessionId);
    if (!player) {
      player = new PlayerSchema();
      player.sessionId = client.sessionId;
      player.displayName = joinOptions.displayName ?? client.sessionId;
      this.state.players.set(client.sessionId, player);
      if (!this.state.currentTurnPlayerId) {
        this.state.currentTurnPlayerId = client.sessionId;
      }
    } else {
      player.isConnected = true;
      if (joinOptions.displayName) player.displayName = joinOptions.displayName;
    }

    this.registerPrivateView(client, player);

    if (this.clients.length === 2) {
      await this.lock();
      this.phaseController.requestTransition(Phase.construction);
    }
  }

  async onLeave(client: NerdiClashClient, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (consented) {
      player.isConnected = false;
      await this.disconnectIfBothPlayersAreDisconnected();
      return;
    }

    try {
      await this.allowReconnection(client, 30);
      player.isConnected = false;
    } catch (_error) {
      player.isConnected = false;
      await this.disconnectIfBothPlayersAreDisconnected();
    }
  }

  onDispose(): void {
    // Game state is intentionally ephemeral. Colyseus disposes the room and
    // its in-memory schema after both seats are disconnected.
  }

  private registerPrivateView(client: NerdiClashClient, player: PlayerSchema): void {
    // In schema 2.x @filter() performs this registration automatically. If a
    // schema 3 client supplies StateView, register both the player and every
    // existing hand card. Future hand pushes must repeat this registration.
    if (!client.view) return;
    client.view.add(player);
    for (const card of player.hand) client.view.add(card);
  }

  private async disconnectIfBothPlayersAreDisconnected(): Promise<void> {
    if (this.state.players.size < 2) return;
    let allDisconnected = true;
    for (const player of this.state.players.values()) {
      if (player.isConnected) {
        allDisconnected = false;
        break;
      }
    }
    if (allDisconnected) await this.disconnect();
  }

  private rotateTurnOwner(): void {
    const playerIds = [...this.state.players.keys()];
    if (playerIds.length !== 2) return;
    const currentIndex = playerIds.indexOf(this.state.currentTurnPlayerId);
    this.state.currentTurnPlayerId = playerIds[(currentIndex + 1) % playerIds.length] ?? playerIds[0];
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
