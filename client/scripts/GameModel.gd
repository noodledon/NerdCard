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
## The one exception is `hasEvalLegal` / `drawsThisTurn`, which the wave-5
## task file assumes exist on the wire as `has_eval_legal` /
## `draws_this_turn`. As of this Wave 5 implementation those fields do NOT
## exist anywhere in the server schema, protocol, or commands (verified via
## CodeGraph across server/src). See report.md "Wave 5 inconsistencies" for
## the client-side compensation used instead.

extends Node

## Raw mirror of the last-received state_snapshot payload's `state` field.
## Shape: { phase, currentTurnPlayerId, turnDeadline, pendingTriggerId,
##          defenseResponseUsed, forceEvalRequested, turnIndex, roundNumber,
##          winner, players: { [sessionId]: PlayerDict }, deckCounts: {...},
##          consecutive_no_eval_turns, global_no_eval_turns }
var state: Dictionary = {}

## This client's own session id, set once ConnectionManager receives
## join_ok / connected.
var local_session_id: String = ""

## Selected variable-value card id (chosen in hand before an eval_function
## or force_eval intent is sent). Cleared after an intent is sent or the
## selection is toggled off. Owned/mutated only by MainGame/CardButton flow,
## never written by ConnectionManager.
var selected_variable_value_card_id: String = ""


func reset() -> void:
	state = {}
	local_session_id = ""
	selected_variable_value_card_id = ""


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
