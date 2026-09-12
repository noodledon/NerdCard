import { describe, expect, it } from 'vitest';
import { ErrorCode, errorCodeForReason } from '../shared/ErrorCode.js';

/**
 * Wave-11 T4 — reason→code contract for `errorCodeForReason`, shared by
 * json-bridge and NerdiClashRoom. Pins the new DECK_EMPTY / GAME_OVER /
 * LIMIT_REACHED codes plus the corrected TOO_MANY_ACTIONS / INTERNAL
 * mappings; INVALID_TARGET stays the documented fallback.
 */
describe('errorCodeForReason', () => {
  const cases: Array<[string | undefined, ErrorCode]> = [
    // new codes
    ['game is over', ErrorCode.GAME_OVER],
    ['deck empty', ErrorCode.DECK_EMPTY],
    ['board limit reached', ErrorCode.LIMIT_REACHED],
    ['maximum board count reached', ErrorCode.LIMIT_REACHED],
    ['maximum composition depth reached', ErrorCode.LIMIT_REACHED],
    ['Board count 4 exceeds maximum of 3', ErrorCode.LIMIT_REACHED],
    ['Hand size 11 exceeds maximum of 10', ErrorCode.LIMIT_REACHED],
    // corrected mappings
    ['turn action limit reached', ErrorCode.TOO_MANY_ACTIONS],
    ['aggressive action already used this turn', ErrorCode.OFFENSIVE_LIMIT_EXCEEDED],
    ['defense response already used', ErrorCode.TOO_MANY_ACTIONS],
    ['evaluation engine unavailable', ErrorCode.INTERNAL],
    ['matrix expression unavailable', ErrorCode.INTERNAL],
    ['modular modulus unavailable', ErrorCode.INTERNAL],
    ['nt theorem unavailable', ErrorCode.INTERNAL],
    ['transform kind unavailable', ErrorCode.INTERNAL],
    ['vector params unavailable', ErrorCode.INTERNAL],
    ['deck unavailable', ErrorCode.INTERNAL],
    ['graveyard unavailable', ErrorCode.INTERNAL],
    ['player state missing', ErrorCode.INTERNAL],
    ['game is gone', ErrorCode.INTERNAL],
    ['illegal transition draw→play', ErrorCode.INTERNAL],
    ['unknown theorem foo', ErrorCode.INTERNAL],
    ['unsupported transform svd', ErrorCode.INTERNAL],
    // unchanged mappings
    ['not the active player', ErrorCode.NOT_YOUR_TURN],
    ['not the defending player', ErrorCode.NOT_YOUR_TURN],
    ['draw_cards only in draw phase', ErrorCode.NOT_PHASE_NOT_DRAW],
    ['end turn only in play phase', ErrorCode.NOT_PHASE_NOT_DRAW],
    ['build_function rejected by phase', ErrorCode.NOT_PHASE_NOT_DRAW],
    ['deckChoices must draw exactly 2 cards', ErrorCode.INVALID_PAYLOAD],
    ['invalid draw choices', ErrorCode.INVALID_PAYLOAD],
    ['mode mismatch: room is nerdiclash', ErrorCode.MODE_MISMATCH],
    ["card x is not in player's hand", ErrorCode.CARD_NOT_IN_HAND],
    ['player not found', ErrorCode.INVALID_TARGET],
    // documented INVALID_TARGET fallback
    ['unsupported intent force_eval', ErrorCode.INVALID_TARGET],
    ['cannot target self', ErrorCode.INVALID_TARGET],
    ['unknown trigger', ErrorCode.INVALID_TARGET],
    ['board not found', ErrorCode.INVALID_TARGET],
    ['trap slot occupied', ErrorCode.INVALID_TARGET],
    ['requires an Evaluate card', ErrorCode.INVALID_TARGET],
    ['ambiguous variable — specify one', ErrorCode.INVALID_TARGET],
    ['composition requires two distinct boards', ErrorCode.INVALID_TARGET],
    [undefined, ErrorCode.INVALID_TARGET],
  ];

  for (const [reason, expected] of cases) {
    it(`${JSON.stringify(reason)} → ${expected}`, () => {
      expect(errorCodeForReason(reason)).toBe(expected);
    });
  }
});
