import { GameRoomState, PlayerSchema, FunctionBoardSchema, addToHand, catalogCardToSchema, shuffleArraySchema } from '../state/schema.js';
import { catalogEffectParams, loadCatalog } from '../data/load-catalog.js';
import { Phase, STALLING_CONSECUTIVE_LIMIT, STALLING_GLOBAL_LIMIT } from '../logic/fsm.js';
import type { BaseDomain } from '../shared/types.js';
import { PhaseController } from './phaseController.js';
import { CommandDispatcher, type CommandIntent } from '../commands/CommandDispatcher.js';
import { evaluate, forceEval as engineForceEval, type ForceEvalPlayer } from '../logic/evalEngine.js';
import { checkWin } from '../logic/winEngine.js';
import { DEFAULT_MODE, MODE_PROFILES, type GameMode, type ModeProfile } from '../logic/modes.js';
import { distinctVariablesInExpression } from '../math/expressions.js';
import { isBoardAlive, type CommandResult, type CommandState } from '../commands/base.js';

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
  /** Rules overlay resolved once from the room's mode — see logic/modes.ts. */
  public readonly profile: ModeProfile;
  private readonly commandDispatcher = new CommandDispatcher();
  private eventListener: GameEventListener | undefined;

  constructor(mode: GameMode = DEFAULT_MODE) {
    this.state = new GameRoomState();
    this.state.phase = Phase.waiting;
    this.state.config.mode = mode;
    this.profile = MODE_PROFILES[mode];
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
      // The attacker's turn ends here, same as requestEndTurn: settle its
      // bookkeeping BEFORE the window opens (stalling counters, flag resets,
      // isolation tick) so the later defense deadline can't count it twice.
      this.settleTurnEnd(this.state.currentTurnPlayerId);
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
      // Bookkeeping runs only on the play→resolution auto-pass: a
      // defense→resolution auto-pass continues a turn whose play-phase end
      // was already settled (end_turn or the intercept above) — settling
      // again would double-count the stalling counters and isolation tick.
      if (previousPhase === Phase.play) {
        this.settleTurnEnd(this.state.currentTurnPlayerId);
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
      // Pre-flight availability: DrawCommand consumes pile+graveyard as it
      // goes, so a batch that can't be fully satisfied must reject BEFORE
      // the first mutation — otherwise the earlier choice's cards stay in
      // hand while the phase remains draw, and a retry overdraws the quota.
      // Aggregate per deck first: duplicate-deck choices ({fcc:1},{fcc:1})
      // share one pile, so per-choice checks would undercount.
      const drawingPlayer = this.state.players.get(sessionId);
      const needed = new Map<string, number>();
      for (const choice of choices) {
        needed.set(choice.deck, (needed.get(choice.deck) ?? 0) + choice.count);
      }
      for (const [deck, count] of needed) {
        const pile = deck === 'fcc'
          ? drawingPlayer?.deckFCC
          : deck === 'number'
            ? drawingPlayer?.deckNumber
            : drawingPlayer?.deckAction;
        // Mirrors DrawCommand's graveyard accepts-rule: only same-deckType
        // non-Anchor cards reshuffle into a starved pile.
        const recyclable = drawingPlayer
          ? [...drawingPlayer.discardGraveyard].filter(
            (card) => card?.deckType === deck && card?.subtype !== 'Anchor',
          ).length
          : 0;
        if ((pile?.length ?? 0) + recyclable < count) {
          return { ok: false, reason: `deck ${deck} cannot supply ${count} card(s)` };
        }
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
    // Rulebook §10.1: an undefined/infinite eval that destroyed the player's
    // last live board is an immediate loss — declared before the generic
    // board-wipe check so the winReason names the true cause.
    if (result.ok && intent === 'eval_function' && result.boardDestroyed === true) {
      this.checkUndefinedIntegralLoss(sessionId);
    }
    if (result.ok) this.runCheckWin();
    return result;
  }

  requestEndTurn(sessionId: string): CommandResult {
    // Same winnerless-gameOver guard as dispatchIntent: an abandoned
    // construction ends in phase=gameOver with state.winner === ''.
    if (this.state.winner || this.state.phase === Phase.gameOver) {
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

    // All turn-end bookkeeping lives in settleTurnEnd so the manual end_turn,
    // deadline auto-pass, and defense-window intercept paths share exactly
    // one implementation (stalling counters, flag resets, isolation tick).
    this.settleTurnEnd(sessionId);

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

  /**
   * Turn-end bookkeeping, run exactly once when a player's play phase ends —
   * by their own end_turn, a quiet deadline auto-pass, or the defense-window
   * intercept. Reads evaluatedThisTurn BEFORE resetting it (eval turns reset
   * the consecutive counter; no-eval turns increment both counters and may
   * trip the §8.5 showdown), clears the per-turn flags, and advances the
   * isolation countdown. Paths that merely continue a turn whose play-phase
   * end was already settled — defense→resolution auto-pass, defender pass,
   * play_defense — must NOT call this or the counters double.
   */
  private settleTurnEnd(playerId: string): void {
    const player = this.state.players.get(playerId);
    if (player) {
      if (player.evaluatedThisTurn) {
        this.phaseController.onEvalTurn();
      } else {
        const fsmEvents = this.phaseController.onNoEvalTurn();
        if (fsmEvents.includes('force-eval')) {
          // §8.5 anti-stall: settle a possible kill first and skip the
          // showdown entirely if the game is already decided. Any recorded
          // attack is still pending — it resolves via the defense window if
          // the game continues.
          this.runCheckWin();
          if (!this.state.winner) {
            this.runStallingForceEval(playerId);
          }
        }
      }
      player.aggressiveActionUsedThisTurn = false;
      player.offensivePlayedThisTurn = false;
      player.evaluatedThisTurn = false;
      player.actionsUsedThisTurn = 0;
    }
    this.state.forceEvalRequested = false;
    this.tickIsolationTimers();
  }

  // ─── State queries ─────────────────────────────────────────────────────────

  getPlayer(sessionId: string): PlayerSchema | undefined {
    return this.state.players.get(sessionId);
  }

  getStateSnapshot(): Record<string, unknown> {
    return {
      // Mode lives on state.config (schema); snapshots surface it flat since
      // config is not otherwise snapshotted.
      mode: this.state.config.mode,
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
              compositionDepth: b.compositionDepth,
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
            // Wave-10 T6 advisory flags — computed for every entry here and
            // stripped from opponent entries in getStateSnapshotForPlayer
            // (evalLegal encodes private hand contents).
            evalLegal: this.isEvalLegalFor(player),
            drawsRemaining: this.drawsRemainingFor(player),
            deckCounts: {
              fcc: player.deckFCC.length,
              number: player.deckNumber.length,
              action: player.deckAction.length,
            },
          },
        ]),
      ),
      // Live per-player pile sizes — the seeded state.deckCounts map is only
      // written at seat time, so derive the snapshot counts from the decks.
      deckCounts: Object.fromEntries([...this.state.players.values()].flatMap((p) => [
        [`${p.sessionId}_fcc`, p.deckFCC.length],
        [`${p.sessionId}_number`, p.deckNumber.length],
        [`${p.sessionId}_action`, p.deckAction.length],
      ])),
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
        // Wave-10 T6: the advisory flags are viewer-scoped — evalLegal reveals
        // whether the holder has Anchor+Eval cards in hand, so an opponent's
        // copy must not carry it (§16 privacy). Flags derive only from the
        // viewer's own visible state.
        delete playerData.evalLegal;
        delete playerData.drawsRemaining;
      }
    }
    return base;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Wave-10 T6 client-truth flag: mirrors what dispatchIntent + EvalCommand
   * actually require for eval_function — the player's own play-phase turn, a
   * live board (EvalCommand's isBoardAlive), an Anchor (the vvc argument),
   * and an 'Eval'-subtype card (consumed automatically). Advisory only — the
   * intent is still fully validated server-side.
   */
  private isEvalLegalFor(player: PlayerSchema): boolean {
    if (this.state.phase !== Phase.play || this.state.currentTurnPlayerId !== player.sessionId) {
      return false;
    }
    const hasLiveBoard = [...player.boards].some(
      (board) => board !== undefined && board.isActive !== false
        && (board as { destroyed?: boolean }).destroyed !== true,
    );
    if (!hasLiveBoard) return false;
    const hand = [...player.hand];
    return hand.some((card) => card?.subtype === 'Anchor')
      && hand.some((card) => card?.subtype === 'Eval');
  }

  /**
   * Wave-10 T6 client-truth flag: cards still drawable on this player's draw
   * step. The draw phase ends on the first accepted batch (finalizeDraw →
   * play), so the quota is the full 2 while the step is open, 0 otherwise.
   */
  private drawsRemainingFor(player: PlayerSchema): number {
    return this.state.phase === Phase.draw && this.state.currentTurnPlayerId === player.sessionId ? 2 : 0;
  }

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
    // Modes without the isolation win path (Classic Clash) never run the
    // countdown — variable_isolation_timers stays empty in snapshots.
    if (!this.profile.win.isolation) return;
    for (const [id, p] of this.state.players.entries()) {
      // W9-T6 isolation pin (rulebook "reduce the opponent's function to a
      // single variable"): the countdown runs only while the player has at
      // least one ACTIVE board and every active board is reduced to <= 1
      // distinct variable — `3*x`, `x^2`, `x+1` now count, not just the
      // single-letter literal. An evaluated board stays active with
      // expression='' and is unparseable, so it cannot establish "reduced"
      // and pauses/clears the timer instead. checkWin kills on the MAIN
      // board landing in [isolationMinVars, isolationMaxVars] — 0..1 in
      // every shipped profile, the same <=1 semantics the countdown starts
      // on (W14 §10.3: the old exactly-1 kill band let constant-only
      // boards stall the win forever).
      const activeBoards = [...p.boards].filter(
        (board): board is NonNullable<typeof board> => board !== undefined && board.isActive,
      );
      const reduced = activeBoards.length > 0 && activeBoards.every((board) => {
        const vars = distinctVariablesInExpression(board.expression);
        return vars !== undefined && vars <= this.profile.isolationMaxVars;
      });
      if (reduced) {
        const current = this.state.variable_isolation_timers.get(id);
        if (current === undefined) {
          this.state.variable_isolation_timers.set(id, this.profile.isolationRebuildTurns);
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
    // gameOver is terminal for win adjudication too — a stalled draw leaves
    // winner unset, so without the phase check a same-tick isolation timer
    // could still award a win (and a second game_over) after the draw.
    if (this.state.winner || this.state.phase === Phase.gameOver) return;
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
    }, this.profile);
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
   * Rulebook §10.1 — "Undefined evaluation results in immediate loss of the
   * game", read with the "integral to the player's survival" qualifier: only
   * an undefined/infinite eval that destroyed the player's LAST live board
   * ends the game; while another board survives it is a board-kill like any
   * other. Called at the sites where an undefined eval result lands
   * (eval_function, runForceEval) so the winReason names the true cause
   * instead of surfacing later as a generic board-wipe. Variable Isolation
   * gates it off — an eval-mishap board is merely dead there, not fatal
   * (doc §3/OQ-12).
   */
  private checkUndefinedIntegralLoss(playerId: string): void {
    if (!this.profile.win.undefinedIntegralLoss || this.state.winner) return;
    const player = this.state.players.get(playerId);
    if (!player) return;
    if ([...player.boards].some((board) => isBoardAlive(board))) return;
    const winnerId = [...this.state.players.keys()].find((id) => id !== playerId);
    if (winnerId) this.declareWinner(winnerId, playerId, 'undefined_integral_loss');
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
    // §10.1: players whose LIVE main board just eval'd undefined — the loss
    // lands during evaluation, ahead of the domination ruling. Only a board
    // that was alive can be "integral to survival" — re-marking an
    // already-dead board destroys nothing.
    const undefinedEvalPlayerIds: string[] = [];
    for (const player of this.state.players.values()) {
      const board = [...player.boards][0];
      const evaluated = evaluate({ expression: board?.expression ?? '' }, 0, vvcValue);
      let lastForceValue = 0;
      if (evaluated.undefined) {
        // A board already holding '' is a legitimately-evaluated/rebuildable
        // board (the post-eval state) — the showdown must not re-destroy it
        // as a failed evaluation and feed a boardWipe on an empty board.
        if (board && board.expression.trim() !== '') {
          if (isBoardAlive(board)) undefinedEvalPlayerIds.push(player.sessionId);
          board.isActive = false;
        }
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
    // §10.1 first: an undefined eval that took the player's last board is an
    // immediate loss — declared ahead of the domination ruling so the reason
    // reflects what actually ended the game.
    for (const playerId of undefinedEvalPlayerIds) {
      this.checkUndefinedIntegralLoss(playerId);
    }
    // Domination → declareWinner is a win path the profile may disable
    // (Variable Isolation). The HP redistribution / failed-nomination board
    // destruction above still runs — only the winner declaration is gated.
    if (result.winner && this.profile.win.forceDomination) {
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
    const counter = this.state.consecutive_no_eval_turns >= STALLING_CONSECUTIVE_LIMIT ? 'consecutive' : 'global';
    // Once the never-resetting global counter sits at its cap a non-terminal
    // answer would fire every turn forever — the profile's endgame resolution
    // takes over there (wave-14 T2 / OQ-8: VI's every-turn soft_wipe left no
    // win path). 'soft_wipe' means "no special resolution — keep the per-trip
    // stallingEval", which preserves v1 behavior for both v1 modes.
    const resolution = this.state.global_no_eval_turns >= STALLING_GLOBAL_LIMIT
      ? this.profile.stallingResolution
      : 'soft_wipe';
    this.emitGameEvent('force_eval', nominatorId, resolution === 'soft_wipe'
      ? { trigger: 'stalling', counter }
      : { trigger: 'stalling', counter, resolution });
    if (resolution === 'draw') {
      this.declareStalledDraw();
      return;
    }
    const softWipe = resolution === 'soft_wipe' && this.profile.stallingEval === 'soft_wipe';
    if (!softWipe) {
      this.runForceEval(nominatorId, 1);
    } else {
      // VI §3.3/OQ-11: the standard showdown would destroy the staller's main
      // board — with boardWipe off that leaves them un-isolatable forever,
      // so the anti-stall trigger instead evaluates every active board at
      // vvc=1 and wipes each to '' (post-eval state, rebuildable through the
      // existing play-phase build_function path). No HP moves, nothing is
      // destroyed — stalling resets the siege for everyone.
      for (const player of this.state.players.values()) {
        for (const board of player.boards) {
          if (!board || !board.isActive) continue;
          evaluate({ expression: board.expression }, 0, 1);
          board.expression = '';
        }
      }
    }
    this.phaseController.onEvalTurn();
  }

  /**
   * §8.5 endgame for a 'draw' stallingResolution: the never-resetting global
   * cap means the players could not produce an eval in twenty turns, so the
   * match is declared a draw — no winner, winReason 'stalled'. Mirrors
   * declareWinner's once-only game_over contract minus the winner to name;
   * the client renders an empty winner as "Draw".
   */
  private declareStalledDraw(): void {
    if (this.state.winner || this.state.phase === Phase.gameOver) return;
    this.state.winReason = 'stalled';
    this.phaseController.requestTransition(Phase.gameOver);
    this.emitGameEvent('game_over', '', { winner: null, loser: '', winReason: 'stalled' });
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
      // Commands read the room's resolved rules overlay from here — mode =
      // data, never a mode string re-resolved inside a command.
      profile: this.profile,
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
          case 'derivative': {
            // §10.2: forward the attacker's `variable` pick — the wire field
            // existed but was never routed, so v1 always took the first var.
            const variable = typeof payload.variable === 'string' && payload.variable !== ''
              ? payload.variable
              : undefined;
            // Doc §3.2 mode overlay: opp_board scope only where the profile
            // grants it — target resolution mirrors ntTheorem/eigenvalue.
            if (target.kind === 'opp_board' && this.profile.offensiveTargeting.derivative === 'opp_board') {
              return {
                intent: 'derivative',
                payload: {
                  playerId,
                  cardId,
                  targetPlayerId: attackPayload.targetPlayerId,
                  targetBoardId: attackPayload.targetBoardId,
                  variable,
                },
              };
            }
            return { intent: 'derivative', payload: { playerId, cardId, boardId, variable } };
          }
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
          case 'limit': {
            const variable = typeof payload.variable === 'string' && payload.variable !== ''
              ? payload.variable
              : undefined;
            if (target.kind === 'opp_board' && this.profile.offensiveTargeting.limit === 'opp_board') {
              return {
                intent: 'limit',
                payload: {
                  playerId,
                  cardId,
                  targetPlayerId: attackPayload.targetPlayerId,
                  targetBoardId: attackPayload.targetBoardId,
                  variable,
                },
              };
            }
            return { intent: 'limit', payload: { playerId, cardId, boardId, variable } };
          }
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
