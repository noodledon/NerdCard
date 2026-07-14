import colyseus from 'colyseus';
import { GameRoomState, PlayerSchema } from '../state/schema.js';
import { Phase, type Phase as FSMPhase } from '../logic/fsm.js';
import { PhaseController } from './phaseController.js';
import { CommandDispatcher, type CommandIntent } from '../commands/CommandDispatcher.js';
import { evaluate } from '../logic/evalEngine.js';
import { ErrorCode } from '../shared/ErrorCode.js';
import { registerHandlers, type HandlerClient } from './handlers.js';
import type { CommandResult, CommandState } from '../commands/base.js';

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
 * T10 — authoritative two-player NerdiClash room.
 *
 * The installed schema version is Colyseus 0.15/@colyseus-schema 2.x, where
 * private hands use @filter(). The optional client.view registration below is
 * retained for schema 3-compatible clients and for explicit privacy tests.
 */
export class NerdiClashRoom extends ColyseusRoom {
  public phaseController!: PhaseController;
  private readonly commandDispatcher = new CommandDispatcher();
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;

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
    registerHandlers(this, (type, handler) => {
      this.onMessage(type, (client, payload) => handler(client, payload));
    });
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
    this.cancelScheduledDisconnect();
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
    if (this.state.phase === Phase.defense && this.state.turnDeadline > Date.now()) {
      client.send('game_event', {
        event: JSON.stringify({ type: 'defense_resumed', deadline: this.state.turnDeadline }),
        actorId: client.sessionId,
        turnId: this.state.turnIndex,
      });
    }

    if (this.clients.length === 2) {
      await this.lock();
      this.phaseController.requestTransition(Phase.construction);
    }
  }

  async onLeave(client: NerdiClashClient, consented: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    player.isConnected = false;
    this.scheduleDisconnectWhenBothPlayersAreDisconnected();
    if (consented) return;

    try {
      await this.allowReconnection(client, 30);
    } catch {
      // The timeout has elapsed; scheduling is idempotent and owns final disposal.
      this.scheduleDisconnectWhenBothPlayersAreDisconnected();
    }
  }

  onDispose(): void {
    this.cancelScheduledDisconnect();
    // Game state is intentionally ephemeral. Colyseus disposes the room and
    // its in-memory schema after both seats are disconnected.
  }

  async dispatchIntent(client: HandlerClient, intent: string, payload: Record<string, unknown>): Promise<void> {
    if (intent === 'ready_inst') return;

    if (intent === 'draw_cards') {
      const choices = this.readDrawChoices(payload);
      if (!choices) {
        client.send('error', { code: ErrorCode.INVALID_PAYLOAD, message: 'invalid draw choices' });
        return;
      }
      for (const choice of choices) {
        const result = this.dispatchCommand({
          intent: 'draw',
          payload: { playerId: client.sessionId, deck: choice.deck, count: choice.count },
        });
        if (!result.ok) {
          client.send('error', {
            code: this.errorCodeFor(result.reason),
            message: result.reason ?? 'draw rejected',
          });
        }
      }
      return;
    }

    const commandIntent = this.toCommandIntent(client.sessionId, intent, payload);
    if (!commandIntent) {
      client.send('error', { code: ErrorCode.INVALID_TARGET, message: `unsupported intent ${intent}` });
      return;
    }
    const result = this.dispatchCommand(commandIntent);
    if (!result.ok) {
      client.send('error', { code: this.errorCodeFor(result.reason), message: result.reason ?? 'command rejected' });
      return;
    }
    if (intent === 'play_defense') this.phaseController.requestTransition(Phase.resolution);
  }

  async requestEndTurn(client: HandlerClient): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      client.send('error', { code: ErrorCode.INTERNAL, message: 'player state missing' });
      return;
    }
    player.aggressiveActionUsedThisTurn = false;
    player.offensivePlayedThisTurn = false;
    player.evaluatedThisTurn = false;
    player.actionsUsedThisTurn = 0;
    this.state.forceEvalRequested = false;
    this.state.pendingTriggerId = '';
    this.state.defenseResponseUsed = false;
    this.phaseController.requestTransition(Phase.resolution);
    this.phaseController.requestTransition(Phase.draw);
    this.rotateTurnOwner();
    this.emitGameEvent('end_turn', client.sessionId);
  }

  private toCommandIntent(playerId: string, intent: string, payload: Record<string, unknown>): CommandIntent | undefined {
    switch (intent) {
      case 'build_function':
        return { intent: 'build-function', payload: { playerId, boardId: String(payload.boardId), expression: String(payload.expression) } };
      case 'set_trap':
        return { intent: 'trap', payload: { playerId, trapCardId: String(payload.cardId) } };
      case 'play_defense':
        return { intent: 'play-defense', payload: { playerId, cardId: String(payload.cardId), targetTriggerId: String(payload.targetTriggerId) } };
      case 'eval_function': {
        const player = this.state.players.get(playerId);
        const boardId = String(payload.boardId);
        const boardIndex = player ? [...player.boards].findIndex((board) => board?.boardId === boardId) : -1;
        return boardIndex >= 0 ? { intent: 'eval', payload: { playerId, boardIndex, vvcCardId: String(payload.variableValueCardId) } } : undefined;
      }
      case 'force_eval': {
        const player = this.state.players.get(playerId);
        const forceCard = player ? [...player.hand].find((card) => card?.cardType === 'forceEval' || card?.subtype === 'force_eval') : undefined;
        return forceCard ? { intent: 'force-eval', payload: { playerId, cardId: forceCard.id } } : undefined;
      }
      case 'play_card': {
        const target = payload.target as { kind: string; id?: string };
        return { intent: 'attack-hp', payload: {
          playerId,
          cardId: String(payload.cardId),
          targetPlayerId: target.kind === 'opp' ? target.id : undefined,
          targetBoardId: target.kind === 'opp_board' ? target.id : undefined,
          numberCardId: (payload.numberFactorCardIds as string[] | undefined)?.[0],
        } };
      }
      default:
        return undefined;
    }
  }

  private emitGameEvent(event: string, actorId: string, details: Record<string, unknown> = {}): void {
    this.broadcast('game_event', {
      event: JSON.stringify({ type: event, ...details }),
      actorId,
      turnId: this.state.turnIndex,
    });
  }

  private errorCodeFor(reason: string | undefined): ErrorCode {
    if (reason?.includes('aggressive action')) return ErrorCode.OFFENSIVE_LIMIT_EXCEEDED;
    if (reason?.includes('not in player')) return ErrorCode.CARD_NOT_IN_HAND;
    if (reason?.includes('maximum') || reason?.includes('already used')) return ErrorCode.TOO_MANY_ACTIONS;
    if (reason?.includes('deck empty')) return ErrorCode.INVALID_TARGET;
    return ErrorCode.INVALID_TARGET;
  }

  private registerPrivateView(client: NerdiClashClient, player: PlayerSchema): void {
    // In schema 2.x @filter() performs this registration automatically. If a
    // schema 3 client supplies StateView, register both the player and every
    // existing hand card. Future hand pushes must repeat this registration.
    if (!client.view) return;
    client.view.add(player);
    for (const card of player.hand) client.view.add(card);
  }

  private dispatchCommand(commandIntent: CommandIntent): CommandResult {
    return this.commandDispatcher.dispatch(this.state as unknown as CommandState, {
      evalEngine: { evaluate },
      emitGameEvent: (event, actorId, details) => this.emitGameEvent(event, actorId, details),
    }, commandIntent);
  }

  private readDrawChoices(
    payload: Record<string, unknown>,
  ): Array<{ deck: 'fcc' | 'number' | 'action'; count: number }> | undefined {
    if (!Array.isArray(payload.deckChoices)) return undefined;
    const choices: Array<{ deck: 'fcc' | 'number' | 'action'; count: number }> = [];
    for (const rawChoice of payload.deckChoices) {
      if (typeof rawChoice !== 'object' || rawChoice === null) return undefined;
      const choice = rawChoice as { deck?: unknown; count?: unknown };
      if (
        (choice.deck !== 'fcc' && choice.deck !== 'number' && choice.deck !== 'action')
        || typeof choice.count !== 'number'
        || !Number.isInteger(choice.count)
      ) {
        return undefined;
      }
      choices.push({ deck: choice.deck, count: choice.count });
    }
    return choices;
  }

  private allPlayersAreDisconnected(): boolean {
    if (this.state.players.size < 2) return false;
    for (const player of this.state.players.values()) {
      if (player.isConnected) return false;
    }
    return true;
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
