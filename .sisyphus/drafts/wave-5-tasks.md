- [ ] 18. Godot connection + state sync — ConnectionManager autoload singleton

  ### What to do
  Create `scripts/ConnectionManager.gd` as an **autoload singleton** (registered in `project.godot` under `[autoload]` as `ConnectionManager`). It owns the network connection and the local `GameModel` mirror, and is the single ingress/egress point between Godot and the Colyseus server.

  Two connection branches, conditional on what T5 verified:
  - **Branch A (preferred, if SDK works under Godot 4.7)**:
    ```gdscript
    extends Node
    # autoload: ConnectionManager
    signal connected(role: String)      # "p1" | "p2"
    signal state_changed(snapshot: Dictionary)
    signal error(code: String, message: String)

    @onready var ip_edit: LineEdit
    @onready var status_label: Label
    @onready var phase_label: Label
    @onready var turn_label: Label

    var client: Object
    var room: Object
    var game_model: Dictionary = {}    # mirrors server GameRoomState as Dictionary

    func _ready():
        client = Colyseus.Client.new()
        ip_edit.text = "ws://localhost:2567"
        status_label.text = "Disconnected"

    func _on_connect_pressed():
        status_label.text = "Connecting..."
        client.connect_to(ip_edit.text)
        var room = yield(client.join_or_create("nerdiclass"), "joined")
        room.connect("on_state_change", self, "_on_state_change")
        room.connect("on_error", self, "_on_error")
        status_label.text = "Connected as %s" % room.session_id
        emit_signal("connected", room.session_id)

    func _on_state_change(state):
        game_model = _state_to_dict(state)
        phase_label.text = "Phase: %s" % game_model.get("phase", "")
        turn_label.text = "Turn: %s" % game_model.get("current_turn", "")
        emit_signal("state_changed", game_model)
    ```
  - **Branch B (fallback, raw `WebSocketPeer`):** import from `scripts/raw-ws-client.gd`, listen for `ws_connected`, then send `{"c":"join","r":"nerdiclass"}` JSON, parse incoming JSON patch frames (`{"type":"patch", ...}` / `{"type":"join_ok", "session":...}`) and build `game_model` incrementally.

  Either branch is acceptable. **Pick whichever T5 verified actually works** — record the chosen branch in Evidence.

  Concrete UI node tree (within `connect_scene.tscn` or main scene root): one `LineEdit` (name/IP input, default `ws://localhost:2567`), one `Button` "Connect" (calls `_on_connect_pressed`), one `Label` "Status" (Disconnected → Connecting... → Connected as P1 / Connected as P2), one `Label` `PhaseLabel`, one `Label` `TurnLabel`. Both labels subscribe to `state_changed` signal from the singleton.

  Expose `GameModel` as a second autoload singleton (plain `Dictionary`), populated only by `ConnectionManager._on_state_change`. No other node writes to it. Mirror every server-side `@type()` field name exactly (snake_case) so downstream (T19, T20) can do `GameModel["players"]["p1"]["hp"]`.

  ### Must NOT do
  - No retry/backoff beyond a single reconnect button press (out of scope for test client).
  - No lobby UI beyond the IP LineEdit + Connect button.
  - No matchmaking UI — `joinOrCreate` only, hard-coded room name `"nerdiclass"`.
  - No rendering of game state beyond Phase/Turn labels (T19 handles the board).
  - No storing math.js `Node` objects in `GameModel` — expressions stay as the raw server string (already strings on the wire).
  - No animations, tweens, or visual transitions on state changes.
  - No silently swallowing the fallback — the chosen branch MUST be the one T5 verified; do not commit dead code for the unused branch (delete it or stub with a TODO).

  ### Recommended Agent Profile
  - **Category**: `visual-engineering`
  - **Skills**: `[/playwright]` (screenshot QA of connect → status label transitions), `[/paseo-advisor]` (review server message schema fan-out before wiring fields)
  - **Evaluated**: connection lifecycle, signal emission on connected/changed/error, `GameModel` dictionary shape parity with server schema (T6), chosen branch matches T5 verification artifact.
  - **Omitted**: turn-screen aesthetics, accessibility, localization, keybinds.

  ### Parallelization
  - **Can Run In Parallel**: T19, T20 (both consume `ConnectionManager` only via `state_changed` / `game_model` once `state_changed` shape is pinned — pin shape via a one-shot shared stub in Evidence before parallel start).
  - **Group**: Wave 5 (Godot minimal client).
  - **Blocks**: T19 (board render needs `state_changed` + `GameModel`), T20 (intent sender needs `ConnectionManager.send`).
  - **Blocked By**: T5 (Godot scaffolding + verified SDK/raw-WS decision), T6 (server schema field names must be stable so the Godot-side Dictionary mirror matches exactly).

  ### References
  - **Pattern**: Colyseus Godot SDK `join_or_create` + `on_state_change` signal — canonical happy path for 2P turn-based clients (matches `colyseus/turnbased-cards-demo` UNO example).
  - **API**: `Colyseus.Client.new()`, `room.connect("on_state_change", self, "_on_state")`, `room.send(msg_type, payload)` — for `send` details used by T20.
  - **Fallback API**: `WebSocketPeer` — `peer = WebSocketPeer.new(); peer.connect_to_url(url); peer.get_packet() / peer.send_text(json)` (verified working by T5).
  - **Test**: T6's emitted schema snapshot (the JSON dump the schema task must produce) is the contract `GameModel` mirrors 1:1.
  - **External**: Godot 4.x autoload docs — https://docs.godotengine.org/en/stable/classes/class_%40gdscript.htmlGDScript_autoload — for singleton registration syntax.
  - **WHY**: A single ConnectionManager singleton prevents scattered network code and guarantees GameModel is the only source of truth the render/intent tasks read, matching the "client is dumb/blind" guardrail.

  ### Acceptance Criteria
  - [ ] `scripts/ConnectionManager.gd` exists, registered as autoload `ConnectionManager` in `project.godot`.
  - [ ] `GameModel` (Dictionary mirror) populated on every `on_state_change`; downstream fields accessible via `GameModel.players.p1.hp` style paths.
  - [ ] Three signals emitted: `connected(role)`, `state_changed(snapshot)`, `error(code, message)`.
  - [ ] Status label transitions Disconnected → Connecting... → Connected as P1 (first client) / Connected as P2 (second `joinOrCreate` client).
  - [ ] PhaseLabel and TurnLabel update from a server-driven state change within one network tick (observed via stdout log in headless run).
  - [ ] ConnectionManager has NO game-state mutation code — purely mirror + signal forwarding.
  - [ ] `godot --headless --script res://main.gd` logs "Connected as P1" then a second process logs "Connected as P2" without errors.

  ### QA Scenarios
  Happy path:
  ```
  # Terminal 1
  cd server && npx tsx src/index.ts                 # server up on :2567
  # Terminal 2
  cd nerdcard-godot && godot --headless --script res://main.gd 2>&1 | tee p1.log
  grep -c "Connected as P1" p1.log                   # expect >= 1
  # Terminal 3
  cd nerdcard-godot && godot --headless --script res://main.gd 2>&1 | tee p2.log
  grep -c "Connected as P2" p2.log                   # expect >= 1
  # screenshot (Playwright of the rendered scene when run windowed):
  # godot ~/NerdCard/nerdicard-godot -> screenshot: .sisyphus/evidence/task-18-happy-connect.png
  # assert via look_at evidence/task-18-happy-connect.png: status label "Connected as P1" visible
  ```
  Failure path (server unreachable):
  ```
  # server NOT running
  cd nerdcard-godot && godot --headless --script res://main.gd 2>&1 | tee fail.log
  grep -cE "error|Error|ERROR" fail.log             # expect >= 1
  grep -i "ECONNREFUSED\|ws error\|status_label=Error" fail.log   # expect a match
  # error signal emits; status label shows "Disconnected" or "Error"; no crash
  # screenshot evidence: .sisyphus/evidence/task-18-fail-no-server.png showing stuck "Connecting..." or "Error"
  ```

  ### Evidence
  - `.sisyphus/evidence/task-18-happy-connect.log`
  - `.sisyphus/evidence/task-18-fail-no-server.log`
  - `.sisyphus/evidence/task-18-happy-connect.png`
  - `.sisyphus/evidence/task-18-chosen-branch.md` (records SDK vs raw-WS decision + T5 artifact reference)
  - `.sisyphus/evidence/task-18-gamemodel-shape.json` (the pinned Dictionary shape T19/T20 depend on)

  ### Commit
  `feat(godot): ConnectionManager autoload + GameModel state mirror + connect UI`

- [ ] 19. Godot game board text render — MainGame.tscn scene

  ### What to do
  Create `scenes/MainGame.tscn` (a `Control` root) + `scripts/MainGame.gd` controller. Subscribes to `ConnectionManager.state_changed` and re-renders text labels only — NO node additions/deletions beyond show/hide of slot nodes that already exist in the scene tree at static counts (2 players × 3 function slots × N trap slot).

  Scene tree (static node counts; only `Label.text` updates, no instancing at runtime):
  ```
  MainGame (Control)
  └─ VBox
     ├─ OpponentPanel   (PlayerPanel, top)
     ├─ BoardArea        (Label spacer — visual separation only, plain text)
     ├─ LocalPanel       (PlayerPanel, bottom)
     ├─ HandVBox         (HBoxContainer)
     ├─ DeckButtons      (HBoxContainer with 3 mini-buttons: "Draw FCC","Draw Number","Draw Action")
     ├─ ActionButtons    (HBoxContainer: "End Turn", "Evaluate")
     ├─ PhaseTurnRow     (HBoxContainer: TurnPhaseLabel, TurnOwnerLabel)
     └─ ErrorModal       (Panel + Label, hidden unless error fired; auto-dismiss 3s via Timer)
  PlayerPanel (scene instance, PackedScene reusable): VBox
     ├─ NameLabel
     ├─ HPLabel          (text = str(int(state.hp / 10)))  // server stores HP×10
     ├─ TrapSlotIndicator (Label: "Trap: empty" or "Trap: set" — content NEVER shown even to owner)
     └─ FunctionBoardPanel (VBox of 3 FunctionSlot rows)
        each FunctionSlot (HBox):
           ├─ ExprLabel     (text = card.expression raw string e.g. "sin(x) + 2*x^2")
           ├─ DomainBadge   (text = card.domain e.g. "trig")
           └─ DepthBadge    (text = "d=%d" % composition_depth)
  ```
  HandPanel: `HBoxContainer` with child `CardButton` nodes — reuses the SAME static count pool is NOT possible because hand size varies; permitted exception: clear and rebuild child `CardButton`s on `state_changed` (this is the one allowed node-add/del operation; card art stays text-only via `Button.text = card.name + " " + card.type`).

  All updates driven via `state_changed`:
  - `phase` → `TurnPhaseLabel.text` ("Draw Phase" / "Play Phase" / "Defense Phase" / "Resolution Phase" / "Game Over").
  - `current_turn` → `TurnOwnerLabel.text` ("p1" / "p2").
  - `players.p1.hp / 10` → LocalPanel.HPLabel; `players.p2.hp / 10` → OpponentPanel.HPLabel (assume local=p1 by default — flip the panels if `room.sessionId == state.players.p2.session`).
  - each `players.X.boards[*]` → corresponding FunctionSlot.ExprLabel / DomainBadge / DepthBadge; empty slots show ExprLabel="(empty)".
  - `players.X.hand[*]` (visible to local via StateView) → HandVBox CardButtons (card.name + card.type).
  - deck counts → labels: `"FCC: %d | Num: %d | Act: %d"`.

  ### Must NOT do
  - NO animations, NO Tween, NO `animate_*` methods, NO sprites/textures/card art.
  - NO sound (`AudioStreamPlayer`).
  - NO semantic decode of `expression` strings — render the raw string verbatim (server is authoritative; client is blind).
  - NO StateView filtering client-side — rely solely on what the server sends (correct `@view()` is server's job, T6).
  - NO predictive rendering — every visible value comes from a `state_changed` event.
  - NO dealing with mask the opponent's trap content — the server already hides it; the client must not attempt to "re-hide" either (pure render layer).
  - NO markdown / rich text formatting — plain Label.text only (BBCode off; avoid RichTextLabel unless plain Label doesn't fit on a single line, then RichTextLabel with `bbcode_enabled=false`).
  - NO node instancing for static slot counts — slots exist in the scene at rest; only their `.text` mutate.

  ### Recommended Agent Profile
  - **Category**: `visual-engineering`
  - **Skills**: `[/playwright]` (screenshot `MainGame.png` showing HP=30, expression `sin(x)+2*x^2`, phase "Play Phase" and `look_at` assert), `[/paseo-advisor]` (mirror schema field naming used by T18's `GameModel` before binding labels — catch typos early)
  - **Evaluated**: every `.text` field originates from a `state_changed` payload (no static/hardcoded UI text beyond structural headers); PlayerPanel scene reused for both players (DRY); hand rebuild is the only permitted node mutation; trap content never rendered.
  - **Omitted**: visual polish, font choice, color themes, responsive layout.

  ### Parallelization
  - **Can Run In Parallel**: T18 (provides the `GameModel` shape contract), T20 (provides CardButton.gd consumed here).
  - **Group**: Wave 5.
  - **Blocks**: F3 (manual QA needs a visible board).
  - **Blocked By**: T18 (must pin `GameModel` Dictionary shape first — consume the pinned JSON from evidence/task-18-gamemodel-shape.json), T6 (schema stable; field names must match), T5 (Godot project scaffolding exists).

  ### References
  - **Pattern**: Colyseus `on_state_change` → mutate `.text` of existing Labels — standard state-sync render for turn-based games; no client-side interpolation.
  - **API**: `Callable` / `ConnectionManager.state_changed.connect(self, "_on_state_changed")`; `Label.text = str(...)`.
  - **Test**: T6 schema snapshot (JSON) fed into a mock `GameModel` to render a static frame for screenshot QA even without a live server.
  - **External**: Godot Control scene + Label docs — https://docs.godotengine.org/en/stable/classes/class_label.html
  - **WHY**: A static scene tree with only `.text` mutation keeps the test client minimal and guarantees no desync from client-side interpolation — every pixel reflects server truth.

  ### Acceptance Criteria
  - [ ] `scenes/MainGame.tscn` + `scripts/MainGame.gd` exist; scene instantiable via `godot res://scenes/MainGame.tscn`.
  - [ ] OpponentPanel (top) + LocalPanel (bottom) both visible; player panels show NameLabel, HPLabel, TrapSlotIndicator, 3 FunctionSlots.
  - [ ] HPLabel displays `str(int(hp / 10))` (server HP×10 normalization verified).
  - [ ] ExprLabel renders raw expression string verbatim from `state.players.X.boards[i].expression` (e.g. `sin(x) + 2*x^2`).
  - [ ] TrapSlotIndicator shows "Trap: empty" or "Trap: set" only — content string NEVER rendered for anyone.
  - [ ] FunctionSlot DomainBadge + DepthBadge populate from `board.domain` + `board.composition_depth`.
  - [ ] HandVBox rebuilds CardButtons on every `state_changed`; each button `.text` = `card.name + " " + card.type`.
  - [ ] DeckButtons row shows `"FCC: %d | Num: %d | Act: %d"` from `state.decks` counts.
  - [ ] TurnPhaseLabel updates for all 5 phases; TurnOwnerLabel shows current turn player.
  - [ ] ErrorModal starts hidden; shown on `ConnectionManager.error` signal; auto-hides after 3s via a `Timer`.
  - [ ] `godot --headless res://scenes/MainGame.tscn` with a mocked `GameModel` runs without null-reference errors.

  ### QA Scenarios
  Happy path:
  ```
  # server up, both clients connected (T18 happy path complete)
  cd server && npx tsx src/index.ts &
  # play a few server-side scripted turns OR use a ws python script to drive state
  npx tsx scripts/drive-state.ts --p2-plays "sin(x) + 2*x^2"
  # windowed godot (Playwright not needed; headless screenshot works):
  godot --headless --render-thread safe res://scenes/MainGame.tscn --screenshot .sisyphus/evidence/task-19-board.png
  # assert via look_at evidence/task-19-board.png:
  #   HPLabel shows "30"
  #   ExprLabel shows "sin(x) + 2*x^2"
  #   TurnPhaseLabel shows "Play Phase"
  ```
  Failure path (server rejects a malformed patch / player card enum corrupt):
  ```
  # inject a bad state shape locally for QA render:
  ConnectionManager.game_model = {"phase":"INVALID_PHASE", "players":{}}
  ConnectionManager.state_changed.emit(ConnectionManager.game_model)
  godot --headless --render-thread safe --screenshot .sisyphus/evidence/task-19-empty-state.png
  # assert via look_at: phase label shows "INVALID_PHASE" verbatim, HP labels default to "0",
  # application does NOT crash, ErrorModal remains hidden (render layer never throws).
  ```

  ### Evidence
  - `.sisyphus/evidence/task-19-board.png` (full board with hand, decks, slots)
  - `.sisyphus/evidence/task-19-empty-state.png` (defensive-empty render, no crash)
  - `.sisyphus/evidence/task-19-render-trace.log` (stdout showing each label update tied to a `state_changed` event)
  - `.sisyphus/evidence/task-19-gamemodel-fields-used.md` (table of every `GameModel[...]` path read by MainGame.gd)

  ### Commit
  `feat(godot): MainGame.tscn text-only board render — panels, slots, hand, decks`

- [ ] 20. Godot intent sender — CardButton clicks → server intents

  ### What to do
  Add `scripts/CardButton.gd` (each `Button` in HandVBox instances the script):
  ```gdscript
  extends Button
  signal card_clicked(card_id: String)

  var card_id: String = ""
  func _ready():
      connect("pressed", self, "_on_pressed")
  func _on_pressed():
      emit_signal("card_clicked", card_id)
  ```
  Wire `MainGame.gd` so every HandVBox CardButton's `card_clicked(card_id)` routes to `ConnectionManager.send_intent(intent_type, payload)`.

  Create a thin helper on `ConnectionManager`:
  ```gdscript
  func send_intent(kind: String, payload: Dictionary) -> void:
      # SDK branch:
      room.send(kind, payload)
      # raw-WS branch:
      # peer.send_text(JSON.stringify({"type": kind, "data": payload}))
  ```

  Concrete intent map (each UI control → intent sent):
  | UI Control | Intent Type | Payload | Disabled Conditions |
  |---|---|---|---|
  | CardButton click (Function/base card in hand) | `play_card` | `{cardId}` | not local's turn OR phase != "play" |
  | End Turn button | `end_turn` | `{}` | not local's turn OR phase == "resolution" |
  | Evaluate button | `eval_function` | `{variableValueCardId}` | not local's turn OR phase != "play" OR no variable-value selected |
  | Draw FCC mini-button | `draw_cards` | `{deckType: "fcc"}` | phase != "draw" OR draws_this_turn >= 2 |
  | Draw Number mini-button | `draw_cards` | `{deckType: "number"}` | phase != "draw" OR draws_this_turn >= 2 |
  | Draw Action mini-button | `draw_cards` | `{deckType: "action"}` | phase != "draw" OR draws_this_turn >= 2 |

  "Evaluate" button visible only when `GameModel.local_player.has_eval_legal == true` (a boolean the server sets; client trusts it). A variable-value card must be selected first — clicking a card of `type == "variable_value"` sets `ConnectionManager.currently_selected_variable_value_card` instead of emitting `play_card`.

  Server is authoritative — invalid intents are NOT pre-filtered client-side beyond the disabled conditions above. Client listens for `ConnectionManager.error(code, message)` → shows `ErrorModal` with `"%s\n%s" % [code, message]`; modal auto-dismisses after 3 s (timer implemented in T19's ErrorModal).

  ### Must NOT do
  - NO client-side game-rule validation (server is authoritative — clients are dumb/blind). The disabled conditions above are UX polish only and MAY be incomplete; server still rejects.
  - NO optimistic UI — never mutate `GameModel` until `state_changed` arrives.
  - NO cancel-intent, undo, or replan UI.
  - NO multi-select or drag-drop — single-click intent send only.
  - NO `console.log`-style debug print in production builds (`print()` guarded by `OS.is_debug_build()` is acceptable).
  - NO retrying a rejected intent automatically — surface the error to the user.

  ### Recommended Agent Profile
  - **Category**: `visual-engineering`
  - **Skills**: `[/playwright]` (screenshot evidence of ErrorModal after illegal intent), `[/paseo-advisor]` (verify intent payload field names match T14 handler Zod schemas before wiring)
  - **Evaluated**: each button maps to exactly one intent type and payload shape that matches T14's Zod message contracts (no silent field-name mismatch); disabled conditions match server phase FSM (T10); Evaluate button visibility tied to server-set `has_eval_legal`; no optimistic state mutation anywhere in the diff.
  - **Omitted**: intent queueing, batching, retries.

  ### Parallelization
  - **Can Run In Parallel**: T19 (provides the UI container + CardButton scene — definitional shared contract; if T19 in flight, this task stubs an in-scene CardButton and Final merges).
  - **Group**: Wave 5.
  - **Blocks**: F3 (manual QA needs clickable intents to drive a full turn).
  - **Blocked By**: T18 (ConnectionManager.send_intent + signals), T14 (server message handler Zod contracts — the exact intent names + payload field names), T10 (phase FSM, to implement correct disable conditions).

  ### References
  - **Pattern**: Colyseus `room.send("play_card", {cardId})` authoritative client intent — server validates then broadcasts delta; client never changes local state until `on_state_change`.
  - **API**: `room.send(msg_type, payload)` (SDK branch) / `peer.send_text(JSON.stringify({"type": msg_type, "data": payload}))` (raw-WS branch).
  - **Test**: T14 handler unit tests define the exact acceptable Zod payloads — use the same literals here to guarantee contract alignment.
  - **External**: Colyseus Room.send docs — https://docs.colyseus.io/colyseus/server/room/#send-type-data
  - **WHY**: Centralizing every outbound `send` through one `ConnectionManager.send_intent` (typified by intent enum strings) keeps intent payload audit single-file and makes the F4 scope-fidelity check trivial.

  ### Acceptance Criteria
  - [ ] `scripts/CardButton.gd` exists; each hand card button emits `card_clicked(card_id)` signal.
  - [ ] `ConnectionManager.send_intent(kind, payload)` exists; both SDK and raw-WS branches covered (one active per T5 decision).
  - [ ] All 6 intents from the table wired to their UI controls with exact payload field names matching T14 Zod schemas.
  - [ ] End Turn button `disabled = true` whenever `GameModel.current_turn != local` OR phase == "resolution".
  - [ ] Evaluate button `visible = false` unless `GameModel.local_player.has_eval_legal == true`; `disabled = true` until a variable-value card selected.
  - [ ] Each Draw mini-button disabled when `phase != "draw"` OR `local.draws_this_turn >= 2`.
  - [ ] CardButton disabled when `current_turn != local` OR `phase != "play"` OR `card.type != play_legal_card_type` (basic check only; server is source of truth).
  - [ ] On `ConnectionManager.error(code, message)`, ErrorModal shows `%s\n%s` and auto-hides after 3s; user cannot queue duplicate modals.
  - [ ] No optimistic mutation of `GameModel` outside `state_changed` — verified by grep / ast_grep_search of `GameModel[` writes anywhere besides ConnectionManager.
  - [ ] `room.send` / `peer.send_text` invoked from exactly one function (`send_intent`) — no scattered network calls.

  ### QA Scenarios
  Happy path:
  ```
  # server up, both clients at draw phase (p1 local)
  cd server && npx tsx src/index.ts &
  # client p1 runs windowed; Playwright optional — use headless stdout:
  # send draw_cards intent:
  godot --headless --script scripts/test-draw-fcc.gd       # clicks "Draw FCC" button programmatically
  # server log expects:
  #   received draw_cards { deckType: "fcc" } from p1
  #   p1 phase advances; send patch { 'players/p1/hand/(length)': N+1 }
  # Verify client:
  grep -c "draw_cards intent sent" p1.log                 # expect >= 1
  grep -c "state_changed: hand size=" p1.log              # expect increased count
  # screenshot:
  godot --headless --render-thread safe --screenshot .sisyphus/evidence/task-20-happy-draw.png
  # assert via look_at: hand panel gained one more CardButton; deck counts fcc decremented
  ```
  Failure path (illegal intent — draw during play phase):
  ```
  # server up; force p1 to play phase (skip draw).
  npx tsx scripts/force-phase.ts --player p1 --phase play
  # client clicks "Draw FCC" anyway (disabled should be true; test overrides disabled to verify rejection):
  godot --headless --script scripts/test-draw-illegal.gd
  # server log expects:
  #   received draw_cards { deckType: "fcc" } from p1
  #   REJECT: phase expected=draw actual=play  code=ERR_WRONG_PHASE
  #   broadcast error { code: "ERR_WRONG_PHASE", message: "Cannot draw during play phase" }
  # Verify client:
  grep -E "ERR_WRONG_PHASE" p1.log                        # expect >= 1
  godot --headless --render-thread safe --screenshot .sisyphus/evidence/task-20-fail-illegal-draw.png
  # assert via look_at: ErrorModal visible showing "ERR_WRONG_PHASE\nCannot draw during play phase"; hand panel UNCHANGED (no optimistic update)
  ```

  ### Evidence
  - `.sisyphus/evidence/task-20-happy-draw.png` + `.log`
  - `.sisyphus/evidence/task-20-fail-illegal-draw.png` + `.log`
  - `.sisyphus/evidence/task-20-intent-matrix.md` (the table above + which `room.send` each row fires)
  - `.sisyphus/evidence/task-20-zod-contract-match.md` (diff between `payload` here and T14 Zod schema, ALL green)

  ### Commit
  `feat(godot): intent sender — CardButton + End Turn / Evaluate / Draw mini-buttons`