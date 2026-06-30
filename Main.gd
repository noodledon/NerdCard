extends Control


@onready var hp_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/TopBar/HpLabel
@onready var board_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/Board/CenterContainer/BoardLabel
@onready var cards_container: HBoxContainer = $CanvasLayer/MarginContainer/VBoxContainer/HandContainer/CardsContainer

var player_hp: int = 0


func _ready() -> void:
	update_hp_label()
	update_board_text("f(x) = 3x1 + 2")


func update_hp_label() -> void:
	hp_label.text = "Player HP: %d" % player_hp


func update_board_text(equation: String) -> void:
	board_label.text = equation


func _on_draw_button_pressed() -> void:
	print("Draw Card pressed")


func _on_evaluate_button_pressed() -> void:
	print("Evaluate Function pressed")
