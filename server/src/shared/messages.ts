import { z } from 'zod';
import { type Board, type Card, type DeckType, type EffectType, type TargetRules } from './types.js';

export type TargetKind = TargetRules['scope'];

export const BuildFunctionSchema = z.object({
  type: z.literal('build_function'),
  boardId: z.string().min(1).max(100),
  expression: z.string().min(1).max(500),
  // variableIds/numberCardIds were removed in wave-9 T5: the variable-card
  // construction economy was never built, so the fields were dead weight.
  // Zod strips unknown keys, so a legacy client still sending them parses fine.
});

export const PlayCardSchema = z.object({
  type: z.literal('play_card'),
  cardId: z.string(),
  target: z
    .object({
      kind: z.enum(['self', 'opp', 'self_board', 'opp_board', 'card', 'global', 'none']),
      id: z.string().optional(),
    })
    .default({ kind: 'none' }),
  numberFactorCardIds: z.array(z.string()).optional(),
  // composition plays only: the symbol to substitute inside the outer board
  // (e.g. 'x') and the inner board to compose in. Both optional — the server
  // falls back to the outer board's sole distinct variable / the first other
  // board when omitted.
  variable: z.string().optional(),
  secondaryBoardId: z.string().optional(),
});

export const DrawCardsDeckChoiceSchema = z.object({
  deck: z.enum(['fcc', 'number', 'action']),
  count: z.number().int().min(1).max(2),
});

export const DrawCardsSchema = z.object({
  type: z.literal('draw_cards'),
  deckChoices: z.array(DrawCardsDeckChoiceSchema).min(1).max(2),
});

export const SetTrapSchema = z.object({
  type: z.literal('set_trap'),
  cardId: z.string(),
  // Optional: the server derives trap behavior from the card's catalog entry
  // (effectParams.trigger), so a client-supplied value is never authoritative.
  trigger: z.enum(['on_attack', 'on_eval', 'on_force_eval']).optional(),
});

export const PlayDefenseSchema = z.object({
  type: z.literal('play_defense'),
  cardId: z.string(),
  targetTriggerId: z.string(),
});

export const EvalFunctionSchema = z.object({
  type: z.literal('eval_function'),
  boardId: z.string(),
  variableValueCardId: z.string(),
});

export const ForceEvalSchema = z.object({
  type: z.literal('force_eval'),
  variableValueCardId: z.string(),
});

export const EndTurnSchema = z.object({
  type: z.literal('end_turn'),
});

export const ReadyInstSchema = z.object({
  type: z.literal('ready_inst'),
});

export const LeaveRoomSchema = z.object({
  type: z.literal('leave_room'),
});

// Room-lifecycle intent handled at the transport layer (JSON bridge), not by
// NerdiClashGame.dispatchIntent — a finished game resets only when both
// seated players vote for it.
export const RematchSchema = z.object({
  type: z.literal('rematch'),
});

// Lobby-level directory pull, answered by the JSON bridge before the join
// gate — any connected socket may ask, seated or not.
export const ListRoomsSchema = z.object({
  type: z.literal('list_rooms'),
});

export const ClientMessage = z.discriminatedUnion('type', [
  BuildFunctionSchema,
  PlayCardSchema,
  DrawCardsSchema,
  SetTrapSchema,
  PlayDefenseSchema,
  EvalFunctionSchema,
  ForceEvalSchema,
  EndTurnSchema,
  ReadyInstSchema,
  LeaveRoomSchema,
  RematchSchema,
  ListRoomsSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

export const StateSnapshotSchema = z.object({
  type: z.literal('state_snapshot'),
  state: z.unknown(),
});

export const PhaseChangeSchema = z.object({
  type: z.literal('phase_change'),
  phase: z.enum(['waiting', 'draw', 'play', 'defense', 'resolution', 'game_over']),
});

export const CardDrawnSchema = z.object({
  type: z.literal('card_drawn'),
  card: z.unknown() as z.ZodType<Card>,
});

export const BoardBuiltSchema = z.object({
  type: z.literal('board_built'),
  board: z.unknown() as z.ZodType<Board>,
});

export const EvalResultSchema = z.object({
  type: z.literal('eval_result'),
  result: z.unknown(),
});

export const TrapTriggeredSchema = z.object({
  type: z.literal('trap_triggered'),
  trap: z.unknown(),
});

export const GameOverSchema = z.object({
  type: z.literal('game_over'),
  winnerId: z.string().nullable(),
  winReason: z.enum(['hp_zero', 'variable_isolation', 'force_eval_domination', 'singular_board', 'undefined_integral_loss', 'abandoned']).nullable(),
});

export const ServerErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

export const RoomInfoSchema = z.object({
  name: z.string(),
  /** Seated players, including disconnected-but-reclaimable seats. */
  playerCount: z.number().int().min(0),
  /** Live sockets currently holding a seat in the room. */
  connected: z.number().int().min(0),
  phase: z.string(),
  /** GameMode the room was created with — fixed for the room's life. */
  mode: z.string(),
});

// Bridge answer to list_rooms — a pull snapshot, never pushed.
export const RoomListSchema = z.object({
  type: z.literal('room_list'),
  rooms: z.array(RoomInfoSchema),
});

// Bridge answer to leave_room — the seat is unseated (isConnected=false,
// still reclaimable via its token while the room lives) but the socket
// stays open for lobby-level browsing or a fresh join.
export const LeftRoomSchema = z.object({
  type: z.literal('left_room'),
});

export const ServerMessage = z.discriminatedUnion('type', [
  StateSnapshotSchema,
  PhaseChangeSchema,
  CardDrawnSchema,
  BoardBuiltSchema,
  EvalResultSchema,
  TrapTriggeredSchema,
  GameOverSchema,
  ServerErrorSchema,
  RoomListSchema,
  LeftRoomSchema,
]);

export type ServerMessage = z.infer<typeof ServerMessage>;

export function parseClientMessage(
  raw: unknown,
): { ok: true; message: ClientMessage } | { ok: false; error: z.ZodError } {
  const result = ClientMessage.safeParse(raw);
  if (result.success) {
    return { ok: true, message: result.data };
  }
  return { ok: false, error: result.error };
}
