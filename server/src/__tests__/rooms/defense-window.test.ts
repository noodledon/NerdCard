import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, type FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

function boardIdFor(game: NerdiClashGame, sessionId: string): string {
  const board = firstBoard(game, sessionId);
  return board.boardId;
}

function firstBoard(game: NerdiClashGame, sessionId: string): FunctionBoardSchema {
  const board = game.getPlayer(sessionId)?.boards[0];
  if (!board) throw new Error(`missing board for ${sessionId}`);
  return board;
}

function giveCard(game: NerdiClashGame, playerId: string, cardId: string): void {
  const player = game.getPlayer(playerId);
  if (!player) throw new Error(`missing player ${playerId}`);
  player.hand.push(catalogCardToSchema(getCardById(cardId)));
  player.handCount = player.hand.length;
}

function requirePlayer(game: NerdiClashGame, sessionId: string): PlayerSchema {
  const player = game.getPlayer(sessionId);
  if (!player) throw new Error(`missing player ${sessionId}`);
  return player;
}

function dispatch(game: NerdiClashGame, sessionId: string, intent: string, payload: Record<string, unknown>): Promise<CommandResult> {
  return Promise.resolve(game.dispatchIntent(sessionId, intent, payload));
}

/** Drive a fresh game through construction + draw into the play phase (p1's turn). */
async function gameInPlay(p1Expression = 'x^2', p2Expression = 'x^3+x'): Promise<NerdiClashGame> {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.startGame();
  await dispatch(game, 'p1', 'build_function', { boardId: boardIdFor(game, 'p1'), expression: p1Expression });
  await dispatch(game, 'p2', 'build_function', { boardId: boardIdFor(game, 'p2'), expression: p2Expression });
  await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
  if (game.state.phase !== Phase.play) throw new Error(`expected play phase, got ${game.state.phase}`);
  return game;
}

/** Seed the fields AttackHpCommand records when an offensive card resolves. */
function seedPendingAttack(game: NerdiClashGame, damage10 = 50, sourceId = 'p1', targetId = 'p2'): void {
  game.state.pendingAttackDamage10 = damage10;
  game.state.pendingAttackSourceId = sourceId;
  game.state.pendingAttackTargetId = targetId;
  game.state.pendingTriggerId = 'trigger-1';
}

describe('end_turn validation', () => {
  it('rejects end_turn outside the play phase', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame(); // construction
    expect(game.requestEndTurn('p1')).toEqual({ ok: false, reason: 'end turn only in play phase' });
  });

  it('rejects end_turn from the non-active player', async () => {
    const game = await gameInPlay();
    expect(game.requestEndTurn('p2')).toEqual({ ok: false, reason: 'not the active player' });
  });

  it('ends a quiet turn through resolution into the next draw phase', async () => {
    const game = await gameInPlay();
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
  });
});

describe('draw_cards validation', () => {
  it('rejects draw_cards outside the draw phase', async () => {
    const game = await gameInPlay();
    const result = await dispatch(game, 'p1', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    });
    expect(result).toEqual({ ok: false, reason: 'not your draw phase' });
  });

  it('rejects draw_cards from the non-active player', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    await dispatch(game, 'p1', 'build_function', { boardId: boardIdFor(game, 'p1'), expression: 'x^2' });
    await dispatch(game, 'p2', 'build_function', { boardId: boardIdFor(game, 'p2'), expression: 'x^2' });
    expect(game.state.phase).toBe(Phase.draw);
    const result = await dispatch(game, 'p2', 'draw_cards', {
      deckChoices: [{ deck: 'fcc', count: 2 }],
    });
    expect(result).toEqual({ ok: false, reason: 'not your draw phase' });
  });
});

describe('defense window', () => {
  it('opens the defense phase on end_turn while an attack is pending', async () => {
    const game = await gameInPlay();
    seedPendingAttack(game);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.phase).toBe(Phase.defense);
    expect(game.state.pendingAttackTargetId).toBe('p2');
    expect(game.state.currentTurnPlayerId).toBe('p1');
  });

  it('applies the pending attack when the defender passes via end_turn', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 100;
    seedPendingAttack(game);
    game.requestEndTurn('p1');
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(p2.hp10).toBe(50);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
    expect(game.state.pendingAttackTargetId).toBe('');
    expect(game.state.pendingTriggerId).toBe('');
  });

  it('rejects a defender pass from the attacker', async () => {
    const game = await gameInPlay();
    seedPendingAttack(game);
    game.requestEndTurn('p1');
    expect(game.state.phase).toBe(Phase.defense);
    expect(game.requestEndTurn('p1')).toEqual({ ok: false, reason: 'end turn only in play phase' });
    expect(game.state.phase).toBe(Phase.defense);
  });

  it('a successful play_defense negates the pending attack and resolves the turn', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 100;
    giveCard(game, 'p1', 'act-offensive-001');
    giveCard(game, 'p2', 'act-shield-001');

    const attack = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(attack.ok).toBe(true);
    expect(game.state.pendingAttackTargetId).toBe('p2');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.phase).toBe(Phase.defense);

    const result = await dispatch(game, 'p2', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: game.state.pendingTriggerId,
    });
    expect(result.ok).toBe(true);
    expect(p2.hp10).toBe(100);
    expect(game.state.pendingAttackDamage10).toBe(0);
    expect(game.state.pendingAttackTargetId).toBe('');
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
  });

  it('applies the pending attack when the defense deadline elapses', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 100;
    seedPendingAttack(game);
    game.requestEndTurn('p1');
    expect(game.state.phase).toBe(Phase.defense);

    game.tick(Date.now() + 20_000);
    expect(p2.hp10).toBe(50);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
    expect(game.state.pendingAttackTargetId).toBe('');
  });

  it('opens the defense window when the play deadline elapses mid-attack', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 100;
    giveCard(game, 'p1', 'act-offensive-001');

    const attack = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(attack.ok).toBe(true);
    expect(game.state.pendingAttackTargetId).toBe('p2');

    // The play deadline elapses with the attack still pending: instead of the
    // FSM's play→resolution auto-pass, the tick must open the defense window.
    game.tick(game.state.turnDeadline + 1);
    expect(game.state.phase).toBe(Phase.defense);
    expect(game.state.pendingAttackTargetId).toBe('p2');
    // Catalog damage:5 reads as display HP → 50 hp10 (see commands/base.ts
    // catalogParams; wave-9 T3 killed the 0.5-HP units bug).
    expect(game.state.pendingAttackDamage10).toBe(50);
    expect(game.state.currentTurnPlayerId).toBe('p1');
    expect(p2.hp10).toBe(100);

    // The defense deadline then lands the attack on a later tick.
    game.tick(game.state.turnDeadline + 1);
    expect(p2.hp10).toBe(50);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
    expect(game.state.pendingAttackTargetId).toBe('');
  });

  it('resolves a quiet play-deadline auto-pass straight to draw', async () => {
    const game = await gameInPlay();
    game.tick(game.state.turnDeadline + 1);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');
  });
});

describe('hp_zero win', () => {
  it('declares the attacker the winner when defense pass drops the defender to 0', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 5;
    p2.everGainedHP = true;
    giveCard(game, 'p1', 'act-offensive-001');

    const attack = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(attack.ok).toBe(true);
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.phase).toBe(Phase.defense);
    expect(game.requestEndTurn('p2').ok).toBe(true);
    expect(p2.hp10).toBe(0);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('hp_zero');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('rejects further intents once the game is over', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 5;
    p2.everGainedHP = true;
    giveCard(game, 'p1', 'act-offensive-001');
    await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    game.requestEndTurn('p1');
    game.requestEndTurn('p2');
    expect(game.state.winner).toBe('p1');
    expect(game.requestEndTurn('p1')).toEqual({ ok: false, reason: 'game is over' });
    expect(await dispatch(game, 'p1', 'play_card', {
      cardId: 'whatever',
      target: { kind: 'none' },
    })).toEqual({ ok: false, reason: 'game is over' });
  });
});

describe("Euler's Ward (artifact theorem)", () => {
  it('sets artifactTheoremActive via play_card and exposes it in snapshots', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-artifact-theorem-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-artifact-theorem-001',
      target: { kind: 'self' },
    });

    expect(result.ok).toBe(true);
    expect(requirePlayer(game, 'p1').artifactTheoremActive).toBe(true);
    const players = game.getStateSnapshot().players as Record<string, { artifactTheoremActive: boolean }>;
    expect(players.p1?.artifactTheoremActive).toBe(true);
    expect(players.p2?.artifactTheoremActive).toBe(false);
  });

  it('halves two consecutive attacks and persists across turns', async () => {
    const game = await gameInPlay();
    const p1 = requirePlayer(game, 'p1');
    p1.hp10 = 100;
    giveCard(game, 'p1', 'act-artifact-theorem-001');
    giveCard(game, 'p2', 'act-offensive-001');
    giveCard(game, 'p2', 'act-martial-theorem-001');
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    game.setEventListener((event) => events.push({ event: event.event, details: event.details }));

    // p1 wards itself, then ends the turn quietly.
    await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-artifact-theorem-001',
      target: { kind: 'self' },
    });
    expect(game.requestEndTurn('p1').ok).toBe(true);

    // p2's turn: Power Spike (catalog 50) → warded p1 takes floor(50/2) = 25.
    await dispatch(game, 'p2', 'draw_cards', { deckChoices: [{ deck: 'action', count: 2 }] });
    const attack1 = await dispatch(game, 'p2', 'play_card', {
      cardId: 'act-offensive-001', target: { kind: 'opp', id: 'p1' },
    });
    expect(attack1.ok).toBe(true);
    game.requestEndTurn('p2');
    expect(game.state.phase).toBe(Phase.defense);
    expect(game.requestEndTurn('p1').ok).toBe(true); // p1 passes
    expect(p1.hp10).toBe(75);

    // Next p2 turn: Pythagoras Strike (catalog 80) → ward still active, 40 lands.
    await dispatch(game, 'p1', 'draw_cards', { deckChoices: [{ deck: 'fcc', count: 2 }] });
    expect(game.requestEndTurn('p1').ok).toBe(true);
    await dispatch(game, 'p2', 'draw_cards', { deckChoices: [{ deck: 'action', count: 2 }] });
    const attack2 = await dispatch(game, 'p2', 'play_card', {
      cardId: 'act-martial-theorem-001', target: { kind: 'opp', id: 'p1' },
    });
    expect(attack2.ok).toBe(true);
    game.requestEndTurn('p2');
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(p1.hp10).toBe(35);
    expect(requirePlayer(game, 'p1').artifactTheoremActive).toBe(true);

    const resolved = events.filter((entry) => entry.event === 'attack_resolved');
    expect(resolved.map((entry) => entry.details)).toEqual([
      { damage10: 25, targetId: 'p1', artifactHalved: true },
      { damage10: 40, targetId: 'p1', artifactHalved: true },
    ]);
  });

  it('applies shield absorb first, then halves the residual', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 100;
    p2.artifactTheoremActive = true;
    giveCard(game, 'p2', 'act-shield-001');
    // An oversized pending hit: absorb 100 leaves 50, the ward halves to 25.
    game.state.phase = Phase.defense;
    game.state.pendingAttackDamage10 = 150;
    game.state.pendingAttackSourceId = 'p1';
    game.state.pendingAttackTargetId = 'p2';
    game.state.pendingTriggerId = 'trigger-ward-order';
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    game.setEventListener((event) => events.push({ event: event.event, details: event.details }));

    const result = await dispatch(game, 'p2', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: 'trigger-ward-order',
    });

    expect(result.ok).toBe(true);
    expect(p2.hp10).toBe(75);
    expect(events).toContainEqual({
      event: 'attack_resolved',
      details: { damage10: 25, targetId: 'p2', artifactHalved: true },
    });
  });
});

describe('force_eval orchestration', () => {
  it('declares domination win through dispatchIntent', async () => {
    const game = await gameInPlay('x^3', 'x');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 100;
    p2.hp10 = 100;
    giveCard(game, 'p1', 'act-special-force-eval-001');

    const result = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(result.ok).toBe(true);
    expect(game.state.winner).toBe('p1');
    expect(game.state.winReason).toBe('force_eval_domination');
    expect(game.state.phase).toBe(Phase.gameOver);
  });

  it('destroys the nominator board and costs half HP on a failed force_eval', async () => {
    const game = await gameInPlay('x', 'x');
    const p1 = requirePlayer(game, 'p1');
    const p2 = requirePlayer(game, 'p2');
    p1.hp10 = 100;
    p2.hp10 = 100;
    giveCard(game, 'p1', 'act-special-force-eval-001');

    const result = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-4' });
    expect(result.ok).toBe(true);
    expect(firstBoard(game, 'p1').isActive).toBe(false);
    expect(p1.hp10).toBe(50);
    expect(p2.hp10).toBe(100);
    // A destroyed last board is itself a loss condition.
    expect(game.state.winner).toBe('p2');
    expect(game.state.winReason).toBe('singular_board');
    expect(game.state.phase).toBe(Phase.gameOver);
  });
});

describe('play_card intent diagnostics', () => {
  it('explains the Evaluate card is spent by eval_function', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-eval-001');
    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-eval-001',
      target: { kind: 'none' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'the Evaluate card is spent automatically by the eval_function intent',
    });
  });

  it('explains shield cards are reactive', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-shield-001');
    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-shield-001',
      target: { kind: 'none' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'shield cards are reactive — use play_defense during the defense phase',
    });
  });

  it('explains number cards are bound factors, not playable cards', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'num-prime-2');
    giveCard(game, 'p1', 'num-irrational-pi');
    const boundFactorReason =
      'number cards only take effect as bound factors — attach via numberFactorCardIds on an offensive play';
    for (const cardId of ['num-prime-2', 'num-irrational-pi']) {
      const result = await dispatch(game, 'p1', 'play_card', {
        cardId,
        target: { kind: 'none' },
      });
      expect(result).toEqual({ ok: false, reason: boundFactorReason });
    }
  });

  it('explains Anchors are spent by eval intents, not played', async () => {
    const game = await gameInPlay();
    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'vvc-1',
      target: { kind: 'none' },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'Anchors are spent by the eval_function/force_eval intent, not played',
    });
  });
});

describe('state snapshot additions', () => {
  it('exposes winReason and pendingAttack fields plus per-player deckCounts', async () => {
    const game = await gameInPlay();
    seedPendingAttack(game);
    const snapshot = game.getStateSnapshot() as Record<string, unknown>;
    expect(snapshot.winReason).toBe('');
    expect(snapshot.pendingAttackDamage10).toBe(50);
    expect(snapshot.pendingAttackSourceId).toBe('p1');
    expect(snapshot.pendingAttackTargetId).toBe('p2');
    const players = snapshot.players as Record<string, { deckCounts: { fcc: number; number: number; action: number } }>;
    // p1 drew 2 fcc cards during the gameInPlay drive; p2's piles are untouched.
    expect(players.p1?.deckCounts.fcc).toBe(8);
    expect(players.p2?.deckCounts).toEqual({ fcc: 10, number: 6, action: 9 });
  });

  it('hides the trap card id from opponents, exposing only trapSet', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-trap-001');
    const armed = await dispatch(game, 'p1', 'set_trap', { cardId: 'act-trap-001' });
    expect(armed.ok).toBe(true);

    const forP1 = game.getStateSnapshotForPlayer('p1');
    const ownView = forP1.players as Record<string, Record<string, unknown>>;
    // The owner still sees which card is armed.
    expect(ownView.p1?.trapCardId).toBe('act-trap-001');
    expect(ownView.p1?.trapSet).toBeUndefined();
    // The opponent's copy of p1 carries only the boolean (docs §16).
    expect(ownView.p2?.trapSet).toBe(false);

    const forP2 = game.getStateSnapshotForPlayer('p2');
    const oppView = forP2.players as Record<string, Record<string, unknown>>;
    expect(oppView.p1?.trapCardId).toBeUndefined();
    expect(oppView.p1?.trapSet).toBe(true);
    expect(oppView.p2?.trapCardId).toBe('');
    expect(oppView.p2?.trapSet).toBeUndefined();
  });

  it('joins catalog display names onto hand entries', async () => {
    const game = await gameInPlay();
    const snapshot = game.getStateSnapshot() as Record<string, unknown>;
    const players = snapshot.players as Record<string, { hand: Array<{ id: string; name: string }> }>;
    const p1Hand = players.p1?.hand ?? [];
    // Every player starts with all five Anchors seeded into hand.
    const anchor = p1Hand.find((card) => card.id === 'vvc-1');
    expect(anchor?.name).toBe('Variable Anchor: 2');
    for (const card of p1Hand) {
      expect(typeof card.name).toBe('string');
      expect(card.name.length).toBeGreaterThan(0);
    }
  });
});
