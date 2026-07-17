## FALLBACK raw websocket client.
##
## The official colyseus-godot SDK uses msgpack and the room protocol;
## this fallback speaks simplified JSON-encoded state patches and is
## intended ONLY if the SDK proves broken under Godot 4.7+ during T5
## verification. Server-side Colyseus still speaks its native protocol —
## fallback would require a server-side JSON bridge (Wave 2 app.config additions).
##
## This is the ACTIVE connection path while the SDK is unavailable.

extends Node
class_name RawWsClient

signal state_received(data: Dictionary)
signal connected()
signal disconnected()
signal connection_failed(reason: String)

@export var endpoint: String = "ws://127.0.0.1:2567"

var peer: WebSocketPeer = WebSocketPeer.new()
var _connected: bool = false
var _dial_attempted: bool = false


func connect_to(url: String) -> int:
	var state := peer.get_ready_state()
	if state == WebSocketPeer.STATE_CONNECTING or state == WebSocketPeer.STATE_OPEN:
		print("[RawWsClient] Already connecting/connected — ignoring duplicate connect_to()")
		return OK
	# A used WebSocketPeer cannot reconnect; always dial from a fresh instance.
	peer = WebSocketPeer.new()
	_connected = false
	_dial_attempted = true
	var err := peer.connect_to_url(url)
	if err != OK:
		_dial_attempted = false
		print("[RawWsClient] Failed to connect to ", url, ": error ", err)
		emit_signal("connection_failed", "connect_to_url error %d" % err)
		return err
	print("[RawWsClient] Connecting to ", url, "...")
	return OK


func _process(_delta: float) -> void:
	var state := peer.get_ready_state()
	# poll() must be called during STATE_CONNECTING too — without it the
	# WebSocket handshake never completes and the peer stalls forever.
	if state == WebSocketPeer.STATE_CONNECTING or state == WebSocketPeer.STATE_OPEN:
		peer.poll()
	if state == WebSocketPeer.STATE_OPEN:
		if not _connected:
			_connected = true
			print("[RawWsClient] Connected!")
			emit_signal("connected")
		_on_packet()
	elif state == WebSocketPeer.STATE_CLOSED:
		if _connected:
			print("[RawWsClient] Disconnected (code: ", peer.get_close_code(), ")")
			emit_signal("disconnected")
			_connected = false
		elif _dial_attempted:
			# Handshake never completed (server down / wrong port / refused).
			# Godot surfaces this silently as STATE_CLOSED — make it visible.
			_dial_attempted = false
			print("[RawWsClient] Connection failed before opening (code: ", peer.get_close_code(), ")")
			emit_signal("connection_failed", "server unreachable or rejected the handshake")


func _on_packet() -> void:
	while peer.get_available_packet_count() > 0:
		var packet: PackedByteArray = peer.get_packet()
		var text: String = packet.get_string_from_utf8()
		var parsed: Variant = JSON.parse_string(text)
		if parsed is Dictionary:
			# state_snapshot arrives ~10x/sec; logging it would flood the debugger.
			if String(parsed.get("type", "")) != "state_snapshot":
				print("[RawWsClient] Received: ", JSON.stringify(parsed, "  "))
			emit_signal("state_received", parsed)
		else:
			print("[RawWsClient] Non-dict packet received: ", text)


func send_json(msg: Dictionary) -> void:
	if peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		var json_str: String = JSON.stringify(msg)
		var err := peer.send_text(json_str)
		if err != OK:
			print("[RawWsClient] Failed to send JSON: error ", err)
	else:
		print("[RawWsClient] Cannot send — not connected.")


func close() -> void:
	if peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		peer.close()
