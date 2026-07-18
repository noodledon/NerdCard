## ConnectionManager — autoload singleton (T18).
##
## Single ingress/egress point between Godot and the Colyseus server. Wraps
## RawWsClient (scripts/raw-ws-client.gd) because T5 verification
## (scripts/colyseus-verify.md) found the official colyseus-godot SDK
## unavailable under Godot 4.7 — SDK-BROKEN-FALLBACK. The SDK branch
## (ColyseusConnection.gd) is kept only as an inert stub; this is the ONLY
## active connection path.
##
## Wire protocol (client <-> server), matching server/src/shared/messages.ts:
##   Outgoing intents: the ten canonical ClientMessage types verbatim, each a
##     JSON object `{"type": "<name>", ...fields}` with exactly the field
##     names in the server's Zod schemas.
##   Incoming: `{"type": "state_snapshot", "state": {...GameRoomState...}}`
##     mirrors ServerMessage's StateSnapshotSchema; `{"type": "error", "code",
##     "message", "retryable"}` mirrors ServerErrorSchema.
##   Join handshake: `{"type": "join_room", "room": "nerdiclash",
##     "displayName": <optional>}` outbound, `{"type": "joined",
##     "sessionId": "...", "role": "p1"|"p2"}` inbound.
##
## IMPORTANT — see report.md "Wave 5 inconsistencies": `join_room` / `joined`
## are NOT part of the current server Zod contract (messages.ts only defines
## the ten ClientMessage types + eight ServerMessage types, none of which
## covers initial join/session-identity). The server-side JSON text-frame
## bridge flagged as required Wave 2 work in colyseus-verify.md was never
## built. This file defines the client-side half of that contract so the
## eventual bridge has an exact, already-implemented target to match.

extends Node

signal connected(role: String)
signal state_changed(snapshot: Dictionary)
signal error(code: String, message: String)

const RawWsClientScript = preload("res://scripts/raw-ws-client.gd")

var ws: Node = null
var endpoint: String = "ws://localhost:2568"
var room_name: String = "nerdiclash"
var display_name: String = ""
var _joined: bool = false


func _ready() -> void:
	ws = RawWsClientScript.new()
	add_child(ws)
	ws.connect("connected", Callable(self, "_on_ws_connected"))
	ws.connect("disconnected", Callable(self, "_on_ws_disconnected"))
	ws.connect("state_received", Callable(self, "_on_ws_message"))
	ws.connect("connection_failed", Callable(self, "_on_ws_connection_failed"))


func connect_to_server(url: String, name_hint: String = "") -> void:
	endpoint = url
	display_name = name_hint
	_joined = false
	var err: int = ws.connect_to(url)
	if err != OK:
		emit_signal("error", "ERR_CONNECT", "Failed to start connection to %s" % url)


func _on_ws_connected() -> void:
	var join_msg: Dictionary = {"type": "join_room", "room": room_name}
	if display_name != "":
		join_msg["displayName"] = display_name
	ws.send_json(join_msg)


func _on_ws_disconnected() -> void:
	_joined = false
	GameModel.reset()


func _on_ws_connection_failed(reason: String) -> void:
	_joined = false
	emit_signal("error", "ERR_CONNECT_FAILED", "Could not connect to %s: %s" % [endpoint, reason])


func _on_ws_message(data: Dictionary) -> void:
	var msg_type: String = String(data.get("type", ""))
	match msg_type:
		"joined":
			_joined = true
			GameModel.local_session_id = String(data.get("sessionId", ""))
			emit_signal("connected", String(data.get("role", "")))
		"state_snapshot":
			GameModel.state = data.get("state", {})
			emit_signal("state_changed", GameModel.state)
		"error":
			emit_signal("error", String(data.get("code", "UNKNOWN")), String(data.get("message", "")))
		"ack":
			pass
		_:
			if OS.is_debug_build():
				print("[ConnectionManager] ignoring unhandled message type: ", msg_type)


## Central outbound intent sender (T20). Every `room.send` / `peer.send_text`
## call in the project MUST go through this function — no scattered network
## calls anywhere else.
func send_intent(kind: String, payload: Dictionary = {}) -> void:
	if not _joined:
		emit_signal("error", "ERR_NOT_JOINED", "Cannot send intent before joining")
		return
	var msg: Dictionary = payload.duplicate()
	msg["type"] = kind
	ws.send_json(msg)


func is_connected_to_room() -> bool:
	return _joined
