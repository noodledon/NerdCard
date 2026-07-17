import { GameRoomState, PlayerSchema, catalogCardToSchema, shuffleArraySchema } from '../state/schema.js';
import { loadCatalog } from '../data/load-catalog.js';
import { Phase } from '../logic/fsm.js';
import { PhaseController } from './phaseController.js';
import { CommandDispatcher, type CommandIntent } from '../commands/CommandDispatcher.js';
import { evaluate } from '../logic/evalEngine.js';
import type { CommandResult, CommandState } from '../commands/base.js';

export interface GameEvent {
  event: string;
  actorId: string;
  details: Record<string, unknown>;
}

export type GameEventListener = (event: GameEvent) => void;

/**
 * Core game logic for NerdiClash, transport-agnostic.
 *
 * This class owns all authoritative game state and rules. It knows nothing
 * about WebSockets, Colyseus, or JSON — it only mutates GameRoomState and
 * emits game events through a listener callback.
 *
 * Both the Colyseus room wrapper and the JSON bridge create an instance of
 * this class and forward player intents to it.
 */
export class NerdiClashGame {
  public readonly state: GameRoomState;
  public readonly phaseController: PhaseController;
  private readonly commandDispatcher = new CommandDispatcher();
  private eventListener: GameEventListener | undefined;

  constructor() {
    this.state = new GameRoomState();
    this.state.phase = Phase.waiting;
    this.phaseController = new PhaseController(this.state);
  }

  setEventListener(listener: GameEventListener | undefined): void {
    this.eventListener = listener;
  }

  // ─── Player lifecycle ──────────────────────────────────────────────────────

  addPlayer(sessionId: string, displayName: string): PlayerSchema {
    let player = this.state.players.get(sessionId);
    if (!player) {
      player = new PlayerSchema();
      player.sessionId = sessionId;
      player.displayName = displayName || sessionId;

      this.seedPlayerDecks(player);

      this.state.players.set(sessionId, player);
      if (!this.state.currentTurnPlayerId) {
        this.state.currentTurnPlayerId = sessionId;
      }
    } else {
      player.isConnected = true;
      if (displayName) player.displayName = displayName;
    }
    return player;
  }

  removePlayer(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.isConnected = false;
  }

  reconnectPlayer(sessionId: string, displayName?: string): void {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    player.isConnected = true;
    if (displayName) player.displayName = displayName;
  }

  playerCount(): number {
    return this.state.players.size;
  }

  isFull(): boolean {
    return this.state.players.size >= 2;
  }

  allPlayersAreDisconnected(): boolean {
    if (this.state.players.size < 2) return false;
    for (const player of this.state.players.values()) {
      if (player.isConnected) return false;
    }
    return true;
  }

  // ─── Game loop ─────────────────────────────────────────────────────────────

  tick(now: number): void {
    const previousPhase = this.phaseController.phase;
    this.phaseController.tick(now);
    if (previousPhase === Phase.resolution && this.phaseController.phase === Phase.draw) {
      this.rotateTurnOwner();
    }
  }

  startGame(): void {
    this.phaseController.requestTransition(Phase.construction);
  }

  // ─── Intent dispatch ───────────────────────────────────────────────────────

  dispatchIntent(sessionId: string, intent: string, payload: Record<string, unknown>): CommandResult {
    if (intent === 'ready_inst') {
      return { ok: true };
    }

    if (intent === 'draw_cards') {
      const choices = this.readDrawChoices(payload);
      if (!choices) {
        return { ok: false, reason: 'invalid draw choices' };
      }
      for (const choice of choices) {
        const result = this.dispatchCommand({
          intent: 'draw',
          payload: { playerId: sessionId, deck: choice.deck, count: choice.count },
        });
        if (!result.ok) return result;
      }
      return { ok: true };
    }

    const commandIntent = this.toCommandIntent(sessionId, intent, payload);
    if (!commandIntent) {
      return { ok: false, reason: `unsupported intent ${intent}` };
    }
    const result = this.dispatchCommand(commandIntent);
    if (result.ok && intent === 'play_defense') {
      this.phaseController.requestTransition(Phase.resolution);
    }
    if (result.ok && !result.fizzled && (intent === 'eval_function' || intent === 'force_eval')) {
      this.phaseController.onEvalTurn();
    }
    return result;
  }

  requestEndTurn(sessionId: string): CommandResult {
    const player = this.state.players.get(sessionId);
    if (!player) {
      return { ok: false, reason: 'player state missing' };
    }
    // Advance stalling counters before resetting the flag so we read the true
    // value for this turn. onEvalTurn resets consecutive_no_eval_turns; 
    // onNoEvalTurn increments both counters and may return force-eval events.
    if (player.evaluatedThisTurn) {
      this.phaseController.onEvalTurn();
    } else {
      this.phaseController.onNoEvalTurn();
    }
    player.aggressiveActionUsedThisTurn = false;
    player.offensivePlayedThisTurn = false;
    player.evaluatedThisTurn = false;
    player.actionsUsedThisTurn = 0;
    this.state.forceEvalRequested = false;
    this.state.pendingTriggerId = '';
    this.state.defenseResponseUsed = false;
    this.tickIsolationTimers();
    this.phaseController.requestTransition(Phase.resolution);
    this.phaseController.requestTransition(Phase.draw);
    this.rotateTurnOwner();
    this.emitGameEvent('end_turn', sessionId);
    return { ok: true };
  }

  // ─── State queries ─────────────────────────────────────────────────────────

  getPlayer(sessionId: string): PlayerSchema | undefined {
    return this.state.players.get(sessionId);
  }

  getStateSnapshot(): Record<string, unknown> {
    return {
      phase: this.state.phase,
      currentTurnPlayerId: this.state.currentTurnPlayerId,
      turnDeadline: this.state.turnDeadline,
      turnIndex: this.state.turnIndex,
      roundNumber: this.state.roundNumber,
      winner: this.state.winner,
      consecutive_no_eval_turns: this.state.consecutive_no_eval_turns,
      global_no_eval_turns: this.state.global_no_eval_turns,
      players: Object.fromEntries(
        [...this.state.players.entries()].map(([id, player]: [string, PlayerSchema]) => [
          id,
          {
            sessionId: player.sessionId,
            displayName: player.displayName,
            hp10: player.hp10,
            everGainedHP: player.everGainedHP,
            isConnected: player.isConnected,
            handCount: player.handCount,
            boardCount: player.boardCount,
            boards: [...player.boards].filter((b): b is NonNullable<typeof b> => b !== undefined).map((b) => ({
              boardId: b.boardId,
              expression: b.expression,
              domain: b.domain,
              isActive: b.isActive,
              isSingular: b.isSingular,
            })),
            deckFCC: [...player.deckFCC].filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => ({ id: c.id, name: c.subtype })),
            deckNumber: [...player.deckNumber].filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => ({ id: c.id, name: c.subtype })),
            deckAction: [...player.deckAction].filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => ({ id: c.id, name: c.subtype })),
            hand: [...player.hand].filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => ({
              id: c.id,
              cardType: c.cardType,
              subtype: c.subtype,
              numericValue: c.numericValue,
              value: c.value,
            })),
            availableVariables: [...player.availableVariables].filter((c): c is NonNullable<typeof c> => c !== undefined).map((c) => c.id),
            variableUsagesLeft: player.variableUsagesLeft,
            baseFunctionUnlocked: player.baseFunctionUnlocked,
            hasUsedVariableThisConstruction: player.hasUsedVariableThisConstruction,
            aggressiveActionUsedThisTurn: player.aggressiveActionUsedThisTurn,
            offensivePlayedThisTurn: player.offensivePlayedThisTurn,
            trapCardId: player.trapCardId,
            boundFactorNumberCardId: player.boundFactorNumberCardId,
            boundFactorSpellId: player.boundFactorSpellId,
            evaluatedThisTurn: player.evaluatedThisTurn,
            actionsUsedThisTurn: player.actionsUsedThisTurn,
          },
        ]),
      ),
      deckCounts: Object.fromEntries(this.state.deckCounts.entries()),
      variable_isolation_timers: Object.fromEntries(this.state.variable_isolation_timers.entries()),
    };
  }

  getStateSnapshotForPlayer(sessionId: string): Record<string, unknown> {
    const base = this.getStateSnapshot();
    const players = base.players as Record<string, Record<string, unknown>>;
    for (const [id, playerData] of Object.entries(players)) {
      if (id !== sessionId) {
        // Hide private fields from opponents
        delete playerData.hand;
        delete playerData.deckFCC;
        delete playerData.deckNumber;
        delete playerData.deckAction;
        delete playerData.availableVariables;
      }
    }
    return base;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private seedPlayerDecks(player: PlayerSchema): void {
    const catalog = loadCatalog();
    for (const card of catalog) {
      const cardSchema = catalogCardToSchema(card);
      if (card.deck === 'fcc') player.deckFCC.push(cardSchema);
      else if (card.deck === 'number') player.deckNumber.push(cardSchema);
      else if (card.deck === 'action') player.deckAction.push(cardSchema);
    }
    shuffleArraySchema(player.deckFCC);
    shuffleArraySchema(player.deckNumber);
    shuffleArraySchema(player.deckAction);

    this.state.deckCounts.set(`${player.sessionId}_fcc`, player.deckFCC.length);
    this.state.deckCounts.set(`${player.sessionId}_number`, player.deckNumber.length);
    this.state.deckCounts.set(`${player.sessionId}_action`, player.deckAction.length);
  }

  private tickIsolationTimers(): void {
    for (const [id, p] of this.state.players.entries()) {
      const mainBoard = [...p.boards][0];
      const expr = mainBoard?.expression?.trim() ?? '';
      if (/^[a-z]$/.test(expr)) {
        const current = this.state.variable_isolation_timers.get(id);
        if (current === undefined) {
          this.state.variable_isolation_timers.set(id, 3);
        } else if (current > 0) {
          this.state.variable_isolation_timers.set(id, current - 1);
        }
      } else {
        this.state.variable_isolation_timers.delete(id);
      }
    }
  }

  private rotateTurnOwner(): void {
    const playerIds = [...this.state.players.keys()];
    if (playerIds.length !== 2) return;
    const currentIndex = playerIds.indexOf(this.state.currentTurnPlayerId);
    this.state.currentTurnPlayerId = playerIds[(currentIndex + 1) % playerIds.length] ?? playerIds[0];
  }

  private emitGameEvent(event: string, actorId: string, details: Record<string, unknown> = {}): void {
    this.eventListener?.({ event, actorId, details });
  }

  private dispatchCommand(commandIntent: CommandIntent): CommandResult {
    return this.commandDispatcher.dispatch(this.state as unknown as CommandState, {
      evalEngine: { evaluate },
      emitGameEvent: (event, actorId, details) => this.emitGameEvent(event, actorId, details ?? {}),
    }, commandIntent);
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
        const forceCard = player ? [...player.hand].find((card) => card?.cardType === 'forceEval' || card?.subtype === 'Force Evaluation') : undefined;
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
}
