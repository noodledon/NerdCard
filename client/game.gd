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

@onready var main_vbox: VBoxContainer = $CanvasLayer/MarginContainer/ScrollContainer/VBoxContainer

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

## Human-readable labels for the server's winReason strings (see
## GameOverSchema in server/src/shared/messages.ts).
const WIN_REASON_LABELS: Dictionary = {
	"hp_zero": "HP depleted",
	"variable_isolation": "Variable isolation",
	"force_eval_domination": "Force-eval domination",
	"singular_board": "Board destroyed",
	"undefined_integral_loss": "Undefined evaluation",
}

## Base captions for the three draw buttons — the armed deck gets a " ·1"
## suffix so a split-draw selection is visible before the second click.
const DECK_BUTTON_BASE_TEXT: Dictionary = {
	"fcc": "Draw FCC",
	"number": "Draw Number",
	"action": "Draw Action",
}

## Shared palette tokens reused by the dynamically-built construction rows.
const MATH_GREEN: Color = Color(0, 1, 0.533)
const TEXT_DIM: Color = Color(0.604, 0.604, 0.69)

## Identifier tokens that are functions/constants, not variables — used by
## _expression_variable to guess a board's variable for composition plays.
const RESERVED_EXPR_NAMES: Array = [
	"exp", "ln", "log", "log2", "log10", "sin", "cos", "tan", "cot", "sec",
	"csc", "asin", "acos", "atan", "sqrt", "abs", "min", "max", "mod",
	"pi", "e", "phi", "tau", "i",
]

var _local_role: String = ""

## Deck armed by a first draw-button click. A second click on the same deck
## draws 2 from it; a click on a different deck splits 1+1. Cleared after
## the draw_cards intent is sent and on every phase change.
var _armed_deck: String = ""

## Phase seen by the previous state_changed. Snapshots stream every 100ms,
## so _armed_deck must reset on phase changes only — not per snapshot.
var _last_phase: String = ""

## Defense banner nodes, built once in _ready (code-built like the
## construction rows — keeps game.tscn untouched).
var _defense_banner: PanelContainer
var _defense_label: Label
var _defense_pass_button: Button

## boardIds whose Build button was pressed and is awaiting a server state
## update. Cleared on every state_changed (send_intent is fire-and-forget;
## the next snapshot is the acknowledgement). Kept so a rapid double-render
## before the next snapshot does not re-enable an in-flight button.
var _pending_build_board_ids: Dictionary = {}


func _ready() -> void:
	ConnectionManager.connect("connected", Callable(self, "_on_connected"))
	ConnectionManager.connect("state_changed", Callable(self, "_on_state_changed"))
	ConnectionManager.connect("error", Callable(self, "_on_connection_error"))
	_build_defense_banner()
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
	var phase: String = String(GameModel.state.get("phase", ""))
	if phase != _last_phase:
		_armed_deck = ""
		_last_phase = phase
	_render_from_model()


func _on_connection_error(code: String, message: String) -> void:
	if code == "ERR_CONNECT_FAILED" or code == "ERR_CONNECT":
		status_label.text = "Connection failed"
	elif code == "ERR_DISCONNECTED" or code == "ROOM_FULL" or code == "SEAT_GONE":
		status_label.text = "Disconnected"
	## Server rejections (INVALID_TARGET etc.) surface here too — the dumb
	## client's only feedback channel for refused intents is the error modal.
	_show_error(code, message)


## Transient banner for server-sent errors and local routing hints
## (auto-dismissed by ErrorDismissTimer). Pass an empty code for hint text.
func _show_error(code: String, message: String) -> void:
	error_label.text = message if code == "" else "%s\n%s" % [code, message]
	error_modal.visible = true
	error_dismiss_timer.start()


func _on_error_dismiss_timeout() -> void:
	error_modal.visible = false


func _render_from_model() -> void:
	var state: Dictionary = GameModel.state
	var phase: String = String(state.get("phase", "waiting"))
	turn_phase_label.text = "Phase: %s" % PHASE_LABELS.get(phase, phase)
	turn_phase_label.add_theme_color_override("font_color", PHASE_COLORS.get(phase, PHASE_DEFAULT_COLOR))
	var turn_owner: String = String(state.get("currentTurnPlayerId", ""))
	var is_mine: bool = turn_owner != "" and turn_owner == GameModel.local_session_id
	turn_owner_label.text = "Turn: %s%s" % [turn_owner, " (you)" if is_mine else ""]

	var local_player: Dictionary = GameModel.local_player()
	var opponent_player: Dictionary = GameModel.opponent_player()
	local_panel.update_from_player(local_player, "You", "Your HP: ")
	opponent_panel.update_from_player(opponent_player, "Opponent", "Opponent HP: ")

	_prune_selections(local_player)
	_render_deck_counts(local_player)
	_rebuild_hand(local_player)
	_update_action_button_states(local_player)
	_render_construction_panel(phase, local_player)
	_render_defense_banner(phase, state)
	_render_game_over(phase, state)


## Drops selection ids whose card has left the hand (consumed by a
## server-side resolution) so a stale id never rides along on an intent.
func _prune_selections(local_player: Dictionary) -> void:
	var hand: Array = local_player.get("hand", [])
	if GameModel.selected_variable_value_card_id != "" and not _hand_has_card(hand, GameModel.selected_variable_value_card_id):
		GameModel.selected_variable_value_card_id = ""
	if GameModel.selected_factor_card_id != "" and not _hand_has_card(hand, GameModel.selected_factor_card_id):
		GameModel.selected_factor_card_id = ""


func _hand_has_card(hand: Array, card_id: String) -> bool:
	for card in hand:
		if String(card.get("id", "")) == card_id:
			return true
	return false


## First active own board — the default target for board-scoped plays and
## eval_function.
func _first_active_board_id(local_player: Dictionary) -> String:
	for board in local_player.get("boards", []):
		if bool(board.get("isActive", false)):
			return String(board.get("boardId", ""))
	return ""


## First active board holding a 2-D matrix — Transform Lens / Eigen Lance
## only affect matrix boards (anything else fizzles server-side; see
## server/src/math/linalg.ts for the detection rule this mirrors).
func _first_active_matrix_board_id(player: Dictionary) -> String:
	for board in player.get("boards", []):
		if not bool(board.get("isActive", false)):
			continue
		if String(board.get("domain", "")) == "matrix" or String(board.get("expression", "")).begins_with("matrix("):
			return String(board.get("boardId", ""))
	return ""


## Best-effort variable name for a composition play: the distinct identifier
## tokens in the expression minus RESERVED_EXPR_NAMES. v1 boards are
## single-variable almost always, so the sole hit is the right symbol; zero
## or several hits fall back to 'x' and the server still validates (an
## ambiguous outer board is rejected with 'ambiguous variable — specify one').
func _expression_variable(expression: String) -> String:
	var found: Dictionary = {}
	var regex := RegEx.new()
	regex.compile("[A-Za-z_]+")
	for m in regex.search_all(expression):
		var token: String = m.get_string()
		if not RESERVED_EXPR_NAMES.has(token):
			found[token] = true
	if found.size() == 1:
		return String(found.keys()[0])
	return "x"


## Number-deck cards (Prime/Irrational — anything carrying a numeric
## payload) arm as attack factors instead of playing directly. Anchor VVCs
## also match but are routed earlier by subtype.
func _is_number_card(card: Dictionary) -> bool:
	var subtype: String = String(card.get("subtype", ""))
	if subtype == "Prime" or subtype == "Irrational":
		return true
	return String(card.get("numericValue", "")) != "" or float(card.get("value", 0)) != 0.0


## True while the local player is the attack target of the defense phase.
## pendingAttackTargetId is authoritative; when absent (older snapshots)
## the defender is simply the player whose turn it is not.
func _is_defense_target(state: Dictionary) -> bool:
	var target_id: String = String(state.get("pendingAttackTargetId", ""))
	if target_id != "":
		return target_id == GameModel.local_session_id
	return not GameModel.is_local_turn()


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


## Builds the defense banner once — a PanelContainer with a status label
## and a Pass button — parked right under the phase row. Only visible while
## phase == "defense" (see _render_defense_banner).
func _build_defense_banner() -> void:
	_defense_banner = PanelContainer.new()
	_defense_banner.name = "DefenseBanner"
	_defense_banner.visible = false
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.137, 0.137, 0.227)
	sb.set_corner_radius_all(8)
	sb.set_border_width_all(1)
	sb.border_width_left = 4
	sb.border_color = PHASE_COLORS["defense"]
	sb.set_content_margin_all(10)
	_defense_banner.add_theme_stylebox_override("panel", sb)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_defense_banner.add_child(row)

	_defense_label = Label.new()
	_defense_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_defense_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_defense_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_defense_label.add_theme_font_size_override("font_size", 16)
	_defense_label.add_theme_color_override("font_color", PHASE_COLORS["defense"])
	row.add_child(_defense_label)

	_defense_pass_button = Button.new()
	_style_button_primary(_defense_pass_button)
	_defense_pass_button.pressed.connect(_on_defense_pass_pressed)
	row.add_child(_defense_pass_button)

	main_vbox.add_child(_defense_banner)
	main_vbox.move_child(_defense_banner, 2)


func _render_defense_banner(phase: String, state: Dictionary) -> void:
	_defense_banner.visible = phase == "defense"
	if phase != "defense":
		return

	var is_target: bool = _is_defense_target(state)
	_defense_label.text = _defense_banner_text()
	_defense_pass_button.visible = is_target
	var damage: float = float(state.get("pendingAttackDamage10", 0)) / 10.0
	_defense_pass_button.text = "Pass (take %s damage)" % str(damage)
	_defense_pass_button.disabled = bool(state.get("defenseResponseUsed", false))


func _defense_banner_text() -> String:
	var remaining: int = _deadline_seconds_left()
	if _is_defense_target(GameModel.state):
		return "INCOMING ATTACK — play a Shield/Trap or Pass (%ds)" % remaining
	return "Opponent is defending… (%ds)" % remaining


func _deadline_seconds_left() -> int:
	var deadline_ms: float = float(GameModel.state.get("turnDeadline", 0))
	var now_ms: float = Time.get_unix_time_from_system() * 1000.0
	return int(max(0.0, (deadline_ms - now_ms) / 1000.0))


## Passing on defense is just end_turn — the server treats it as declining
## to play a reactive card and applies the pending attack damage.
func _on_defense_pass_pressed() -> void:
	ConnectionManager.send_intent("end_turn", {})


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

	var reason: String = String(WIN_REASON_LABELS.get(String(state.get("winReason", "")), ""))
	if reason != "":
		game_over_detail.text += "\n%s" % reason


## Updates the construction countdown and the defense banner every frame
## while those phases are active. turnDeadline is a server Unix-ms timestamp;
## remaining seconds are derived against the local clock and floored at zero.
func _process(_delta: float) -> void:
	var phase: String = String(GameModel.state.get("phase", ""))
	if phase == "construction":
		construction_countdown.text = "%ds" % _deadline_seconds_left()
	elif phase == "defense" and _defense_label != null:
		_defense_label.text = _defense_banner_text()


func _render_deck_counts(local_player: Dictionary) -> void:
	## Preferred source is the per-player `deckCounts` object ({fcc, number,
	## action}) on the local player. Two fallbacks keep the label honest on
	## older snapshots: the state-level deckCounts map keyed
	## "<sessionId>_<deck>", then the private deck arrays (owner-visible via
	## @filter).
	var counts: Dictionary = local_player.get("deckCounts", {})
	var state_counts: Dictionary = GameModel.state.get("deckCounts", {})
	var sid: String = GameModel.local_session_id
	var fcc: int = int(counts.get("fcc", state_counts.get(sid + "_fcc", local_player.get("deckFCC", []).size())))
	var number: int = int(counts.get("number", state_counts.get(sid + "_number", local_player.get("deckNumber", []).size())))
	var action: int = int(counts.get("action", state_counts.get(sid + "_action", local_player.get("deckAction", []).size())))
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
	var can_play: bool = is_local_turn and phase == "play"
	## The defense target may only reach for reactive cards (shield/trap);
	## everyone else's hand is inert outside their own play phase.
	var defending: bool = phase == "defense" and _is_defense_target(GameModel.state)

	for card in hand:
		var card_id: String = String(card.get("id", ""))
		var button := CardButtonScript.new()
		button.name = "HandCard_%s" % card_id
		hand_vbox.add_child(button)
		button.set_card(card)
		if defending:
			var card_type: String = String(card.get("cardType", ""))
			button.disabled = not (card_type == "shield" or card_type == "trap")
		else:
			button.disabled = not can_play
		button.set_selected(
			card_id == GameModel.selected_variable_value_card_id
			or card_id == GameModel.selected_factor_card_id
			or card_id == String(local_player.get("trapCardId", ""))
		)
		button.card_clicked.connect(_on_card_clicked)


## Routes a hand-card click to the right intent by cardType/subtype — the
## client does no rule validation, it only picks the intent shape the server
## contract expects (server/src/shared/messages.ts).
func _on_card_clicked(card_id: String) -> void:
	var local_player: Dictionary = GameModel.local_player()
	var hand: Array = local_player.get("hand", [])
	var clicked_card: Dictionary = {}
	for card in hand:
		if String(card.get("id", "")) == card_id:
			clicked_card = card
			break
	if clicked_card.is_empty():
		return

	var state: Dictionary = GameModel.state
	var card_type: String = String(clicked_card.get("cardType", ""))
	var subtype: String = String(clicked_card.get("subtype", ""))

	## Defense window: only the attack target may answer, and only with a
	## reactive card (shield/trap per PlayDefenseCommand).
	if String(state.get("phase", "")) == "defense" and _is_defense_target(state):
		if card_type == "shield" or card_type == "trap":
			ConnectionManager.send_intent("play_defense", {
				"cardId": card_id,
				"targetTriggerId": String(state.get("pendingTriggerId", "")),
			})
		return

	## Variable Value Cards ("Anchor" subtype, see
	## server/src/data/card-catalog.json vvc-1..5) are selected rather than
	## played directly — they are consumed by eval_function/force_eval.
	if subtype == "Anchor":
		if GameModel.selected_variable_value_card_id == card_id:
			GameModel.selected_variable_value_card_id = ""
		else:
			GameModel.selected_variable_value_card_id = card_id
		_render_from_model()
		return

	if card_type == "forceEval":
		if GameModel.selected_variable_value_card_id == "":
			_show_error("", "Select an Anchor (value) card first")
			return
		ConnectionManager.send_intent("force_eval", {
			"variableValueCardId": GameModel.selected_variable_value_card_id,
		})
		GameModel.selected_variable_value_card_id = ""
		return

	if card_type == "offensive" or card_type == "martialTheorem":
		var opponent_id: String = String(GameModel.opponent_player().get("sessionId", ""))
		if opponent_id == "":
			_show_error("", "No opponent to target")
			return
		var payload: Dictionary = {
			"cardId": card_id,
			"target": {"kind": "opp", "id": opponent_id},
		}
		var factor_id: String = GameModel.selected_factor_card_id
		if factor_id != "" and _hand_has_card(hand, factor_id):
			payload["numberFactorCardIds"] = [factor_id]
		ConnectionManager.send_intent("play_card", payload)
		GameModel.selected_factor_card_id = ""
		return

	## Mod Cage rewrites an own board's expression — target the first active
	## own board (same shape the generic board-scoped fallthrough sends).
	if card_type == "modular":
		var mod_board_id: String = _first_active_board_id(local_player)
		var mod_target: Dictionary = {"kind": "self_board", "id": mod_board_id} if mod_board_id != "" else {"kind": "none"}
		ConnectionManager.send_intent("play_card", {
			"cardId": card_id,
			"target": mod_target,
		})
		return

	## Fermat Echo attacks the opponent's function — target their first
	## active board (opponent boards are public in snapshots).
	if card_type == "ntTheorem":
		var opp_board_id: String = _first_active_board_id(GameModel.opponent_player())
		var nt_target: Dictionary = {"kind": "opp_board", "id": opp_board_id} if opp_board_id != "" else {"kind": "none"}
		ConnectionManager.send_intent("play_card", {
			"cardId": card_id,
			"target": nt_target,
		})
		return

	## Vector Shift / Matrix Weave create a new board on the caster — the
	## server mints the board id, so no target is needed ('none').
	if card_type == "vector" or card_type == "matrix":
		ConnectionManager.send_intent("play_card", {
			"cardId": card_id,
			"target": {"kind": "none"},
		})
		return

	## Transform Lens rewrites an own matrix board to its LUP U factor —
	## prefer the first active own matrix board, else first active board.
	if card_type == "transform":
		var lens_board_id: String = _first_active_matrix_board_id(local_player)
		if lens_board_id == "":
			lens_board_id = _first_active_board_id(local_player)
		var lens_target: Dictionary = {"kind": "self_board", "id": lens_board_id} if lens_board_id != "" else {"kind": "none"}
		ConnectionManager.send_intent("play_card", {
			"cardId": card_id,
			"target": lens_target,
		})
		return

	## Eigen Lance kills a singular opponent matrix board — prefer their
	## first active matrix board, else their first active board.
	if card_type == "eigenvalue":
		var lance_board_id: String = _first_active_matrix_board_id(GameModel.opponent_player())
		if lance_board_id == "":
			lance_board_id = _first_active_board_id(GameModel.opponent_player())
		var lance_target: Dictionary = {"kind": "opp_board", "id": lance_board_id} if lance_board_id != "" else {"kind": "none"}
		ConnectionManager.send_intent("play_card", {
			"cardId": card_id,
			"target": lance_target,
		})
		return

	if card_type == "trap":
		if String(local_player.get("trapCardId", "")) != "":
			_show_error("", "Trap slot already occupied")
			return
		## `trigger` is ignored server-side (toCommandIntent drops it — the
		## server derives trap behavior from the card). Kept only because
		## SetTrapSchema still requires the field; harmless once it becomes
		## optional (wave-7 T6).
		ConnectionManager.send_intent("set_trap", {
			"cardId": card_id,
			"trigger": "on_force_eval",
		})
		return

	if card_type == "shield":
		_show_error("", "Shield is reactive — wait for defense phase")
		return

	if _is_number_card(clicked_card):
		if GameModel.selected_factor_card_id == card_id:
			GameModel.selected_factor_card_id = ""
		else:
			GameModel.selected_factor_card_id = card_id
		_render_from_model()
		return

	## The 'Eval' action card is consumed by eval_function — clicking it is
	## a shortcut for the Evaluate button once an Anchor is selected.
	if subtype == "Eval":
		if not _try_send_eval():
			_show_error("", "Needs: play phase, an active board, and a selected Anchor")
		return

	## Composition targets the first active own board (outer) and names the
	## next active own board as secondaryBoardId (inner) — v1 has no board
	## picker, so the client sends the same pair the server's auto-pick would
	## choose, plus the outer board's variable.
	if card_type == "composition":
		var outer_board_id: String = _first_active_board_id(local_player)
		if outer_board_id == "":
			_show_error("", "Needs an active board to compose onto")
			return
		var outer_expression: String = ""
		var inner_board_id: String = ""
		for board in local_player.get("boards", []):
			var bid: String = String(board.get("boardId", ""))
			if bid == outer_board_id:
				outer_expression = String(board.get("expression", ""))
			elif inner_board_id == "" and bool(board.get("isActive", false)):
				inner_board_id = bid
		var composition_payload: Dictionary = {
			"cardId": card_id,
			"target": {"kind": "self_board", "id": outer_board_id},
			"variable": _expression_variable(outer_expression),
		}
		if inner_board_id != "":
			composition_payload["secondaryBoardId"] = inner_board_id
		ConnectionManager.send_intent("play_card", composition_payload)
		return

	## Board-scoped plays (addTerm/derivative/integral/limit/composition and
	## anything unrecognized) default to the first active own board.
	var board_id: String = _first_active_board_id(local_player)
	var target: Dictionary = {"kind": "self_board", "id": board_id} if board_id != "" else {"kind": "none"}
	ConnectionManager.send_intent("play_card", {
		"cardId": card_id,
		"target": target,
	})


func _update_action_button_states(local_player: Dictionary) -> void:
	var phase: String = String(GameModel.state.get("phase", ""))
	var is_local_turn: bool = GameModel.is_local_turn()

	## During defense the turn button stays off — the defender answers via
	## the banner's Pass button (which also sends end_turn).
	end_turn_button.disabled = not is_local_turn or phase == "resolution" or phase == "defense"

	var has_active_board: bool = _first_active_board_id(local_player) != ""
	var has_eval_card: bool = false
	for card in local_player.get("hand", []):
		if String(card.get("subtype", "")) == "Eval":
			has_eval_card = true
			break

	## No `has_eval_legal` field exists anywhere on the server (schema,
	## protocol, or commands — verified via CodeGraph). The wave-5 plan
	## assumes the server sets this boolean; it does not. Compensating
	## client-side: Evaluate is visible whenever local player has an active
	## board to evaluate, matching EvalCommand's actual phase/board checks.
	## eval_function additionally consumes an 'Eval'-subtype action card, so
	## the button spells out whichever prerequisite is missing.
	## See report.md "Wave 5 inconsistencies".
	evaluate_button.visible = has_active_board
	evaluate_button.disabled = (
		not is_local_turn
		or phase != "play"
		or GameModel.selected_variable_value_card_id == ""
		or not has_eval_card
	)
	if not has_eval_card:
		evaluate_button.text = "Needs Evaluate card"
	elif GameModel.selected_variable_value_card_id == "":
		evaluate_button.text = "Select Anchor + Evaluate"
	else:
		evaluate_button.text = "Evaluate"

	var can_draw: bool = is_local_turn and phase == "draw"
	draw_fcc_button.disabled = not can_draw
	draw_number_button.disabled = not can_draw
	draw_action_button.disabled = not can_draw
	_update_draw_button_labels()


## Restores the draw-button captions, tagging the armed deck with " ·1".
func _update_draw_button_labels() -> void:
	var buttons: Dictionary = {
		"fcc": draw_fcc_button,
		"number": draw_number_button,
		"action": draw_action_button,
	}
	for deck in buttons:
		var button: Button = buttons[deck]
		button.text = String(DECK_BUTTON_BASE_TEXT[deck]) + (" ·1" if _armed_deck == deck else "")


func _on_draw_fcc_pressed() -> void:
	_send_draw("fcc")


func _on_draw_number_pressed() -> void:
	_send_draw("number")


func _on_draw_action_pressed() -> void:
	_send_draw("action")


func _send_draw(deck: String) -> void:
	## server/src/rooms/handlers.ts drawChoiceTotal() requires the sum of
	## deckChoices[].count to equal exactly 2 — draw_cards is not a
	## single-card-per-click intent. The first click only "arms" a deck; the
	## second sends — same deck draws 2, a different deck splits 1+1.
	## See report.md "Wave 5 inconsistencies".
	if _armed_deck == "":
		_armed_deck = deck
		_update_draw_button_labels()
		return
	var choices: Array
	if _armed_deck == deck:
		choices = [{"deck": deck, "count": 2}]
	else:
		choices = [{"deck": _armed_deck, "count": 1}, {"deck": deck, "count": 1}]
	_armed_deck = ""
	_update_draw_button_labels()
	ConnectionManager.send_intent("draw_cards", {
		"deckChoices": choices,
	})


func _on_end_turn_pressed() -> void:
	ConnectionManager.send_intent("end_turn", {})


## Sends eval_function against the first active board with the selected
## Anchor card. Shared by the Evaluate button and clicking the 'Eval'
## action card itself. Returns false when prerequisites are unmet.
func _try_send_eval() -> bool:
	var board_id: String = _first_active_board_id(GameModel.local_player())
	var vvc_id: String = GameModel.selected_variable_value_card_id
	if board_id == "" or vvc_id == "":
		return false
	ConnectionManager.send_intent("eval_function", {
		"boardId": board_id,
		"variableValueCardId": vvc_id,
	})
	GameModel.selected_variable_value_card_id = ""
	return true


func _on_evaluate_pressed() -> void:
	_try_send_eval()
