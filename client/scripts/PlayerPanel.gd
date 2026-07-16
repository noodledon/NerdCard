## PlayerPanel — reusable player board display (T19).
##
## Pure render component: every `.text` value written here originates from
## a player Dictionary handed in via update_from_player(). No node is
## created or destroyed by this script (function slots are static children
## at a fixed count of 3, matching PlayerSchema.boards being read positionally).

extends VBoxContainer
class_name PlayerPanel

@onready var name_label: Label = $NameLabel
@onready var hp_label: Label = $HPLabel
@onready var trap_slot_indicator: Label = $TrapSlotIndicator
@onready var function_board_panel: VBoxContainer = $FunctionBoardPanel

const FUNCTION_SLOT_COUNT: int = 3


func _ready() -> void:
	_render_empty()


## `player` is one entry from GameModel.state.players (a Dictionary), or {}
## when the player has not joined yet / data is unavailable.
func update_from_player(player: Dictionary, display_name_fallback: String = "") -> void:
	if player.is_empty():
		_render_empty(display_name_fallback)
		return

	name_label.text = String(player.get("displayName", display_name_fallback))

	var hp10: int = int(player.get("hp10", 0))
	hp_label.text = str(int(hp10 / 10))

	var trap_card_id: String = String(player.get("trapCardId", ""))
	trap_slot_indicator.text = "Trap: set" if trap_card_id != "" else "Trap: empty"

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


func _render_empty(display_name_fallback: String = "") -> void:
	name_label.text = display_name_fallback
	hp_label.text = "0"
	trap_slot_indicator.text = "Trap: empty"
	for index in range(FUNCTION_SLOT_COUNT):
		var slot: HBoxContainer = function_board_panel.get_child(index)
		slot.get_node("ExprLabel").text = "(empty)"
		slot.get_node("DomainBadge").text = ""
		slot.get_node("DepthBadge").text = ""
