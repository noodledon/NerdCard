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


func _ready() -> void:
	pressed.connect(_on_pressed)


func set_card(card: Dictionary) -> void:
	card_id = String(card.get("id", ""))
	card_type = String(card.get("cardType", ""))
	card_subtype = String(card.get("subtype", ""))
	text = "%s %s" % [String(card.get("name", card_id)), card_type]


func _on_pressed() -> void:
	card_clicked.emit(card_id)
