## PlayerPanel — reusable player board display (T19).
##
## Pure render component: every `.text` value written here originates from
## a player Dictionary handed in via update_from_player(). No node is
## created or destroyed by this script (function slots are static children
## at a fixed count of 3, matching PlayerSchema.boards being read positionally).

extends VBoxContainer
class_name PlayerPanel

@onready var card_panel: PanelContainer = $Card
@onready var name_label: Label = $Card/CardInner/NameLabel
@onready var hp_bar: ProgressBar = $Card/CardInner/HPBar
@onready var hp_label: Label = $Card/CardInner/HPLabel
@onready var trap_slot_indicator: Label = $Card/CardInner/TrapSlotIndicator
@onready var function_board_panel: VBoxContainer = $Card/CardInner/FunctionBoardPanel

const FUNCTION_SLOT_COUNT: int = 3

## Dark-chalkboard palette (see nerdcard-ui-theme memory).
const PANEL_BG: Color = Color(0.137, 0.137, 0.227)
const BORDER: Color = Color(0.227, 0.227, 0.361)
const TEXT: Color = Color(0.878, 0.878, 0.878)
const TEXT_DIM: Color = Color(0.604, 0.604, 0.69)
const MATH_GREEN: Color = Color(0, 1, 0.533)
const HP_GREEN: Color = Color(0.133, 0.8, 0.4)
const HP_LOW_RED: Color = Color(1, 0.2, 0.267)
const DOMAIN_BLUE: Color = Color(0.267, 0.533, 1)
const DEPTH_PURPLE: Color = Color(0.627, 0.4, 1)
const TRAP_ORANGE: Color = Color(1, 0.533, 0.267)
const EXPR_DISPLAY_BG: Color = Color(0.078, 0.078, 0.133)

## HP has no fixed max on the server (starts at 0, is gained). This is a soft
## visual reference cap for the bar fill only — see the memory note.
const HP_BAR_REFERENCE_MAX: float = 200.0

## HP at or below this hp10 value (20.0 HP) renders in red as a low-HP warning.
const LOW_HP10_THRESHOLD: int = 200
const LOW_HP_COLOR: Color = Color(0.9, 0.2, 0.2)
const NORMAL_HP_COLOR: Color = Color(1, 1, 1)

## Shared monospace font for the "calculator display" expression labels.
var _mono_font: SystemFont


func _ready() -> void:
	_apply_static_style()
	_render_empty()


## One-time theming of the static tree: the card frame with a left accent
## stripe, typography, the HP bar fill, and per-slot expression/badge styling.
func _apply_static_style() -> void:
	_mono_font = SystemFont.new()
	_mono_font.font_names = PackedStringArray(["JetBrains Mono", "Menlo", "Consolas", "monospace"])

	var frame := StyleBoxFlat.new()
	frame.bg_color = PANEL_BG
	frame.set_corner_radius_all(8)
	frame.set_border_width_all(1)
	frame.border_width_left = 4
	frame.border_color = MATH_GREEN
	frame.set_content_margin_all(10)
	card_panel.add_theme_stylebox_override("panel", frame)

	name_label.add_theme_font_size_override("font_size", 20)
	name_label.add_theme_color_override("font_color", TEXT)

	hp_label.add_theme_font_size_override("font_size", 18)

	_style_hp_bar(HP_GREEN)

	trap_slot_indicator.add_theme_font_size_override("font_size", 13)

	for index in range(FUNCTION_SLOT_COUNT):
		var slot: HBoxContainer = function_board_panel.get_child(index)
		var expr_label: Label = slot.get_node("ExprLabel")
		var domain_badge: Label = slot.get_node("DomainBadge")
		var depth_badge: Label = slot.get_node("DepthBadge")

		expr_label.add_theme_font_override("font", _mono_font)
		expr_label.add_theme_font_size_override("font_size", 16)
		expr_label.add_theme_color_override("font_color", MATH_GREEN)
		expr_label.clip_text = true
		var display := StyleBoxFlat.new()
		display.bg_color = EXPR_DISPLAY_BG
		display.set_corner_radius_all(4)
		display.set_content_margin_all(6)
		display.content_margin_left = 8
		display.content_margin_right = 8
		expr_label.add_theme_stylebox_override("normal", display)

		_style_badge(domain_badge, DOMAIN_BLUE)
		_style_badge(depth_badge, DEPTH_PURPLE)


## A small bold "pill": colored rounded background, white text, tight margins.
func _style_badge(badge: Label, bg: Color) -> void:
	badge.add_theme_font_size_override("font_size", 12)
	badge.add_theme_color_override("font_color", Color(1, 1, 1))
	badge.custom_minimum_size = Vector2(28, 0)
	badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	var pill := StyleBoxFlat.new()
	pill.bg_color = bg
	pill.set_corner_radius_all(6)
	pill.content_margin_left = 6
	pill.content_margin_right = 6
	pill.content_margin_top = 2
	pill.content_margin_bottom = 2
	badge.add_theme_stylebox_override("normal", pill)


## Recolors the HP bar fill; background stays a dark inset regardless of fill.
func _style_hp_bar(fill: Color) -> void:
	var bg := StyleBoxFlat.new()
	bg.bg_color = EXPR_DISPLAY_BG
	bg.set_corner_radius_all(6)
	hp_bar.add_theme_stylebox_override("background", bg)

	var fg := StyleBoxFlat.new()
	fg.bg_color = fill
	fg.set_corner_radius_all(6)
	hp_bar.add_theme_stylebox_override("fill", fg)


## `player` is one entry from GameModel.state.players (a Dictionary), or {}
## when the player has not joined yet / data is unavailable. `hp_prefix` is
## prepended to the HP readout (e.g. "Your HP: ", "Opponent HP: ").
func update_from_player(player: Dictionary, display_name_fallback: String = "", hp_prefix: String = "") -> void:
	if player.is_empty():
		_render_empty(display_name_fallback, hp_prefix)
		return

	name_label.text = String(player.get("displayName", display_name_fallback))

	var hp10: int = int(player.get("hp10", 0))
	hp_label.text = "%s%.1f" % [hp_prefix, hp10 / 10.0]
	var is_low: bool = hp10 <= LOW_HP10_THRESHOLD
	hp_label.add_theme_color_override("font_color", LOW_HP_COLOR if is_low else NORMAL_HP_COLOR)
	hp_bar.value = clamp(float(hp10) / 10.0, 0.0, HP_BAR_REFERENCE_MAX)
	_style_hp_bar(HP_LOW_RED if is_low else HP_GREEN)

	var trap_card_id: String = String(player.get("trapCardId", ""))
	var trap_set: bool = trap_card_id != ""
	trap_slot_indicator.text = "Trap: set" if trap_set else "Trap: empty"
	trap_slot_indicator.add_theme_color_override("font_color", TRAP_ORANGE if trap_set else TEXT_DIM)

	var boards: Array = player.get("boards", [])
	for index in range(FUNCTION_SLOT_COUNT):
		var slot: HBoxContainer = function_board_panel.get_child(index)
		var expr_label: Label = slot.get_node("ExprLabel")
		var domain_badge: Label = slot.get_node("DomainBadge")
		var depth_badge: Label = slot.get_node("DepthBadge")

		if index < boards.size():
			var board: Dictionary = boards[index]
			var expression: String = String(board.get("expression", ""))
			expr_label.text = expression if expression != "" else "(empty)"
			domain_badge.text = String(board.get("domain", ""))
			depth_badge.text = "d=%d" % int(board.get("compositionDepth", 0))
		else:
			expr_label.text = "(empty)"
			domain_badge.text = ""
			depth_badge.text = ""


func _render_empty(display_name_fallback: String = "", hp_prefix: String = "") -> void:
	name_label.text = display_name_fallback
	hp_label.text = "%s0.0" % hp_prefix
	hp_label.add_theme_color_override("font_color", NORMAL_HP_COLOR)
	hp_bar.value = 0.0
	_style_hp_bar(HP_LOW_RED)
	trap_slot_indicator.text = "Trap: empty"
	trap_slot_indicator.add_theme_color_override("font_color", TEXT_DIM)
	for index in range(FUNCTION_SLOT_COUNT):
		var slot: HBoxContainer = function_board_panel.get_child(index)
		slot.get_node("ExprLabel").text = "(empty)"
		slot.get_node("DomainBadge").text = ""
		slot.get_node("DepthBadge").text = ""
