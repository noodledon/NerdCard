import type { z } from 'zod';
import {
  BuildFunctionSchema,
  DrawCardsSchema,
  EndTurnSchema,
  EvalFunctionSchema,
  ForceEvalSchema,
  LeaveRoomSchema,
  PlayCardSchema,
  PlayDefenseSchema,
  ReadyInstSchema,
  SetTrapSchema,
} from '../shared/messages.js';
import { ErrorCode } from '../shared/ErrorCode.js';

export interface HandlerClient {
  sessionId: string;
  send(type: 'error', payload: { code: ErrorCode; message: string }): void;
  leave?(code?: number): void;
}

interface HandlerCard {
  id: string;
}

interface HandlerBoard {
  boardId: string;
  isActive: boolean;
}

interface HandlerPlayer {
  sessionId?: string;
  hand: Iterable<HandlerCard>;
  boards: Iterable<HandlerBoard>;
}

export interface HandlerRoom {
  readonly state: {
    phase: string;
    currentTurnPlayerId: string;
    pendingTriggerId?: string;
    defenseResponseUsed?: boolean;
    players: {
      get(id: string): HandlerPlayer | undefined;
      values?(): IterableIterator<HandlerPlayer>;
    };
  };
  dispatchIntent(client: HandlerClient, intent: string, payload: Record<string, unknown>): Promise<void>;
  requestEndTurn(client: HandlerClient): Promise<void>;
}

type PayloadSchema = z.ZodType<Record<string, unknown>>;
type TargetKind = 'self' | 'opp' | 'self_board' | 'opp_board' | 'card' | 'global' | 'none';

interface TargetPayload {
  kind: TargetKind;
  id?: string;
}

interface DrawChoicePayload {
  deck: 'fcc' | 'number' | 'action';
  count: number;
}

function sendError(client: HandlerClient, code: ErrorCode, message: string): void {
  client.send('error', { code, message });
}

function parsePayload(
  client: HandlerClient,
  schema: PayloadSchema,
  raw: unknown,
): Record<string, unknown> | undefined {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const path = result.error.issues.map((issue) => issue.path.join('.')).join('; ');
  sendError(client, ErrorCode.INVALID_PAYLOAD, path || 'invalid payload');
  return undefined;
}

function requirePhase(room: HandlerRoom, client: HandlerClient, phases: readonly string[]): boolean {
  if (phases.includes(room.state.phase)) return true;
  sendError(client, ErrorCode.NOT_PHASE_NOT_DRAW, `intent is not legal during ${room.state.phase}`);
  return false;
}

function requireTurnOwner(room: HandlerRoom, client: HandlerClient): boolean {
  if (room.state.currentTurnPlayerId === client.sessionId) return true;
  sendError(client, ErrorCode.NOT_YOUR_TURN, 'not the active player');
  return false;
}

function playerValues(room: HandlerRoom): HandlerPlayer[] {
  const values = room.state.players.values?.();
  return values ? [...values] : [];
}

function requireCard(room: HandlerRoom, client: HandlerClient, cardId: string): boolean {
  const player = room.state.players.get(client.sessionId);
  if (player && [...player.hand].some((card) => card.id === cardId)) return true;
  sendError(client, ErrorCode.CARD_NOT_IN_HAND, cardId);
  return false;
}

function requireBoard(room: HandlerRoom, client: HandlerClient, boardId: string): boolean {
  const player = room.state.players.get(client.sessionId);
  if (player && [...player.boards].some((board) => board.boardId === boardId && board.isActive)) return true;
  sendError(client, ErrorCode.INVALID_TARGET, boardId);
  return false;
}

function readTarget(value: unknown): TargetPayload | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as { kind?: unknown; id?: unknown };
  const kinds: readonly TargetKind[] = [
    'self', 'opp', 'self_board', 'opp_board', 'card', 'global', 'none',
  ];
  if (typeof candidate.kind !== 'string' || !kinds.includes(candidate.kind as TargetKind)) return undefined;
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return undefined;
  return { kind: candidate.kind as TargetKind, id: candidate.id };
}

function requireTarget(room: HandlerRoom, client: HandlerClient, rawTarget: unknown): boolean {
  const target = readTarget(rawTarget);
  if (!target) {
    sendError(client, ErrorCode.INVALID_TARGET, 'invalid target');
    return false;
  }

  const players = playerValues(room);
  const targetId = target.id;
  const hasActiveBoard = (player: HandlerPlayer | undefined): boolean => Boolean(
    targetId && player && [...player.boards].some((board) => board.boardId === targetId && board.isActive),
  );

  let isValid = false;
  switch (target.kind) {
    case 'none':
    case 'global':
      isValid = targetId === undefined;
      break;
    case 'self':
      isValid = targetId === undefined || targetId === client.sessionId;
      break;
    case 'opp':
      isValid = Boolean(targetId && targetId !== client.sessionId && room.state.players.get(targetId));
      break;
    case 'self_board':
      isValid = hasActiveBoard(room.state.players.get(client.sessionId));
      break;
    case 'opp_board':
      isValid = players.some((player) => player.sessionId !== client.sessionId && hasActiveBoard(player));
      break;
    case 'card':
      isValid = Boolean(targetId) && players.some(
        (player) => [...player.hand].some((card) => card.id === targetId),
      );
      break;
  }

  if (isValid) return true;
  sendError(client, ErrorCode.INVALID_TARGET, targetId ?? target.kind);
  return false;
}

function drawChoiceTotal(payload: Record<string, unknown>): number | undefined {
  const choices = payload.deckChoices;
  if (!Array.isArray(choices)) return undefined;
  let total = 0;
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice === null) return undefined;
    const candidate = choice as Partial<DrawChoicePayload>;
    if (
      (candidate.deck !== 'fcc' && candidate.deck !== 'number' && candidate.deck !== 'action')
      || typeof candidate.count !== 'number'
    ) {
      return undefined;
    }
    total += candidate.count;
  }
  return total;
}

function requirePendingTrigger(
  room: HandlerRoom,
  client: HandlerClient,
  triggerId: string,
): boolean {
  if (room.state.defenseResponseUsed) {
    sendError(client, ErrorCode.TOO_MANY_ACTIONS, 'a defense response is already resolved');
    return false;
  }
  if (!room.state.pendingTriggerId || room.state.pendingTriggerId !== triggerId) {
    sendError(client, ErrorCode.INVALID_TARGET, triggerId);
    return false;
  }
  return true;
}

export function registerHandlers(
  room: HandlerRoom,
  onMessage: (type: string, handler: (client: HandlerClient, payload: unknown) => Promise<void>) => void,
): void {
  onMessage('build_function', async (client, raw) => {
    const payload = parsePayload(client, BuildFunctionSchema, raw);
    if (!payload || !requirePhase(room, client, ['construction', 'play'])) return;
    if (room.state.phase === 'play' && !requireTurnOwner(room, client)) return;
    if (!requireBoard(room, client, String(payload.boardId))) return;
    await room.dispatchIntent(client, 'build_function', payload);
  });

  onMessage('play_card', async (client, raw) => {
    const payload = parsePayload(client, PlayCardSchema, raw);
    if (!payload || !requirePhase(room, client, ['play']) || !requireTurnOwner(room, client)) return;
    if (!requireCard(room, client, String(payload.cardId))) return;
    if (!requireTarget(room, client, payload.target)) return;
    await room.dispatchIntent(client, 'play_card', payload);
  });

  onMessage('draw_cards', async (client, raw) => {
    const payload = parsePayload(client, DrawCardsSchema, raw);
    if (!payload || !requirePhase(room, client, ['draw']) || !requireTurnOwner(room, client)) return;
    const total = drawChoiceTotal(payload);
    if (total !== 2) {
      sendError(client, ErrorCode.INVALID_PAYLOAD, 'deckChoices must draw exactly 2 cards');
      return;
    }
    await room.dispatchIntent(client, 'draw_cards', payload);
  });

  onMessage('set_trap', async (client, raw) => {
    const payload = parsePayload(client, SetTrapSchema, raw);
    if (!payload || !requirePhase(room, client, ['play']) || !requireTurnOwner(room, client)) return;
    if (!requireCard(room, client, String(payload.cardId))) return;
    await room.dispatchIntent(client, 'set_trap', payload);
  });

  onMessage('play_defense', async (client, raw) => {
    const payload = parsePayload(client, PlayDefenseSchema, raw);
    if (!payload || !requirePhase(room, client, ['defense']) || !requireTurnOwner(room, client)) return;
    if (!requireCard(room, client, String(payload.cardId))) return;
    if (!requirePendingTrigger(room, client, String(payload.targetTriggerId))) return;
    await room.dispatchIntent(client, 'play_defense', payload);
  });

  onMessage('eval_function', async (client, raw) => {
    const payload = parsePayload(client, EvalFunctionSchema, raw);
    if (!payload || !requirePhase(room, client, ['play']) || !requireTurnOwner(room, client)) return;
    if (!requireBoard(room, client, String(payload.boardId)) || !requireCard(room, client, String(payload.variableValueCardId))) return;
    await room.dispatchIntent(client, 'eval_function', payload);
  });

  onMessage('force_eval', async (client, raw) => {
    const payload = parsePayload(client, ForceEvalSchema, raw);
    if (!payload || !requirePhase(room, client, ['play']) || !requireTurnOwner(room, client)) return;
    if (!requireCard(room, client, String(payload.variableValueCardId))) return;
    await room.dispatchIntent(client, 'force_eval', payload);
  });

  onMessage('end_turn', async (client, raw) => {
    const payload = parsePayload(client, EndTurnSchema, raw);
    if (!payload || !requirePhase(room, client, ['play']) || !requireTurnOwner(room, client)) return;
    await room.requestEndTurn(client);
  });

  onMessage('ready_inst', async (client, raw) => {
    const payload = parsePayload(client, ReadyInstSchema, raw);
    if (payload) await room.dispatchIntent(client, 'ready_inst', payload);
  });

  onMessage('leave_room', async (client, raw) => {
    const payload = parsePayload(client, LeaveRoomSchema, raw);
    if (!payload) return;
    client.leave?.();
  });
}
