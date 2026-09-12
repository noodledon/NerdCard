extends Node
## NerdCard test harness — dev-only autoload.
##
## Activated only when the process is launched with env vars
##   NERDCARD_TESTKIT_PORT  — TCP port of the testkit-mcp hub (127.0.0.1)
##   NERDCARD_TESTKIT_ID    — this client's name ("p1", "p2", ...)
## Optional: NERDCARD_BACKGROUND=1 hides the window offscreen.
## With the env vars unset this node frees itself in _ready: zero cost.
##
## Direction is client-dials-out: ONE hub (tools/testkit-mcp/server.mjs)
## serves N clients; no per-client ports. Line-delimited JSON both ways.
##
## Commands (each is one JSON line: {"id":N,"cmd":"...",...params}):
##   eval        {code}            run GDScript body with ctx vars in scope:
##                                 tree, gm, cm, kit, root(=current scene)
##   intent      {type, payload}   ConnectionManager.send_intent
##   wait_state  {expr, timeout_ms} eval expr each frame until truthy/timeout
##   wait        {ms}              sleep inside the client
##   screenshot  {path}            viewport → PNG (absolute path)
##   scenario    {steps}           sequential step list — the timing-safe way
##                                 to cross short windows (defense, trap)
##   ws_close {}                   close the game socket (reconnect test)
##   connect_ws  {url,room,mode}   ConnectionManager.connect_to_server
##                                 (room/mode optional — bridge defaults)
##   get_log {}                    drained ring buffer of WS msgs + signals
##   quit {}                       exit the client process
##
## Scenario steps: {do:"intent"|"eval"|"wait_state"|"wait"|"screenshot"|
##                  "ws_close"|"connect_ws"|"dump_log"|"expect"|"log", ...}
## First failing step aborts and returns the per-step results.

const RECONNECT_MS := 2000
const MAX_LOG := 500
const CMD_TIMEOUT_MS := 120000

var _id := ""
var _port := 0
var _sock := StreamPeerTCP.new()
var _rx := PackedByteArray()
var _greeted := false
var _handling := false
var _queue: Array = []
var _retry_at := 0
var _log: Array = []
var _ws_tapped := false
var _cm: Node = null


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_port = int(OS.get_environment("NERDCARD_TESTKIT_PORT"))
	_id = OS.get_environment("NERDCARD_TESTKIT_ID")
	if _port == 0 or _id == "":
		queue_free()
		return
	if OS.get_environment("NERDCARD_BACKGROUND") == "1":
		DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_NO_FOCUS, true)
		DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_MOUSE_PASSTHROUGH, true)
		DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
		DisplayServer.window_set_position(Vector2i(-9999, -9999))
	_cm = get_node_or_null("/root/ConnectionManager")
	_tap_cm()
	_dial()
	print("[TestKit] client '%s' dialing hub on 127.0.0.1:%d" % [_id, _port])


func _process(_delta: float) -> void:
	_tap_ws()
	var st := _sock.get_status()
	if st == StreamPeerTCP.STATUS_CONNECTED:
		if not _greeted:
			_send({"hello": _id})
			_greeted = true
		_sock.poll()
		var avail := _sock.get_available_bytes()
		if avail > 0:
			var chunk: Array = _sock.get_partial_data(avail)
			if chunk[0] == OK:
				_rx.append_array(chunk[1])
		_drain()
	elif st == StreamPeerTCP.STATUS_CONNECTING:
		_sock.poll()
	else:
		_greeted = false
		if Time.get_ticks_msec() >= _retry_at:
			_dial()


func _dial() -> void:
	_sock = StreamPeerTCP.new()
	_sock.set_no_delay(true)
	_sock.connect_to_host("127.0.0.1", _port)
	_retry_at = Time.get_ticks_msec() + RECONNECT_MS


func _drain() -> void:
	var last_nl := -1
	for i in _rx.size():
		if _rx[i] == 10:
			last_nl = i
	if last_nl < 0:
		return
	var block := _rx.slice(0, last_nl)
	_rx = _rx.slice(last_nl + 1)
	for line in block.get_string_from_utf8().split("\n", false):
		var p = JSON.parse_string(line)
		if typeof(p) == TYPE_DICTIONARY:
			_queue.append(p)
	if not _handling and not _queue.is_empty():
		_handling = true
		_next()


func _next() -> void:
	if _queue.is_empty():
		_handling = false
		return
	var msg: Dictionary = _queue.pop_front()
	var req_id = msg.get("id", 0)
	var res = await _run_command(msg)
	if typeof(res) == TYPE_DICTIONARY and res.has("error") and not res.has("ok"):
		_respond_err(req_id, String(res.error))
	elif typeof(res) == TYPE_DICTIONARY and res.has("ok"):
		_send({"id": req_id, "ok": res.ok, "result": res})
	else:
		_send({"id": req_id, "ok": true, "result": res})
	_next()


func _send(d: Dictionary) -> void:
	if _sock.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	_sock.put_data((JSON.stringify(d) + "\n").to_utf8_buffer())


func _respond_err(req_id, message: String) -> void:
	_send({"id": req_id, "ok": false, "error": message})


func _ctx() -> Dictionary:
	var tree := get_tree()
	return {
		"tree": tree,
		"gm": tree.root.get_node_or_null("GameModel"),
		"cm": _cm,
		"kit": self,
		"root": tree.current_scene,
	}


func _push_log(entry: Dictionary) -> void:
	entry["t"] = Time.get_ticks_msec()
	_log.append(entry)
	if _log.size() > MAX_LOG:
		_log.pop_front()


func _tap_cm() -> void:
	if _cm == null:
		return
	if _cm.has_signal("error") and not _cm.is_connected("error", _on_cm_error):
		_cm.connect("error", _on_cm_error)
	if _cm.has_signal("connected") and not _cm.is_connected("connected", _on_cm_connected):
		_cm.connect("connected", _on_cm_connected)


func _tap_ws() -> void:
	if _ws_tapped or _cm == null:
		return
	var ws = _cm.get("ws")
	if ws != null and ws.has_signal("state_received"):
		ws.connect("state_received", _on_ws_state)
		_ws_tapped = true


func _on_cm_error(code: String, message: String) -> void:
	_push_log({"src": "signal", "type": "error", "code": code, "msg": message})


func _on_cm_connected(role: String) -> void:
	_push_log({"src": "signal", "type": "connected", "role": role})


func _on_ws_state(data: Dictionary) -> void:
	_push_log({"src": "ws", "type": String(data.get("type", "?")), "data": data})


func _eval_body(code: String) -> Variant:
	var src := "extends RefCounted\n"
	src += "func run(ctx):\n"
	src += "\tvar tree = ctx.tree\n\tvar gm = ctx.gm\n\tvar cm = ctx.cm\n"
	src += "\tvar kit = ctx.kit\n\tvar root = ctx.tree.current_scene\n"
	for line in code.split("\n"):
		src += "\t" + line + "\n"
	var s := GDScript.new()
	s.source_code = src
	var err := s.reload()
	if err != OK:
		return {"__compile_error": s.get_instance_base_type(), "code": code}
	var inst = s.new()
	return await inst.run(_ctx())


func _eval_expr(expr: String) -> Variant:
	return await _eval_body("return (%s)" % expr)


func _wait_state(expr: String, timeout_ms: int) -> Dictionary:
	var deadline := Time.get_ticks_msec() + timeout_ms
	while Time.get_ticks_msec() < deadline:
		var v = await _eval_expr(expr)
		if v != null and v != false:
			return {"ok": true, "value": v}
		await get_tree().process_frame
	return {"ok": false, "error": "timeout waiting for: %s" % expr}


func _screenshot(path: String) -> Dictionary:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img == null:
		return {"ok": false, "error": "no viewport image"}
	var dir := path.get_base_dir()
	if dir != "":
		DirAccess.make_dir_recursive_absolute(dir)
	var err := img.save_png(path)
	return {"ok": err == OK, "path": path, "error": error_string(err)}


func _run_command(msg: Dictionary) -> Variant:
	match String(msg.get("cmd", "")):
		"eval":
			return await _eval_body(String(msg.get("code", "return null")))
		"intent":
			_cm.send_intent(String(msg.get("type", "")), msg.get("payload", {}))
			return {"sent": msg.get("type")}
		"wait_state":
			return await _wait_state(String(msg.get("expr", "false")), int(msg.get("timeout_ms", 15000)))
		"wait":
			await get_tree().create_timer(int(msg.get("ms", 0)) / 1000.0).timeout
			return {"waited": msg.get("ms")}
		"screenshot":
			return await _screenshot(String(msg.get("path", "user://shot.png")))
		"scenario":
			return await _run_scenario(msg.get("steps", []))
		"ws_close":
			var ws = _cm.get("ws")
			if ws != null and ws.has_method("close"):
				ws.close()
			return {"closed": ws != null}
		"connect_ws":
			_cm.connect_to_server(
				String(msg.get("url", "ws://localhost:2568")),
				"",
				String(msg.get("room", "")),
				String(msg.get("mode", "")),
			)
			return {"connecting": true}
		"get_log":
			var include_snaps: bool = msg.get("include_snapshots", false)
			var out: Array = []
			for e in _log:
				if not include_snaps and e.get("type") == "state_snapshot":
					continue
				out.append(e)
			return {"entries": out, "count": out.size(), "total": _log.size()}
		"clear_log":
			_log.clear()
			return {"cleared": true}
		"quit":
			get_tree().quit()
			return {"quitting": true}
		_:
			return {"error": "unknown cmd: %s" % msg.get("cmd", "")}


func _run_scenario(steps: Array) -> Dictionary:
	var results: Array = []
	for i in steps.size():
		var step: Dictionary = steps[i]
		var do := String(step.get("do", ""))
		var r: Variant
		match do:
			"intent":
				r = await _run_command({"cmd": "intent", "type": step.get("type"), "payload": step.get("payload", {})})
			"eval":
				r = await _eval_body(String(step.get("code", "return null")))
			"expect":
				r = await _eval_expr(String(step.get("expr", "false")))
				if r == null or r == false:
					r = {"ok": false, "error": "expect failed: %s" % step.get("expr")}
			"wait_state":
				r = await _wait_state(String(step.get("expr", "false")), int(step.get("timeout_ms", 15000)))
			"wait":
				r = await _run_command({"cmd": "wait", "ms": step.get("ms", 0)})
			"screenshot":
				r = await _screenshot(String(step.get("path", "user://shot_%d.png" % i)))
			"ws_close":
				r = await _run_command({"cmd": "ws_close"})
			"connect_ws":
				r = await _run_command({
					"cmd": "connect_ws",
					"url": step.get("url", "ws://localhost:2568"),
					"room": step.get("room", ""),
					"mode": step.get("mode", ""),
				})
			"dump_log":
				var p := String(step.get("path", "user://testkit_log.json"))
				DirAccess.make_dir_recursive_absolute(p.get_base_dir())
				var f := FileAccess.open(p, FileAccess.WRITE)
				if f != null:
					f.store_string(JSON.stringify(_log, "  "))
					f.close()
				r = {"ok": f != null, "path": p, "entries": _log.size()}
			"log":
				_push_log({"src": "marker", "msg": String(step.get("msg", ""))})
				r = {"ok": true}
			_:
				r = {"ok": false, "error": "unknown step do: %s" % do}
		var failed: bool = (typeof(r) == TYPE_DICTIONARY and r.get("ok") == false) \
			or (typeof(r) == TYPE_DICTIONARY and r.has("__compile_error"))
		results.append({"step": i, "do": do, "result": r})
		if failed:
			return {"ok": false, "aborted_at": i, "results": results}
	return {"ok": true, "results": results}
