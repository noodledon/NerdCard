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

@onready var ip_line_edit: LineEdit = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConnectRow/IpLineEdit
@onready var connect_button: Button = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConnectRow/ConnectButton
@onready var status_label: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConnectRow/StatusLabel

@onready var turn_phase_label: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/PhaseTurnRow/TurnPhaseLabel
@onready var turn_owner_label: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/PhaseTurnRow/TurnOwnerLabel

@onready var construction_panel: PanelContainer = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConstructionPanel
@onready var construction_countdown: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConstructionPanel/ConstructionInner/ConstructionCountdown
@onready var construction_empty: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConstructionPanel/ConstructionInner/ConstructionEmpty
@onready var board_list_vbox: VBoxContainer = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ConstructionPanel/ConstructionInner/BoardListVBox

@onready var game_over_overlay: ColorRect = $CanvasLayer/GameOverOverlay
@onready var game_over_result: Label = $CanvasLayer/GameOverOverlay/GameOverCenter/GameOverBox/GameOverVBox/GameOverResult
@onready var game_over_detail: Label = $CanvasLayer/GameOverOverlay/GameOverCenter/GameOverBox/GameOverVBox/GameOverDetail

@onready var opponent_panel: PlayerPanel = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/OpponentPanel
@onready var local_panel: PlayerPanel = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/LocalPanel

@onready var hand_vbox: HBoxContainer = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/HandVBox

@onready var draw_fcc_button: Button = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/DeckButtons/DrawFCCButton
@onready var draw_number_button: Button = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/DeckButtons/DrawNumberButton
@onready var draw_action_button: Button = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/DeckButtons/DrawActionButton
@onready var deck_count_label: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/DeckButtons/DeckCountLabel

@onready var end_turn_button: Button = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ActionButtons/EndTurnButton
@onready var evaluate_button: Button = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ActionButtons/EvaluateButton

@onready var error_modal: Panel = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ErrorModal
@onready var error_label: Label = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ErrorModal/ErrorLabel
@onready var error_dismiss_timer: Timer = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer/ErrorModal/ErrorDismissTimer

const CardButtonScript = preload("res://scripts/CardButton.gd")

## Friendly display text for each server phase string. Keys are the exact
## lowercase phase strings emitted by the server FSM.
const PHASE_LABELS: Dictionary = {
	"waiting": "Waiting for opponent...",
	"construction": "Construction (build your function)",
	"draw": "Draw Phase",
	"play": "Play Phase",
	"defense": "Defense Phase",
	"resolution": "Resolution",
	"gameOver": "Game Over",
}

## Max expression length accepted by the server (BuildFunctionSchema).
const MAX_EXPRESSION_LEN: int = 500

## Dark-chalkboard accent per phase — tints the phase banner so the current
## phase is legible at a glance (see nerdcard-ui-theme memory). Keys match the
## server FSM phase strings exactly.
const PHASE_COLORS: Dictionary = {
	"waiting": Color(0.4, 0.467, 0.533),
	"construction": Color(1, 0.667, 0.133),
	"draw": Color(0.267, 0.533, 1),
	"play": Color(0.133, 0.8, 0.4),
	"defense": Color(1, 0.533, 0.267),
	"resolution": Color(0.627, 0.4, 1),
	"gameOver": Color(1, 0.2, 0.267),
}
const PHASE_DEFAULT_COLOR: Color = Color(0.878, 0.878, 0.878)

## Shared palette tokens reused by the dynamically-built construction rows.
const MATH_GREEN: Color = Color(0, 1, 0.533)
const TEXT_DIM: Color = Color(0.604, 0.604, 0.69)

var _local_role: String = ""

## boardIds whose Build button was pressed and is awaiting a server state
## update. Cleared on every state_changed (send_intent is fire-and-forget;
## the next snapshot is the acknowledgement). Kept so a rapid double-render
## before the next snapshot does not re-enable an in-flight button.
var _pending_build_board_ids: Dictionary = {}


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
	## A fresh snapshot is the server's acknowledgement of any in-flight
	## build_function intent, so Build buttons re-enable here (see the
	## rebuild in _render_construction_panel).
	_pending_build_board_ids.clear()
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
	var phase: String = String(state.get("phase", "waiting"))
	turn_phase_label.text = "Phase: %s" % PHASE_LABELS.get(phase, phase)
	turn_phase_label.add_theme_color_override("font_color", PHASE_COLORS.get(phase, PHASE_DEFAULT_COLOR))
	turn_owner_label.text = "Turn: %s" % String(state.get("currentTurnPlayerId", ""))

	var local_player: Dictionary = GameModel.local_player()
	var opponent_player: Dictionary = GameModel.opponent_player()
	local_panel.update_from_player(local_player, "You", "Your HP: ")
	opponent_panel.update_from_player(opponent_player, "Opponent", "Opponent HP: ")

	_render_deck_counts(local_player)
	_rebuild_hand(local_player)
	_update_action_button_states(local_player)
	_render_construction_panel(phase, local_player)
	_render_game_over(phase, state)


## Rebuilds the construction UI from scratch on every render (mirroring the
## hand rebuild). Rows are only present while phase == "construction"; in any
## other phase the whole panel is hidden and its children are cleared so no
## stale LineEdit text survives into the next construction window.
## Uses reconciliation to preserve LineEdit nodes across snapshots.
var _board_row_cache: Dictionary = {}  # boardId -> HBoxContainer

func _render_construction_panel(phase: String, local_player: Dictionary) -> void:
	var is_construction: bool = phase == "construction"
	construction_panel.visible = is_construction

	# Clear everything when leaving construction phase
	if not is_construction:
		for child in board_list_vbox.get_children():
			child.queue_free()
		_board_row_cache.clear()
		return

	# Clear cache and free rows for boards that disappeared
	var current_board_ids = []
	for board in local_player.get("boards", []):
		current_board_ids.append(String(board.get("boardId", "")))
	
	for board_id in _board_row_cache.keys():
		if not current_board_ids.has(board_id):
			var row = _board_row_cache[board_id]
			if is_instance_valid(row):
				row.queue_free()
			_board_row_cache.erase(board_id)

	var boards: Array = local_player.get("boards", [])
	construction_empty.visible = boards.is_empty()

	# Reconcile: reuse existing rows, create new ones only for new board IDs
	for board in boards:
		var board_id: String = String(board.get("boardId", ""))
		var expression: String = String(board.get("expression", ""))
		
		if _board_row_cache.has(board_id):
			# Reuse existing row - just update the expression label
			var row = _board_row_cache[board_id]
			if is_instance_valid(row):
				var expr_label = row.get_child(1) as Label  # expr_label is at index 1
				if expr_label:
					expr_label.text = expression if expression != "" else "— none —"
			else:
				# Row exists in cache but is invalid, recreate it
				row.queue_free()
				_board_row_cache.erase(board_id)
				var new_row = _make_board_row(board_id, expression)
				board_list_vbox.add_child(new_row)
				_board_row_cache[board_id] = new_row
		else:
			# New board ID, create a new row
			var new_row = _make_board_row(board_id, expression)
			board_list_vbox.add_child(new_row)
			_board_row_cache[board_id] = new_row



## Builds one construction row: short board id, current expression, an entry
## field, and a Build button. The Build button starts disabled if this board
## already has an intent in flight (see _pending_build_board_ids).
func _make_board_row(board_id: String, expression: String) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 8)

	var id_label := Label.new()
	id_label.text = board_id.substr(0, 8) if board_id != "" else "(no id)"
	id_label.add_theme_color_override("font_color", TEXT_DIM)
	id_label.add_theme_font_size_override("font_size", 12)
	row.add_child(id_label)

	var expr_label := Label.new()
	expr_label.text = expression if expression != "" else "— none —"
	expr_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	expr_label.add_theme_font_override("font", _mono_font())
	expr_label.add_theme_color_override("font_color", MATH_GREEN)
	row.add_child(expr_label)

	var entry := LineEdit.new()
	entry.placeholder_text = "e.g. x^2 + 1"
	entry.text = expression
	entry.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	entry.custom_minimum_size = Vector2(220, 0)
	entry.add_theme_stylebox_override("normal", _entry_stylebox())
	entry.add_theme_color_override("font_color", Color(0.878, 0.878, 0.878))
	row.add_child(entry)

	var build_button := Button.new()
	build_button.text = "Build"
	build_button.disabled = _pending_build_board_ids.has(board_id)
	_style_button_primary(build_button)
	build_button.pressed.connect(_on_build_pressed.bind(board_id, entry, build_button))
	row.add_child(build_button)

	return row


## Lazily-built shared monospace font for construction-row expression readouts.
var _mono_font_cache: SystemFont
func _mono_font() -> SystemFont:
	if _mono_font_cache == null:
		_mono_font_cache = SystemFont.new()
		_mono_font_cache.font_names = PackedStringArray(["JetBrains Mono", "Menlo", "Consolas", "monospace"])
	return _mono_font_cache


## A dark inset field style matching the "calculator display" look elsewhere.
func _entry_stylebox() -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.078, 0.078, 0.133)
	sb.set_corner_radius_all(4)
	sb.set_border_width_all(1)
	sb.border_color = Color(0.227, 0.227, 0.361)
	sb.content_margin_left = 8
	sb.content_margin_right = 8
	sb.content_margin_top = 4
	sb.content_margin_bottom = 4
	return sb


## Filled green primary-button styling with hover/pressed/disabled states.
## Applied to dynamically-created Build buttons so they match the static
## primary actions defined in game.tscn.
func _style_button_primary(btn: Button) -> void:
	btn.custom_minimum_size = Vector2(90, 36)
	btn.add_theme_color_override("font_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_hover_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_pressed_color", Color(1, 1, 1))
	btn.add_theme_color_override("font_disabled_color", Color(0.5, 0.5, 0.6))
	btn.add_theme_stylebox_override("normal", _button_fill(Color(0.133, 0.8, 0.4)))
	btn.add_theme_stylebox_override("hover", _button_fill(Color(0.196, 0.86, 0.463)))
	btn.add_theme_stylebox_override("pressed", _button_fill(Color(0.098, 0.6, 0.302)))
	btn.add_theme_stylebox_override("focus", _button_fill(Color(0.133, 0.8, 0.4)))
	btn.add_theme_stylebox_override("disabled", _button_fill(Color(0.176, 0.176, 0.235, 0.4)))


func _button_fill(bg: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(6)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	return sb


func _on_build_pressed(board_id: String, entry: LineEdit, build_button: Button) -> void:
	var expr: String = entry.text.strip_edges()
	if expr == "" or expr.length() > MAX_EXPRESSION_LEN:
		return

	## Disable immediately; re-enabled by the next state_changed (send_intent
	## is fire-and-forget with no per-intent callback).
	build_button.disabled = true
	_pending_build_board_ids[board_id] = true
	ConnectionManager.send_intent("build_function", {
		"boardId": board_id,
		"expression": expr,
	})


## Full-screen modal shown only in the gameOver phase. Compares the winning
## sessionId against this client's own to pick the outcome text.
func _render_game_over(phase: String, state: Dictionary) -> void:
	var is_over: bool = phase == "gameOver"
	game_over_overlay.visible = is_over
	if not is_over:
		return

	var winner: Variant = state.get("winner", null)
	var winner_id: String = String(winner) if winner != null else ""
	if winner_id == "":
		game_over_result.text = "Draw"
		game_over_detail.text = "No winner this match."
	elif winner_id == GameModel.local_session_id:
		game_over_result.text = "You Win!"
		game_over_detail.text = "You defeated your opponent."
	else:
		game_over_result.text = "You Lose"
		game_over_detail.text = "Your opponent won this match."


## Updates the construction countdown every frame while that phase is active.
## turnDeadline is a server Unix-ms timestamp; remaining seconds are derived
## against the local clock and floored at zero.
func _process(_delta: float) -> void:
	if String(GameModel.state.get("phase", "")) != "construction":
		return
	var deadline_ms: float = float(GameModel.state.get("turnDeadline", 0))
	var now_ms: float = Time.get_unix_time_from_system() * 1000.0
	var remaining: int = int(max(0.0, (deadline_ms - now_ms) / 1000.0))
	construction_countdown.text = "%ds" % remaining


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
		# Remove immediately before queueing deletion so a same-frame rebuild can
		# reuse the stable node names below without Godot appending @Button@NNN.
		hand_vbox.remove_child(child)
		child.queue_free()

	var hand: Array = local_player.get("hand", [])
	var is_local_turn: bool = GameModel.is_local_turn()
	var phase: String = String(GameModel.state.get("phase", ""))

	for card in hand:
		var card_id: String = String(card.get("id", ""))
		var button := CardButtonScript.new()
		button.name = "HandCard_%s" % card_id
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
