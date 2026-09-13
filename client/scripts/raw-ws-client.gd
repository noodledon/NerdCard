## Raw websocket client — the client's ONLY transport.
##
## T5 verification (scripts/colyseus-verify.md) found the official
## colyseus-godot SDK unavailable under Godot 4.7, so this speaks
## simplified JSON-encoded frames to the server's JSON bridge
## (server/src/json-bridge.ts, ws://localhost:2568). Server-side Colyseus
## still speaks its native protocol on :2567, but that room is a
## single-room legacy/dev path — no multi-room, rematch, room-list, or
## mode support (all bridge-only).

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
	# poll() must be called during STATE_CONNECTING and STATE_CLOSING too —
	# without it neither the open handshake nor the close handshake completes
	# and the peer stalls forever (a stuck CLOSING peer never reaches CLOSED,
	# so 'disconnected' never fires and the reconnect path never arms).
	if state == WebSocketPeer.STATE_CONNECTING or state == WebSocketPeer.STATE_OPEN or state == WebSocketPeer.STATE_CLOSING:
		peer.poll()
	if state == WebSocketPeer.STATE_OPEN:
		if not _connected:
			_connected = true
			# A completed handshake clears the dial flag — otherwise the next
			# drop's STATE_CLOSED hits the elif below and emits a phantom
			# "connection_failed" one frame after 'disconnected'.
			_dial_attempted = false
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
