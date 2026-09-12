import { GameRoomState, PlayerSchema, FunctionBoardSchema, addToHand, catalogCardToSchema, shuffleArraySchema } from '../state/schema.js';
import { catalogEffectParams, loadCatalog } from '../data/load-catalog.js';
import { Phase } from '../logic/fsm.js';
import type { BaseDomain } from '../shared/types.js';
import { PhaseController } from './phaseController.js';
import { CommandDispatcher, type CommandIntent } from '../commands/CommandDispatcher.js';
import { evaluate, forceEval as engineForceEval, type ForceEvalPlayer } from '../logic/evalEngine.js';
import { checkWin } from '../logic/winEngine.js';
import { distinctVariablesInExpression } from '../math/expressions.js';
import type { CommandResult, CommandState } from '../commands/base.js';

export interface GameEvent {
  event: string;
  actorId: string;
  details: Record<string, unknown>;
}

export type GameEventListener = (event: GameEvent) => void;

const WIN_REASON_BY_ENGINE: Record<string, string> = {
  hp0: 'hp_zero',
  isolation: 'variable_isolation',
  'force-dom': 'force_eval_domination',
  singular: 'singular_board',
  dim0: 'singular_board',
};

/** Catalog id → display name, used to enrich hand entries in snapshots. */
const CARD_NAME_BY_ID = new Map(loadCatalog().map((card) => [card.id, card.name]));

/** play_card cardTypes that toCommandIntent already routes to a command. */
const ROUTED_PLAY_CARD_TYPES = new Set([
  'addTerm', 'derivative', 'offensive', 'martialTheorem', 'trap',
  'artifactTheorem', 'forceEval', 'addBoard', 'composition', 'integral', 'limit',
  'modular', 'ntTheorem', 'vector', 'matrix', 'transform', 'eigenvalue',
]);

/**
 * Rulebook §6 turn economy: at most two actions per play phase, on top of
 * the existing one-aggressive-action lockout. A wire intent in this set —
 * any routed play_card (trap-set included), set_trap, eval_function or
 * force_eval — consumes one action when it resolves (ok:true), fizzles
 * included: the card was spent, the action was used. Rejected intents
 * (ok:false) never consume. draw_cards/build_function/play_defense/
 * end_turn/ready_inst/leave_room never count — wrong phase or lifecycle.
 */
const ACTION_COUNTING_INTENTS = new Set(['play_card', 'set_trap', 'eval_function', 'force_eval']);
const MAX_ACTIONS_PER_TURN = 2;

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
    // A play deadline that elapses with a pending attack must open the same
    // defense window the end_turn path grants — otherwise an AFK attacker
    // would bypass the defender's reactive cards entirely. play→defense is a
    // legal transition but resolution→defense is not, so this intercept must
    // run BEFORE phaseController.tick performs the FSM's play→resolution
    // auto-pass. The defense deadline then lands the attack on a later tick
    // via the defense→resolution auto-pass below.
    if (
      previousPhase === Phase.play
      && this.state.turnDeadline > 0
      && now >= this.state.turnDeadline
      && this.state.pendingAttackTargetId
    ) {
      if (!this.state.pendingTriggerId) {
        this.state.pendingTriggerId = `attack-${this.state.turnIndex}`;
      }
      this.phaseController.requestTransition(Phase.defense, now);
      this.runCheckWin();
      return;
    }
    const fsmEvents = this.phaseController.tick(now);
    const phase = this.phaseController.phase;
    if ((previousPhase === Phase.play || previousPhase === Phase.defense) && phase === Phase.resolution) {
      // Auto-pass: a play/defense deadline elapsed, so the turn resolves here.
      // The defender already had (or never earned) a defense window, so any
      // pending attack lands now.
      this.applyPendingAttack();
      // A 'force-eval' event means a stalling counter tripped inside the FSM.
      // Settle a possible kill from the landed attack first and skip the
      // showdown entirely if the game is already decided.
      if (fsmEvents.includes('force-eval')) {
        this.runCheckWin();
        if (!this.state.winner) {
          this.runStallingForceEval(this.state.currentTurnPlayerId);
        }
      }
      this.phaseController.requestTransition(Phase.draw);
      this.rotateTurnOwner();
    } else if (previousPhase === Phase.resolution && phase === Phase.draw) {
      this.rotateTurnOwner();
    }
    if (fsmEvents.includes('game-over')) {
      this.resolveConstructionAbandonment();
    }
    this.runCheckWin();
  }

  startGame(): void {
    this.phaseController.requestTransition(Phase.construction);
  }

  // ─── Intent dispatch ───────────────────────────────────────────────────────

  dispatchIntent(sessionId: string, intent: string, payload: Record<string, unknown>): CommandResult | Promise<CommandResult> {
    // gameOver without a winner (abandoned construction) must also refuse
    // intents — every per-intent phase check would reject anyway, but the
    // reason should say the game is over, not misreport the phase.
    if (this.state.winner || this.state.phase === Phase.gameOver) {
      return { ok: false, reason: 'game is over' };
    }

    if (intent === 'ready_inst') {
      return { ok: true };
    }

    if (intent === 'draw_cards') {
      if (this.state.phase !== Phase.draw) {
        return { ok: false, reason: 'draw_cards only in draw phase' };
      }
      if (sessionId !== this.state.currentTurnPlayerId) {
        return { ok: false, reason: 'not the active player' };
      }
      const choices = this.readDrawChoices(payload);
      if (!choices) {
        return { ok: false, reason: 'invalid draw choices' };
      }
      // handlers.ts drawChoiceTotal parity: the batch must total exactly 2.
      const drawTotal = choices.reduce((sum, choice) => sum + choice.count, 0);
      if (drawTotal !== 2) {
        return { ok: false, reason: 'deckChoices must draw exactly 2 cards' };
      }
      for (const choice of choices) {
        const result = this.dispatchCommand({
          intent: 'draw',
          payload: { playerId: sessionId, deck: choice.deck, count: choice.count },
        });
        // DrawCommand is always synchronous, but dispatchCommand's return type
        // is the union. Guard for type safety.
        if (result instanceof Promise) {
          return result.then((resolved) => {
            if (!resolved.ok) return resolved;
            return this.finalizeDraw(sessionId);
          });
        }
        if (!result.ok) return result;
      }
      return this.finalizeDraw(sessionId);
    }

    // Authority backstop: the Colyseus handlers run these checks early
    // (handlers.ts), but the JSON bridge calls dispatchIntent directly, so
    // turn/defender ownership is enforced here where both transports share it.
    //
    // Handler → shared-path parity matrix (wave-10 T2 audit):
    //   parsePayload (Zod)      → parseClientMessage — same Zod schemas, bridge-side
    //   requirePhase            → checks below + each command's phaseAllowed
    //   requireTurnOwner        → currentTurnPlayerId checks below / requestEndTurn
    //   requireCard             → toCommandIntent hand lookup (play_card) /
    //                             requiredCard + 'not in player's hand' in commands
    //   requireBoard (isActive) → command findBoard + isBoardAlive — eval on a dead
    //                             board intentionally fizzles instead of erroring
    //   requireTarget           → toCommandIntent target-kind + self-target guards;
    //                             commands re-validate resolved ids
    //   requirePendingTrigger   → pendingTriggerId match below (after a resolved
    //                             defense the phase has left defense, which
    //                             subsumes the handler's defenseResponseUsed check)
    //   drawChoiceTotal === 2   → exact-2 sum check in the draw_cards branch
    //   end_turn defender pass  → requestEndTurn's defenderPassing branch
    if (intent === 'build_function') {
      // Parity with handlers.ts: construction takes simultaneous builds from
      // both players; in play only the turn owner may rebuild a wiped board
      // (BuildFunctionCommand enforces the empty-expression rule itself).
      if (this.state.phase !== Phase.construction && this.state.phase !== Phase.play) {
        return { ok: false, reason: 'build_function only in construction or play phase' };
      }
      if (this.state.phase === Phase.play && sessionId !== this.state.currentTurnPlayerId) {
        return { ok: false, reason: 'not the active player' };
      }
    }
    if (
      intent === 'play_card'
      || intent === 'set_trap'
      || intent === 'eval_function'
      || intent === 'force_eval'
    ) {
      if (this.state.phase !== Phase.play || sessionId !== this.state.currentTurnPlayerId) {
        return { ok: false, reason: 'not the active player' };
      }
    }
    if (intent === 'play_defense') {
      if (this.state.phase !== Phase.defense || sessionId !== this.state.pendingAttackTargetId) {
        return { ok: false, reason: 'not the defending player' };
      }
      if (payload.targetTriggerId !== this.state.pendingTriggerId) {
        return { ok: false, reason: 'unknown trigger' };
      }
    }

    // §6 two-action cap — after the winner/phase/ownership guards but before
    // toCommandIntent, so a rejected or unrouted intent never burns an
    // action. EvalCommand also permits Phase.resolution; an eval landing
    // there is still this turn's economy (the counter only resets in
    // requestEndTurn), so the cap counts — and can block — it here too.
    if (ACTION_COUNTING_INTENTS.has(intent)) {
      const player = this.state.players.get(sessionId);
      if (player && player.actionsUsedThisTurn >= MAX_ACTIONS_PER_TURN) {
        return { ok: false, reason: 'turn action limit reached' };
      }
    }

    const routed = this.toCommandIntent(sessionId, intent, payload);
    if (routed && 'ok' in routed) {
      return routed;
    }
    if (!routed) {
      const unrouted = intent === 'play_card' ? this.unroutedPlayCardReason(sessionId, payload) : undefined;
      return { ok: false, reason: unrouted ?? `unsupported intent ${intent}` };
    }
    const commandIntent = routed;
    const result = this.dispatchCommand(commandIntent);
    if (result instanceof Promise) {
      return result.then((resolved) => this.applyPostPlayProcessing(resolved, intent, payload, sessionId));
    }
    return this.applyPostPlayProcessing(result, intent, payload, sessionId);
  }

  private finalizeDraw(sessionId: string): CommandResult {
    this.phaseController.requestTransition(Phase.play);
    void sessionId;
    return { ok: true };
  }

  private applyPostPlayProcessing(
    result: CommandResult,
    intent: string,
    payload: Record<string, unknown>,
    sessionId: string,
  ): CommandResult {
    if (result.ok && intent === 'build_function' && this.state.phase === Phase.construction) {
      const board = this.findBoardForPlayer(sessionId, String(payload.boardId));
      const domain = (board?.domain ?? 'poly') as BaseDomain;
      const submission = this.phaseController.submitBuildFunction(sessionId, {
        expression: String(payload.expression),
        domain,
      });
      if (!submission.ok) {
        return { ok: false, reason: submission.reason ?? 'build_function rejected by phase' };
      }
      // The submission gate owns the write during construction — the command
      // stayed write-free so a rejected intent mutates nothing.
      if (board) board.expression = String(payload.expression);
      this.emitGameEvent('build_function', sessionId, { boardId: String(payload.boardId) });
    }
    if (result.ok && intent === 'play_defense') {
      // PlayDefenseCommand already zeroed the pending damage for a successful
      // defense; applyPendingAttack records the (negated) hit and clears state.
      this.applyPendingAttack();
      this.resolveTurn();
    }
    if (result.ok && !result.fizzled && (intent === 'eval_function' || intent === 'force_eval')) {
      this.phaseController.onEvalTurn();
    }
    // Spend one of the turn's two actions on any resolved action intent —
    // fizzles included (the card was used). Validation failures (ok:false)
    // don't consume.
    if (result.ok && ACTION_COUNTING_INTENTS.has(intent)) {
      const player = this.state.players.get(sessionId);
      if (player) player.actionsUsedThisTurn += 1;
    }
    if (result.ok) this.runCheckWin();
    return result;
  }

  requestEndTurn(sessionId: string): CommandResult {
    if (this.state.winner) {
      return { ok: false, reason: 'game is over' };
    }
    const defenderPassing = this.state.phase === Phase.defense
      && sessionId === this.state.pendingAttackTargetId;
    if (this.state.phase !== Phase.play && !defenderPassing) {
      return { ok: false, reason: 'end turn only in play phase' };
    }
    if (this.state.phase === Phase.play && sessionId !== this.state.currentTurnPlayerId) {
      return { ok: false, reason: 'not the active player' };
    }
    const player = this.state.players.get(sessionId);
    if (!player) {
      return { ok: false, reason: 'player state missing' };
    }

    if (defenderPassing) {
      // The defender declines to respond — the pending attack lands.
      this.applyPendingAttack();
      this.resolveTurn();
      this.emitGameEvent('end_turn', sessionId);
      return { ok: true };
    }

    // Advance stalling counters before resetting the flag so we read the true
    // value for this turn. onEvalTurn resets consecutive_no_eval_turns;
    // onNoEvalTurn increments both counters and may return force-eval events.
    if (player.evaluatedThisTurn) {
      this.phaseController.onEvalTurn();
    } else {
      const fsmEvents = this.phaseController.onNoEvalTurn();
      if (fsmEvents.includes('force-eval')) {
        // §8.5 anti-stall: the staller's turn ending trips the showdown while
        // any recorded attack is still pending (it resolves via the defense
        // window below if the game continues).
        this.runStallingForceEval(sessionId);
      }
    }
    player.aggressiveActionUsedThisTurn = false;
    player.offensivePlayedThisTurn = false;
    player.evaluatedThisTurn = false;
    player.actionsUsedThisTurn = 0;
    this.state.forceEvalRequested = false;
    this.tickIsolationTimers();

    if (this.state.pendingAttackTargetId) {
      // An attack was recorded this turn — open the defense window instead of
      // resolving. pendingTriggerId/defenseResponseUsed stay live until the
      // attack actually resolves.
      if (!this.state.pendingTriggerId) {
        this.state.pendingTriggerId = `attack-${this.state.turnIndex}`;
      }
      this.phaseController.requestTransition(Phase.defense);
    } else {
      this.applyPendingAttack();
      this.resolveTurn();
    }
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
      winReason: this.state.winReason,
      pendingAttackDamage10: this.state.pendingAttackDamage10,
      pendingAttackSourceId: this.state.pendingAttackSourceId,
      pendingAttackTargetId: this.state.pendingAttackTargetId,
      pendingTriggerId: this.state.pendingTriggerId,
      defenseResponseUsed: this.state.defenseResponseUsed,
      forceEvalRequested: this.state.forceEvalRequested,
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
              // Display name joined from the catalog — CardSchema deliberately
              // has no name field (keeps the ≤64-field guard happy); unknown
              // ids fall back to the subtype so clients always get a label.
              name: CARD_NAME_BY_ID.get(c.id) ?? c.subtype,
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
            artifactTheoremActive: player.artifactTheoremActive,
            deckCounts: {
              fcc: player.deckFCC.length,
              number: player.deckNumber.length,
              action: player.deckAction.length,
            },
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
        // §16: trap content is hidden from non-owners — swap the exact card
        // id for a boolean so the UI can still show "trap armed".
        playerData.trapSet = typeof playerData.trapCardId === 'string' && playerData.trapCardId !== '';
        delete playerData.trapCardId;
      }
    }
    return base;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private seedPlayerDecks(player: PlayerSchema): void {
    const catalog = loadCatalog();
    for (const card of catalog) {
      const cardSchema = catalogCardToSchema(card);
      // VVCs are a documented opening resource, not random number-deck draws.
      // Keeping every Anchor in hand guarantees both players can evaluate once
      // they reach play phase and choose an Anchor in the client.
      if (cardSchema.subtype === 'Anchor') addToHand(player, cardSchema);
      else if (card.deck === 'fcc') player.deckFCC.push(cardSchema);
      else if (card.deck === 'number') player.deckNumber.push(cardSchema);
      else if (card.deck === 'action') player.deckAction.push(cardSchema);
    }
    shuffleArraySchema(player.deckFCC);
    shuffleArraySchema(player.deckNumber);
    shuffleArraySchema(player.deckAction);

    this.state.deckCounts.set(`${player.sessionId}_fcc`, player.deckFCC.length);
    this.state.deckCounts.set(`${player.sessionId}_number`, player.deckNumber.length);
    this.state.deckCounts.set(`${player.sessionId}_action`, player.deckAction.length);

    // Each player starts with one active board so they can build their initial
    // function the moment the construction phase begins. Without this, the very
    // first build_function fails with "board not found".
    const board = new FunctionBoardSchema();
    board.boardId = `${player.sessionId}_board_1`;
    board.ownerSessionId = player.sessionId;
    board.expression = '';
    board.domain = 'poly';
    board.isActive = true;
    player.boards.push(board);
    player.boardCount = player.boards.length;
  }

  private tickIsolationTimers(): void {
    for (const [id, p] of this.state.players.entries()) {
      // W9-T6 isolation pin (rulebook "reduce the opponent's function to a
      // single variable"): the countdown runs only while the player has at
      // least one ACTIVE board and every active board is reduced to <= 1
      // distinct variable — `3*x`, `x^2`, `x+1` now count, not just the
      // single-letter literal. An evaluated board stays active with
      // expression='' and is unparseable, so it cannot establish "reduced"
      // and pauses/clears the timer instead. checkWin still gates on the
      // main board via isIsolatedExpression (exactly-1) — unchanged.
      const activeBoards = [...p.boards].filter(
        (board): board is NonNullable<typeof board> => board !== undefined && board.isActive,
      );
      const reduced = activeBoards.length > 0 && activeBoards.every((board) => {
        const vars = distinctVariablesInExpression(board.expression);
        return vars !== undefined && vars <= 1;
      });
      if (reduced) {
        const current = this.state.variable_isolation_timers.get(id);
        if (current === undefined) {
          this.state.variable_isolation_timers.set(id, 3);
        } else if (current > 0) {
          this.state.variable_isolation_timers.set(id, current - 1);
        }
      } else if (this.state.variable_isolation_timers.has(id)) {
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

  /** Apply a recorded attack once the defense window closes, then clear it. */
  private applyPendingAttack(): void {
    if (this.state.pendingAttackDamage10 <= 0 && !this.state.pendingAttackTargetId) return;
    const target = this.state.players.get(this.state.pendingAttackTargetId);
    let damage10 = this.state.pendingAttackDamage10;
    // Euler's Ward (act-artifact-theorem-001, {persistent:true}): halves every
    // incoming attack while active — pinned as a persistent passive, not a
    // consume-on-hit negate. Ordering pin: shield absorb already reduced the
    // pending amount upstream in PlayDefenseCommand, so the ward halves the
    // residual.
    const artifactHalved = damage10 > 0 && target?.artifactTheoremActive === true;
    if (artifactHalved) damage10 = Math.floor(damage10 / 2);
    if (target) {
      target.hp10 = Math.max(0, target.hp10 - damage10);
    }
    this.emitGameEvent('attack_resolved', this.state.pendingAttackSourceId, {
      damage10,
      targetId: this.state.pendingAttackTargetId,
      ...(artifactHalved ? { artifactHalved: true } : {}),
    });
    this.state.pendingAttackDamage10 = 0;
    this.state.pendingAttackSourceId = '';
    this.state.pendingAttackTargetId = '';
    this.state.pendingTriggerId = '';
    this.state.defenseResponseUsed = false;
  }

  /** Close out the current turn: resolution → draw, rotate the owner, check wins. */
  private resolveTurn(): void {
    const phase = this.phaseController.phase;
    if (phase === Phase.play || phase === Phase.defense) {
      this.phaseController.requestTransition(Phase.resolution);
    }
    this.phaseController.requestTransition(Phase.draw);
    this.rotateTurnOwner();
    this.runCheckWin();
  }

  private runCheckWin(): void {
    if (this.state.winner) return;
    const result = checkWin({
      players: [...this.state.players.values()].map((player) => ({
        id: player.sessionId,
        hp10: player.hp10,
        everGainedHP: player.everGainedHP,
        mainBoardExpr: [...player.boards][0]?.expression,
        boards: [...player.boards]
          .filter((b): b is NonNullable<typeof b> => b !== undefined)
          .map((b) => ({
            destroyed: (b as { destroyed?: boolean }).destroyed,
            isActive: b.isActive,
            isSingular: b.isSingular,
            // Schema dimension 0 means "scalar board", not a collapsed vector
            // space — only a real rank may feed the dim0 win condition.
            dimension: b.dimension > 0 ? b.dimension : undefined,
          })),
      })),
      variableIsolationTimers: this.state.variable_isolation_timers,
    });
    if (!result.winner) return;
    this.declareWinner(result.winner, result.loser, WIN_REASON_BY_ENGINE[result.reason ?? ''] ?? '');
  }

  /**
   * Construction deadline elapsed with incomplete submissions — the FSM's
   * AFK safeguard already moved the game to gameOver. A lone submitter wins
   * by abandonment; with zero submissions the game ends a documented draw
   * (phase gameOver, no winner, winReason 'abandoned').
   */
  private resolveConstructionAbandonment(): void {
    const submissions = this.phaseController.fsm.state.buildSubmissions;
    const submitter = [...this.state.players.keys()].find((id) => submissions?.get(id) === true);
    if (submitter) {
      const loser = [...this.state.players.keys()].find((id) => id !== submitter);
      this.declareWinner(submitter, loser, 'abandoned');
      return;
    }
    this.state.winReason = 'abandoned';
    this.emitGameEvent('game_over', '', { winner: null, loser: '', winReason: 'abandoned' });
  }

  /**
   * Single point where state.winner flips unset→set. Both runCheckWin and
   * runForceEval funnel here so the 'game_over' game_event fires exactly
   * once per game; transports translate it into their wire frame.
   */
  private declareWinner(winnerId: string, loserId: string | undefined, wireReason: string): void {
    if (this.state.winner) return;
    this.state.winner = winnerId;
    this.state.winReason = wireReason;
    this.phaseController.requestTransition(Phase.gameOver);
    this.emitGameEvent('game_over', winnerId, {
      winner: winnerId,
      loser: loserId ?? '',
      winReason: wireReason === '' ? null : wireReason,
    });
  }

  /**
   * CommandContext.forceEval — evaluate every player's main board at the VVC
   * value, resolve the showdown, and copy resulting HP back onto the schema.
   */
  private runForceEval(nominatorId: string, vvcValue: number): unknown {
    const wrappers: ForceEvalPlayer[] = [];
    for (const player of this.state.players.values()) {
      const board = [...player.boards][0];
      const evaluated = evaluate({ expression: board?.expression ?? '' }, 0, vvcValue);
      let lastForceValue = 0;
      if (evaluated.undefined) {
        if (board) board.isActive = false;
      } else {
        lastForceValue = evaluated.value;
      }
      wrappers.push({
        id: player.sessionId,
        hp10: player.hp10,
        lastForceValue,
        boards: [...player.boards].filter((b): b is NonNullable<typeof b> => b !== undefined),
      });
    }
    const result = engineForceEval({ players: wrappers }, { nominatorId });
    for (const wrapper of wrappers) {
      const player = this.state.players.get(wrapper.id);
      if (player) player.hp10 = wrapper.hp10;
    }
    if (result.winner) {
      const winnerId = result.winner;
      const loserId = [...this.state.players.keys()].find((id) => id !== winnerId);
      this.declareWinner(winnerId, loserId, 'force_eval_domination');
    }
    // A failed nomination destroys the initiator's main board — which may also
    // end the game — so always follow up with a win check.
    this.runCheckWin();
    return result;
  }

  /**
   * Rulebook §8.5 anti-stall showdown, fired when a no-eval counter trips.
   *
   * v1 auto-trigger contract:
   * - The nominator is the player whose turn just ended — the staller pays any
   *   failed-domination penalty, which is the anti-stall pressure.
   * - vvcValue is fixed at 1, a neutral fixed point: an automatic trigger has
   *   no per-player VVC choice.
   * - No Force Evaluation card is consumed — this is a phase event, not a
   *   card play.
   * - consecutive_no_eval_turns restarts afterward (a forced eval is an eval);
   *   global_no_eval_turns never resets (locked constraint).
   */
  private runStallingForceEval(nominatorId: string): void {
    const counter = this.state.consecutive_no_eval_turns >= 5 ? 'consecutive' : 'global';
    this.emitGameEvent('force_eval', nominatorId, { trigger: 'stalling', counter });
    this.runForceEval(nominatorId, 1);
    this.phaseController.onEvalTurn();
  }

  /**
   * Clearer failure reason when play_card references a card with no routed
   * command. Every unrouted catalog card is a non-playable resource, not an
   * unimplemented one — each gets a reason that says how it IS used.
   * 'card effect not implemented in v1' is deliberately gone (unreachable).
   */
  private unroutedPlayCardReason(sessionId: string, payload: Record<string, unknown>): string | undefined {
    const cardId = typeof payload.cardId === 'string' ? payload.cardId : undefined;
    const player = cardId ? this.state.players.get(sessionId) : undefined;
    const card = player ? [...player.hand].find((candidate) => candidate?.id === cardId) : undefined;
    if (!card || ROUTED_PLAY_CARD_TYPES.has(card.cardType)) return undefined;
    if (card.cardType === 'prime' || card.subtype === 'Irrational') {
      return 'number cards only take effect as bound factors — attach via numberFactorCardIds on an offensive play';
    }
    if (card.cardType === 'eval') {
      if (card.subtype === 'Anchor') {
        return 'Anchors are spent by the eval_function/force_eval intent, not played';
      }
      return 'the Evaluate card is spent automatically by the eval_function intent';
    }
    if (card.cardType === 'shield') {
      return 'shield cards are reactive — use play_defense during the defense phase';
    }
    return `card type '${card.cardType}' is a resource — it is never played directly`;
  }

  /** Owner of a boardId across all players, or undefined when no board matches. */
  private boardOwnerId(boardId: string): string | undefined {
    for (const [id, candidate] of this.state.players.entries()) {
      if ([...candidate.boards].some((board) => board?.boardId === boardId)) return id;
    }
    return undefined;
  }

  private findBoardForPlayer(sessionId: string, boardId: string): FunctionBoardSchema | undefined {
    const player = this.state.players.get(sessionId);
    if (!player) return undefined;
    return [...player.boards].find((b) => b?.boardId === boardId);
  }

  private dispatchCommand(commandIntent: CommandIntent): CommandResult | Promise<CommandResult> {
    return this.commandDispatcher.dispatch(this.state as unknown as CommandState, {
      evalEngine: { evaluate },
      forceEval: (_state, nominatorId, vvcValue) => this.runForceEval(nominatorId, vvcValue),
      emitGameEvent: (event, actorId, details) => this.emitGameEvent(event, actorId, details ?? {}),
    }, commandIntent);
  }

  /**
   * Route a wire intent to a command. Returns a CommandResult instead of a
   * CommandIntent when the route itself rejects (e.g. a self-targeting
   * play_card); undefined means the intent has no route at all.
   */
  private toCommandIntent(playerId: string, intent: string, payload: Record<string, unknown>): CommandIntent | CommandResult | undefined {
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
        if (!forceCard) return undefined;
        // vvcCardId is consumed by ForceEvalCommand; built via a named const so
        // the extra field survives structural typing whether or not the payload
        // interface declares it yet.
        const forcePayload = { playerId, cardId: forceCard.id, vvcCardId: String(payload.variableValueCardId ?? '') };
        return { intent: 'force-eval', payload: forcePayload };
      }
      case 'play_card': {
        // The JSON bridge receives untrusted JSON directly. Keep this guard even
        // though the bridge validates with Zod so no future transport can crash
        // the authoritative game loop by omitting target.
        if (typeof payload.target !== 'object' || payload.target === null || Array.isArray(payload.target)) {
          return undefined;
        }
        const target = payload.target as { kind?: unknown; id?: unknown };
        if (typeof target.kind !== 'string') return undefined;

        const cardId = typeof payload.cardId === 'string' ? payload.cardId : undefined;
        if (!cardId) return undefined;
        const player = this.state.players.get(playerId);
        if (!player) return undefined;
        const card = [...player.hand].find((candidate) => candidate?.id === cardId);
        // handlers.ts requireCard parity: a card the player doesn't hold is a
        // CARD_NOT_IN_HAND rejection, not a routing miss.
        if (!card) return { ok: false, reason: `card ${cardId} is not in player's hand` };

        const targetId = typeof target.id === 'string' ? target.id : undefined;
        // 'opp' must name an opponent and 'opp_board' a board an opponent owns —
        // naming yourself or your own board is self-targeting spelled differently.
        if (target.kind === 'opp' && targetId === playerId) {
          return { ok: false, reason: 'cannot target self' };
        }
        if (target.kind === 'opp_board' && targetId && this.boardOwnerId(targetId) === playerId) {
          return { ok: false, reason: 'cannot target self' };
        }
        const rawNumberFactors = payload.numberFactorCardIds;
        const numberCardId = Array.isArray(rawNumberFactors) && typeof rawNumberFactors[0] === 'string'
          ? rawNumberFactors[0]
          : undefined;
        const boardId = target.kind === 'self_board' ? targetId : undefined;
        const attackPayload = {
          playerId,
          cardId,
          targetPlayerId: target.kind === 'opp' ? targetId : undefined,
          targetBoardId: target.kind === 'opp_board' ? targetId : undefined,
          numberCardId,
        };

        switch (card.cardType) {
          case 'addTerm':
            return {
              intent: 'add-term',
              payload: { playerId, cardId, boardId, term: card.expressionPayload || 't' },
            };
          case 'derivative':
            return { intent: 'derivative', payload: { playerId, cardId, boardId } };
          case 'offensive':
            return { intent: 'attack-hp', payload: attackPayload };
          case 'martialTheorem':
            // Damage comes from the catalog join inside AttackHpCommand
            // (effectParams.damage ×10) — no hardcode here.
            return { intent: 'theorem-martial', payload: attackPayload };
          case 'trap':
            return { intent: 'trap', payload: { playerId, trapCardId: cardId } };
          case 'artifactTheorem':
            return { intent: 'theorem-artifact', payload: { playerId, cardId } };
          case 'forceEval':
            // play_card carries no VVC — the dedicated force_eval intent does.
            // Empty vvcCardId fails in ForceEvalCommand with the proper reason.
            return { intent: 'force-eval', payload: { playerId, cardId, vvcCardId: '' } };
          case 'addBoard': {
            const firstBoard = [...player.boards][0];
            const nextBoardId = `${playerId}_board_${player.boards.length + 1}`;
            return {
              intent: 'add-board',
              payload: {
                playerId,
                cardId,
                boardId: nextBoardId,
                expression: '',
                domain: firstBoard?.domain ?? '',
              },
            };
          }
          case 'composition': {
            const outerBoardId = boardId ?? [...player.boards][0]?.boardId;
            // The client may name the inner board via secondaryBoardId; the
            // documented v1 fallback auto-picks the first board that isn't the
            // outer. `variable` rides through to CompositionCommand, which
            // defaults it to the outer board's sole distinct variable.
            const secondaryBoardId = typeof payload.secondaryBoardId === 'string' && payload.secondaryBoardId !== ''
              ? payload.secondaryBoardId
              : undefined;
            const innerBoardId = secondaryBoardId
              ?? [...player.boards].find((board) => board?.boardId !== outerBoardId)?.boardId;
            if (!outerBoardId || !innerBoardId) return undefined;
            const variable = typeof payload.variable === 'string' && payload.variable !== ''
              ? payload.variable
              : undefined;
            return { intent: 'composition', payload: { playerId, cardId, outerBoardId, innerBoardId, variable } };
          }
          case 'integral':
            return { intent: 'integral', payload: { playerId, cardId, boardId } };
          case 'limit':
            return { intent: 'limit', payload: { playerId, cardId, boardId } };
          case 'modular': {
            const modulus = catalogEffectParams(cardId)?.modulus;
            if (typeof modulus !== 'number' || !Number.isInteger(modulus) || modulus <= 0) {
              return { ok: false, reason: 'modular modulus unavailable' };
            }
            return { intent: 'modular', payload: { playerId, cardId, boardId, modulus } };
          }
          case 'ntTheorem': {
            const theorem = catalogEffectParams(cardId)?.theorem;
            if (typeof theorem !== 'string' || theorem === '') {
              return { ok: false, reason: 'nt theorem unavailable' };
            }
            return {
              intent: 'nt-theorem',
              payload: {
                playerId,
                cardId,
                targetPlayerId: attackPayload.targetPlayerId,
                targetBoardId: attackPayload.targetBoardId,
                theorem,
              },
            };
          }
          case 'vector': {
            const params = catalogEffectParams(cardId);
            const values = params?.values;
            const dim = params?.dim;
            if (
              !Array.isArray(values) || values.length === 0
              || !values.every((value) => typeof value === 'number' && Number.isFinite(value))
              || typeof dim !== 'number' || !Number.isInteger(dim) || dim <= 0
            ) {
              return { ok: false, reason: 'vector params unavailable' };
            }
            return {
              intent: 'vector',
              payload: {
                playerId,
                cardId,
                boardId: `${playerId}_board_${player.boards.length + 1}`,
                expression: `[${values.join(', ')}]`,
                dimension: dim,
              },
            };
          }
          case 'matrix': {
            const expression = catalogEffectParams(cardId)?.expr;
            if (typeof expression !== 'string' || expression === '') {
              return { ok: false, reason: 'matrix expression unavailable' };
            }
            return {
              intent: 'matrix',
              payload: {
                playerId,
                cardId,
                boardId: `${playerId}_board_${player.boards.length + 1}`,
                expression,
              },
            };
          }
          case 'transform': {
            const kind = catalogEffectParams(cardId)?.kind;
            if (typeof kind !== 'string' || kind === '') {
              return { ok: false, reason: 'transform kind unavailable' };
            }
            return { intent: 'transform', payload: { playerId, cardId, boardId, kind } };
          }
          case 'eigenvalue':
            return {
              intent: 'eigenvalue',
              payload: {
                playerId,
                cardId,
                targetPlayerId: attackPayload.targetPlayerId,
                targetBoardId: attackPayload.targetBoardId,
              },
            };
          default:
            return undefined;
        }
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
        || choice.count < 1
        || choice.count > 2
      ) {
        return undefined;
      }
      choices.push({ deck: choice.deck, count: choice.count });
    }
    return choices;
  }
}
