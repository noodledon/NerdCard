import { describe, expect, it } from 'vitest';
import { AttackHpCommand } from '../../commands/AttackHpCommand.js';
import { ForceEvalCommand } from '../../commands/ForceEvalCommand.js';
import { PlayDefenseCommand } from '../../commands/PlayDefenseCommand.js';
import type { CommandState } from '../../commands/base.js';

function player(
  id: string,
  hand: Array<{ id: string; cardType?: string; subtype?: string }> = [],
) {
  return {
    sessionId: id,
    hp10: 100,
    hand,
    boards: [{ boardId: `${id}-board`, expression: 'x', isActive: true }],
    discardGraveyard: [] as Array<{ id: string; cardType?: string; subtype?: string }>,
  };
}

function state(players: ReturnType<typeof player>[]): CommandState {
  const byId = Object.fromEntries(players.map((entry) => [entry.sessionId, entry]));
  return {
    phase: 'play',
    players: {
      ...byId,
      get(id: string) { return byId[id]; },
      *values() { yield* players; },
    },
  };
}

describe('Wave 4 command edges', () => {
  it('(c) resolves one force evaluation and fizzles a duplicate in the same turn', () => {
    const p1 = player('p1', [
      { id: 'force-1', cardType: 'forceEval' },
      { id: 'force-2', cardType: 'forceEval' },
    ]);
    const gameState = state([p1, player('p2')]);
    const events: Array<{ event: string; actorId: string; details: Record<string, unknown> }> = [];
    const command = new ForceEvalCommand();
    command.state = gameState;
    command.roomRef = {
      emitGameEvent(event, actorId, details = {}) { events.push({ event, actorId, details }); },
    };

    expect(command.execute({ playerId: 'p1', cardId: 'force-1' })).toEqual({ ok: true });
    expect(command.execute({ playerId: 'p1', cardId: 'force-2' })).toMatchObject({ ok: true, fizzled: true });

    expect(events).toEqual([
      { event: 'force_eval', actorId: 'p1', details: { cardId: 'force-1' } },
      {
        event: 'fizzle',
        actorId: 'p1',
        details: { source: 'force_eval', cardId: 'force-2', reason: 'already_resolved' },
      },
    ]);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['force-1']);
    expect(p1.hand.map((card) => card.id)).toEqual(['force-2']);
  });

  it('(d) sends a source card to the graveyard and emits fizzle when its board target is gone', () => {
    const p1 = player('p1', [{ id: 'attack-1', cardType: 'offensive' }]);
    const p2 = player('p2');
    p2.boards[0]!.isActive = false;
    const events: Array<{ event: string; details: Record<string, unknown> }> = [];
    const command = new AttackHpCommand();
    command.state = state([p1, p2]);
    command.roomRef = {
      emitGameEvent(event, _actorId, details = {}) { events.push({ event, details }); },
    };

    expect(command.execute({
      playerId: 'p1', cardId: 'attack-1', targetPlayerId: 'p2', targetBoardId: 'p2-board',
    })).toMatchObject({ ok: true, fizzled: true });
    expect(p1.hand).toEqual([]);
    expect(p1.discardGraveyard.map((card) => card.id)).toEqual(['attack-1']);
    expect(events).toEqual([{
      event: 'fizzle',
      details: {
        source: 'play_card', cardId: 'attack-1', targetId: 'p2-board', reason: 'target_gone',
      },
    }]);
  });

  it('rejects a force evaluation card identifier that is not a Force Evaluation card', () => {
    const p1 = player('p1', [{ id: 'not-force', cardType: 'offensive' }]);
    const command = new ForceEvalCommand();
    command.state = state([p1, player('p2')]);

    expect(command.execute({ playerId: 'p1', cardId: 'not-force' })).toEqual({
      ok: false,
      reason: 'force evaluation card required',
    });
    expect(p1.hand.map((card) => card.id)).toEqual(['not-force']);
  });

  it('allows only one defense response for the pending trigger', () => {
    const p1 = player('p1', [{ id: 'shield-1', cardType: 'shield' }]);
    const gameState = state([p1, player('p2')]);
    gameState.phase = 'defense';
    gameState.pendingTriggerId = 'trigger-1';
    const command = new PlayDefenseCommand();
    command.state = gameState;

    expect(command.execute({ playerId: 'p1', cardId: 'shield-1', targetTriggerId: 'trigger-1' })).toEqual({ ok: true });
    expect(gameState.defenseResponseUsed).toBe(true);
    expect(command.execute({ playerId: 'p1', cardId: 'shield-1', targetTriggerId: 'trigger-1' })).toEqual({
      ok: false,
      reason: 'defense response already used',
    });
  });
});
