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
##   Join handshake: `{"type": "join_room", "room": <room_name — each name
##     is an isolated 2P game; blank falls back to "nerdiclash">,
##     "displayName": <optional>, "sessionId": <optional>,
##     "reconnectToken": <optional>}` outbound,
##     `{"type": "joined", "sessionId": "...", "role": "p1"|"p2",
##     "reconnectToken": "..."}` inbound.
##     Sending the prior sessionId + reconnectToken pair reclaims a
##     disconnected seat (json-bridge.ts handleJoin reconnection branch);
##     the token proves seat ownership — sessionIds are guessable.
##   Room directory: `{"type": "list_rooms"}` outbound is lobby-level — the
##     bridge answers ANY connected socket, seated or not, with
##     `{"type": "room_list", "rooms": [{"name", "playerCount", "connected",
##     "phase"}]}`. Pull-only: nothing streams the list, clients re-ask.
##
## Transport reality: the JSON bridge (server/src/json-bridge.ts) is live at
## ws://localhost:2568 — outside the Zod ClientMessage union by design. It
## accepts `join_room`, replies `joined` (sessionId + role), answers each
## intent with `ack`/`error`, and streams a per-player-filtered
## `state_snapshot` every 100ms.

extends Node

signal connected(role: String)
signal state_changed(snapshot: Dictionary)
signal error(code: String, message: String)
## Emitted on a game_event 'rematch' whose actorId is the opponent's — our
## own vote is already reflected by the Rematch button's waiting state.
signal rematch_offered(actor_id: String)
## Carries the rooms array of a room_list reply (see send_list_rooms).
signal room_listed(rooms: Array)

const RawWsClientScript = preload("res://scripts/raw-ws-client.gd")

## Delay before the single auto-retry after a drop — gives the bridge a
## beat to process the old socket's close (mark the seat isConnected=false)
## so the reclaim branch in handleJoin can see it. One retry, no backoff.
const RETRY_DELAY_SEC: float = 1.0

var ws: Node = null
var endpoint: String = "ws://localhost:2568"
var room_name: String = "nerdiclash"
var display_name: String = ""
var _joined: bool = false
## True while the in-flight join_room carried a stored sessionId — set in
## _on_ws_connected, consumed by the "joined"/"error" branches.
var _rejoin_attempted: bool = false
## The one permitted auto-retry per connection sequence (T5 reconnect).
var _auto_retried: bool = false
## Set when ROOM_FULL was just surfaced — the bridge closes the socket
## right after, and the resulting disconnect must not clobber that
## distinct "seat gone" message with a generic drop notice.
var _room_full_notified: bool = false
## True while the socket was dialed by browse_rooms (a directory pull, no
## seat) — _on_ws_connected sends list_rooms instead of join_room. Cleared
## by connect_to_server, so a later Connect on the browsing socket joins.
var _browse_only: bool = false


func _ready() -> void:
	ws = RawWsClientScript.new()
	add_child(ws)
	ws.connect("connected", Callable(self, "_on_ws_connected"))
	ws.connect("disconnected", Callable(self, "_on_ws_disconnected"))
	ws.connect("state_received", Callable(self, "_on_ws_message"))
	ws.connect("connection_failed", Callable(self, "_on_ws_connection_failed"))


func connect_to_server(url: String, name_hint: String = "", room_hint: String = "") -> void:
	endpoint = url
	display_name = name_hint
	## Blank keeps the bridge default ("nerdiclash") — room names are
	## [a-zA-Z0-9_-]{1,32} and each is an isolated 2P game (wave-11 T1).
	room_name = room_hint if room_hint != "" else "nerdiclash"
	_joined = false
	_auto_retried = false
	_room_full_notified = false
	_browse_only = false
	if ws.peer.get_ready_state() == WebSocketPeer.STATE_OPEN:
		## Socket already up (a directory browse is live) — 'connected' will
		## not fire again, so join on it directly.
		_send_join()
		return
	var err: int = ws.connect_to(url)
	if err != OK:
		emit_signal("error", "ERR_CONNECT", "Failed to start connection to %s" % url)


## Dial (or reuse) the endpoint purely to fetch the room directory — no
## seat is taken. On a live socket this just re-asks; a joined socket keeps
## its seat and still gets an answer (the bridge treats list_rooms as
## lobby-level either way), so _browse_only is left untouched then.
func browse_rooms(url: String) -> void:
	endpoint = url
	var state: int = ws.peer.get_ready_state()
	if state == WebSocketPeer.STATE_OPEN:
		if not _joined:
			_browse_only = true
		send_list_rooms()
		return
	## A CONNECTING peer already has a purpose — a Connect join-dial or an
	## earlier browse — so a Refresh mid-dial leaves _browse_only alone.
	if state == WebSocketPeer.STATE_CONNECTING:
		return
	_browse_only = true
	var err: int = ws.connect_to(url)
	if err != OK:
		emit_signal("error", "ERR_CONNECT", "Failed to start connection to %s" % url)


func _on_ws_connected() -> void:
	if _browse_only:
		send_list_rooms()
		return
	_send_join()


func _send_join() -> void:
	var join_msg: Dictionary = {"type": "join_room", "room": room_name}
	if display_name != "":
		join_msg["displayName"] = display_name
	## Seat reclaim (T5 + wave-10 T3): a held sessionId + reconnectToken
	## always ride along on join_room, so both the auto-retry and a manual
	## Connect act as "Reconnect". The bridge falls through to a fresh join
	## when the seat is gone.
	_rejoin_attempted = GameModel.local_session_id != ""
	if _rejoin_attempted:
		join_msg["sessionId"] = GameModel.local_session_id
		join_msg["reconnectToken"] = GameModel.local_reconnect_token
	ws.send_json(join_msg)


func _on_ws_disconnected() -> void:
	## Transient drop: keep GameModel.state and local_session_id — the
	## bridge marks the seat isConnected=false but holds it, and resumed
	## snapshots resync the UI. GameModel.reset() is reserved for a fresh
	## seat (see the "joined" branch).
	_joined = false
	if _room_full_notified:
		_room_full_notified = false
		return
	if not _auto_retried:
		_auto_retried = true
		emit_signal("error", "ERR_DISCONNECTED", "Connection lost — retrying…")
		get_tree().create_timer(RETRY_DELAY_SEC).timeout.connect(_retry_connect)
	else:
		emit_signal("error", "ERR_DISCONNECTED", "Connection lost — press Connect to rejoin")


## The single auto-retry after a drop. Re-dials the same endpoint; the held
## sessionId makes _on_ws_connected send a reclaim join. RawWsClient
## dedupes the dial if a manual Connect already re-connected within the
## delay window.
func _retry_connect() -> void:
	if _joined:
		return
	var err: int = ws.connect_to(endpoint)
	if err != OK:
		emit_signal("error", "ERR_CONNECT", "Reconnect failed — press Connect to rejoin")


func _on_ws_connection_failed(reason: String) -> void:
	_joined = false
	emit_signal("error", "ERR_CONNECT_FAILED", "Could not connect to %s: %s" % [endpoint, reason])


func _on_ws_message(data: Dictionary) -> void:
	var msg_type: String = String(data.get("type", ""))
	match msg_type:
		"joined":
			var new_session_id: String = String(data.get("sessionId", ""))
			var seat_reclaimed: bool = new_session_id != "" and new_session_id == GameModel.local_session_id
			if not seat_reclaimed:
				## Fresh seat — first join, or the held sessionId was not a
				## disconnected seat and the bridge fell through to a new
				## join (old game torn down). Drop the dead game's state.
				if _rejoin_attempted:
					emit_signal("error", "SEAT_GONE", "Previous game is gone — joined a new room")
				GameModel.reset()
			_rejoin_attempted = false
			_auto_retried = false
			_joined = true
			GameModel.local_session_id = new_session_id
			GameModel.local_reconnect_token = String(data.get("reconnectToken", ""))
			emit_signal("connected", String(data.get("role", "")))
		"state_snapshot":
			GameModel.state = data.get("state", {})
			emit_signal("state_changed", GameModel.state)
		"game_over":
			## Dedicated GameOverSchema frame (wave-8 T5): lands ahead of the
			## next 100ms snapshot, so patch the model and re-render now.
			## Guarded on phase — if a snapshot already showed gameOver the
			## overlay is up and re-emitting state_changed would be a no-op
			## anyway (game.gd _render_game_over only flips visibility).
			if String(GameModel.state.get("phase", "")) != "gameOver":
				GameModel.state["phase"] = "gameOver"
				GameModel.state["winner"] = data.get("winnerId")
				GameModel.state["winReason"] = data.get("winReason")
				emit_signal("state_changed", GameModel.state)
		"game_event":
			## Rematch votes ride the event stream only — snapshots never
			## carry them (json-bridge voteRematch), so the opponent's vote
			## is surfaced here as a notice. Other game_events stay
			## informational; snapshots carry everything else.
			if String(data.get("event", "")) == "rematch" and String(data.get("actorId", "")) != GameModel.local_session_id:
				emit_signal("rematch_offered", String(data.get("actorId", "")))
		"room_list":
			emit_signal("room_listed", data.get("rooms", []))
		"error":
			var code: String = String(data.get("code", "UNKNOWN"))
			var message: String = String(data.get("message", ""))
			if code == "ROOM_FULL":
				## A reclaim join that still gets ROOM_FULL means the seat
				## is truly gone (or never ours). Drop the held id + token
				## so the next Connect is a clean fresh join, and say so
				## plainly instead of surfacing a generic connect error.
				GameModel.local_session_id = ""
				GameModel.local_reconnect_token = ""
				_room_full_notified = true
				message = "Room full / seat gone — try again once a seat frees up"
			emit_signal("error", code, message)
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


## list_rooms is lobby-level — the bridge answers any connected socket,
## seated or not — so it bypasses send_intent's _joined gate by design.
## RawWsClient.send_json itself no-ops when the peer isn't open.
func send_list_rooms() -> void:
	ws.send_json({"type": "list_rooms"})


func is_connected_to_room() -> bool:
	return _joined
