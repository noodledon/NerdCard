export type WinReason = 'hp0' | 'isolation' | 'force-dom' | 'singular' | 'dim0';

export interface WinBoard {
  destroyed?: boolean;
  isActive?: boolean;
  isSingular?: boolean;
  dimension?: number;
}

export interface WinPlayer {
  id: string;
  hp10: number;
  everGainedHP?: boolean;
  mainBoardExpr?: string;
  boards?: WinBoard[];
}

export interface WinState {
  players: Iterable<WinPlayer>;
  variableIsolationTimers?: Map<string, number> | Record<string, number>;
  lastForceEvalWinner?: string;
}

export interface WinResult {
  winner?: string;
  loser?: string;
  reason?: WinReason;
  destroyedPlayerBoards: string[];
}

function timerFor(state: WinState, playerId: string): number | undefined {
  const timers = state.variableIsolationTimers;
  if (!timers) return undefined;
  return timers instanceof Map ? timers.get(playerId) : timers[playerId];
}

function opponentId(players: WinPlayer[], loserId: string): string | undefined {
  return players.find((player) => player.id !== loserId)?.id;
}

function isIsolated(expression: string | undefined): boolean {
  return expression !== undefined && /^[a-z]$/.test(expression.trim());
}

export function checkWin(state: WinState): WinResult {
  const players = [...state.players];
  const base: WinResult = { destroyedPlayerBoards: [] };

  if (state.lastForceEvalWinner) {
    const loser = players.find((player) => player.id !== state.lastForceEvalWinner)?.id;
    return { ...base, winner: state.lastForceEvalWinner, loser, reason: 'force-dom' };
  }

  for (const player of players) {
    if (player.everGainedHP === true && player.hp10 <= 0) {
      return { ...base, winner: opponentId(players, player.id), loser: player.id, reason: 'hp0' };
    }
  }

  for (const player of players) {
    if (isIsolated(player.mainBoardExpr) && timerFor(state, player.id) === 0) {
      return { ...base, winner: opponentId(players, player.id), loser: player.id, reason: 'isolation' };
    }
  }

  for (const player of players) {
    const boards = player.boards ?? [];
    const destroyed = boards.filter(
      (board) => board.destroyed === true || board.isActive === false || board.isSingular === true || board.dimension === 0,
    );
    if (destroyed.length === 0) continue;
    base.destroyedPlayerBoards.push(player.id);
    const surviving = boards.filter((board) => !destroyed.includes(board));
    if (boards.length > 0 && surviving.length === 0) {
      const singular = destroyed.some((board) => board.isSingular === true);
      return {
        ...base,
        winner: opponentId(players, player.id),
        loser: player.id,
        reason: singular ? 'singular' : 'dim0',
      };
    }
  }

  return base;
}
