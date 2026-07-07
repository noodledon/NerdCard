// Pure resource-limit predicates — T7.
//
// CRITICAL: ZERO imports from @colyseus/schema or colyseus.js. Operates on the
// PlayerLogic interface so it is unit-testable without a Colyseus Room.
//
// Rulebook caps: hand size 7 (configurable), boards <= 3.

import type { PlayerLogic } from './types.js';

export const DEFAULT_MAX_HAND_SIZE = 7;
export const MAX_BOARD_COUNT = 3;

export function enforceHandSize(
  player: PlayerLogic,
  maxHandSize: number = DEFAULT_MAX_HAND_SIZE,
): { ok: boolean; reason?: string } {
  const handSize = player.hand.length;
  if (handSize > maxHandSize) {
    return {
      ok: false,
      reason: `Hand size ${handSize} exceeds maximum of ${maxHandSize}`,
    };
  }
  return { ok: true };
}

export function enforceBoardCount(
  player: PlayerLogic,
): { ok: boolean; reason?: string } {
  const boardCount = player.boards.length;
  if (boardCount > MAX_BOARD_COUNT) {
    return {
      ok: false,
      reason: `Board count ${boardCount} exceeds maximum of ${MAX_BOARD_COUNT}`,
    };
  }
  return { ok: true };
}

export function canAddBoard(player: PlayerLogic): boolean {
  return player.boards.length < MAX_BOARD_COUNT;
}
