import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
import type { CommandResult } from '../../commands/base.js';

function firstBoard(game: NerdiClashGame, sessionId: string): FunctionBoardSchema {
  const board = game.getPlayer(sessionId)?.boards[0];
  if (!board) throw new Error(`missing board for ${sessionId}`);
  return board;
}

function boardIdFor(game: NerdiClashGame, sessionId: string): string {
  return firstBoard(game, sessionId).boardId;
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

function dispatch(
  game: NerdiClashGame,
  sessionId: string,
  intent: string,
  payload: Record<string, unknown>,
): Promise<CommandResult> {
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

function snapshotActionsUsed(game: NerdiClashGame, sessionId: string): number {
  const players = game.getStateSnapshot().players as Record<string, { actionsUsedThisTurn: number }>;
  return players[sessionId]?.actionsUsedThisTurn ?? -1;
}

describe('two-actions-per-turn cap (§6)', () => {
  it('rejects a third play_card in one play phase', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'fcc-add-term-001');
    giveCard(game, 'p1', 'fcc-calc-derivative-001');
    giveCard(game, 'p1', 'fcc-nt-modular-001');

    const first = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-add-term-001', target: { kind: 'none' },
    });
    const second = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001', target: { kind: 'none' },
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);
    expect(snapshotActionsUsed(game, 'p1')).toBe(2);

    const third = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-nt-modular-001', target: { kind: 'none' },
    });
    expect(third).toEqual({ ok: false, reason: 'turn action limit reached' });
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);
  });

  it('counts eval_function toward the same two-action budget', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-eval-001');
    giveCard(game, 'p1', 'fcc-add-term-001');
    giveCard(game, 'p1', 'fcc-calc-derivative-001');

    const evalResult = await dispatch(game, 'p1', 'eval_function', {
      boardId: boardIdFor(game, 'p1'),
      variableValueCardId: 'vvc-1',
    });
    expect(evalResult.ok).toBe(true);
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(1);

    // The eval cleared the board expression; a second action still lands.
    const second = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-add-term-001', target: { kind: 'none' },
    });
    expect(second.ok).toBe(true);
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);

    const third = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001', target: { kind: 'none' },
    });
    expect(third).toEqual({ ok: false, reason: 'turn action limit reached' });
  });

  it('counts set_trap and force_eval as actions too', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-trap-001');
    giveCard(game, 'p1', 'act-special-force-eval-001');
    giveCard(game, 'p1', 'fcc-add-term-001');
    // Arm the opponent's trap so the force eval is countered (fizzle) instead
    // of resolving into a game-ending showdown.
    giveCard(game, 'p2', 'act-trap-001');
    requirePlayer(game, 'p2').trapCardId = 'act-trap-001';

    const trap = await dispatch(game, 'p1', 'set_trap', { cardId: 'act-trap-001' });
    expect(trap.ok).toBe(true);
    const forced = await dispatch(game, 'p1', 'force_eval', { variableValueCardId: 'vvc-3' });
    expect(forced).toMatchObject({ ok: true, fizzled: true, countered: true });
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);

    const third = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-add-term-001', target: { kind: 'none' },
    });
    expect(third).toEqual({ ok: false, reason: 'turn action limit reached' });
  });

  it('a fizzled play still consumes an action', async () => {
    const game = await gameInPlay();
    // Give p2 a second live board so killing board[0] fizzles the attack
    // without ending the game (win check: all boards dead = loss).
    const p2 = requirePlayer(game, 'p2');
    const spare = new FunctionBoardSchema();
    spare.boardId = 'p2_board_2';
    spare.ownerSessionId = 'p2';
    spare.expression = 'x';
    spare.isActive = true;
    p2.boards.push(spare);
    p2.boardCount = p2.boards.length;
    firstBoard(game, 'p2').isActive = false; // dead board → attack fizzles
    giveCard(game, 'p1', 'act-offensive-001');
    giveCard(game, 'p1', 'act-martial-theorem-001');
    giveCard(game, 'p1', 'fcc-add-term-001');

    const fizzle = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp_board', id: boardIdFor(game, 'p2') },
    });
    expect(fizzle).toMatchObject({ ok: true, fizzled: true });
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(1);
    // The fizzle does not trip the aggressive lockout — only the cap.
    expect(requirePlayer(game, 'p1').aggressiveActionUsedThisTurn).toBe(false);

    const secondFizzle = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-martial-theorem-001',
      target: { kind: 'opp_board', id: boardIdFor(game, 'p2') },
    });
    expect(secondFizzle).toMatchObject({ ok: true, fizzled: true });
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);

    const third = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-add-term-001', target: { kind: 'none' },
    });
    expect(third).toEqual({ ok: false, reason: 'turn action limit reached' });
  });

  it('rejected intents never consume an action', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'num-prime-2');
    giveCard(game, 'p1', 'fcc-add-term-001');
    giveCard(game, 'p1', 'fcc-add-term-001');
    giveCard(game, 'p1', 'fcc-calc-derivative-001');

    // Unrouted card → rejection at the routing layer.
    const unrouted = await dispatch(game, 'p1', 'play_card', {
      cardId: 'num-prime-2', target: { kind: 'none' },
    });
    expect(unrouted.ok).toBe(false);
    // Card not in hand → rejection.
    const missing = await dispatch(game, 'p1', 'play_card', {
      cardId: 'not-in-hand', target: { kind: 'none' },
    });
    expect(missing.ok).toBe(false);
    // Route-level rejection (self-targeting an opp scope).
    const selfTarget = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-add-term-001', target: { kind: 'opp', id: 'p1' },
    });
    expect(selfTarget).toEqual({ ok: false, reason: 'cannot target self' });
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(0);

    // Two good plays then the cap — proving the earlier rejects spent nothing.
    for (const cardId of ['fcc-add-term-001', 'fcc-add-term-001']) {
      const played = await dispatch(game, 'p1', 'play_card', { cardId, target: { kind: 'none' } });
      expect(played.ok).toBe(true);
    }
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);
    const third = await dispatch(game, 'p1', 'play_card', {
      cardId: 'fcc-calc-derivative-001', target: { kind: 'none' },
    });
    expect(third).toEqual({ ok: false, reason: 'turn action limit reached' });
  });

  it('does not count play_defense or end_turn against the defender', async () => {
    const game = await gameInPlay();
    const p2 = requirePlayer(game, 'p2');
    giveCard(game, 'p1', 'act-offensive-001');
    giveCard(game, 'p2', 'act-shield-001');

    await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001', target: { kind: 'opp', id: 'p2' },
    });
    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(game.state.phase).toBe(Phase.defense);

    const defense = await dispatch(game, 'p2', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: game.state.pendingTriggerId,
    });
    expect(defense.ok).toBe(true);
    // Defense is the opponent's window — never the defender's action budget.
    expect(p2.actionsUsedThisTurn).toBe(0);
  });

  it('resets the counter when the turn ends and re-allows plays next turn', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'fcc-add-term-001');
    giveCard(game, 'p1', 'fcc-add-term-001');
    giveCard(game, 'p1', 'fcc-calc-derivative-001');
    giveCard(game, 'p2', 'fcc-add-term-001');

    for (const cardId of ['fcc-add-term-001', 'fcc-add-term-001']) {
      await dispatch(game, 'p1', 'play_card', { cardId, target: { kind: 'none' } });
    }
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(2);

    expect(game.requestEndTurn('p1').ok).toBe(true);
    expect(requirePlayer(game, 'p1').actionsUsedThisTurn).toBe(0);
    expect(game.state.phase).toBe(Phase.draw);
    expect(game.state.currentTurnPlayerId).toBe('p2');

    // p2's turn is independent — they get their own two actions.
    await dispatch(game, 'p2', 'draw_cards', { deckChoices: [{ deck: 'action', count: 2 }] });
    const p2Play = await dispatch(game, 'p2', 'play_card', {
      cardId: 'fcc-add-term-001', target: { kind: 'none' },
    });
    expect(p2Play.ok).toBe(true);
    expect(requirePlayer(game, 'p2').actionsUsedThisTurn).toBe(1);
  });
});
