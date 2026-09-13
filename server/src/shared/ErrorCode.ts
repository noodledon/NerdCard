export enum ErrorCode {
  INVALID_PAYLOAD = 'INVALID_PAYLOAD',
  NOT_PHASE_NOT_DRAW = 'NOT_PHASE_NOT_DRAW',
  NOT_YOUR_TURN = 'NOT_YOUR_TURN',
  CARD_NOT_IN_HAND = 'CARD_NOT_IN_HAND',
  INVALID_TARGET = 'INVALID_TARGET',
  OFFENSIVE_LIMIT_EXCEEDED = 'OFFENSIVE_LIMIT_EXCEEDED',
  TOO_MANY_ACTIONS = 'TOO_MANY_ACTIONS',
  LIMIT_REACHED = 'LIMIT_REACHED',
  DECK_EMPTY = 'DECK_EMPTY',
  GAME_OVER = 'GAME_OVER',
  ROOM_FULL = 'ROOM_FULL',
  SERVER_FULL = 'SERVER_FULL',
  MODE_MISMATCH = 'MODE_MISMATCH',
  ALREADY_JOINED = 'ALREADY_JOINED',
  INTERNAL = 'INTERNAL',
}

/**
 * Maps a command-level rejection `reason` string to a wire error code.
 * Shared by both transports (json-bridge, NerdiClashRoom) so a given
 * rejection carries the same code regardless of wire path.
 *
 * Reasons that stay on the INVALID_TARGET fallback — by design:
 * - unrouted plays (`unsupported intent *`, `unroutedPlayCardReason`
 *   guidance strings): the card is a non-playable resource
 * - target/semantic rejections a client could retry differently
 *   (`cannot target self`, `unknown trigger`, `board not found`,
 *   `composition requires two distinct boards`, `trap slot occupied`,
 *   `* card required`, engine transform failures, `invalid expression *`,
 *   `ambiguous variable — specify one`, `term is required`,
 *   `board expression *`, `evaluation is not a finite real number`,
 *   `player not found`)
 */
export function errorCodeForReason(reason: string | undefined): ErrorCode {
  if (reason?.includes('game is over')) return ErrorCode.GAME_OVER;
  if (reason?.includes('active player') || reason?.includes('defending player')) return ErrorCode.NOT_YOUR_TURN;
  if (reason?.includes('only in') || reason?.includes('phase')) return ErrorCode.NOT_PHASE_NOT_DRAW;
  if (reason?.includes('deckChoices') || reason?.includes('invalid draw choices')) return ErrorCode.INVALID_PAYLOAD;
  if (reason?.includes('mode mismatch')) return ErrorCode.MODE_MISMATCH;
  if (reason?.includes('aggressive action')) return ErrorCode.OFFENSIVE_LIMIT_EXCEEDED;
  if (reason?.includes('action limit') || reason?.includes('already used')) return ErrorCode.TOO_MANY_ACTIONS;
  if (reason?.includes('board limit') || reason?.includes('maximum')) return ErrorCode.LIMIT_REACHED;
  if (reason?.includes('not in player')) return ErrorCode.CARD_NOT_IN_HAND;
  if (reason?.includes('deck empty')) return ErrorCode.DECK_EMPTY;
  if (
    reason?.includes('unavailable')
    || reason?.includes('state missing')
    || reason?.includes('game is gone')
    || reason?.includes('seat is gone')
    || reason?.includes('illegal transition')
    || reason?.includes('unknown theorem')
    || reason?.includes('unsupported transform')
  ) return ErrorCode.INTERNAL;
  if (reason?.includes('player not found')) return ErrorCode.INVALID_TARGET;
  return ErrorCode.INVALID_TARGET;
}
