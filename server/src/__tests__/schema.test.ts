import { describe, it, expect } from 'vitest';
import { Schema, type, MapSchema, ArraySchema } from '@colyseus/schema';

import {
  CardSchema,
  FunctionBoardSchema,
  PlayerSchema,
  GameRoomState,
  RoomConfigSchema,
  addToHand,
  ClientView,
} from '../state/schema.js';

// ─── Field count guard ────────────────────────────────────────────────────────

function countDecoratedFields(cls: typeof Schema): number {
  const proto = cls.prototype;
  let count = 0;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor' || key.startsWith('_')) continue;
    count++;
  }
  return count;
}

describe('schema field counts', () => {
  it('CardSchema has ≤64 fields', () => {
    expect(countDecoratedFields(CardSchema)).toBeLessThanOrEqual(64);
  });
  it('FunctionBoardSchema has ≤64 fields', () => {
    expect(countDecoratedFields(FunctionBoardSchema)).toBeLessThanOrEqual(64);
  });
  it('PlayerSchema has ≤64 fields', () => {
    expect(countDecoratedFields(PlayerSchema)).toBeLessThanOrEqual(64);
  });
  it('GameRoomState has ≤64 fields', () => {
    expect(countDecoratedFields(GameRoomState)).toBeLessThanOrEqual(64);
  });
});

// ─── Basic instantiation ──────────────────────────────────────────────────────

describe('CardSchema', () => {
  it('instantiates with defaults', () => {
    const card = new CardSchema();
    expect(card.id).toBe('');
    expect(card.deckType).toBe('');
    expect(card.cardType).toBe('');
    expect(card.domain).toBe('');
    expect(card.numericValue).toBe('');
    expect(card.expressionPayload).toBe('');
    expect(card.usableOncePerConstruction).toBe(false);
    expect(card.isFlipped).toBe(false);
  });

  it('sets fields and round-trips via encode/decode', () => {
    const card = new CardSchema();
    card.id = 'act-shield-001';
    card.deckType = 'Action';
    card.cardType = 'shield';
    card.domain = 'Trig';
    card.numericValue = '10';
    card.expressionPayload = '';
    card.usableOncePerConstruction = false;
    card.isFlipped = false;

    const encoded = card.encode();
    const decoded = new CardSchema();
    decoded.decode(encoded);

    expect(decoded.id).toBe('act-shield-001');
    expect(decoded.deckType).toBe('Action');
    expect(decoded.cardType).toBe('shield');
  });
});

describe('FunctionBoardSchema', () => {
  it('instantiates with defaults', () => {
    const board = new FunctionBoardSchema();
    expect(board.expression).toBe('');
    expect(board.compositionDepth).toBe(0);
    expect(board.dimension).toBe(0);
    expect(board.isSingular).toBe(false);
    expect(board.isActive).toBe(true);
  });
});

describe('PlayerSchema', () => {
  it('instantiates with defaults', () => {
    const player = new PlayerSchema();
    expect(player.hp10).toBe(0);
    expect(player.everGainedHP).toBe(false);
    expect(player.isConnected).toBe(true);
    expect(player.handCount).toBe(0);
    expect(player.boardCount).toBe(1);
    expect(player.baseFunctionUnlocked).toBe(false);
    expect(player.hasUsedVariableThisConstruction).toBe(false);
    expect(player.variableUsagesLeft).toBe(10);
  });
});

describe('GameRoomState', () => {
  it('instantiates with defaults', () => {
    const state = new GameRoomState();
    expect(state.phase).toBe('waiting');
    expect(state.currentTurnPlayerId).toBe('');
    expect(state.turnDeadline).toBe(0);
    expect(state.turnIndex).toBe(0);
    expect(state.roundNumber).toBe(0);
    expect(state.winner).toBe('');
    expect(state.consecutive_no_eval_turns).toBe(0);
    expect(state.global_no_eval_turns).toBe(0);
    expect(state.players.size).toBe(0);
  });

  it('holds MapSchema players with string keys', () => {
    const state = new GameRoomState();
    const player = new PlayerSchema();
    player.sessionId = 'sessA';
    player.displayName = 'Player A';
    state.players.set('sessA', player);
    expect(state.players.size).toBe(1);
    expect(state.players.get('sessA')!.sessionId).toBe('sessA');
  });

  it('holds MapSchema variable_isolation_timers', () => {
    const state = new GameRoomState();
    state.variable_isolation_timers.set('sessA', 2);
    expect(state.variable_isolation_timers.get('sessA')).toBe(2);
  });

  it('holds MapSchema deckCounts', () => {
    const state = new GameRoomState();
    state.deckCounts.set('fcc', 5);
    expect(state.deckCounts.get('fcc')).toBe(5);
  });

  it('has RoomConfigSchema nested', () => {
    const state = new GameRoomState();
    expect(state.config.maxPlayers).toBe(2);
    expect(state.config.turnTimeoutMs).toBe(30000);
    expect(state.config.seed).toBe('');
  });
});

// ─── @filter() hand privacy ───────────────────────────────────────────────────

describe('hand @filter() privacy', () => {
  const owner: ClientView = { sessionId: 'sessA' };
  const opponent: ClientView = { sessionId: 'sessB' };

  /** All fields that must be visible ONLY to the owning client. */
  const privateFields = ['deckFCC', 'deckNumber', 'deckAction', 'hand', 'availableVariables'];

  it('owner passes the filter, opponent fails — for every private field', () => {
    const player = new PlayerSchema();
    player.sessionId = 'sessA';

    const card = new CardSchema();
    card.id = 'c1';

    const def = (PlayerSchema as unknown as {
      _definition?: { filters: Record<number, (c: ClientView, v: CardSchema) => boolean>, indexes: Record<string, number> };
    })._definition;
    expect(def).toBeDefined();

    for (const field of privateFields) {
      const filterFn = def!.filters[def!.indexes[field]];
      expect(filterFn, `filter for ${field} should exist`).toBeDefined();
      expect(filterFn.call(player, owner, card), `${field} visible to owner`).toBe(true);
      expect(filterFn.call(player, opponent, card), `${field} hidden from opponent`).toBe(false);
    }
  });

  it('public fields (discardGraveyard, boards) have no filter', () => {
    const def = (PlayerSchema as unknown as {
      _definition?: { filters: Record<number, unknown>, indexes: Record<string, number> };
    })._definition;
    expect(def).toBeDefined();
    for (const field of ['discardGraveyard', 'boards']) {
      const idx = def!.indexes[field];
      expect(def!.filters[idx], `${field} should NOT be filtered`).toBeUndefined();
    }
  });
});

// ─── addToHand ────────────────────────────────────────────────────────────────

describe('addToHand', () => {
  it('pushes card and updates handCount', () => {
    const player = new PlayerSchema();
    const card = new CardSchema();
    card.id = 'act-shield-001';
    card.deckType = 'Action';
    card.cardType = 'shield';

    addToHand(player, card);

    expect(player.hand.length).toBe(1);
    expect(player.handCount).toBe(1);
  });

  it('increments handCount on multiple adds', () => {
    const player = new PlayerSchema();
    const card1 = new CardSchema();
    card1.id = 'c1';
    addToHand(player, card1);

    const card2 = new CardSchema();
    card2.id = 'c2';
    addToHand(player, card2);

    expect(player.hand.length).toBe(2);
    expect(player.handCount).toBe(2);
  });
});

// ─── Round-trip serialization ─────────────────────────────────────────────────

describe('round-trip serialization', () => {
  it('GameRoomState encodes/decodes string expression fields intact', () => {
    const state = new GameRoomState();
    state.phase = 'play';
    state.currentTurnPlayerId = 'sessA';
    state.turnDeadline = Date.now() + 30000;
    state.turnIndex = 4;
    state.consecutive_no_eval_turns = 1;
    state.global_no_eval_turns = 3;

    const playerA = new PlayerSchema();
    playerA.sessionId = 'sessA';
    playerA.displayName = 'Alice';
    playerA.hp10 = 120;
    playerA.everGainedHP = true;
    playerA.isConnected = true;
    playerA.handCount = 0;
    playerA.boardCount = 1;
    playerA.variableUsagesLeft = 10;

    const playerB = new PlayerSchema();
    playerB.sessionId = 'sessB';
    playerB.displayName = 'Bob';
    playerB.hp10 = 70;
    playerB.isConnected = true;
    playerB.handCount = 2;
    playerB.boardCount = 1;
    playerB.variableUsagesLeft = 8;

    state.players.set('sessA', playerA);
    state.players.set('sessB', playerB);

    state.variable_isolation_timers.set('sessB', 2);

    const board = new FunctionBoardSchema();
    board.boardId = 'board-1';
    board.ownerSessionId = 'sessA';
    board.expression = 'x^2 + 3*x';
    board.domain = 'poly';
    board.compositionDepth = 0;
    board.dimension = 0;
    board.isSingular = false;
    board.isActive = true;
    playerA.boards.push(board);
    playerA.boardCount = 1;

    // Encode and decode
    const encoded = state.encode();
    const decoded = new GameRoomState();
    decoded.decode(encoded);

    // Verify root fields
    expect(decoded.phase).toBe('play');
    expect(decoded.currentTurnPlayerId).toBe('sessA');
    expect(decoded.turnIndex).toBe(4);
    expect(decoded.consecutive_no_eval_turns).toBe(1);
    expect(decoded.global_no_eval_turns).toBe(3);
    expect(decoded.variable_isolation_timers.get('sessB')).toBe(2);

    // Verify players
    expect(decoded.players.size).toBe(2);
    const decodedPlayerA = decoded.players.get('sessA')!;
    expect(decodedPlayerA.hp10).toBe(120);
    expect(decodedPlayerA.everGainedHP).toBe(true);
    expect(decodedPlayerA.boards.length).toBe(1);
    const decodedBoard = decodedPlayerA.boards[0]!;
    expect(decodedBoard.expression).toBe('x^2 + 3*x');
    expect(decodedBoard.domain).toBe('poly');
    expect(decodedBoard.compositionDepth).toBe(0);

    // Verify string expressions survived (no AST leak)
    expect(typeof decodedBoard.expression).toBe('string');
  });
});

// ─── Schema purity (no math.js leak) ──────────────────────────────────────────

describe('schema purity', () => {
  it('does not import or use math.js', async () => {
    const fs = await import('fs');
    const path = new URL('../state/schema.ts', import.meta.url);
    const content = fs.readFileSync(path, 'utf-8');
    // Detect REAL usage (imports / calls), not doc-comment mentions.
    expect(content).not.toMatch(/from\s+["']mathjs["']/);
    expect(content).not.toMatch(/from\s+["']math\.js["']/);
    expect(content).not.toMatch(/\bmath\s*\.\s*parse\s*\(/);
    expect(content).not.toMatch(/\bmath\s*\.\s*Node\b/);
    expect(content).not.toMatch(/require\s*\(\s*["']mathjs["']\s*\)/);
  });
});
