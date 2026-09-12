# Game Modes 2–3 — Design Doc

> Design pass for the two post-MVP game modes, per wave-12 T4. **No code is
> specified for immediate implementation** — this doc is the contract a future
> modes wave executes against.
>
> Sources: `docs/NerdiCard.txt` (rulebook v1.0), `docs/gameplay-flow.md`,
> `report.md` (pinned v1 semantics), `server/src/logic/fsm.ts`,
> `server/src/state/schema.ts`, `server/src/shared/messages.ts`,
> `server/src/data/card-catalog.json`, `.sisyphus/docs/nerdicard-overview.md`.

---

## 1. What the sources actually define

The three-mode list exists only in `.sisyphus/docs/nerdicard-overview.md:20-23`,
which summarizes a design doc — **`Nerdicard Game Logic Version 1.txt` — that is
not in the repo.** The rulebook itself has no per-mode sections; its rules are
written as one game. Everything known about modes 2–3:

| Mode | Source text | Status |
|------|-------------|--------|
| **NerdiClash** (mode 1) | "Official — Win by Variable Isolation OR reducing opponent HP to 0" | **Shipped** — this is v1 |
| **Variable Isolation** (mode 2) | "Win only by isolating opponent's variables" | One sentence |
| **Classic Clash** (mode 3) | "Pure HP attack mode" | One sentence, marked **WIP** in the source |

Consequences for this design:

- v1 (NerdiClash) actually ships *four* rulebook win paths — `hp_zero`,
  `variable_isolation`, `force_eval_domination`, `singular_board` (incl. dim0) —
  plus `abandoned`. Modes 2–3 are **subsets plus small deltas**, not new games.
- Because the source spec is two sentences, the rulebook-silent decisions are
  listed as **open questions (§7)** with a recommended default each — nothing
  here invents rules silently.
- Both modes are 2-player, same turn structure, same frozen catalog. Nothing in
  either mode's summary implies N-player, new phases, or new cards.

### v1 mechanics the modes reuse (verified in code)

- FSM: `waiting → construction → draw → play → defense → resolution →
  gameOver` (`logic/fsm.ts`) — generic, no mode coupling.
- Win adjudication: `logic/winEngine.ts checkWin()` — three independent
  branches (hp0 gated by `everGainedHP`; isolation gated by
  `variable_isolation_timers[id] === 0` + `isIsolatedExpression(boards[0])`;
  board-wipe via `destroyed/isActive=false/isSingular/dimension=0` on all
  boards). `runForceEval` handles the domination branch separately.
- Isolation machinery: `tickIsolationTimers()` starts a 3-turn countdown when
  **every active board** has ≤1 distinct variable (`distinctVariablesInExpression`),
  clears it otherwise; `checkWin` lands the kill only if `boards[0]` has
  **exactly** 1 variable when the timer hits 0 (`math/expressions.ts`).
- Turn economy: 2 actions/turn, 1 aggressive/turn, trap-set counts as
  aggressive; deferred attack + defense window; §8.5 stalling auto force-eval
  at consecutive=5 / global=20 (nominator = just-ended player, vvc=1).
- Mode flag precedent: the Colyseus room already sets metadata
  `{ mode: 'nerdiclash' }` (`NerdiClashRoom.ts:84`). The JSON bridge — the only
  live transport — has no mode concept yet; `join_room` carries `room`,
  `sessionId`, `reconnectToken`, `displayName`, parsed ad hoc in
  `json-bridge.ts handleJoin`.

---

## 2. Shared seam: how a mode is selected and applied

Both modes ride one piece of plumbing — this is most of the implementation
cost, paid once.

**Mode as rules configuration, not a subclass.** A new pure module
`server/src/logic/modes.ts` exports:

```ts
export type GameMode = 'nerdiclash' | 'variable_isolation' | 'classic_clash';

export interface ModeProfile {
  win: { hpZero: boolean; isolation: boolean; forceDomination: boolean; boardWipe: boolean };
  /** Isolation predicate for the kill check: 1 = v1's exactly-1-var. */
  isolationMaxVars: number;
  /** Turns an isolated player gets to rebuild (v1: 3, counted in game-turns). */
  isolationRebuildTurns: number;
  /** Whether the Showdown card is playable (its domination win aside). */
  forceEvalCard: boolean;
  /** Behavior of the §8.5 auto showdown: 'standard' | 'soft_wipe'. */
  stallingEval: 'standard' | 'soft_wipe';
  /** Cards allowed to target opp_board beyond their v1 scope (mode overlay). */
  offensiveTargeting: Readonly<Record<string, 'opp_board'>>;
}
export const MODE_PROFILES: Record<GameMode, ModeProfile> = { ... };
```

This shape is a recommendation, not a mandate — the invariant that matters:
**one `GameRoomState` schema, one FSM, one command set; mode = data.**

**Where it lands:**

| Layer | Change |
|-------|--------|
| `join_room` (bridge) | optional `mode` field; validated against the `GameMode` enum; invalid → `INVALID_PAYLOAD`. Slot captures mode at creation (`slot.mode`); a later join naming a live room with a different mode → error (recommended new `MODE_MISMATCH` `ErrorCode`, or reuse `INVALID_PAYLOAD`). Seat reclaim ignores `mode` (the seat's mode is the room's). |
| `GameSlot` | `+ mode: GameMode` — fixed at slot birth, dies with it. |
| `NerdiClashGame` | `constructor(mode: GameMode = 'nerdiclash')`; writes `state.config.mode`; resolves `MODE_PROFILES[mode]` once into `this.profile`. |
| Schema | `RoomConfigSchema` gains `@type('string') mode = 'nerdiclash'` → 4 fields (limit is 64 — trivially fine). |
| Snapshot | `getStateSnapshot()` adds root `mode` (config is not currently snapshotted — surface it flat). |
| `joined` | echoes `mode` back (additive; older clients ignore it). |
| `checkWin` | `checkWin(state, profile)` — each branch gated by `profile.win.*`. |
| `runForceEval` | domination → `declareWinner` gated by `profile.win.forceDomination`; the failed-domination penalty path unchanged. |
| `tickIsolationTimers` | skipped when `!profile.win.isolation` (timers stay `{}` in snapshots). |
| Colyseus path | `onCreate` reads mode from room options → constructor; `setMetadata` already exists. **Optional** — the bridge is the only live transport; note parity, don't require it. |
| Wave-12 T1 `list_rooms` (in flight) | `room_list` rows should carry `mode` — one field on the in-flight spec. |
| Rematch (w11-t2, merging separately) | a rematch must inherit `slot.mode`, not re-ask. |

No new intents, no new phases, no new winReason enum values — VI reuses
`variable_isolation`; CC reuses `hp_zero`/`force_eval_domination`/
`singular_board`/`abandoned`.

---

## 3. Mode 2 — Variable Isolation

**Spec:** "Win only by isolating opponent's variables." Recommended profile:

```ts
{
  win: { hpZero: false, isolation: true, forceDomination: false, boardWipe: false },
  isolationMaxVars: 1,              // see OQ-4: recommend ≤1, not exactly-1
  isolationRebuildTurns: 3,
  forceEvalCard: false,             // Showdown is a dead card here — see below
  stallingEval: 'soft_wipe',        // see §3.3 — 'standard' makes stallers invincible
  offensiveTargeting: { derivative: 'opp_board', limit: 'opp_board' },
}
```

### 3.1 Rules delta vs NerdiClash

| Element | NerdiClash (v1) | Variable Isolation |
|---------|-----------------|--------------------|
| Win paths | hp0, isolation, force-dom, board-wipe | **isolation only** |
| HP | decisive resource | still exists, still moves (eval grants, attacks drain, force-eval redistributes) — **non-decisive** (OQ-2) |
| Evaluation | HP engine | doubles as the **escape valve**: eval wipes the board to `''` → unparseable → clears the isolation timer |
| Showdown card | domination gamble | recommended mode-gated off (always-self-harm otherwise) |
| §8.5 auto showdown | standard | recommended `soft_wipe` (§3.3) |
| `derivative`, `limit` | own boards only | recommended `opp_board` scope — **the actual isolation weapons** (§3.2) |
| Construction | any domain-valid expression | recommended minimum 2 distinct variables (OQ-6 — else turn-1 self-owns) |
| Destroyed boards | permanently dead | recommended rebuildable via `build_function` (OQ-7 — else zombie states) |
| Turn structure, decks, catalog, action economy | — | **unchanged** |

### 3.2 The arsenal gap — the mode's blocking problem

Verified against `server/src/commands/`: only three commands touch opponent
state at all:

| Command | Opponent effect | Removes a variable? |
|---------|-----------------|---------------------|
| `AttackHpCommand` (Power Spike, Pythagoras Strike) | `pendingAttackDamage10` | No — never touches expressions |
| `NtTheoremCommand` (Fermat Echo) | constants `mod 7` on target board | No — `x+y` has no constants; `x^2+8x+7` was already 1-var |
| `EigenvalueCommand` (Eigen Lance) | kills a **matrix** board | No — kills the board, doesn't isolate it |

**No v1 card can reduce an opponent board's distinct-variable count.** In v1
isolation is effectively self-inflicted (a 1-var construction, or your own
cards simplifying you down). Under "win only by isolating", an opponent who
builds `x + y` can never be forcibly isolated → no win path → **the mode is
unendable as the catalog stands.** The catalog is frozen (locked constraint 4)
— no new cards — so the weapon must come from re-scoping existing cards:

- `mathEngine.derivative(expr, v)` keeps only terms containing `v`:
  `d/dx (x^2 + y) → 2*x` — every other variable eliminated. This **is**
  variable isolation, already implemented, currently self-only.
- `mathEngine.limit(expr, v, 0)` similarly strips `v` (`lim y→0 (x^2+y) = x^2`)
  — same effect, SymPy-backed or poly-only on math.js.
- The wire already has the selection field: `PlayCardSchema.variable` exists
  (consumed today only by composition) — forwarding it to derivative/limit
  payloads is additive, no schema change.

**Recommended overlay:** in VI only, `derivative` and `limit` accept
`target:{kind:'opp_board', id}` (routing resolves `targetPlayerId` +
`targetBoardId` exactly like `ntTheorem`/`eigenvalue`), forward `variable`
(attacker picks which variable *survives*), and the play counts as aggressive
(`markAggressiveActionUsed` — it is an attack). Catalog `targetRules` are not
edited — the mode layer overlays scope; the frozen file is untouched.

Defender's escapes (all already live mechanics): **Term Surge** adds `t`
(`x → x+t`, 2 vars), **Evaluate** wipes the board, **Second Foundation** adds a
board (the timer needs *every* active board ≤1 var — a fresh `''` board breaks
it), **Composition**, or `build_function` on a wiped board. The attacker's job:
isolate all active boards simultaneously and hold for 3 game-turns. Escape is
cheap but card-gated — flag as the mode's balance risk (OQ-8).

Board-kills still work in VI (Eigen Lance on matrices; undefined evals) and are
*siege* plays — shrinking the set the attacker must isolate — since
boardWipe=false means the last board can't be killed for a win, only isolated.

### 3.3 §8.5 stalling eval cannot run as-is

v1's auto showdown destroys the nominator's main board on failed domination.
In VI (domination off, boardWipe off): a staller losing their only board leaves
them with **zero active boards → `reduced` requires ≥1 active board → they can
never be isolated → permanently un-losable.** Stalling becomes the optimal
strategy — the anti-stall mechanism inverts.

Recommended `soft_wipe` variant for VI: the §8.5 trigger evaluates every
active board at vvc=1 (same trigger, same nominator rule), then sets
`expression = ''` on each — post-eval state, rebuildable through the existing
play-phase `build_function` path. No HP movement, no destruction. Effect:
stalling forces *everyone* back to construction-of-function, resetting the
isolation siege — progress pressure without creating invincibility.

### 3.4 Isolation predicate asymmetry (v1 edge, mode-critical)

- Timer (`tickIsolationTimers`): every active board **≤1** distinct var —
  includes 0-var constants (`5`).
- Kill (`checkWin` → `isIsolatedExpression`): `boards[0]` must be **exactly 1**.

So a constant-only main board ticks the timer forever but never dies. For VI
recommend `isolationMaxVars: 1` meaning ≤1 for *both* checks — a board reduced
to a constant is more isolated, not less. Keep v1 NerdiClash at exactly-1
(shipped semantics, don't move it); the profile field splits the difference
cleanly. (OQ-4.)

### 3.5 Schema/FSM/wire impact

- **Schema:** `config.mode` only (shared seam). `variable_isolation_timers`,
  board flags, `hp10` — all reused as-is. No field-pressure.
- **FSM:** zero new phases/transitions.
- **Commands:** `DerivativeCommand`/`LimitCommand` gain mode-gated opponent
  targeting (resolve target player like `NtTheoremCommand`, forward
  `variable`, mark aggressive); `BuildFunctionCommand` gains a mode-gated
  destroyed-board rebuild branch; `ForceEvalCommand`/`dispatchIntent` gain a
  mode-gated rejection for the Showdown card. `runStallingForceEval` gains the
  `soft_wipe` branch.
- **One shared bug to fix:** `tickIsolationTimers()` is only called from
  `requestEndTurn` — the deadline auto-pass path in `tick()` skips it, so an
  isolated player's countdown never advances while turns time out. Cosmetic
  exploit in v1; **mode-breaking in VI.** Fix on the shared path (both modes
  benefit), not behind the profile.
- **Client:** mode picker (shared), an isolation-countdown surface —
  `variable_isolation_timers` is already public in snapshots but the client
  doesn't render it; VI needs a per-player "isolated: N turns left" badge.

---

## 4. Mode 3 — Classic Clash

**Spec:** "Pure HP attack mode" (WIP). Recommended profile:

```ts
{
  win: { hpZero: true, isolation: false, forceDomination: true, boardWipe: true },
  isolationMaxVars: 1, isolationRebuildTurns: 3,
  forceEvalCard: true, stallingEval: 'standard',
  offensiveTargeting: {},
}
```

### 4.1 Rules delta vs NerdiClash

| Element | NerdiClash (v1) | Classic Clash |
|---------|-----------------|---------------|
| Win paths | all four | **`hp_zero`** (+ recommended: `force_eval_domination`, `singular_board`/dim0 stay on — OQ-9) |
| Isolation | 3-turn timer → loss | **off** — timers stay empty; cards that simplify expressions are just... simplification |
| Everything else | — | **unchanged**: eval is the HP engine, attacks drain it, defense windows, traps, §8.5 auto showdown (an HP-swing event — on-theme), 2-action economy |

Why the two "extra" wins stay on by default: `force_eval_domination` is the
Showdown card's entire payoff — disabling it makes the card strictly
self-harming (always lose half HP + board) → dead draw. `boardWipe` off would
create zombie states (a player with zero live boards can't eval, can still
attack — endable but degenerate). Both flags exist; if "pure" is taken
literally, flip them and accept the named consequences.

### 4.2 Impact

- **Schema/FSM:** nothing beyond the shared seam — literally zero mode-specific
  state. `tickIsolationTimers` skips itself via the profile flag.
- **Wire:** nothing beyond `join_room.mode`/`joined.mode`/snapshot `mode`.
- **Client:** mode picker + a mode badge; `WIN_REASON_LABELS` already covers
  every reason CC can emit.
- **Tests:** per-win-path gating tests (isolation timer never starts; an
  isolated opponent doesn't lose at timer 0; hp0/domination/board-wipe still
  land).

This mode is a **rules filter over v1** — no new mechanics anywhere.

---

## 5. Engine impact (both modes)

Under the recommended profiles, **zero new math-engine capability is needed**:

| Need | Have | Gap |
|------|------|-----|
| Variable elimination (VI weapon) | `mathEngine.derivative` (math.js ✓), `mathEngine.limit` (SymPy / poly-only) | none — routing change, not math |
| Isolation detection | `distinctVariablesInExpression`, `isIsolatedExpression` | none |
| Eval / HP / force-eval | `evalEngine.evaluate`, `evalEngine.forceEval` | none |
| Board-wipe detection | `isSingular`/`isActive`/`dimension` flags + `linalg.ts` | none |
| §8.5 soft-wipe | existing eval + `expression=''` write | none |

The work is in *routing, gating, and adjudication* — never in `math/`. (If a
future VI variant wanted "solve for x" mechanics, symbolic equation solving is
the known math.js gap → SymPy; nothing in this design needs it.)

---

## 6. Locked-constraint audit

| Constraint | Verdict |
|------------|---------|
| Strings-only expressions on the wire/schema | ✅ untouched — mode adds no AST state |
| `hp10` int ×10, `Math.floor` deltas | ✅ untouched — VI keeps hp10 as a live-but-non-decisive resource |
| Schema ≤64 fields/class | ✅ +1 field total (`RoomConfigSchema.mode` → 4/64) |
| 30-card catalog frozen — no additions | ✅ respected — VI's arsenal is a **targeting overlay** on existing cards; `card-catalog.json` unedited |
| TS strict | ✅ profiles are typed literals |
| FSM transitions | ✅ unchanged — no new phases |
| Wire `winReason` enum | ✅ unchanged — both modes emit existing members |

**No locked constraint needs breaking.** The one gray area worth saying out
loud: VI's `opp_board` targeting changes what a *card* does by mode — a rules
overlay, not a catalog edit; if "frozen" is read to cover targeting semantics
too, that's a product call (OQ-3).

---

## 7. Open questions (rulebook is silent — recommendations in **bold**)

**Source-level**

- **OQ-1.** The mode spec is two sentences from a doc that's not in the repo.
  Confirm `.sisyphus/docs/nerdicard-overview.md` is the authoritative mode
  source, or recover `Nerdicard Game Logic Version 1.txt` before the
  implementation wave starts.

**Variable Isolation**

- **OQ-2.** Does HP do anything in VI? **Recommended: live-but-non-decisive**
  (eval still grants it, attacks still drain it, hp0 is not a loss — zero
  engine change). Alternative: strip HP entirely — bigger doc/code surface for
  no gameplay gain.
- **OQ-3.** Which cards may isolate? **Recommended: `derivative` + `limit` gain
  `opp_board` scope with `variable` forwarding, aggressive-marked, VI-only.**
  Alternative (none): mode is unendable — reject.
- **OQ-4.** Isolation kill predicate: exactly-1 var (v1) or ≤1 (includes
  constant boards)? **Recommended ≤1 in VI** via `isolationMaxVars`; v1 keeps
  exactly-1.
- **OQ-5.** Does the 3-turn window count game-turns (v1: timer ticks every
  `end_turn`) or the victim's own turns? **Recommended: keep v1 game-turns.**
- **OQ-6.** May a player *construct* a ≤1-var initial function (self-own)?
  **Recommended: VI construction requires ≥2 distinct vars** (mode-gated
  `submitBuildFunction`/`BuildFunctionCommand` check).
- **OQ-7.** All-boards-destroyed player in VI — boardWipe is off, so how do
  they re-enter? **Recommended: `build_function` may rebuild destroyed boards
  in VI** (mode-gated relaxation of `isBoardAlive`). Alternative: only Second
  Foundation resurrects — risks permanent stalemate.
- **OQ-8.** Escape difficulty — Term Surge/Evaluate/Add Board all break the
  timer for one card. Too cheap? **Recommended: ship v1 semantics, playtest,
  then tune** (options: timer survives a wipe at -1, escape requires
  domain-valid rebuild, etc.) — don't pre-balance on a two-sentence spec.
- **OQ-9.** (also CC) For CC: do `force_eval_domination` and board-wipe still
  win? **Recommended: yes** (dead-card/zombie reasoning, §4.1).
- **OQ-10.** The Showdown card in VI: **recommended mode-gated rejection**
  (`force_eval` → reason "Showdown has no effect in Variable Isolation").
  Alternative: playable-but-always-penalty — pointless.
- **OQ-11.** §8.5 form in VI: **recommended `soft_wipe`** (evaluate all, set
  `expression=''`, no destruction/HP) — 'standard' makes the staller
  un-isolatable (§3.3). Alternative: disable §8.5 entirely — removes stall
  pressure.
- **OQ-12.** Undefined eval in VI (rulebook §10.1 "immediate loss if integral
  to survival"): board destroys as usual — and a destroyed board is *outside*
  the isolation net. **Recommended: unchanged** (an eval-mishap is a dodge,
  which is fine texture), but note `undefined_integral_loss` is a declared-but-
  never-emitted winReason — available if a mode wants the literal rulebook
  reading.

**Cross-cutting**

- **OQ-13.** `join_room.mode` on a live room that disagrees: **recommended
  reject** (`MODE_MISMATCH` or `INVALID_PAYLOAD`) rather than silently
  absorbing.
- **OQ-14.** Mode-specific deck composition (e.g., pull Showdown from VI decks
  instead of rejecting at play time)? **Recommended: unified decks** — play-
  time rejection keeps one code path and preserves draw math.
- **OQ-15.** Should a VI room advertise differently in `list_rooms` (wave-12
  T1)? **Recommended: add `mode` to `room_list` rows** — one field, spec'd
  while T1 is in flight.

---

## 8. Implementation-wave task breakdown

Sized like the wave files; dependencies and file-collision notes called out.

| Task | Scope | Files | Parallel? |
|------|-------|-------|-----------|
| **M1 — Mode plumbing** | `GameMode`+`ModeProfile`+`MODE_PROFILES`; `config.mode`; `NerdiClashGame(mode)`; `join_room.mode` + slot capture + mismatch reject; `joined.mode`; snapshot `mode`; `checkWin(state, profile)` signature + call sites; profile-gated `tickIsolationTimers`; unit tests | `logic/modes.ts` (new), `state/schema.ts`, `rooms/NerdiClashGame.ts`, `logic/winEngine.ts`, `json-bridge.ts`, `shared/{types,messages,ErrorCode}.ts`, tests | **No — blocks all** |
| **M2 — Classic Clash** | CC profile values; per-win-path gating tests; doc pin of OQ-9 decision | `logic/modes.ts`, `__tests__/logic/`, `__tests__/rooms/` | **Yes** — after M1; disjoint from M3 |
| **M3 — Client mode picker** | code-built `OptionButton` on ConnectRow (same pattern as `_room_line_edit`); `ConnectionManager.game_mode` + `join_msg.mode`; snapshot `mode` → badge; headless check | `client/game.gd`, `client/scripts/ConnectionManager.gd`, `GameModel.gd` | **Yes** — after M1; disjoint from M2/M4 |
| **M4 — VI arsenal + rules** | `opp_board` overlay for derivative/limit (VI); `variable` forwarding; aggressive marking; construction ≥2-var gate; destroyed-board rebuild; Showdown rejection; `soft_wipe` §8.5; `isolationMaxVars`; **shared fix:** `tickIsolationTimers` on the auto-pass path | `rooms/NerdiClashGame.ts` (`toCommandIntent`), `commands/{Derivative,Limit,BuildFunction,ForceEval}Command.ts`, `logic/modes.ts`, `rooms/NerdiClashGame.ts` (stalling), tests | Partially — after M1; **collides with M2** only in `modes.ts` (trivial) and with anything touching `NerdiClashGame.ts` — sequence after M2 or rebase |
| **M5 — VI playability pass** | isolation end-to-end tests (isolate → timer → escapes → kill), timer auto-pass regression, client countdown badge; balance notes → report | `__tests__/`, `client/game.gd` | No — after M3+M4 |
| **M6 — Live QA + docs** | per-mode ws probes (join modes, mismatch, VI isolate-kill, CC hp0), `godot-2p-playtest` both modes, `report.md`/`AGENTS.md`/`gameplay-flow.md` updates | docs + evidence | No — final gate |

Dependency graph: `M1 → {M2 ∥ M3} → M4 → M5 → M6` (M4 may start once M1 lands
if M2's `modes.ts` edit is sequenced; safest to run M2 before M4 since it's
hours not days).

---

## 9. Recommended build order: Classic Clash first

**Classic Clash is unambiguously cheaper**, and not by a little:

| | Classic Clash | Variable Isolation |
|--|----------------|--------------------|
| New mechanics | none | opp-board targeting, `variable` forwarding, soft-wipe §8.5, construction gate, destroyed-board rebuild |
| Rules decisions needed | 1 (OQ-9) | 8+ (OQ-2…OQ-12) — several blocking |
| Can be unendable by accident | no | yes (arsenal gap, §8.5 inversion, zombie boards) |
| New wire surface | shared seam only | seam + targeting semantics |
| Client surface | picker + badge | picker + badge + isolation countdown |

CC is "v1 with flags off" — it proves the entire seam end-to-end (join → slot →
game → profile → checkWin → snapshot → client picker) on a mode you can verify
in one playtest. VI then rides proven plumbing and spends its whole budget on
the genuinely hard part: making isolation *achievable* (arsenal) and
*defensible* (escape/tuning) without creating unendable states.

Sequenced: **M1 (plumbing) → M2 (CC) + M3 (client) → M4/M5 (VI) → M6.** VI's
blocking open questions (OQ-1, OQ-3, OQ-7) should be answered before M4
starts — ideally when this doc is reviewed.

---

## 10. Latent v1 issues surfaced by this design (for the record)

Found while auditing for the modes; each is a candidate fix independent of
modes work:

1. **`tickIsolationTimers` never runs on deadline auto-pass** — only
   `requestEndTurn` calls it (`NerdiClashGame.ts:400`); the `tick()` play/
   defense auto-pass path skips it. In v1 an isolated player's countdown is
   frozen while turns time out — a stall exploit that becomes mode-breaking
   in VI. Recommend fixing on the shared path regardless of mode work.
2. **`PlayCardSchema.variable` is unrouted for derivative/limit** — the wire
   field exists and `DerivativeCommand`/`LimitCommand` accept `variable`, but
   `toCommandIntent` never forwards it. v1 players can't pick the
   differentiation variable (defaults to first/`'x'`). Additive fix; VI needs
   it.
3. **Timer/kill predicate asymmetry** — `≤1 var` starts the countdown but
   `==1 var` on `boards[0]` lands the kill (`tickIsolationTimers` vs
   `checkWin`+`isIsolatedExpression`). Constant-only boards stall the win
   forever in v1; VI's `isolationMaxVars` profile absorbs it.
4. **`undefined_integral_loss` is a dead winReason** — declared in
   `shared/types.ts` + `GameOverSchema`, never emitted. Rulebook §10.1's
   "immediate loss" is currently only reachable indirectly via
   all-boards-destroyed. Available vocabulary if a mode (or a v1 fidelity
   pass) wants the literal rule.
