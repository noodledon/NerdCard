## CardButton — one instance per hand card (T20).
##
## Rebuilt (added/removed) by MainGame.gd on every state_changed — this is
## the one permitted node-mutation exception called out by the wave-5 plan
## (hand size varies; everything else in the scene is static-count).
##
## Emits card_clicked(card_id) only. Routing to ConnectionManager.send_intent
## happens in MainGame.gd, keeping exactly one function
## (ConnectionManager.send_intent) as the sole network egress point.

extends Button
class_name CardButton

signal card_clicked(card_id: String)

var card_id: String = ""
var card_type: String = ""
var card_subtype: String = ""

## Dark-chalkboard card face colors (see nerdcard-ui-theme).
const FACE_BG: Color = Color(0.173, 0.173, 0.282)
const FACE_HOVER: Color = Color(0.216, 0.216, 0.337)
const FACE_PRESSED: Color = Color(0.137, 0.137, 0.227)
const FACE_BORDER: Color = Color(0.227, 0.227, 0.361)
const FACE_DISABLED: Color = Color(0.129, 0.129, 0.176)
const TEXT_COLOR: Color = Color(0.878, 0.878, 0.878)
const TEXT_DISABLED: Color = Color(0.42, 0.42, 0.49)
## Selection highlight — matches MATH_GREEN in game.gd.
const SELECT_COLOR: Color = Color(0, 1, 0.533)

## Per-card-type accent, keyed off the deckType/cardType category string.
const FCC_BLUE: Color = Color(0.267, 0.533, 1)
const NUM_GREEN: Color = Color(0.133, 0.8, 0.4)
const ACT_ORANGE: Color = Color(1, 0.533, 0.267)
const NEUTRAL_ACCENT: Color = Color(0.5, 0.5, 0.6)

## Display names for the frozen 30-card catalog
## (server/src/data/card-catalog.json). Hand snapshots carry the catalog id
## but no `name` field, so the client maps id -> name for readability. This
## is presentation metadata only — the server remains authoritative.
const CARD_NAMES: Dictionary = {
	"fcc-add-term-001": "Term Surge",
	"fcc-calc-derivative-001": "Flux Delta",
	"fcc-calc-integral-001": "Anti-Flux",
	"fcc-calc-limit-001": "Limit Break",
	"fcc-nt-modular-001": "Mod Cage",
	"fcc-nt-theorem-001": "Fermat Echo",
	"fcc-la-vector-001": "Vector Shift",
	"fcc-la-matrix-001": "Matrix Weave",
	"fcc-la-transform-001": "Transform Lens",
	"fcc-la-eigenvalue-001": "Eigen Lance",
	"act-offensive-001": "Power Spike",
	"act-shield-001": "Aegis Guard",
	"act-trap-001": "Snarecoded",
	"act-martial-theorem-001": "Pythagoras Strike",
	"act-artifact-theorem-001": "Euler's Ward",
	"act-special-add-board-001": "Second Foundation",
	"act-special-composition-001": "Nested Chaos",
	"act-special-force-eval-001": "Showdown",
	"act-eval-001": "Evaluate",
	"num-prime-2": "Two (2)",
	"num-prime-3": "Three (3)",
	"num-prime-5": "Five (5)",
	"num-irrational-pi": "Pi (π)",
	"num-irrational-e": "Euler's Number (e)",
	"num-irrational-phi": "Golden Ratio (φ)",
	"vvc-1": "Anchor: 2",
	"vvc-2": "Anchor: π",
	"vvc-3": "Anchor: 3",
	"vvc-4": "Anchor: 10",
	"vvc-5": "Anchor: -1",
}

## The left-stripe StyleBoxFlats we recolor per card. Built once in _ready and
## kept so set_card only has to repaint the accent, not rebuild geometry.
var _sb_normal: StyleBoxFlat
var _sb_hover: StyleBoxFlat
var _sb_pressed: StyleBoxFlat
var _sb_disabled: StyleBoxFlat
var _selected: bool = false
var _base_text: String = ""


func _ready() -> void:
	pressed.connect(_on_pressed)
	_apply_base_style()
	if _selected:
		set_selected(true)


func set_card(card: Dictionary) -> void:
	card_id = String(card.get("id", ""))
	card_type = String(card.get("cardType", ""))
	card_subtype = String(card.get("subtype", ""))
	## Hand cards on the wire carry {id, cardType, subtype, numericValue,
	## value} — `name` exists only on deck entries, so fall back to the
	## subtype display name, then the id. Number-ish cards also show their
	## payload so e.g. the five Anchor VVCs are distinguishable.
	var title: String = String(CARD_NAMES.get(card_id, card.get("name", "")))
	if title == "":
		title = card_subtype if card_subtype != "" else card_id
	var detail: String = String(card.get("numericValue", ""))
	if detail == "":
		var number_value: float = float(card.get("value", 0))
		if number_value != 0.0:
			detail = str(int(number_value)) if number_value == floorf(number_value) else str(number_value)
	_base_text = title if detail == "" else "%s · %s" % [title, detail]
	text = ("✓ " if _selected else "") + _base_text
	_apply_accent(_accent_for_type(card_type))


func _on_pressed() -> void:
	card_clicked.emit(card_id)


## Marks this card as the current selection (Anchor VVC or number factor):
## thicker green border + green label. Purely visual — game.gd reapplies it
## after each hand rebuild based on the GameModel selection ids.
func set_selected(selected: bool) -> void:
	_selected = selected
	if _base_text != "":
		text = ("✓ " if _selected else "") + _base_text
	if _sb_normal == null:
		return
	if _selected:
		for sb in [_sb_normal, _sb_hover, _sb_pressed]:
			sb.set_border_width_all(2)
			sb.border_width_left = 6
			sb.border_color = SELECT_COLOR
		add_theme_color_override("font_color", SELECT_COLOR)
		add_theme_color_override("font_hover_color", SELECT_COLOR)
		add_theme_color_override("font_pressed_color", SELECT_COLOR)
	else:
		for sb in [_sb_normal, _sb_hover, _sb_pressed]:
			sb.set_border_width_all(1)
			sb.border_width_left = 5
		_apply_accent(_accent_for_type(card_type))
		add_theme_color_override("font_color", TEXT_COLOR)
		add_theme_color_override("font_hover_color", TEXT_COLOR)
		add_theme_color_override("font_pressed_color", TEXT_COLOR)


## Builds the card-like frame: rounded face, thin border, a thick left accent
## stripe (recolored per type in _apply_accent), and clearly grayed disabled
## and legible label styling. Called once from _ready.
func _apply_base_style() -> void:
	custom_minimum_size = Vector2(150, 84)

	_sb_normal = _make_face(FACE_BG, FACE_BORDER)
	_sb_hover = _make_face(FACE_HOVER, FACE_BORDER)
	_sb_pressed = _make_face(FACE_PRESSED, FACE_BORDER)
	_sb_disabled = _make_face(FACE_DISABLED, Color(0.176, 0.176, 0.227))

	add_theme_stylebox_override("normal", _sb_normal)
	add_theme_stylebox_override("hover", _sb_hover)
	add_theme_stylebox_override("pressed", _sb_pressed)
	add_theme_stylebox_override("focus", _sb_normal)
	add_theme_stylebox_override("disabled", _sb_disabled)

	add_theme_color_override("font_color", TEXT_COLOR)
	add_theme_color_override("font_hover_color", TEXT_COLOR)
	add_theme_color_override("font_pressed_color", TEXT_COLOR)
	add_theme_color_override("font_disabled_color", TEXT_DISABLED)
	add_theme_font_size_override("font_size", 15)

	# Left-aligned, top-anchored, wrapping label so long ids read as a card face.
	alignment = HORIZONTAL_ALIGNMENT_LEFT
	autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	clip_text = true


## A rounded card face with a 1px border and a thick left stripe (the stripe
## color is set later by _apply_accent). Content margins pad the label inset.
func _make_face(bg: Color, border: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.set_corner_radius_all(8)
	sb.set_border_width_all(1)
	sb.border_width_left = 5
	sb.border_color = border
	sb.content_margin_left = 12
	sb.content_margin_right = 10
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	return sb


## Recolors the frame of each active-state box to the card-type accent. The
## thick left border width (set in _make_face) makes that side read as a
## stripe; the disabled box uses a darkened accent so a dead card looks inert.
func _apply_accent(accent: Color) -> void:
	if _sb_normal == null:
		return
	for sb in [_sb_normal, _sb_hover, _sb_pressed]:
		sb.border_color = accent
	_sb_disabled.border_color = accent.darkened(0.55)


## Maps a card's category string to its accent. Matches loosely on substrings
## so "fcc"/"number"/"action" variants all resolve; unknown types stay neutral.
func _accent_for_type(type_str: String) -> Color:
	var t := type_str.to_lower()
	if t.contains("fcc"):
		return FCC_BLUE
	if t.contains("num"):
		return NUM_GREEN
	if t.contains("act"):
		return ACT_ORANGE
	return NEUTRAL_ACCENT
