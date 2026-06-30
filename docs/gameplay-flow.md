# NERDICARD — Gameplay Flow Explainer

> A plain-language walkthrough of how NERDICARD actually plays, what's being built in the MVP, and the rules you can verify against the implementation.
> Companion to the full development plan at `.sisyphus/plans/nerdicard-backend.md`.

---

## 1. What Is NERDICARD?

NERDICARD is a **mathematically-driven strategic card game** where players construct, manipulate, and attack mathematical expressions. You build functions across multiple boards, use advanced math (calculus, number theory, linear algebra) to compromise opponents' functions or HP, and evaluate expressions strategically to gain advantage.

Think of it as: **Yu-Gi-Oh meets calculus** — cards are math operations, your "monster" is a function, and "attacking" means applying transformations to your opponent's expression.

**The MVP is "NerdiClash" mode, 2 players, authoritative server.**

---

## 2. Tech Stack (What's Being Built)

| Layer | Tech | Role |
|-------|------|------|
| **Backend Server** | Node.js + TypeScript | The brain — all rules, shuffling, win/loss logic lives here |
| **Multiplayer Framework** | Colyseus.js | Rooms, matchmaking, real-time state sync |
| **Math Engine** | math.js | Evaluates expressions, derivatives, matrix ops |
| **Client** | Godot 4 + GDScript | "Dumb" client — renders state, sends intents only |
| **Testing** | vitest | Tests written after implementation |

**Anti-cheat principle**: The client is *blind*. It never computes rules. It only shows what the server tells it and sends player intents like "play card #3" or "evaluate." The server validates everything.

---

## 3. Player Resources (What You Start With)

Each player begins a match with:

| Resource | Count | Notes |
|----------|-------|-------|
| Base Function Card | 1 | Picks your domain (see §4) |
| Variable Cards | 10 | Labeled x1..x10, each usable ONCE per construction phase |
| Number Cards | ~7 | Primes (2, 3, 5) + irrationals (π, e, √2, φ, etc.) — reusable |
| Starter Cards | 5 | Random mix from FCC / Action / Defense decks |
| Variable Value Cards (VVC) | 5 | Used during evaluation — one VVC substitutes for ALL variables |
| HP | 0 | You *gain* HP by evaluating functions — start empty |
| Function Boards | 1 (max 3) | Where your function lives; add more via "Add Board" cards |

---

## 4. Function Domains (Your Base Card Choice)

Your Base Function Card locks you into one of three domains. Everything you build must conform:

| Domain | Restriction |
|--------|-------------|
| **Rational / Polynomial** | Polynomials up to degree 5; coefficients are integers −5..5 (no 0 unless explicitly allowed) |
| **Trigonometric** | Up to 6 trig terms (sin, cos, tan, etc.) combined by addition or multiplication ONLY — no nested compositions like `sin(cos(x))` |
| **Exponential / Logarithmic** | Up to 10 combined log/exp terms with bases 2, 10, or e; `ln^power` counts as 2 terms |

**The server validates every function you build against your domain.** If you try to play a card that violates your domain, the server rejects it.

---

## 5. The Three Decks

Players draw from three separate decks during the game:

| Deck | Contains | Example Cards |
|------|----------|---------------|
| **FCC Deck** | Function Component Cards — building blocks for functions | Add Term, Derivative, Integral (stubbed), Limit (stubbed), Modular, Vector, Matrix, Transform, Eigenvalue |
| **Number Deck** | Constants and arithmetic operators | 2, 3, 5, π, e, √2, φ |
| **Action Deck** | Offensive, defensive, trap, spell, theorem, special cards | Offensive ("Divide by 2"), Shield (ln protects against e), Trap (snarecoded), Martial Theorem (Chaos Theory rearranges opponent's terms), Artifact Theorem (Realist blocks imaginary terms), Add Board, Composition, Force Evaluation, Evaluate |

---

## 6. The Turn Cycle (Heart of the Game)

Players alternate turns. Each turn has **4 phases**:

```
┌─────────────────────────────────────────────────────────────┐
│                      A SINGLE TURN                          │
├──────────────┬──────────────────────────────────────────────┤
│ 1. DRAW      │ Active player draws 2 cards from any         │
│    PHASE     │ combination of the 3 decks (e.g. 1 FCC +     │
│              │ 1 Action, or 2 Number cards).                │
├──────────────┼──────────────────────────────────────────────┤
│ 2. PLAY      │ Active player performs up to 2 actions:      │
│    PHASE     │  • Build/modify function with FCC cards       │
│              │  • Play attack card targeting opponent        │
│              │  • Play defense/shield/trap/theorem         │
│              │  • Play special card (Add Board, Composition, │
│              │    Force Evaluation)                          │
│              │  • Evaluate their function                    │
│              │                                               │
│              │ ⚠️ MAX 1 offensive action per turn            │
│              │ ⚠️ Setting a trap blocks offensive that turn  │
├──────────────┼──────────────────────────────────────────────┤
│ 3. DEFENSE   │ Other player may respond to attacks/plays    │
│    PHASE     │ using defense or trap cards. Max 1 defense   │
│              │ or trap per triggered event.                 │
│              │ Turn timer: 15s (auto-pass if no response).  │
├──────────────┼──────────────────────────────────────────────┤
│ 4. RESOLUTION│ All played cards resolve. Used cards go to   │
│    PHASE     │ the "3rd Dimension" (graveyard). Turn passes │ │
│              │ to the opponent.                              │
└──────────────┴──────────────────────────────────────────────┘
```

**Turn timer**: 30 seconds for play phase. If you don't act, the server auto-advances.

---

## 7. Card Types & Effects

### Function Component Cards (FCCs)
- **Add Term Cards** — Add terms to your function (must comply with your domain)
- **Calculus FCCs** — Differentiation (works), Integration (stubbed), Limit (stubbed), Continuity (stubbed)
- **Number Theory FCCs** — Modular arithmetic, prime factor manipulation, theorems (Fermat's, Euler's)
- **Linear Algebra FCCs** — Vector/matrix operations, linear transformations, rank/eigenvalue manipulations

### Action Cards (from Action Deck)
| Type | What It Does | Example |
|------|--------------|---------|
| **Offensive** | Attacks opponent's function or HP | "Divide by 2" halves opponent's function value |
| **Shield** | Protects from specific attacks | Natural log shield blocks e-based attacks |
| **Trap** | Activates in response to opponent's action | Snarecoded — counters a Force Evaluation |
| **Martial Theorem** | Offensive theorem | Chaos Theory rearranges all terms in opponent's function |
| **Artifact Theorem** | Passive benefit | Realist prevents imaginary terms entering your function |
| **Special: Add Board** | Adds a new function board (max 3) | Enables Linear Algebra mechanics |
| **Special: Composition** | Substitute one board's function into another's variable | Cross-domain only, depth ≤2 |
| **Special: Force Eval** | Compel simultaneous evaluation | See §10 |
| **Special: Evaluate** | Evaluate your function for HP | See §9 |

### Number Cards
- Have a numeric value (primes, irrationals)
- Can **bind** to a spell or offensive card as a factor — they stay bound until reaching the graveyard, then unbind

---

## 8. Building & Modifying Functions

Your function lives on a **Function Board** as a math expression string (e.g., `"x^2 + 3*x"`). The server stores it as a string, parses it on-the-fly with math.js when it needs to evaluate or modify it.

### Construction Phase (Game Start)
1. Both players build their initial function simultaneously
2. They submit a `build_function` intent with their expression
3. Server validates it against their Base Function Card domain
4. Once both submit valid functions → game transitions to Draw phase

### During Play
- **Add Term FCCs** add terms to your expression (e.g., turns `"x^2"` into `"x^2 + 2*x"`)
- **Calculus FCCs** transform your expression (derivative of `"x^2"` → `"2*x"`)
- **Composition** substitutes one function into another (cross-domain only, max depth 2)

### Multiple Boards
- Start with 1 board, can add up to 3 via "Add Board" cards
- Each board has its own function and domain
- Composition lets you pipe one board's output into another's input

---

## 9. Evaluation Mechanics — The HP Gain Engine

Evaluation is how you gain HP. Here's the exact flow:

### Step-by-Step Evaluation
1. **Play an Evaluate card** (or trigger Force Evaluation)
2. **Choose a Variable Value Card (VVC)** from your hand
3. Server parses your function string → math.js AST
4. Server substitutes the VVC's value for ALL variables in the function
5. Server computes the **Function Value** at that point
6. Server computes the **Complexity Score** using a custom AST Walker (T9):
   - +1 per **distinct variable** (x, y, z…)
   - +1 per **term beyond the first** (top-level additions)
   - +2 per **composition** (g(f(x)) nested structure)
   - **Eligibility**: if <2 distinct variables → score forced to 0, NO HP gained
7. Server calculates: `hpGain = Math.floor(FunctionValue × ComplexityScore / 10)`
8. HP stored internally as integer ×10: `player.hp10 += hpGain * 10`

### Concrete Examples

| Function | VVC Value | Function Value | Complexity | eligible? | hpGain10 |
|----------|-----------|----------------|------------|-----------|----------|
| `x` | 2 | 2 | 1 (1 var, 0 terms beyond, 0 comp) | ❌ (<2 vars) | **0** |
| `x^2 + 3*x` | 2 | 10 | 2 (1 var + 1 term beyond) | ❌ (<2 vars) | **0** |
| `x^2 + y` | 2 (both vars) | 6 | 3 (2 vars + 1 term beyond) | ✅ | **Math.floor(6×3/10)×10 = 10** |
| `sin(x) + cos(y)` | 2 | ~0.49 (sin2 + cos2) | 3 (2 vars + 1 term beyond) | ✅ | ~0 (small value) |
| `g(f(x))` explicit composition | 2 | (depends on g,f) | +2 composition bonus on top of var/term scores | depends | depends |
| `x*y + z + 1` | 2 | 7 | 5 (3 vars + 2 terms beyond) | ✅ | **Math.floor(7×5/10)×10 = 30** |

### After Evaluation
- The evaluated function is **removed from the board**
- Its cards are reshuffled into the FCC deck
- Used variable cards are **returned to your hand**
- The VVC is consumed

### Undefined / Infinite Evaluation
- If evaluation yields `Infinity`, `NaN`, or throws (e.g., division by zero):
  - The affected board is **destroyed**
  - If this was the player's only surviving function → **immediate loss**

---

## 10. Force Evaluation — The Showdown Card

Force Evaluation is a high-stakes card that compels **all players to evaluate simultaneously**.

### Resolution Logic (per rulebook §8.4)

```
FORCE EVALUATION FLOW
═════════════════════

1. Initiator plays Force Evaluation card
2. ALL players' functions are evaluated simultaneously
3. Compare values:
   ┌──────────────────────────────────────────────────────┐
   │ DOMINATION CHECK: Is the initiator's value            │
   │ STRICTLY GREATER THAN 2× every opponent's value?     │
   │ (Using FP epsilon 1e-9 to avoid edge cases)            │
   └──────────────────────────────────────────────────────┘
           │
           ├─ YES → DOMINATION WIN
           │   • Initiator wins the game IMMEDIATELY
           │   • NO HP transfer happens
           │   • No board destruction
           │   • Win reason = 'force_eval_domination'
           │
           └─ NO → NO DOMINATION (initiator pays penalty)
               • Initiator loses HALF their HP
                 halfA = Math.floor(initiator.hp10 / 2)
                 initiator.hp10 -= halfA
               • HP redistribution:
                 - If opponent's value > initiator's value:
                   opponent.hp10 += halfA (they get the half)
                 - If opponent's value ≤ initiator's value:
                   the half is DISCARDED (no beneficiary)
               • Initiator's main function board is DESTROYED
               • Initiator gains NO HP from their own evaluation
               • Game continues — initiator might lose via HP=0 path
```

### Concrete Force Eval Examples

| Scenario | Initiator Val | Opp Val | Result |
|----------|---------------|---------|--------|
| A=100, B=30 | 100 | 30 | **A WINS** (100 > 2×30=60) — game over, no HP moved |
| A=60.000001, B=30 | 60.000001 | 30 | **A WINS** (just above 2× threshold with epsilon) |
| A=60, B=30 | 60 | 30 | No domination (60 ≯ 60). A loses half HP. B doesn't beat A (30<60), so HP is discarded. A's board destroyed. |
| A=60, B=80 | 60 | 80 | No domination. A loses half HP. B beats A (80>60), so B gets the half. A's board destroyed. |

---

## 11. Win Conditions

A player wins by achieving ANY ONE of:

| # | Condition | How It Triggers |
|---|-----------|-----------------|
| 1 | **Reduce opponent HP to 0** | Attack cards or post-force-eval HP=0 |
| 2 | **Isolate opponent's variables** | Reduce opponent's function to a single variable like `{x}`. They have **3 turns** to rebuild a valid function. If they fail → they lose. Tracked via `variable_isolation_timers[sessionId]`. |
| 3 | **Force Evaluation domination** | Initiator's value > 2× every opponent's (see §10) |
| 4 | **Linear Algebra destruction** | Reduce opponent's vector space dimension to 0, OR force their matrix board to become singular (determinant = 0) |

---

## 12. Stalling Prevention (Two-Mechanism Design)

The rulebook §8.5 has TWO independent anti-stall rules. The plan uses TWO counters (only ONE was originally specced, which created an unreachable bug — this is being fixed):

### Counter 1: `consecutive_no_eval_turns` (0..5)
- **Resets to 0** every time ANY evaluation occurs (normal or forced)
- Increments each turn where no one evaluates
- **Triggers forced evaluation when it reaches 5**

### Counter 2: `global_no_eval_turns` (0..20)
- **NEVER resets** — counts from game start
- Caps at 20
- **Triggers forced evaluation when it reaches 20**

### Why Two Counters?
- The old single-counter design reset on eval. With resets, it could never accumulate to 20 (because it would trigger at 5 first). So the 20-turn global rule was unreachable — a bug.
- Two counters fix this: one for the "5 consecutive" panic mechanism, one for the "20 turns globally" hard cap. They have different reset semantics because the rulebook treats them as independent mechanisms.

---

## 13. Cards: The Frozen MVP Catalog (~25 cards)

The v1 catalog is **frozen** — no additions during development. It spans every archetype:

### FCC Cards (10)
| # | Card | Effect Type |
|---|------|-------------|
| 1 | Term Surge | Add Term |
| 2 | Flux Delta | Derivative |
| 3 | Anti-Flux | Integral (STUBBED) |
| 4 | Limit Break | Limit (STUBBED) |
| 5 | Mod Cage | Modular Arithmetic |
| 6 | Fermat Echo | Number Theory Theorem |
| 7 | Vector Shift | Vector op |
| 8 | Matrix Weave | Matrix op |
| 9 | Transform Lens | Linear Transform |
| 10 | Eigen Lance | Eigenvalue |

### Action Cards (9)
| # | Card | Effect |
|---|------|--------|
| 11 | Power Spike | Offensive (attack) |
| 12 | Aegis Guard | Shield/Defense |
| 13 | Snarecoded | Trap |
| 14 | Pythagoras Strike | Martial Theorem |
| 15 | Euler's Ward | Artifact Theorem |
| 16 | Second Foundation | Add Board |
| 17 | Nested Chaos | Composition |
| 18 | Showdown | Force Evaluation |
| 19 | Evaluate | Evaluation trigger |

### Number Cards (6)
| # | Card | Value |
|---|------|-------|
| 20 | Two | 2 |
| 21 | Three | 3 |
| 22 | Five | 5 |
| 23 | Pi | π |
| 24 | Euler's Number | e |
| 25 | Golden Ratio | φ |

### Variable Value Cards (5) — separate dealing, not in deck pools
| # | Card | Numeric Value |
|---|------|---------------|
| VVC-1 | Variable Anchor: 2 | 2 |
| VVC-2 | Variable Anchor: π | π |
| VVC-3 | Variable Anchor: 3 | 3 |
| VVC-4 | Variable Anchor: 10 | 10 |
| VVC-5 | Variable Anchor: -1 | -1 |

VVCs are dealt at end of construction phase — 5 per player. They're not drawn from the FCC/Number/Action decks.

---

## 14. Edge Cases the Server Handles

| Case | Handling |
|------|----------|
| Deck exhaustion | Graveyard auto-reshuffles into the deck |
| Both decks empty | Player draws nothing; turn continues |
| Simultaneous Force Eval plays | Turn player's effect resolves first; opponent's fizzles |
| Card targets a destroyed board | Card fizzles, goes to graveyard |
| Both players disconnect | Room stays alive 30s for reconnect; then disposes |
| Reconnect during defense phase | Resume pending defense timer if still pending |
| Undefined evaluation (1/0, ln(0)) | Board destroyed; immediate loss if integral to survival |
| FP edge in Force Eval (exactly 2×) | `A=60, B=30` → A does NOT win (60 ≯ 60 + 1e-9) |
| Odd HP during redistribution | `Math.floor` discards remainder (e.g., 301/2 = 150, remainder 1 discarded) |
| Negative HP | Floor at 0 (HP can't go negative) |

---

## 15. The Authoritative Server Principle

This is the core anti-cheat design:

```
CLIENT (Godot)                      SERVER (Colyseus)
═══════════════                     ═════════════════
                                   
Renders state  ←── patches ───────  Mutates all state
                                   
Sends intents  ─── "play card 3"→  Validates:
                                    ✓ Is it your turn?
                                    ✓ Valid phase?
                                    ✓ Card in your hand?
                                    ✓ Legal target?
                                    ✓ Not over offensive limit?
                                    ✓ Trap doesn't block it?
                                    ↓
                                    Dispatches command
                                    Mutates schema
                                    Broadcasts delta patch
                                    ↓
Receives patch ←── broadcast ────  
Renders update                       
```

**The client NEVER:**
- Computes win/loss
- Shuffles decks
- Validates card legality
- Stores hidden information (opponent's hand)
- Calculates HP

**The client ONLY:**
- Renders what the server tells it
- Sends intents ("play card N", "evaluate", "end turn")
- Shows error messages when the server rejects an intent

---

## 16. The Minimal Godot Test Client

The MVP client is intentionally bare-bones — **text-rendering only, no animations, no card art, no sound**:

- **Connect screen**: IP/URL input, Connect button, Status label
- **Game board**: 
  - Two player panels (top=opponent, bottom=you)
  - HP displayed as `hp10 / 10` (integer ×10 server field)
  - Function boards rendered as raw expression strings (`"x^2 + 3*x"`)
  - Domain badge, composition depth badge
  - Hand as a row of card buttons (text labels: card name + type)
  - Deck counts (FCC: 5 | Num: 3 | Act: 7)
  - Phase label ("Draw Phase" / "Play Phase" / etc.)
  - Turn indicator
  - Trap slot indicator (hidden content if not owner)
- **Buttons**: Draw FCC / Draw Number / Draw Action, End Turn, Evaluate, error modal
- **Intents on click**: Card click → `play_card`, End Turn → `end_turn`, Draw → `draw_cards`

No lobby beyond direct IP connect. No matchmaking beyond `joinOrCreate`.

---

## 17. The 4-Week Development Roadmap (Summary)

The full plan has 20 tasks across 5 parallel waves mapped to ~4 weeks:

| Week | Waves | What Happens |
|------|-------|--------------|
| **Week 1** | W1 + start W2 | Scaffolding (T1-T5: project setup, types, catalog, math engine, Godot SDK) + begin core schema/engine (T6-T9) |
| **Week 2** | Finish W2 + W3 | Complete state schema, pure logic, expression layer, complexity walker + game flow (T10-T14: room, FSM, card effects, evaluation, win conditions) |
| **Week 3** | W4 + W5 | Integration (T15-T17: handlers, edge cases, tests) IN PARALLEL with Godot client (T18-T20: connect, render, send intents) |
| **Week 4** | FINAL | 4 verification agents (F1-F4: compliance, code quality, manual QA, scope fidelity) + user acceptance |

Critical path: `T1 → T6 → T11 → T15 → T17 → F1-F4 → user okay`

---

## 18. The Three Critical Architectural Constraints

These are **locked in** and cannot be violated:

### Constraint 1: String-Only Expressions in Schema
Math.js `Node` objects can NEVER live in Colyseus Schema fields. Expressions are stored ONLY as `@type("string")`. The server parses `string → AST` on-the-fly via `math.parse(str)` when it needs to modify or evaluate, then serializes back via `node.toString()`.

**Why**: Colyseus schemas only accept primitives, nested Schemas, MapSchema, ArraySchema. Putting a math.js Node would break serialization entirely.

### Constraint 2: Custom Complexity Score Walker (T9)
math.js has no native function to count "distinct variable terms" or "nested compositions." A custom AST visitor (`computeComplexity`) walks the Node tree via `node.traverse()` to compute the score dynamically before the HP formula is applied.

### Constraint 3: Floating-Point Determinism
- HP is stored as an integer ×10 (`hp10` field on schema) — display by dividing by 10
- All HP deltas use `Math.floor`
- The Force Evaluation "2× domination" rule uses epsilon `1e-9` to avoid floating-point edge cases

---

## 19. SymPy Operations — Stubbed for v1

The "Full math domain" scope includes calculus/number theory/linear algebra. But math.js can't do everything. These operations are **stubbed** (returning `{ supported: false, reason: "Not implemented in v1" }`) and deferred to a Python/SymPy microservice post-MVP:

| Operation | Status | Reason |
|-----------|--------|--------|
| Derivative (`d/dx`) | ✅ Working | math.js supports |
| Simplify | ✅ Working | math.js supports |
| Matrix: determinant, inverse, SVD, LU, QR | ✅ Working | math.js supports |
| Complex numbers (full) | ✅ Working | math.js supports |
| gcd, lcm, mod, isPrime | ✅ Working | math.js supports |
| **Symbolic Integration** | ⏳ STUBBED | math.js issue #442 open since 2015 |
| **Limit Evaluation** | ⏳ STUBBED | Not in math.js roadmap |
| **RREF (Reduced Row Echelon Form)** | ⏳ STUBBED | Not available in math.js |
| **Rank** | ⏳ STUBBED | Undocumented in math.js |

A "Math Engine Capability Matrix" document is part of the plan deliverables — it tracks green/yellow/red per operation.

---

## 20. Glossary

| Term | Definition |
|------|------------|
| **Board** | A play area representing one function or function space (max 3 per player) |
| **FCC** | Function Component Card — used to build/modify functions |
| **Variable Card** | Represents a variable (x1..x10); usable once per construction phase, returned on evaluation |
| **Number Card** | Represents a constant or operator; reusable unless specified |
| **Evaluation** | Substituting variables with values to compute function value and gain HP |
| **Trap** | A card that responds to opponent actions by negating or altering effects |
| **Force Evaluation** | Special card compelling all players to evaluate simultaneously |
| **3rd Dimension** | The graveyard — where used cards go after resolution |
| **VVC (Variable Value Card)** | Provides a numeric value used during evaluation; substitutes for ALL variables |
| **Variable Isolation** | When a player's function is reduced to a single variable (e.g., just `{x}`) — triggers 3-turn rebuild timer |
| **Composition** | Substituting one function into another's variable; cross-domain only, depth ≤2 |
| **DOMINATE_EPSILON** | Constant `1e-9` used in force-eval 2× comparison to avoid floating-point edge cases |
| **hp10** | HP field on schema; stored as integer ×10 (e.g., `hp10 = 300` means 30 HP) |

---

## Quick Reference: One Full Turn Walkthrough

**Setup**: Both players built functions. Player A has `f(x,y) = x^2 + y` on a Polynomial board. Player B has `g(x) = sin(x) + cos(x)` on a Trig board. HP: A=0, B=0.

1. **Draw Phase (A)**: A draws 1 FCC + 1 Action card
2. **Play Phase (A)**: 
   - Action 1: A plays `Evaluate` card with VVC=2 → `f(2,2) = 6`, complexity=3, `hpGain = floor(6×3/10)=1`, A's `hp10 += 10` → A.hp10=10 (displayed as 1.0 HP)
   - Action 2: A plays `Power Spike` offensive card targeting B's function with a Number Card (value 2) bound → divides B's function value by 2
3. **Defense Phase**: B responds with `Aegis Guard` shield (if valid) — server validates, shield blocks the attack
4. **Resolution Phase**: Used cards go to graveyard; A's evaluated function is reshuffled into FCC deck; A's variables return to hand; turn passes to B
5. **B's Draw Phase**: B draws 2 cards
6. ...continues...

**Stalling check**: If neither player has evaluated in 5 consecutive turns → forced evaluation triggers. After 20 global turns without ANY evaluation → forced evaluation also triggers.

**Victory**: When A's `hp10 <= 0`, B wins via `hp_zero`. When B's function is isolated to `{x}` and B fails to rebuild in 3 turns, A wins via `variable_isolation`.

---

*This explainer is a companion document to `.sisyphus/plans/nerdicard-backend.md` (the full work plan). For implementation details, task specs, QA scenarios, and parallelization waves, refer to the plan.*