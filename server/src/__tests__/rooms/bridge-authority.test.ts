import { describe, expect, it } from 'vitest';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, type FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';
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

function handIds(game: NerdiClashGame, sessionId: string): string[] {
  return [...requirePlayer(game, sessionId).hand]
    .filter((card): card is NonNullable<typeof card> => card !== undefined)
    .map((card) => card.id);
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

/** Play phase, p1's turn, with a real attack recorded and the defense window open. */
async function gameInDefense(): Promise<NerdiClashGame> {
  const game = await gameInPlay();
  giveCard(game, 'p1', 'act-offensive-001');
  const attack = await dispatch(game, 'p1', 'play_card', {
    cardId: 'act-offensive-001',
    target: { kind: 'opp', id: 'p2' },
  });
  if (!attack.ok) throw new Error(`setup attack failed: ${attack.reason}`);
  if (!game.requestEndTurn('p1').ok) throw new Error('setup end_turn failed');
  if (game.state.phase !== Phase.defense) throw new Error(`expected defense phase, got ${game.state.phase}`);
  return game;
}

// The JSON bridge calls dispatchIntent directly, so these checks are the shared
// backstop the Colyseus handlers perform early (see handlers.ts).
describe('dispatchIntent turn-owner guard', () => {
  it('rejects an off-turn play_card without mutating state', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p2', 'act-offensive-001');
    const p2 = requirePlayer(game, 'p2');
    const handBefore = handIds(game, 'p2').length;

    const result = await dispatch(game, 'p2', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p1' },
    });

    expect(result).toEqual({ ok: false, reason: 'not the active player' });
    expect(handIds(game, 'p2').length).toBe(handBefore);
    expect(p2.hp10).toBe(0);
    expect(game.state.pendingAttackTargetId).toBe('');
    expect(game.state.pendingAttackDamage10).toBe(0);
    expect(game.state.phase).toBe(Phase.play);
  });

  it('rejects off-turn set_trap, eval_function and force_eval', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p2', 'act-trap-001');
    giveCard(game, 'p2', 'act-special-force-eval-001');

    for (const [intent, payload] of [
      ['set_trap', { cardId: 'act-trap-001' }],
      ['eval_function', { boardId: boardIdFor(game, 'p2'), variableValueCardId: 'vvc-1' }],
      ['force_eval', { variableValueCardId: 'vvc-1' }],
    ] as const) {
      const result = await dispatch(game, 'p2', intent, payload);
      expect(result).toEqual({ ok: false, reason: 'not the active player' });
    }
    expect(requirePlayer(game, 'p2').trapCardId).toBe('');
  });

  it('rejects play_card outside the play phase', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    expect(game.state.phase).toBe(Phase.construction);
    giveCard(game, 'p1', 'act-offensive-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(result).toEqual({ ok: false, reason: 'not the active player' });
  });
});

describe('dispatchIntent defender guard', () => {
  it('rejects play_defense while no defense window is open', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p2', 'act-shield-001');

    const result = await dispatch(game, 'p2', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: 'anything',
    });
    expect(result).toEqual({ ok: false, reason: 'not the defending player' });
    expect(handIds(game, 'p2')).toContain('act-shield-001');
  });

  it('rejects play_defense from the attacker during the defense window', async () => {
    const game = await gameInDefense();
    giveCard(game, 'p1', 'act-shield-001');

    const result = await dispatch(game, 'p1', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: game.state.pendingTriggerId,
    });
    expect(result).toEqual({ ok: false, reason: 'not the defending player' });
    expect(game.state.defenseResponseUsed).toBe(false);
    expect(game.state.phase).toBe(Phase.defense);
  });

  it('rejects play_defense naming an unknown trigger', async () => {
    const game = await gameInDefense();
    giveCard(game, 'p2', 'act-shield-001');

    const result = await dispatch(game, 'p2', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: 'bogus-trigger',
    });
    expect(result).toEqual({ ok: false, reason: 'unknown trigger' });
    // A wrong-trigger rejection must not spend the card or the response slot.
    expect(handIds(game, 'p2')).toContain('act-shield-001');
    expect(game.state.defenseResponseUsed).toBe(false);
    expect(game.state.phase).toBe(Phase.defense);
  });
});

describe('dispatchIntent self-target guard', () => {
  it('rejects play_card targeting { kind: opp, id: <self> }', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-offensive-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p1' },
    });

    expect(result).toEqual({ ok: false, reason: 'cannot target self' });
    expect(handIds(game, 'p1')).toContain('act-offensive-001');
    expect(game.state.pendingAttackTargetId).toBe('');
    expect(game.state.pendingAttackDamage10).toBe(0);
  });

  it('rejects an opp_board target that names the caster’s own board', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-offensive-001');
    const ownBoardId = boardIdFor(game, 'p1');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp_board', id: ownBoardId },
    });

    expect(result).toEqual({ ok: false, reason: 'cannot target self' });
    expect(handIds(game, 'p1')).toContain('act-offensive-001');
    expect(game.state.pendingAttackTargetId).toBe('');
  });
});

describe('dispatchIntent still routes legal intents', () => {
  it('lets the active player play an offensive card at the opponent', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-offensive-001');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp', id: 'p2' },
    });
    expect(result.ok).toBe(true);
    expect(game.state.pendingAttackTargetId).toBe('p2');
  });

  it('lets the active player target an opponent board by id', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-offensive-001');
    const oppBoardId = boardIdFor(game, 'p2');

    const result = await dispatch(game, 'p1', 'play_card', {
      cardId: 'act-offensive-001',
      target: { kind: 'opp_board', id: oppBoardId },
    });
    expect(result.ok).toBe(true);
    expect(game.state.pendingAttackTargetId).toBe('p2');
  });

  it('lets the defender answer with the live trigger id', async () => {
    const game = await gameInDefense();
    const p2 = requirePlayer(game, 'p2');
    p2.hp10 = 100;
    giveCard(game, 'p2', 'act-shield-001');

    const result = await dispatch(game, 'p2', 'play_defense', {
      cardId: 'act-shield-001',
      targetTriggerId: game.state.pendingTriggerId,
    });
    expect(result.ok).toBe(true);
    expect(p2.hp10).toBe(100);
    expect(game.state.phase).toBe(Phase.draw);
  });

  it('lets the active player eval_function and set_trap', async () => {
    const game = await gameInPlay();
    giveCard(game, 'p1', 'act-eval-001');

    const evalResult = await dispatch(game, 'p1', 'eval_function', {
      boardId: boardIdFor(game, 'p1'),
      variableValueCardId: 'vvc-1',
    });
    expect(evalResult.ok).toBe(true);

    // Fresh game for the trap — eval consumed this turn's action budget.
    const trapGame = await gameInPlay();
    giveCard(trapGame, 'p1', 'act-trap-001');
    const trapResult = await dispatch(trapGame, 'p1', 'set_trap', { cardId: 'act-trap-001' });
    expect(trapResult.ok).toBe(true);
    expect(requirePlayer(trapGame, 'p1').trapCardId).toBe('act-trap-001');
  });
});
