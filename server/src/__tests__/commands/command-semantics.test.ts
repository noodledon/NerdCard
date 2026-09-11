import { describe, expect, it } from 'vitest';
import { AttackHpCommand } from '../../commands/AttackHpCommand.js';
import { EvalCommand } from '../../commands/EvalCommand.js';
import { ForceEvalCommand } from '../../commands/ForceEvalCommand.js';
import { PlayDefenseCommand } from '../../commands/PlayDefenseCommand.js';
import { TrapCommand } from '../../commands/TrapCommand.js';
import type { CommandContext, CommandState } from '../../commands/base.js';

interface TestCard { id: string; cardType?: string; subtype?: string; value?: number; }

function player(id: string, hand: TestCard[] = []) {
  return {
    sessionId: id,
    hp10: 100,
    hand,
    boards: [{ boardId: `${id}-board`, expression: 'x + y', isActive: true, destroyed: false }],
    discardGraveyard: [] as TestCard[],
    trapCardId: '',
    aggressiveActionUsedThisTurn: false,
    everGainedHP: false,
    evaluatedThisTurn: false,
    boundFactor: null as { numberCardId: string; spellId: string } | null,
  };
}

type TestPlayer = ReturnType<typeof player>;

function state(players: TestPlayer[], phase = 'play'): CommandState {
  const byId = Object.fromEntries(players.map((entry) => [entry.sessionId, entry]));
  return {
    phase,
    turnIndex: 3,
    players: {
      ...byId,
      get(id: string) { return byId[id]; },
      *values() { yield* players; },
    },
  };
}

describe('deferred attack resolution', () => {
  it('records a pending attack instead of dealing damage', () => {
    const p1 = player('p1', [{ id: 'atk-1', cardType: 'offensive' }]);
    const p2 = player('p2');
    const gameState = state([p1, p2]);
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const command = new AttackHpCommand();
    command.state = gameState;
    command.roomRef = {
      emitGameEvent(event, _actorId, details = {}) { events.push({ event, details }); },
    };

    const result = command.execute({
      playerId: 'p1', cardId: 'atk-1', targetPlayerId: 'p2', damage10: 5,
    });

    expect(result).toEqual({ ok: true, damage10: 5, pending: true });
    expect(p2.hp10).toBe(100);
    expect(gameState.pendingAttackDamage10).toBe(5);
    expect(gameState.pendingAttackSourceId).toBe('p1');
    expect(gameState.pendingAttackTargetId).toBe('p2');
    expect(gameState.pendingTriggerId).toBe('attack_t3_atk-1');
    expect(p1.aggressiveActionUsedThisTurn).toBe(true);
    expect(p1.hand).toEqual([]);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['atk-1']);
    expect(events).toEqual([{
      event: 'play_card',
      details: {
        cardId: 'atk-1',
        targetPlayerId: 'p2',
        targetBoardId: undefined,
        damage10: 5,
        pending: true,
      },
    }]);
  });

  it('scales the pending damage by a bound number card', () => {
    const p1 = player('p1', [
      { id: 'atk-1', cardType: 'offensive' },
      { id: 'num-1', value: 2 },
    ]);
    const p2 = player('p2');
    const gameState = state([p1, p2]);
    const command = new AttackHpCommand();
    command.state = gameState;

    const result = command.execute({
      playerId: 'p1', cardId: 'atk-1', targetPlayerId: 'p2', damage10: 5, numberCardId: 'num-1',
    });

    expect(result).toEqual({ ok: true, damage10: 10, pending: true });
    expect(gameState.pendingAttackDamage10).toBe(10);
    expect(p2.hp10).toBe(100);
    // The bound spell card reaching the graveyard unbinds the factor (doc §7).
    expect(p1.boundFactor).toBeNull();
  });
});

describe('defense response', () => {
  it('fully negates the pending attack', () => {
    const p1 = player('p1', [{ id: 'shield-1', cardType: 'shield' }]);
    const gameState = state([p1, player('p2')], 'defense');
    gameState.pendingAttackDamage10 = 50;
    gameState.pendingTriggerId = 'attack_t3_atk-1';
    const command = new PlayDefenseCommand();
    command.state = gameState;

    const result = command.execute({
      playerId: 'p1', cardId: 'shield-1', targetTriggerId: 'attack_t3_atk-1',
    });

    expect(result).toEqual({ ok: true });
    expect(gameState.pendingAttackDamage10).toBe(0);
    expect(gameState.defenseResponseUsed).toBe(true);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['shield-1']);
  });

  it('frees the trap slot when the set trap is spent as a defense card', () => {
    const p1 = player('p1', [{ id: 'trap-1', cardType: 'trap' }]);
    p1.trapCardId = 'trap-1';
    const gameState = state([p1, player('p2')], 'defense');
    gameState.pendingAttackDamage10 = 50;
    gameState.pendingTriggerId = 'attack_t3_atk-1';
    const command = new PlayDefenseCommand();
    command.state = gameState;

    const result = command.execute({
      playerId: 'p1', cardId: 'trap-1', targetTriggerId: 'attack_t3_atk-1',
    });

    expect(result).toEqual({ ok: true });
    expect(p1.trapCardId).toBe('');
    expect(gameState.pendingAttackDamage10).toBe(0);
    expect(p1.hand).toEqual([]);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['trap-1']);
  });
});

describe('trap semantics', () => {
  it('persists in hand while occupying the trap slot', () => {
    const p1 = player('p1', [{ id: 'trap-1', cardType: 'trap' }]);
    const gameState = state([p1, player('p2')]);
    const command = new TrapCommand();
    command.state = gameState;

    const result = command.execute({ playerId: 'p1', trapCardId: 'trap-1' });

    expect(result).toEqual({ ok: true });
    expect(p1.trapCardId).toBe('trap-1');
    expect(p1.hand.map((card) => card.id)).toEqual(['trap-1']);
    expect(p1.discardGraveyard).toEqual([]);
    expect(p1.aggressiveActionUsedThisTurn).toBe(true);
  });

  it('counters a force evaluation', () => {
    const p1 = player('p1', [
      { id: 'force-1', cardType: 'forceEval' },
      { id: 'vvc-1', subtype: 'Anchor', value: 2 },
    ]);
    const p2 = player('p2', [{ id: 'trap-9', cardType: 'trap' }]);
    p2.trapCardId = 'trap-9';
    const gameState = state([p1, p2]);
    const events: Array<{ event: string; actorId: string; details: Record<string, unknown> }> = [];
    const command = new ForceEvalCommand();
    command.state = gameState;
    command.roomRef = {
      emitGameEvent(event, actorId, details = {}) { events.push({ event, actorId, details }); },
    };

    const result = command.execute({ playerId: 'p1', cardId: 'force-1', vvcCardId: 'vvc-1' });

    expect(result).toEqual({ ok: true, fizzled: true, countered: true });
    expect(gameState.forceEvalRequested).toBeUndefined();
    expect(p2.trapCardId).toBe('');
    expect(p2.discardGraveyard.map((card) => card.id)).toEqual(['trap-9']);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['force-1', 'vvc-1']);
    expect(events).toEqual([{
      event: 'trap_triggered',
      actorId: 'p2',
      details: { trapCardId: 'trap-9', countered: 'force_eval', attackerId: 'p1' },
    }]);
  });

  it('still resolves force eval against a trap-free opponent', () => {
    const p1 = player('p1', [
      { id: 'force-1', cardType: 'forceEval' },
      { id: 'vvc-1', subtype: 'Anchor', value: 7 },
    ]);
    const gameState = state([p1, player('p2')]);
    const calls: Array<{ nominatorId: string; vvcValue: number }> = [];
    const command = new ForceEvalCommand();
    command.state = gameState;
    command.roomRef = {
      forceEval(_state, nominatorId, vvcValue) { calls.push({ nominatorId, vvcValue }); },
    };

    const result = command.execute({ playerId: 'p1', cardId: 'force-1', vvcCardId: 'vvc-1' });

    expect(result).toEqual({ ok: true });
    expect(gameState.forceEvalRequested).toBe(true);
    expect(calls).toEqual([{ nominatorId: 'p1', vvcValue: 7 }]);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['force-1', 'vvc-1']);
  });

  it('requires an Anchor VVC for force eval', () => {
    const p1 = player('p1', [{ id: 'force-1', cardType: 'forceEval' }]);
    const gameState = state([p1, player('p2')]);
    const command = new ForceEvalCommand();
    command.state = gameState;

    const result = command.execute({ playerId: 'p1', cardId: 'force-1', vvcCardId: 'missing' });

    expect(result).toEqual({ ok: false, reason: 'valid variable-value card required' });
    expect(gameState.forceEvalRequested).toBeUndefined();
  });
});

describe('eval semantics', () => {
  const engine = (result: { undefined: boolean; hpGain10: number; value?: number; complexity?: number }): CommandContext => ({
    evalEngine: { evaluate: () => result },
  });

  it('requires an Evaluate card in hand', () => {
    const p1 = player('p1', [{ id: 'vvc-1', subtype: 'Anchor', value: 2 }]);
    const gameState = state([p1, player('p2')]);
    const command = new EvalCommand();
    command.state = gameState;
    command.roomRef = engine({ undefined: false, hpGain10: 30 });

    const result = command.execute({ playerId: 'p1', boardIndex: 0, vvcCardId: 'vvc-1' });

    expect(result).toEqual({ ok: false, reason: 'requires an Evaluate card' });
    expect(p1.hand.map((card) => card.id)).toEqual(['vvc-1']);
    expect(p1.discardGraveyard).toEqual([]);
  });

  it('consumes the VVC and Evaluate card and clears the board expression', () => {
    const p1 = player('p1', [
      { id: 'vvc-1', subtype: 'Anchor', value: 2 },
      { id: 'eval-1', subtype: 'Eval' },
    ]);
    const gameState = state([p1, player('p2')]);
    const command = new EvalCommand();
    command.state = gameState;
    command.roomRef = engine({ undefined: false, hpGain10: 30, value: 6, complexity: 3 });

    const result = command.execute({ playerId: 'p1', boardIndex: 0, vvcCardId: 'vvc-1' });

    expect(result).toEqual({ ok: true, hpGain10: 30 });
    expect(p1.hp10).toBe(130);
    expect(p1.everGainedHP).toBe(true);
    expect(p1.evaluatedThisTurn).toBe(true);
    expect(p1.boards[0]!.expression).toBe('');
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['vvc-1', 'eval-1']);
    expect(p1.hand).toEqual([]);
  });

  it('still consumes both cards when the evaluation is undefined', () => {
    const p1 = player('p1', [
      { id: 'vvc-1', subtype: 'Anchor', value: 2 },
      { id: 'eval-1', subtype: 'Eval' },
    ]);
    const gameState = state([p1, player('p2')]);
    const command = new EvalCommand();
    command.state = gameState;
    command.roomRef = engine({ undefined: true, hpGain10: 0 });

    const result = command.execute({ playerId: 'p1', boardIndex: 0, vvcCardId: 'vvc-1' });

    expect(result).toEqual({ ok: true, boardDestroyed: true });
    expect(p1.boards[0]!.destroyed).toBe(true);
    expect(p1.boards[0]!.isActive).toBe(false);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['vvc-1', 'eval-1']);
  });

  it('keeps both cards when the eval fizzles on a dead board', () => {
    const p1 = player('p1', [
      { id: 'vvc-1', subtype: 'Anchor', value: 2 },
      { id: 'eval-1', subtype: 'Eval' },
    ]);
    p1.boards[0]!.isActive = false;
    const gameState = state([p1, player('p2')]);
    const command = new EvalCommand();
    command.state = gameState;
    command.roomRef = engine({ undefined: false, hpGain10: 30 });

    const result = command.execute({ playerId: 'p1', boardIndex: 0, vvcCardId: 'vvc-1' });

    expect(result).toEqual({ ok: true, fizzled: true });
    expect(p1.hand.map((card) => card.id)).toEqual(['vvc-1', 'eval-1']);
    expect(p1.discardGraveyard).toEqual([]);
  });
});
