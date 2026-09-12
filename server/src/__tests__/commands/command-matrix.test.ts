import { describe, expect, it } from 'vitest';
import { AddBoardCommand } from '../../commands/AddBoardCommand.js';
import { AddTermCommand } from '../../commands/AddTermCommand.js';
import { AttackHpCommand } from '../../commands/AttackHpCommand.js';
import { BuildFunctionCommand } from '../../commands/BuildFunctionCommand.js';
import { CompositionCommand } from '../../commands/CompositionCommand.js';
import { DerivativeCommand } from '../../commands/DerivativeCommand.js';
import { DrawCommand } from '../../commands/DrawCommand.js';
import { EigenvalueCommand } from '../../commands/EigenvalueCommand.js';
import { EvalCommand } from '../../commands/EvalCommand.js';
import { ForceEvalCommand } from '../../commands/ForceEvalCommand.js';
import { IntegralCommand } from '../../commands/IntegralCommand.js';
import { LimitCommand } from '../../commands/LimitCommand.js';
import { MatrixCommand } from '../../commands/MatrixCommand.js';
import { ModularCommand } from '../../commands/ModularCommand.js';
import { NtTheoremCommand } from '../../commands/NtTheoremCommand.js';
import { PlayDefenseCommand } from '../../commands/PlayDefenseCommand.js';
import { TheoremArtifactCommand } from '../../commands/TheoremArtifactCommand.js';
import { TheoremMartialCommand } from '../../commands/TheoremMartialCommand.js';
import { TransformCommand } from '../../commands/TransformCommand.js';
import { TrapCommand } from '../../commands/TrapCommand.js';
import { VectorCommand } from '../../commands/VectorCommand.js';
import type { CommandState, GameCommand } from '../../commands/base.js';
import { getCardById } from '../../data/load-catalog.js';
import { Phase } from '../../logic/fsm.js';
import { NerdiClashGame } from '../../rooms/NerdiClashGame.js';
import { catalogCardToSchema, FunctionBoardSchema, type PlayerSchema } from '../../state/schema.js';

interface TestCard { id: string; cardType?: string; subtype?: string; deckType?: string; value?: number; }
interface TestBoard {
  boardId: string; expression: string; domain?: string;
  isActive?: boolean; destroyed?: boolean; compositionDepth?: number; dimension?: number;
}

function player(id: string, hand: TestCard[] = [], boards?: TestBoard[]) {
  return {
    sessionId: id,
    hp10: 100,
    hand,
    boards: boards ?? [{ boardId: `${id}-board`, expression: 'x^2', domain: 'poly', isActive: true, destroyed: false }],
    discardGraveyard: [] as TestCard[],
    deckFCC: [] as TestCard[],
    trapCardId: '',
    aggressiveActionUsedThisTurn: false,
    evaluatedThisTurn: false,
    boundFactor: null as { numberCardId: string; spellId: string } | null,
  };
}

type TestPlayer = ReturnType<typeof player>;

function state(players: TestPlayer[], phase = 'play'): CommandState {
  const byId = Object.fromEntries(players.map((entry) => [entry.sessionId, entry]));
  return {
    phase,
    turnIndex: 2,
    players: {
      ...byId,
      get(id: string) { return byId[id]; },
      *values() { yield* players; },
    },
  };
}

async function run(
  command: GameCommand<unknown>,
  gameState: CommandState,
  payload: unknown,
) {
  command.state = gameState;
  return Promise.resolve(command.execute(payload));
}

const CARD = { id: 'c1' };

/**
 * Every card-bearing command must answer 'card <id> is not in player's hand'
 * when the named card is absent — and must not mutate state doing it.
 */
describe('command matrix — card-not-in-hand', () => {
  it.each([
    ['add-term', () => new AddTermCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1-board', term: 't' }],
    ['derivative', () => new DerivativeCommand(), { playerId: 'p1', cardId: 'missing' }],
    ['attack-hp', () => new AttackHpCommand(), { playerId: 'p1', cardId: 'missing', targetPlayerId: 'p2' }],
    ['theorem-martial', () => new TheoremMartialCommand(), { playerId: 'p1', cardId: 'missing', targetPlayerId: 'p2' }],
    ['theorem-artifact', () => new TheoremArtifactCommand(), { playerId: 'p1', cardId: 'missing' }],
    ['trap', () => new TrapCommand(), { playerId: 'p1', trapCardId: 'missing' }],
    ['add-board', () => new AddBoardCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1_board_2', expression: '' }],
    ['composition', () => new CompositionCommand(), { playerId: 'p1', cardId: 'missing', outerBoardId: 'p1-board', innerBoardId: 'b2' }],
    ['force-eval', () => new ForceEvalCommand(), { playerId: 'p1', cardId: 'missing', vvcCardId: 'vvc-1' }],
    ['integral', () => new IntegralCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1-board' }],
    ['limit', () => new LimitCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1-board' }],
    ['modular', () => new ModularCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1-board', modulus: 7 }],
    ['nt-theorem', () => new NtTheoremCommand(), { playerId: 'p1', cardId: 'missing', targetBoardId: 'p2-board', theorem: 'fermat_little' }],
    ['vector', () => new VectorCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1_board_2', expression: '[1, 0]', dimension: 2 }],
    ['matrix', () => new MatrixCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1_board_2', expression: 'matrix([1,0],[0,1])' }],
    ['transform', () => new TransformCommand(), { playerId: 'p1', cardId: 'missing', boardId: 'p1-board', kind: 'lup' }],
    ['eigenvalue', () => new EigenvalueCommand(), { playerId: 'p1', cardId: 'missing', targetBoardId: 'p2-board' }],
  ] as Array<[string, () => GameCommand<unknown>, Record<string, unknown>]>)(
    '%s rejects a card the player does not hold',
    async (_name, make, payload) => {
      const gameState = state([player('p1', [CARD]), player('p2')]);
      const result = await run(make(), gameState, payload);
      expect(result).toEqual({ ok: false, reason: "card missing is not in player's hand" });
    },
  );

  it('eval reports its VVC card as missing', async () => {
    const gameState = state([player('p1', [{ id: 'ev', subtype: 'Eval' }]), player('p2')]);
    const command = new EvalCommand() as GameCommand<unknown>;
    const result = await run(command, gameState, { playerId: 'p1', boardIndex: 0, vvcCardId: 'missing' });
    expect(result).toEqual({ ok: false, reason: "card missing is not in player's hand" });
  });

  it('play-defense reports a missing defense card after the trigger checks pass', async () => {
    const gameState = state([player('p1'), player('p2')], 'defense');
    gameState.pendingTriggerId = 'trig-1';
    gameState.pendingAttackDamage10 = 50;
    const command = new PlayDefenseCommand() as GameCommand<unknown>;
    const result = await run(command, gameState, { playerId: 'p1', cardId: 'missing', targetTriggerId: 'trig-1' });
    expect(result).toEqual({ ok: false, reason: "card missing is not in player's hand" });
  });
});

/**
 * Phase guards are per-command contract — the dispatch layer rejects earlier,
 * but a command invoked on the wrong phase must still fail closed and keep
 * the card (the reject precedes moveCardToGraveyard in every command).
 */
describe('command matrix — wrong phase', () => {
  it.each([
    ['add-term', () => new AddTermCommand(), 'add term only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1-board', term: 't' }, { id: 'c1', cardType: 'addTerm' }],
    ['derivative', () => new DerivativeCommand(), 'derivative only in play', { playerId: 'p1', cardId: 'c1' }, { id: 'c1', cardType: 'derivative' }],
    ['attack-hp', () => new AttackHpCommand(), 'attack only in play', { playerId: 'p1', cardId: 'c1', targetPlayerId: 'p2' }, { id: 'c1', cardType: 'offensive' }],
    ['theorem-martial', () => new TheoremMartialCommand(), 'attack only in play', { playerId: 'p1', cardId: 'c1', targetPlayerId: 'p2' }, { id: 'c1', cardType: 'martialTheorem' }],
    ['theorem-artifact', () => new TheoremArtifactCommand(), 'artifact theorem only in play', { playerId: 'p1', cardId: 'c1' }, { id: 'c1', cardType: 'artifactTheorem' }],
    ['trap', () => new TrapCommand(), 'trap only in play', { playerId: 'p1', trapCardId: 'c1' }, { id: 'c1', cardType: 'trap' }],
    ['add-board', () => new AddBoardCommand(), 'add board only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1_board_2', expression: '' }, { id: 'c1', cardType: 'addBoard' }],
    ['composition', () => new CompositionCommand(), 'composition only in play', { playerId: 'p1', cardId: 'c1', outerBoardId: 'p1-board', innerBoardId: 'b2' }, { id: 'c1', cardType: 'composition' }],
    ['integral', () => new IntegralCommand(), 'integral only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1-board' }, { id: 'c1', cardType: 'integral' }],
    ['limit', () => new LimitCommand(), 'limit only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1-board' }, { id: 'c1', cardType: 'limit' }],
    ['modular', () => new ModularCommand(), 'modular only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1-board', modulus: 7 }, { id: 'c1', cardType: 'modular' }],
    ['nt-theorem', () => new NtTheoremCommand(), 'nt theorem only in play', { playerId: 'p1', cardId: 'c1', targetBoardId: 'p2-board', theorem: 'fermat_little' }, { id: 'c1', cardType: 'ntTheorem' }],
    ['vector', () => new VectorCommand(), 'vector only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1_board_2', expression: '[1, 0]', dimension: 2 }, { id: 'c1', cardType: 'vector' }],
    ['matrix', () => new MatrixCommand(), 'matrix only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1_board_2', expression: 'matrix([1,0],[0,1])' }, { id: 'c1', cardType: 'matrix' }],
    ['transform', () => new TransformCommand(), 'transform only in play', { playerId: 'p1', cardId: 'c1', boardId: 'p1-board', kind: 'lup' }, { id: 'c1', cardType: 'transform' }],
    ['eigenvalue', () => new EigenvalueCommand(), 'eigenvalue only in play', { playerId: 'p1', cardId: 'c1', targetBoardId: 'p2-board' }, { id: 'c1', cardType: 'eigenvalue' }],
  ] as Array<[string, () => GameCommand<unknown>, string, Record<string, unknown>, TestCard]>)(
    '%s rejects outside the play phase and keeps the card',
    async (_name, make, reason, payload, card) => {
      const p1 = player('p1', [card]);
      const gameState = state([p1, player('p2')], 'draw');
      const result = await run(make(), gameState, payload);
      expect(result).toEqual({ ok: false, reason });
      expect(p1.hand.map((c) => c.id)).toEqual(['c1']);
      expect(p1.discardGraveyard).toEqual([]);
    },
  );

  it('eval and force-eval also accept the resolution phase', async () => {
    // Command contract allows play+resolution; the dispatch gate restricts
    // eval_function to play, so resolution is reachable only internally — the
    // phaseAllowed list is still the command's own contract.
    const p1 = player('p1', [
      { id: 'vvc', subtype: 'Anchor', value: 2 },
      { id: 'ev', subtype: 'Eval' },
      { id: 'fe', cardType: 'forceEval' },
      { id: 'vvc2', subtype: 'Anchor', value: 3 },
    ]);
    const gameState = state([p1, player('p2')], 'resolution');

    const evalCommand = new EvalCommand() as GameCommand<unknown>;
    evalCommand.state = gameState;
    evalCommand.roomRef = { evalEngine: { evaluate: () => ({ undefined: false, hpGain10: 20 }) } };
    await expect(Promise.resolve(evalCommand.execute({ playerId: 'p1', boardIndex: 0, vvcCardId: 'vvc' }))).resolves.toMatchObject({ ok: true });

    const forceCommand = new ForceEvalCommand() as GameCommand<unknown>;
    forceCommand.state = gameState;
    forceCommand.roomRef = { forceEval: () => ({}) };
    await expect(Promise.resolve(forceCommand.execute({ playerId: 'p1', cardId: 'fe', vvcCardId: 'vvc2' }))).resolves.toMatchObject({ ok: true });
  });

  it('draw rejects outside the draw phase', async () => {
    const p1 = player('p1');
    p1.deckFCC = [{ id: 'f1', deckType: 'fcc' }];
    const gameState = state([p1, player('p2')], 'play');
    const command = new DrawCommand() as GameCommand<unknown>;
    await await expect(run(command, gameState, { playerId: 'p1', deck: 'fcc', count: 1 }))
      .resolves.toEqual({ ok: false, reason: 'draw only in draw phase' });
  });

  it('build_function rejects outside construction and play', async () => {
    const gameState = state([player('p1'), player('p2')], 'draw');
    const command = new BuildFunctionCommand() as GameCommand<unknown>;
    await await expect(run(command, gameState, { playerId: 'p1', boardId: 'p1-board', expression: 'x' }))
      .resolves.toEqual({ ok: false, reason: 'build_function only in construction or play phase' });
  });

  it('play-defense rejects outside the defense phase', async () => {
    const p1 = player('p1', [{ id: 'c1', cardType: 'shield' }]);
    const gameState = state([p1, player('p2')], 'play');
    const command = new PlayDefenseCommand() as GameCommand<unknown>;
    await await expect(run(command, gameState, { playerId: 'p1', cardId: 'c1', targetTriggerId: 't' }))
      .resolves.toEqual({ ok: false, reason: 'defense only in defense phase' });
    expect(p1.hand.map((c) => c.id)).toEqual(['c1']);
  });
});

/** Dead-target fizzle cells the suite did not already pin down. */
describe('command matrix — dead-target fizzles', () => {
  it('add-term fizzles on a dead own board — card spent, expression untouched', async () => {
    const p1 = player('p1', [{ id: 'c1', cardType: 'addTerm' }]);
    p1.boards[0]!.isActive = false;
    const command = new AddTermCommand() as GameCommand<unknown>;
    const result = await run(command, state([p1, player('p2')]), {
      playerId: 'p1', cardId: 'c1', boardId: 'p1-board', term: 't',
    });
    expect(result).toEqual({ ok: true, fizzled: true });
    expect(p1.boards[0]!.expression).toBe('x^2');
    expect(p1.discardGraveyard.map((c) => c.id)).toEqual(['c1']);
  });

  it('derivative fizzles on a dead own board — card spent, expression untouched', async () => {
    const p1 = player('p1', [{ id: 'c1', cardType: 'derivative' }]);
    p1.boards[0]!.isActive = false;
    const command = new DerivativeCommand() as GameCommand<unknown>;
    const result = await run(command, state([p1, player('p2')]), {
      playerId: 'p1', cardId: 'c1', boardId: 'p1-board',
    });
    expect(result).toEqual({ ok: true, fizzled: true });
    expect(p1.boards[0]!.expression).toBe('x^2');
    expect(p1.discardGraveyard.map((c) => c.id)).toEqual(['c1']);
  });

  it('martial theorem fizzles on a dead opponent board without spending the aggressive slot', async () => {
    const p1 = player('p1', [{ id: 'act-martial-theorem-001', cardType: 'martialTheorem' }]);
    const p2 = player('p2');
    p2.boards[0]!.isActive = false;
    const command = new TheoremMartialCommand() as GameCommand<unknown>;
    const result = await run(command, state([p1, p2]), {
      playerId: 'p1', cardId: 'act-martial-theorem-001', targetPlayerId: 'p2', targetBoardId: 'p2-board',
    });
    expect(result).toEqual({ ok: true, fizzled: true, boardDestroyed: false });
    expect(p1.aggressiveActionUsedThisTurn).toBe(false);
    expect(p1.discardGraveyard.map((c) => c.id)).toEqual(['act-martial-theorem-001']);
  });
});

describe('trap slot guards', () => {
  it('rejects a second trap while the slot is occupied and keeps the card', async () => {
    const p1 = player('p1', [{ id: 'c1', cardType: 'trap' }]);
    p1.trapCardId = 'already-armed';
    const command = new TrapCommand() as GameCommand<unknown>;
    const result = await run(command, state([p1, player('p2')]), { playerId: 'p1', trapCardId: 'c1' });
    expect(result).toEqual({ ok: false, reason: 'trap slot occupied' });
    expect(p1.trapCardId).toBe('already-armed');
    expect(p1.hand.map((c) => c.id)).toEqual(['c1']);
  });

  it('rejects a trap set after an aggressive action this turn', async () => {
    const p1 = player('p1', [{ id: 'c1', cardType: 'trap' }]);
    p1.aggressiveActionUsedThisTurn = true;
    const command = new TrapCommand() as GameCommand<unknown>;
    const result = await run(command, state([p1, player('p2')]), { playerId: 'p1', trapCardId: 'c1' });
    expect(result).toEqual({ ok: false, reason: 'aggressive action already used this turn' });
    expect(p1.trapCardId).toBe('');
  });
});

describe('build_function command edges', () => {
  it('rejects a destroyed board even when its expression is empty', async () => {
    const p1 = player('p1');
    p1.boards[0]!.isActive = false;
    p1.boards[0]!.destroyed = true;
    p1.boards[0]!.expression = '';
    const command = new BuildFunctionCommand() as GameCommand<unknown>;
    await expect(run(command, state([p1, player('p2')]), { playerId: 'p1', boardId: 'p1-board', expression: 'x' }))
      .resolves.toEqual({ ok: false, reason: 'board is destroyed' });
  });

  it('rejects rewriting a live expression during play', async () => {
    const p1 = player('p1');
    const command = new BuildFunctionCommand() as GameCommand<unknown>;
    await expect(run(command, state([p1, player('p2')]), { playerId: 'p1', boardId: 'p1-board', expression: 'x + 1' }))
      .resolves.toEqual({ ok: false, reason: 'board already has a live expression' });
    expect(p1.boards[0]!.expression).toBe('x^2');
  });

  it('is write-free during construction — the FSM submission gate owns the write', async () => {
    const p1 = player('p1');
    p1.boards[0]!.expression = '';
    const gameState = state([p1, player('p2')], 'construction');
    const command = new BuildFunctionCommand() as GameCommand<unknown>;
    await expect(run(command, gameState, { playerId: 'p1', boardId: 'p1-board', expression: 'x^2' }))
      .resolves.toEqual({ ok: true });
    expect(p1.boards[0]!.expression).toBe('');
  });
});

// ─── Add Board end-to-end (the one routed cardType with no coverage) ────────

function gameInPlay(): NerdiClashGame {
  const game = new NerdiClashGame();
  game.addPlayer('p1', 'Player One');
  game.addPlayer('p2', 'Player Two');
  game.state.phase = Phase.play;
  game.state.currentTurnPlayerId = 'p1';
  return game;
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

describe('Add Board (act-special-add-board-001)', () => {
  it('creates a second board cloning the first board’s domain and graveyards the card', async () => {
    const game = gameInPlay();
    requirePlayer(game, 'p1').boards[0]!.expression = 'x^2';
    giveCard(game, 'p1', 'act-special-add-board-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-add-board-001',
      target: { kind: 'none' },
    }));

    expect(result).toEqual({ ok: true });
    const p1 = requirePlayer(game, 'p1');
    expect(p1.boards.length).toBe(2);
    const added = p1.boards[1]!;
    expect(added.boardId).toBe('p1_board_2');
    expect(added.ownerSessionId).toBe('p1');
    expect(added.domain).toBe('poly'); // cloned from the seeded board
    expect(added.expression).toBe('');
    expect(added.isActive).toBe(true);
    expect(p1.boardCount).toBe(2);
    expect(handIds(game, 'p1')).not.toContain('act-special-add-board-001');
    expect([...p1.discardGraveyard].map((c) => c?.id)).toContain('act-special-add-board-001');
  });

  it('rejects at the 3-board cap and keeps the card', async () => {
    const game = gameInPlay();
    const p1 = requirePlayer(game, 'p1');
    for (let i = 0; i < 2; i += 1) {
      const board = new FunctionBoardSchema();
      board.boardId = `p1_extra_${i}`;
      board.ownerSessionId = 'p1';
      board.expression = 'x';
      board.domain = 'poly';
      board.isActive = true;
      p1.boards.push(board);
    }
    p1.boardCount = p1.boards.length;
    giveCard(game, 'p1', 'act-special-add-board-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-add-board-001',
      target: { kind: 'none' },
    }));

    expect(result).toEqual({ ok: false, reason: 'maximum board count reached' });
    expect(p1.boards.length).toBe(3);
    expect(handIds(game, 'p1')).toContain('act-special-add-board-001');
  });

  it('is rejected during construction by the shared turn-owner gate', async () => {
    const game = new NerdiClashGame();
    game.addPlayer('p1', 'Player One');
    game.addPlayer('p2', 'Player Two');
    game.startGame();
    giveCard(game, 'p1', 'act-special-add-board-001');

    const result = await Promise.resolve(game.dispatchIntent('p1', 'play_card', {
      cardId: 'act-special-add-board-001',
      target: { kind: 'none' },
    }));

    expect(result.ok).toBe(false);
    expect(handIds(game, 'p1')).toContain('act-special-add-board-001');
  });
});
