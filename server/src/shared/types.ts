// CRITICAL CONSTRAINT: math.js Node objects NEVER live in Colyseus Schema.
// Board.expression is @type("string") only — server parses via math.parse(str) on demand.
// See drafts/nerdicard-backend.md:129-130.

export const CardType = ['fcc', 'number', 'action'] as const;
export type CardType = (typeof CardType)[number];

export const DeckType = ['fcc', 'number', 'action'] as const;
export type DeckType = (typeof DeckType)[number];

export const BaseDomain = ['rational', 'poly', 'trig', 'exp', 'log'] as const;
export type BaseDomain = (typeof BaseDomain)[number];

export const Phase = ['waiting', 'draw', 'play', 'defense', 'resolution', 'game_over'] as const;
export type Phase = (typeof Phase)[number];

export const Rarity = ['common', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof Rarity)[number];

export const EffectType = [
  'add_term',
  'derivative',
  'integral',
  'limit',
  'continuity',
  'modular',
  'prime',
  'nt_theorem',
  'vector',
  'matrix',
  'transform',
  'eigenvalue',
  'offensive',
  'shield',
  'trap',
  'martial_theorem',
  'artifact_theorem',
  'add_board',
  'composition',
  'force_eval',
  'eval',
] as const;
export type EffectType = (typeof EffectType)[number];

export interface TargetRules {
  scope: 'self' | 'opp' | 'self_board' | 'opp_board' | 'global';
  requires: string[];
}

export interface Card {
  id: string;
  name: string;
  type: CardType;
  deck: DeckType;
  subtype: string;
  rarity: Rarity;
  effectType: EffectType;
  effectParams: Record<string, unknown>;
  targetRules: TargetRules;
}

export interface Board {
  id: string;
  ownerId: string;
  expression: string;
  domains: BaseDomain[];
  compositionDepth: number;
  isolatedVarCount: number;
  integral: boolean;
}

export interface EffectPayload {
  kind: EffectType;
}

export type WinReason = 'hp_zero' | 'variable_isolation' | 'force_eval_domination' | 'singular_board' | 'undefined_integral_loss';

export interface PlayerState {
  id: string;
  hp10: number;
  hand: Card[];
  boards: Board[];
  deckCounts: Record<DeckType, number>;
  variableCardsUsed: Set<number>;
}

export interface GameRoomState {
  phase: Phase;
  currentTurn: number;
  consecutive_no_eval_turns: number;
  global_no_eval_turns: number;
  variable_isolation_timers: Record<string, number>;
  players: Record<string, PlayerState>;
  winnerId: string | null;
  winReason: WinReason | null;
}
