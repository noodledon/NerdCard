## GameModel — autoload singleton.
##
## Plain-Dictionary mirror of the server's GameRoomState (see
## server/src/state/schema.ts). Populated ONLY by
## ConnectionManager._on_state_change(); every other script treats this as
## read-only.
##
## Field names below mirror the server schema exactly (camelCase, matching
## the @type() property names) so downstream code can do:
##   GameModel.state.players["p1"].hp10
##   GameModel.state.phase
##
## Wave-10 T6 added server-computed advisory flags on the local player's own
## snapshot entry: `evalLegal` (own play turn + live board + Anchor + Eval
## card held) and `drawsRemaining` (2 during the own draw step, else 0). They
## gate UI buttons only — the server still validates every intent — and are
## never present on the opponent's entry (they encode private hand contents).

extends Node

## Raw mirror of the last-received state_snapshot payload's `state` field.
## Shape: { phase, currentTurnPlayerId, turnDeadline, pendingTriggerId,
##          defenseResponseUsed, forceEvalRequested, turnIndex, roundNumber,
##          winner, players: { [sessionId]: PlayerDict }, deckCounts: {...},
##          consecutive_no_eval_turns, global_no_eval_turns }
var state: Dictionary = {}

## This client's own session id, set by ConnectionManager on "joined".
## Survives a transient disconnect so a rejoin can reclaim the seat
## (wave-7 T5); cleared only here in reset() — called on a fresh seat —
## or when a reclaim is rejected with ROOM_FULL.
var local_session_id: String = ""

## Seat-ownership proof issued inside "joined" (wave-10 T3). The bridge
## requires sessionId + reconnectToken together to reclaim a disconnected
## seat — sessionIds alone are sequential and guessable. Same lifecycle as
## local_session_id.
var local_reconnect_token: String = ""

## Selected variable-value card id (chosen in hand before an eval_function
## or force_eval intent is sent). Cleared after an intent is sent or the
## selection is toggled off. Owned/mutated only by MainGame/CardButton flow,
## never written by ConnectionManager.
var selected_variable_value_card_id: String = ""

## Selected number-factor card id (Prime/Irrational hand cards bound into an
## offensive play_card as numberFactorCardIds). Same ownership/lifecycle as
## selected_variable_value_card_id.
var selected_factor_card_id: String = ""


func reset() -> void:
	state = {}
	local_session_id = ""
	local_reconnect_token = ""
	selected_variable_value_card_id = ""
	selected_factor_card_id = ""


func local_player() -> Dictionary:
	var players: Dictionary = state.get("players", {})
	return players.get(local_session_id, {})


func opponent_player() -> Dictionary:
	var players: Dictionary = state.get("players", {})
	for session_id in players.keys():
		if session_id != local_session_id:
			return players[session_id]
	return {}


func is_local_turn() -> bool:
	return state.get("currentTurnPlayerId", "") == local_session_id and local_session_id != ""
