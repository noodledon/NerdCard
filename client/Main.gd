extends Control


@onready var hp_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/TopBar/HpLabel
@onready var phase_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/TopBar/PhaseLabel
@onready var opponent_hp_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/TopBar/OpponentHpLabel
@onready var end_turn_button: Button = $CanvasLayer/MarginContainer/VBoxContainer/TopBar/EndTurnButton
@onready var board_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/Board/BossArea/CenterContainer/BoardLabel
@onready var status_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/StatusLabel
@onready var deck_count_label: Label = $CanvasLayer/MarginContainer/VBoxContainer/HandContainer/DeckCountLabel
@onready var cards_container: HBoxContainer = $CanvasLayer/MarginContainer/VBoxContainer/HandContainer/CardsContainer

var player_hp: int = 0
var opponent_hp: int = 0


func _ready() -> void:
	update_hp_label()
	update_opponent_hp_label()
	update_phase_label("Draw")
	update_board_text("f(x) = 3x1 + 2")
	update_status("Game started")
	update_deck_counts(0, 0, 0)


func update_hp_label() -> void:
	hp_label.text = "Player HP: %d" % player_hp


func update_opponent_hp_label() -> void:
	opponent_hp_label.text = "Opponent HP: %d" % opponent_hp


func update_phase_label(phase: String) -> void:
	phase_label.text = "Phase: %s" % phase


func update_board_text(equation: String) -> void:
	board_label.text = equation


func update_status(text: String) -> void:
	status_label.text = text


func update_deck_counts(fcc: int, num: int, act: int) -> void:
	deck_count_label.text = "FCC: %d | Num: %d | Act: %d" % [fcc, num, act]


func _on_draw_button_pressed() -> void:
	print("Draw Card pressed")


func _on_evaluate_button_pressed() -> void:
	print("Evaluate Function pressed")


func _on_end_turn_button_pressed() -> void:
	print("End Turn pressed")
