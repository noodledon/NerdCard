## Game — main scene controller (T18/T19/T20 wiring).
##
## Wires the EXISTING UI (game.tscn: two PlayerPanel instances, HandVBox,
## DeckButtons, ActionButtons, PhaseTurnRow, ErrorModal) to the EXISTING
## autoloads/scripts (ConnectionManager, GameModel, PlayerPanel.gd,
## CardButton.gd). This script does not alter PlayerPanel.tscn structure,
## rename any existing node, or introduce an alternate UI layout.
##
## Render rule: every `.text` / `.visible` / `.disabled` value here is
## derived from GameModel.state (itself populated only by
## ConnectionManager on state_changed). No optimistic mutation of
## GameModel happens anywhere in this file.

extends Node2D

@onready var ip_line_edit: LineEdit = $CanvasLayer/MarginContainer/VBoxContainer/ConnectRow/IpLineEdit
@onready var connect_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/ConnectRow/ConnectButton
@onready var status_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/ConnectRow/StatusLabel

@onready var turn_phase_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/PhaseTurnRow/TurnPhaseLabel
@onready var turn_owner_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/PhaseTurnRow/TurnOwnerLabel

@onready var opponent_panel: PlayerPanel = $CanvasLayer/MarginContainer/VBoxContainer/OpponentPanel
@onready var local_panel: PlayerPanel = $CanvasLayer/MarginContainer/VBoxContainer/LocalPanel

@onready var hand_vbox: HBoxContainer = $CanvasLayer/MarginContainer/VBoxContainer/HandVBox

@onready var draw_fcc_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/DeckButtons/DrawFCCButton
@onready var draw_number_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/DeckButtons/DrawNumberButton
@onready var draw_action_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/DeckButtons/DrawActionButton
@onready var deck_count_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/DeckButtons/DeckCountLabel

@onready var end_turn_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/ActionButtons/EndTurnButton
@onready var evaluate_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/ActionButtons/EvaluateButton

@onready var error_modal: Panel = $CanvasLayer/MarginContainer/VBoxContainer/ErrorModal
@onready var error_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/ErrorModal/ErrorLabel
@onready var error_dismiss_timer: Timer = $CanvasLayer/MarginContainer/VBoxContainer/ErrorModal/ErrorDismissTimer

const CardButtonScript = preload("res://scripts/CardButton.gd")

var _local_role: String = ""


func _ready() -> void:
	ConnectionManager.connect("connected", Callable(self, "_on_connected"))
	ConnectionManager.connect("state_changed", Callable(self, "_on_state_changed"))
	ConnectionManager.connect("error", Callable(self, "_on_connection_error"))
	_render_from_model()


func _on_connect_button_pressed() -> void:
	status_label.text = "Connecting..."
	ConnectionManager.connect_to_server(ip_line_edit.text)


func _on_connected(role: String) -> void:
	_local_role = role
	status_label.text = "Connected as %s" % role


func _on_state_changed(_snapshot: Dictionary) -> void:
	_render_from_model()


func _on_connection_error(code: String, message: String) -> void:
	if code == "ERR_CONNECT_FAILED" or code == "ERR_CONNECT":
		status_label.text = "Connection failed"
	error_label.text = "%s\n%s" % [code, message]
	error_modal.visible = true
	error_dismiss_timer.start()


func _on_error_dismiss_timeout() -> void:
	error_modal.visible = false


func _render_from_model() -> void:
	var state: Dictionary = GameModel.state
	turn_phase_label.text = "Phase: %s" % String(state.get("phase", "waiting"))
	turn_owner_label.text = "Turn: %s" % String(state.get("currentTurnPlayerId", ""))

	var local_player: Dictionary = GameModel.local_player()
	var opponent_player: Dictionary = GameModel.opponent_player()
	local_panel.update_from_player(local_player, "You")
	opponent_panel.update_from_player(opponent_player, "Opponent")

	_render_deck_counts(local_player)
	_rebuild_hand(local_player)
	_update_action_button_states(local_player)


func _render_deck_counts(local_player: Dictionary) -> void:
	## `state.deckCounts` (server/src/state/schema.ts GameRoomState.deckCounts)
	## is a public MapSchema<number> intended as the deck-size mirror, but no
	## server command populates it yet (verified via CodeGraph: only
	## schema.test.ts writes to it). Fall back to the local player's own
	## private deck arrays, which ARE visible to the owning client via
	## @filter(). See report.md "Wave 5 inconsistencies".
	var deck_counts: Dictionary = GameModel.state.get("deckCounts", {})
	var fcc: int = int(deck_counts.get("fcc", local_player.get("deckFCC", []).size()))
	var number: int = int(deck_counts.get("number", local_player.get("deckNumber", []).size()))
	var action: int = int(deck_counts.get("action", local_player.get("deckAction", []).size()))
	deck_count_label.text = "FCC: %d | Num: %d | Act: %d" % [fcc, number, action]


func _rebuild_hand(local_player: Dictionary) -> void:
	for child in hand_vbox.get_children():
		child.queue_free()

	var hand: Array = local_player.get("hand", [])
	var is_local_turn: bool = GameModel.is_local_turn()
	var phase: String = String(GameModel.state.get("phase", ""))

	for card in hand:
		var button := CardButtonScript.new()
		hand_vbox.add_child(button)
		button.set_card(card)
		button.disabled = not (is_local_turn and phase == "play")
		button.card_clicked.connect(_on_card_clicked)


func _on_card_clicked(card_id: String) -> void:
	var local_player: Dictionary = GameModel.local_player()
	var hand: Array = local_player.get("hand", [])
	var clicked_card: Dictionary = {}
	for card in hand:
		if String(card.get("id", "")) == card_id:
			clicked_card = card
			break

	## Variable Value Cards ("Anchor" subtype, see
	## server/src/data/card-catalog.json vvc-1..5) are selected rather than
	## played directly — they are consumed by eval_function/force_eval.
	if String(clicked_card.get("subtype", "")) == "Anchor":
		GameModel.selected_variable_value_card_id = card_id
		_update_action_button_states(local_player)
		return

	ConnectionManager.send_intent("play_card", {
		"cardId": card_id,
		"target": {"kind": "none"},
	})


func _update_action_button_states(local_player: Dictionary) -> void:
	var phase: String = String(GameModel.state.get("phase", ""))
	var is_local_turn: bool = GameModel.is_local_turn()

	end_turn_button.disabled = not is_local_turn or phase == "resolution"

	var boards: Array = local_player.get("boards", [])
	var has_active_board: bool = false
	for board in boards:
		if bool(board.get("isActive", false)):
			has_active_board = true
			break

	## No `has_eval_legal` field exists anywhere on the server (schema,
	## protocol, or commands — verified via CodeGraph). The wave-5 plan
	## assumes the server sets this boolean; it does not. Compensating
	## client-side: Evaluate is visible whenever local player has an active
	## board to evaluate, matching EvalCommand's actual phase/board checks.
	## See report.md "Wave 5 inconsistencies".
	evaluate_button.visible = has_active_board
	evaluate_button.disabled = (
		not is_local_turn
		or phase != "play"
		or GameModel.selected_variable_value_card_id == ""
	)

	var can_draw: bool = is_local_turn and phase == "draw"
	draw_fcc_button.disabled = not can_draw
	draw_number_button.disabled = not can_draw
	draw_action_button.disabled = not can_draw


func _on_draw_fcc_pressed() -> void:
	_send_draw("fcc")


func _on_draw_number_pressed() -> void:
	_send_draw("number")


func _on_draw_action_pressed() -> void:
	_send_draw("action")


func _send_draw(deck: String) -> void:
	## server/src/rooms/handlers.ts drawChoiceTotal() requires the sum of
	## deckChoices[].count to equal exactly 2 — draw_cards is not a
	## single-card-per-click intent. See report.md "Wave 5 inconsistencies"
	## (the wave-5 plan's intent table assumed a 1-card {deckType} payload).
	ConnectionManager.send_intent("draw_cards", {
		"deckChoices": [{"deck": deck, "count": 2}],
	})


func _on_end_turn_pressed() -> void:
	ConnectionManager.send_intent("end_turn", {})


func _on_evaluate_pressed() -> void:
	var local_player: Dictionary = GameModel.local_player()
	var boards: Array = local_player.get("boards", [])
	var board_id: String = ""
	for board in boards:
		if bool(board.get("isActive", false)):
			board_id = String(board.get("boardId", ""))
			break
	if board_id == "" or GameModel.selected_variable_value_card_id == "":
		return

	ConnectionManager.send_intent("eval_function", {
		"boardId": board_id,
		"variableValueCardId": GameModel.selected_variable_value_card_id,
	})
	GameModel.selected_variable_value_card_id = ""
