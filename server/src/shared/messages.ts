import { z } from 'zod';
import { type Board, type Card, type DeckType, type EffectType, type TargetRules } from './types.js';

export type TargetKind = TargetRules['scope'];

const BuildFunctionSchema = z.object({
  type: z.literal('build_function'),
  boardId: z.string().optional(),
  expression: z.string().max(500),
  variableIds: z.array(z.number()),
  numberCardIds: z.array(z.string()),
});

const PlayCardSchema = z.object({
  type: z.literal('play_card'),
  cardId: z.string(),
  target: z
    .object({
      kind: z.enum(['self', 'opp', 'self_board', 'opp_board', 'global']),
      id: z.string().optional(),
    })
    .optional(),
  numberFactorCardIds: z.array(z.string()).optional(),
});

const DrawCardsDeckChoiceSchema = z.object({
  deck: z.enum(['fcc', 'number', 'action']),
  count: z.number(),
});

const DrawCardsSchema = z.object({
  type: z.literal('draw_cards'),
  deckChoices: z.array(DrawCardsDeckChoiceSchema),
});

const SetTrapSchema = z.object({
  type: z.literal('set_trap'),
  cardId: z.string(),
  trigger: z.enum(['on_attack', 'on_eval', 'on_force_eval']),
});

const EvalPointSchema = z.object({
  variable: z.string(),
  value: z.number(),
});

const EvalFunctionSchema = z.object({
  type: z.literal('eval_function'),
  boardId: z.string(),
  evalPoint: EvalPointSchema.optional(),
});

const ForceEvalSchema = z.object({
  type: z.literal('force_eval'),
  boardIds: z.array(z.string()),
});

const EndTurnSchema = z.object({
  type: z.literal('end_turn'),
});

const ReconnectSchema = z.object({
  type: z.literal('reconnect'),
  sessionId: z.string(),
});

const LeaveSchema = z.object({
  type: z.literal('leave'),
});

export const ClientMessage = z.discriminatedUnion('type', [
  BuildFunctionSchema,
  PlayCardSchema,
  DrawCardsSchema,
  SetTrapSchema,
  EvalFunctionSchema,
  ForceEvalSchema,
  EndTurnSchema,
  ReconnectSchema,
  LeaveSchema,
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
  winReason: z.enum(['hp_zero', 'variable_isolation', 'force_eval_domination', 'singular_board', 'undefined_integral_loss']).nullable(),
});

export const ServerErrorSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
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
