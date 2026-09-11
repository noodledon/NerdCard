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

  it('reports unimplemented card effects', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'num-prime-2');
    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'num-prime-2',
      target: { kind: 'none' },
    });
    expect(result).toEqual({ ok: false, reason: 'card effect not implemented in v1' });
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
});
