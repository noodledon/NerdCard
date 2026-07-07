// Pure game-logic types — T7.
//
// CRITICAL: This module (and everything in src/logic/*) MUST NOT import from
// @colyseus/schema or colyseus.js. It is the pure, unit-testable engine layer.
// Callers (T10 FSM, T14 handlers) wrap the zone-move callbacks to push into the
// Colyseus @view() hand / graveyard via the T6 addToHand helper.
//
// Expression fields are plain strings only (never math.Node) — parsing belongs
// to the T8/T9 math layer.

import type { BaseDomain, DeckType, CardType } from '../shared/types.js';

export type { BaseDomain, DeckType, CardType } from '../shared/types.js';

/**
 * Zones a card can live in within the pure LogicState.
 * Hand / BoardEq / Active / Held are per-player; Deck* and Graveyard are global.
 */
export enum ZoneType {
  Hand = 'Hand',
  BoardEq = 'BoardEq',
  Graveyard = 'Graveyard',
  DeckFCC = 'DeckFCC',
  DeckNumber = 'DeckNumber',
  DeckAction = 'DeckAction',
  Active = 'Active',
  Held = 'Held',
}

/**
 * Card data currency for the pure logic layer. Field names intentionally mirror
 * CardSchema (T6) so T14 handlers can map CardData <-> CardSchema 1:1.
 * `cardType` is the effect identifier string (e.g. "addTerm", "offensive");
 * it is intentionally typed as string (CardSchema stores it as @type("string")).
 */
export interface CardData {
  id: string;
  deckType: DeckType;
  cardType: string;
  domain: BaseDomain;
  numericValue?: string; // For Number cards: "pi", "sqrt(2)", "2"
  expressionPayload?: string; // FCC builder expression as math.js string
  usableOncePerConstruction?: boolean; // For variable cards
  isFlipped?: boolean; // Graveyard front/back
}

export interface FunctionBoardLogic {
  boardId: string;
  ownerSessionId: string;
  expression: string; // math.js node.toString() — e.g. "x^2 + 3*x"
  domain: BaseDomain;
  compositionDepth: number; // 0, 1, or 2
  dimension: number; // 0 for scalar; rank for matrix/vector
  isSingular: boolean;
  isActive: boolean;
}

export interface PlayerLogic {
  sessionId: string;
  displayName: string;
  hp10: number; // HP stored as 10x base
  isConnected: boolean;
  hand: CardData[];
  boards: FunctionBoardLogic[];
  availableVariables: string[]; // x1..x10
  variableUsagesLeft: number;
  baseFunctionUnlocked: boolean;
  hasUsedVariableThisConstruction: boolean;
  // Public mirrors (opponents derive info from these):
  handCount: number;
  boardCount: number;
}

export interface LogicState {
  players: Map<string, PlayerLogic>;
  decks: {
    fcc: CardData[];
    number: CardData[];
    action: CardData[];
  };
  graveyard: CardData[];
  callbacks: {
    onCardAddedToZone?: (
      card: CardData,
      to: ZoneType,
      ownerSessionId: string,
    ) => void;
    onCardRemovedFromZone?: (
      card: CardData,
      from: ZoneType,
      ownerSessionId: string,
    ) => void;
  };
}

export interface CardMoveEvent {
  cardId: string;
  from: ZoneType;
  to: ZoneType;
  ownerSessionId: string;
  timestamp: number;
}
