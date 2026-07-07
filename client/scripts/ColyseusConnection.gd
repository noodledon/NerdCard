## Colyseus Connection wrapper.
## Attempts to use the official Colyseus Godot SDK.
## If the SDK is unavailable (class not found), this script will
## fall back to raw WebSocket communication via raw-ws-client.gd.
##
## NOTE: The colyseus-godot SDK repository is currently unavailable.
## This script is kept as the intended SDK path; see raw-ws-client.gd
## for the active fallback implementation.

extends Node
class_name ColyseusConnection

@export var endpoint: String = "ws://127.0.0.1:2567"
@export var room_name: String = "nerdiclash"

var _client: Variant = null
var _room: Variant = null
var _last_sdk_error: String = ""


func _ready() -> void:
	_connect_sdk()


func _connect_sdk() -> void:
	# Try to instantiate the Colyseus SDK Client class.
	# If the SDK addon is not present, Godot will throw an error.
	var sdk_available := ClassDB.class_exists("Colyseus")
	if not sdk_available:
		_last_sdk_error = "Colyseus SDK not found — falling back to raw WebSocket."
		print("[ColyseusConnection] ", _last_sdk_error)
		return

	_client = Colyseus.Client.new(endpoint)
	print("[ColyseusConnection] SDK Client created, endpoint=", endpoint)


func join_room(name: String = "nerdiclash") -> int:
	if _client == null:
		_last_sdk_error = "Client not initialized. SDK may be unavailable."
		return ERR_CANT_CONNECT

	# Join the room via the SDK
	_room = _client.join(name)
	if _room == null:
		_last_sdk_error = "Failed to join room '%s'" % name
		print("[ColyseusConnection] ", _last_sdk_error)
		return ERR_CANT_CONNECT

	# Listen for state changes
	_room.state_changed.connect(_on_state_change)
	print("[ColyseusConnection] Joined room '", name, "' successfully.")
	return OK


func send_intent(intent: Dictionary) -> void:
	if _room != null:
		_room.send(intent)
	else:
		print("[ColyseusConnection] WARNING: Cannot send intent — room not joined.")


func _on_state_change(patch: Dictionary) -> void:
	# Minimal "dumb/blind" client: just print the patch.
	# Wave 2+ will wire this to render updates.
	print("[ColyseusConnection] State patch received:")
	print(JSON.stringify(patch, "  "))
