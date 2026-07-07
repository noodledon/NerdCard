// Pure zone-transition engine — T7.
//
// CRITICAL: ZERO imports from @colyseus/schema or colyseus.js. This mutates the
// internal LogicState (NOT Colyseus state) and fires optional callbacks. The
// callbacks are the contract boundary — T10 FSM / T14 handlers wrap them to push
// into the Colyseus @view() hand / graveyard via the T6 addToHand helper.

import type { CardData, CardMoveEvent, LogicState } from './types.js';
import { ZoneType } from './types.js';

/**
 * Locate and extract a card object from its current zone within the LogicState.
 * Returns the card (removed from the source zone) or null if not found.
 *
 * BoardEq stores FunctionBoardLogic objects keyed by boardId, not CardData, so a
 * BoardEq lookup returns null here — board lifecycle is owned by T10/T14 handlers
 * (the card is still reported via callbacks using a synthetic CardData wrapper).
 */
function extractFromZone(
  state: LogicState,
  cardId: string,
  from: ZoneType,
): CardData | null {
  switch (from) {
    case ZoneType.Hand: {
      for (const player of state.players.values()) {
        const idx = player.hand.findIndex((c) => c.id === cardId);
        if (idx !== -1) return player.hand.splice(idx, 1)[0];
      }
      return null;
    }
    case ZoneType.DeckFCC:
      return extractFromArray(state.decks.fcc, cardId);
    case ZoneType.DeckNumber:
      return extractFromArray(state.decks.number, cardId);
    case ZoneType.DeckAction:
      return extractFromArray(state.decks.action, cardId);
    case ZoneType.Graveyard:
      return extractFromArray(state.graveyard, cardId);
    default:
      // BoardEq / Active / Held placement is owned by callers via callbacks.
      return null;
  }
}

function extractFromArray(arr: CardData[], cardId: string): CardData | null {
  const idx = arr.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  return arr.splice(idx, 1)[0];
}

function placeInZone(state: LogicState, card: CardData, to: ZoneType): void {
  switch (to) {
    case ZoneType.DeckFCC:
      state.decks.fcc.push(card);
      break;
    case ZoneType.DeckNumber:
      state.decks.number.push(card);
      break;
    case ZoneType.DeckAction:
      state.decks.action.push(card);
      break;
    case ZoneType.Graveyard:
      state.graveyard.push(card);
      break;
    // Hand / BoardEq / Active / Held placement is owned by callers via callbacks.
    default:
      break;
  }
}

/**
 * Move a card between zones within the pure LogicState.
 *
 * Mutates the internal LogicState (deck / hand / graveyard arrays) and invokes the
 * optional callbacks onCardRemovedFromZone (from) then onCardAddedToZone (to) in
 * that order. The callbacks are the contract boundary — callers (T10 FSM, T14
 * handlers) wrap them to push into the Colyseus @view() hand / graveyard.
 */
export function moveCard(
  state: LogicState,
  cardId: string,
  from: ZoneType,
  to: ZoneType,
  ownerSessionId?: string,
): CardMoveEvent {
  // Determine owner: search players' hands and boards for the card by id.
  // Fall back to an explicitly provided ownerSessionId, then to empty string.
  let ownerId = ownerSessionId;
  if (!ownerId) {
    for (const player of state.players.values()) {
      const inHand = player.hand.some((c) => c.id === cardId);
      const inBoards = player.boards.some((b) => b.boardId === cardId);
      if (inHand || inBoards) {
        ownerId = player.sessionId;
        break;
      }
    }
  }
  if (!ownerId) {
    ownerId = '';
  }

  // Mutate the LogicState: remove from source zone if it lives in a plain array.
  const movedCard = extractFromZone(state, cardId, from);
  const cardForCallbacks: CardData = movedCard ?? ({ id: cardId } as CardData);

  if (from !== to) {
    placeInZone(state, cardForCallbacks, to);
  }

  // Fire callbacks in order: removed-from (from) then added-to (to).
  if (state.callbacks?.onCardRemovedFromZone) {
    state.callbacks.onCardRemovedFromZone(cardForCallbacks, from, ownerId);
  }
  if (state.callbacks?.onCardAddedToZone) {
    state.callbacks.onCardAddedToZone(cardForCallbacks, to, ownerId);
  }

  return {
    cardId,
    from,
    to,
    ownerSessionId: ownerId,
    timestamp: Date.now(),
  };
}
