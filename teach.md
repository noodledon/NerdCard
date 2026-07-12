# Learn to Understand and Code the NERDICARD Codebase

A beginner's guide for someone who knows basic JavaScript/TypeScript syntax and wants to become able to work on this project independently.

> **How to use this guide:** Do not try to memorize the whole repository. Use this document as a map. Read one section, open the referenced files, run the example, and then explain the idea back to yourself in your own words.

---

## 1. Your goal

By the end of this guide, you should be able to:

1. Find where a feature belongs.
2. Explain how data moves through the server and client.
3. Read a TypeScript interface, class, function, and test.
4. Make a small change without breaking an important project rule.
5. Test your change and investigate a failure.
6. Plan a larger feature as several small changes.

You do **not** need to understand every file before writing code. Professional developers usually understand only the part of the system they are changing, plus the interfaces around it.

---

## 2. First: understand the game, not the code

Start with [`docs/gameplay-flow.md`](docs/gameplay-flow.md). It explains:

- what a card, board, variable, and evaluation are;
- the turn phases;
- the three decks;
- how HP is earned;
- the win conditions;
- the non-negotiable technical constraints.

The most important architectural sentence is:

> The server is authoritative. The Godot client is “dumb/blind”: it renders server state and sends player intents.

That means the client must **not** decide whether a card is legal or calculate the official result. The server receives an intent such as “draw these cards” or “evaluate this board,” validates it, changes the state, and sends the result back.

### A small mental model

```text
Player clicks a button
        │
        ▼
Godot creates an intent/message
        │
        ▼
Server validates the message shape and game rules
        │
        ▼
Server changes authoritative state
        │
        ▼
Colyseus synchronizes state to clients
        │
        ▼
Godot renders the new state
```

The repository now has the core room lifecycle, phase machine, and card-effect command layer. Network message handlers that turn every client intent into these commands are later integration work, so do not assume every gameplay action is playable from the client yet.

### The full request-to-screen workflow

Use this diagram whenever you are trying to understand a feature. Start at the left and follow the arrows to the right:

```text
┌────────────────────┐
│ 1. Player action   │  Clicks Draw, Evaluate, End Turn, etc.
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 2. Godot client    │  Builds a small intent Dictionary/JSON message
│    client/         │  Example: { type: "end_turn" }
└─────────┬──────────┘
          │ WebSocket / Colyseus
          ▼
┌────────────────────┐
│ 3. Room handler    │  Receives the message from a specific player
│    server/         │  Checks connection, turn, and current phase
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 4. Shape validation│  Zod checks that the message has the right fields
│    shared/         │  Invalid input stops here with an error
└─────────┬──────────┘
          │ valid intent
          ▼
┌────────────────────┐
│ 5. Game-rule logic │  Checks cards, domains, targets, limits, and math
│    logic/ + math/  │  This is where the server makes the real decision
└─────────┬──────────┘
          │ legal result
          ▼
┌────────────────────┐
│ 6. Authoritative   │  Updates hp10, hands, decks, boards, phase, timers
│    server state    │  Colyseus Schema stores only serializable values
└─────────┬──────────┘
          │ state patch / server message
          ▼
┌────────────────────┐
│ 7. Colyseus sync   │  Sends permitted state to each connected client
│    state/          │  Private cards remain private via filtering
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│ 8. Godot rendering │  Updates labels, cards, boards, HP, and phase UI
│    client/         │  It displays the result; it does not decide it
└────────────────────┘
```

When debugging, ask which numbered box failed. For example, if clicking **End Turn** changes nothing, do not immediately edit the label. Check: did the button send an intent (2)? did a room receive it (3)? did validation accept it (4)? was the phase legal (5)? did state change (6)? did the client receive the patch (7)?

### The “one feature” reading loop

```text
Choose one user action
        │
        ▼
Find its message type
        │
        ▼
Find the validator and nearest test
        │
        ▼
Find the pure logic function it needs
        │
        ▼
Find the state field it changes
        │
        ▼
Find the client code that displays that field
        │
        ▼
Write a tiny test or explanation before editing
```

---

## 3. The repository map

### Read these first

| File | Why it matters |
|---|---|
| `AGENTS.md` | Rules every coding agent must follow in this repository. |
| `docs/gameplay-flow.md` | Plain-language game rules and vocabulary. |
| `.sisyphus/plans/nerdicard-dev-plan.md` | Master implementation plan and acceptance criteria. |
| `server/package.json` | Commands and dependencies. |
| `server/tsconfig.json` | TypeScript compiler settings. |

### Main folders

```text
NerdCard/
├── docs/                 Game explanation and rulebook
├── server/
│   ├── src/
│   │   ├── data/         Card catalog loading and validation
│   │   ├── logic/        Pure game logic, independent of Colyseus
│   │   ├── math/         Expression parsing, validation, evaluation, scoring
│   │   ├── rooms/        Colyseus room lifecycle and phase-controller bridge
│   │   ├── commands/     Card-effect commands and their dispatcher
│   │   ├── shared/       Types and network message schemas
│   │   └── state/        Colyseus state schemas sent to clients
│   └── package.json
├── client/               Godot 4 project and GDScript UI/client code
└── .sisyphus/            Development plan and wave/task drafts
```

### The server's layers

Think of the server as layers with different responsibilities:

```text
index.ts / app.config.ts
        │  start the server and register room types
        ▼
rooms/NerdiClashRoom.ts
        │  owns connected clients, lifecycle, and synchronization
        ▼
rooms/phaseController.ts
        │  bridges synchronized state to the pure turn FSM
        ├───────────────┬───────────────┐
        ▼               ▼               ▼
shared/messages    state/schema     logic/*
validate message   synchronized     pure rules and
shape              state            card movement
        │
        ▼
math/* + data/*
math rules         card catalog
```

The `logic/` layer is deliberately kept independent of Colyseus. For example, `logic/fsm.ts` owns phase transitions and timers without needing a socket or schema. The room/controller layer copies its results into synchronized state. This makes game rules easier to test as ordinary TypeScript.

### How a card moves through the server

This is a useful picture for understanding a draw, play, or discard operation:

```text
             ┌─────────────────────┐
             │ Card catalog JSON   │
             │ server/src/data/    │
             └──────────┬──────────┘
                        │ load + validate
                        ▼
             ┌─────────────────────┐
             │ Card / CardData     │
             │ typed object        │
             └──────────┬──────────┘
                        │ placed into
                        ▼
       ┌────────────┬───┴────┬────────────┬─────────────┐
       │ FCC deck   │ Number │ Action deck│ Player hand │
       └─────┬──────┴───┬────┴──────┬─────┴──────┬──────┘
             │          │           │            │
             └──────────┴───────────┴────────────┘
                        │ moveCard / Deck.draw
                        ▼
             ┌─────────────────────┐
             │ LogicState          │
             │ pure, easy to test  │
             └──────────┬──────────┘
                        │ callback / mapping
                        ▼
             ┌─────────────────────┐
             │ Colyseus Schema     │
             │ private hand +      │
             │ public counts       │
             └──────────┬──────────┘
                        │ filtered patch
                        ▼
             ┌─────────────────────┐
             │ Godot hand UI       │
             └─────────────────────┘
```

The important distinction is that `CardData` and `LogicState` are ordinary TypeScript data for rules and tests, while `CardSchema` and `PlayerSchema` are networked Colyseus data. A future handler connects those two worlds.

---

## 4. What is actually implemented today?

When you read a plan, separate three things:

1. **Rule/specification:** what the game should do.
2. **Foundation:** code that supports the future feature.
3. **Integration:** code that connects everything into a playable match.

In the current tree:

- `server/src/shared/types.ts` defines the domain vocabulary.
- `server/src/shared/messages.ts` validates the shape of client intents and server messages.
- `server/src/state/schema.ts` defines Colyseus-synchronized state.
- `server/src/data/` loads and validates the card catalog.
- `server/src/logic/` contains pure deck, zone, graveyard, limit, and composition helpers.
- `server/src/math/` contains the math engine abstraction, math.js implementation, expression helpers, domain validation, counters, and complexity scoring.
- `server/src/index.ts` starts a Colyseus server on port `2567`.
- `server/src/app.config.ts` registers the `nerdiclash` room type.
- `server/src/rooms/NerdiClashRoom.ts` creates the two-player room, configures state patches and message rate limits, locks after both seats join, and preserves seats during a 30-second reconnect window.
- `server/src/logic/fsm.ts` is the pure turn phase state machine. It controls legal phase transitions, deadlines, construction submissions, and anti-stall counters.
- `server/src/rooms/phaseController.ts` is the thin bridge that mirrors FSM values into `GameRoomState`.
- `server/src/commands/` contains one command per card-effect archetype. Commands validate their immediate rules and mutate authoritative game state; `CommandDispatcher` chooses the command for a validated intent.
- The Godot files contain an early UI and connection scaffolding. `Main.gd` displays placeholder values, and the Colyseus SDK wrapper has a raw WebSocket fallback.
- Tests cover many foundation modules. Focused lifecycle, FSM, command, evaluation, win-condition, and client-intent integration tests remain important planned work.

This distinction is important: if you cannot find an implementation, it may be planned work rather than a mistake in your search.

---

## 5. TypeScript concepts you will see everywhere

You already know basic JS/TS syntax. These are the project-specific patterns to learn next.

### 5.1 `interface`: the shape of an object

From `server/src/shared/types.ts`:

```ts
export interface Card {
  id: string;
  name: string;
  type: CardType;
  deck: DeckType;
  effectType: EffectType;
  effectParams: Record<string, unknown>;
}
```

Read this as:

> A `Card` object must have these named properties, with these types.

An object that satisfies it could look like:

```ts
const card: Card = {
  id: 'fcc-add-term',
  name: 'Add Term',
  type: 'fcc',
  deck: 'fcc',
  effectType: 'add_term',
  effectParams: {},
};
```

Interfaces usually describe **data**. They do not contain runtime behavior.

### 5.2 A union made from `as const`

```ts
export const BaseDomain = ['rational', 'poly', 'trig', 'exp', 'log'] as const;
export type BaseDomain = (typeof BaseDomain)[number];
```

This creates both:

- a runtime array, `BaseDomain`, useful for checking or iterating;
- a type, also named `BaseDomain`, whose allowed values are only those five strings.

This is safer than using an unrestricted `string` for important game concepts.

### 5.3 `Record`

```ts
Record<string, unknown>
```

means “an object whose keys are strings and whose values may be anything.” It is useful for flexible card parameters, but it gives you less type safety than a dedicated interface.

### 5.4 Classes and private state

From `server/src/logic/deck.ts`:

```ts
export class Deck {
  private cards: CardData[];

  draw(): CardData | null {
    return this.cards.length > 0 ? this.cards.shift()! : null;
  }
}
```

A class combines data and methods. `private cards` means callers should use `draw()`, `peek()`, and `size()` instead of changing the array directly.

The `| null` return type is a useful warning: an empty deck is a normal possibility, so callers must handle it.

### 5.5 `Map` and arrays

You will see:

```ts
const players = new Map<string, PlayerLogic>();
const hand: CardData[] = [];
```

- `CardData[]` is an array of cards.
- `Map<string, PlayerLogic>` maps a player ID to a player object.
- `map.get(id)` can return `undefined`, so check it before using the result.

### 5.6 Imports and type-only imports

```ts
import type { CardData } from './types.js';
```

This imports only the TypeScript type. It does not create a runtime import. Use it when the imported name is needed for type checking but not executed at runtime.

The project uses ESM, so source imports include `.js` even though the source file is `.ts`:

```ts
import { loadCatalog } from './data/load-catalog.js';
```

### 5.7 Discriminated unions

A message has a `type` field that tells you which shape it has:

```ts
{ type: 'end_turn' }

{ type: 'build_function',
  expression: 'x^2 + y',
  variableIds: [1, 2],
  numberCardIds: [] }
```

`server/src/shared/messages.ts` uses Zod to validate these at runtime. TypeScript alone disappears when the program runs, so runtime validation is needed for data arriving over the network.

The key idea is the discriminator:

```ts
if (message.type === 'build_function') {
  // TypeScript can now understand that expression exists.
}
```

---

## 6. The most important project boundaries

### 6.1 Pure logic versus synchronized state

Files under `server/src/logic/` must not import `@colyseus/schema` or `colyseus.js`. They work with ordinary arrays, maps, interfaces, and classes.

Why?

- Pure functions and classes are easier to test.
- They do not depend on a running server or connected client.
- The same rule can be reused by a room handler.

`server/src/state/schema.ts` is different. Its classes extend Colyseus `Schema` and use decorators such as:

```ts
@type('number')
hp10: number = 0;
```

This is the serialized state that clients observe. Do not put arbitrary objects into schema fields.

### 6.2 String-only math expressions

This is locked in:

```text
math.js Node object  ──parse──▶  temporary AST ──toString──▶  string in state
```

Expressions in state are strings such as:

```ts
board.expression = 'x^2 + 3*x';
```

When the server needs to work on one:

```ts
const node = math.parse(board.expression);
// inspect or transform node temporarily
board.expression = node.toString();
```

Never store a math.js `Node` in a Colyseus schema. The schema is designed for serializable values, not library-specific AST objects.

The abstraction in `server/src/math/engine.ts` keeps the internal node opaque so future code can use another math backend without exposing math.js details everywhere.

### 6.3 `hp10` is not ordinary displayed HP

HP is stored as an integer multiplied by ten:

```ts
hp10 = 30;       // display as 3.0 HP
const display = hp10 / 10;
```

Use `Math.floor` for HP deltas. This avoids floating-point differences between clients and the authoritative server.

### 6.4 The client sends intentions, not decisions

A client can send:

```ts
{ type: 'end_turn' }
```

It must not send “I won” or tell the server to trust a computed HP value. The server checks whose turn it is, whether the phase is legal, whether the card is in the player's hand, and whether the expression is valid.

---

## 7. How to explore the codebase without getting lost

### Step 1: ask one narrow question

Bad question:

> How does the entire game work?

Good questions:

- Where is a client message validated?
- What fields are synchronized for a player?
- How does drawing remove a card from a deck?
- Where is polynomial degree checked?
- Which tests describe composition depth?

### Step 2: use CodeGraph first

This repository is indexed. Start with:

```bash
codegraph explore "where is ClientMessage defined and who uses parseClientMessage"
codegraph explore "Deck draw and its tests"
codegraph explore "how is hp10 represented and updated"
codegraph explore "validatePolynomial and callers"
```

CodeGraph can show symbols, source, callers, tests, and blast radius. Search for a **symbol or behavior**, not just a filename.

If CodeGraph does not answer a narrower follow-up, then read the relevant file directly:

```bash
sed -n '1,220p' server/src/shared/messages.ts
```

### Step 3: read the test next to the implementation

A test often explains intended behavior more clearly than comments. For example:

```text
server/src/logic/deck.ts
server/src/__tests__/logic/deck.test.ts
```

Read both together:

1. What does the class expose?
2. What behavior does the test require?
3. What edge cases are tested?
4. What behavior is *not* tested yet?

### Step 4: draw a tiny dependency chain

For a `build_function` feature, write:

```text
Client intent
  → shared/messages.ts
  → future room message handler
  → math/expressions.ts and math/validation.ts
  → state/schema.ts board expression
  → client rendering
```

This prevents random file hopping.

### Step 5: change one boundary at a time

For a new feature, usually work in this order:

1. Add or clarify a type.
2. Add runtime message validation if network input is involved.
3. Implement pure logic.
4. Add tests for the pure logic.
5. Connect it to the room/handler.
6. Update the client only after the server behavior is reliable.

---

## 8. A feature-tracing example: drawing cards

Use this as a model for exploring any feature.

### 8.1 Start with the message

In `server/src/shared/messages.ts`:

```ts
const DrawCardsSchema = z.object({
  type: z.literal('draw_cards'),
  deckChoices: z.array(DrawCardsDeckChoiceSchema),
});
```

This answers: **what shape does the client send?**

Example:

```ts
{
  type: 'draw_cards',
  deckChoices: [
    { deck: 'fcc', count: 1 },
    { deck: 'action', count: 1 },
  ],
}
```

### 8.2 Find the data type

`server/src/logic/types.ts` defines `CardData` and the deck arrays in `LogicState`:

```ts
decks: {
  fcc: CardData[];
  number: CardData[];
  action: CardData[];
};
```

This answers: **what does a pure logic deck contain?**

### 8.3 Find the operation

`server/src/logic/deck.ts` contains:

```ts
draw(): CardData | null
drawN(n: number): CardData[]
```

This answers: **how is a card removed?** `draw()` removes the first card, while an empty deck returns `null` rather than throwing.

### 8.4 Find the state representation

`server/src/state/schema.ts` contains synchronized player fields and private deck fields. Colyseus filtering is used so clients do not see another player's private deck contents.

This answers: **where would the result become visible to clients?**

### 8.5 Notice the missing integration

Search for a room handler that receives `draw_cards`. The `DrawCommand` now contains the immediate draw rule, but the message-handler integration that validates a client message and dispatches that command is still planned work.

Do not invent a fake caller just because the message schema and command both exist. Trace the real handler or implement it as a dedicated integration task.

### 8.6 Draw-card sequence diagram

```text
Player A             Godot             Server room          Deck / state       Player B
   │                    │                   │                   │                 │
   │ click Draw         │                   │                   │                 │
   ├───────────────────▶│                   │                   │                 │
   │                    │ {type:draw_cards}│                   │                 │
   │                    ├──────────────────▶│                   │                 │
   │                    │                   │ validate message  │                 │
   │                    │                   │ check phase/turn  │                 │
   │                    │                   ├──────────────────▶│ draw + add hand │
   │                    │                   │◀──────────────────┤                 │
   │                    │                   │ update handCount  │                 │
   │                    │◀──────────────────┤                   │                 │
   │                    │ render own card   │                   │                 │
   │                    │                   ├─────────────────────────────────────▶│
   │                    │                   │ public count only  │                 │
```

This diagram teaches two rules: the server performs the draw, and Player B should receive only public information such as a changed hand count—not Player A's private card contents.

---

## 9. A feature-tracing example: validating an expression

For an expression such as `x^2 + y`:

1. The message schema accepts an expression as a string.
2. `server/src/math/expressions.ts` parses the string.
3. `server/src/math/validation.ts` checks the expression against a domain.
4. `server/src/math/counters.ts` and `server/src/math/complexity.ts` inspect its AST for scoring.
5. The board stores the final expression as a string.

The validators are domain-specific:

- polynomial validation checks variables, numeric coefficients, and maximum degree;
- trigonometric validation checks allowed functions, nesting, and term count;
- exponential/log validation checks allowed functions, nested powers, and term count.

### How to learn an AST walker

Do not begin by understanding every math.js node type. Start with one function such as `validatePolynomial`:

1. Find `node.traverse(...)`.
2. Notice that the callback visits each part of the parsed expression.
3. See how `SymbolNode` identifies variables.
4. See how the code records facts in a `Set`.
5. Find the final rule check and its error message.
6. Read the test cases that prove the rule.

A useful translation is:

```ts
const vars = new Set<string>();
node.traverse((n) => {
  if (n.type === 'SymbolNode') {
    // record a variable name
  }
});
```

Meaning:

> Walk every AST node; whenever a node represents a symbol, remember its name.

---

## 10. How to write code here as a beginner

### Before coding

Write a mini-spec in plain English:

```text
When a player draws N cards:
- N must be non-negative.
- Only the active player may draw.
- The request must occur in the draw phase.
- The selected deck must exist.
- Each drawn card leaves the deck and enters the player's hand.
- The opponent sees the hand count, not the card contents.
```

Then identify:

- data types involved;
- pure logic to implement;
- network message to validate;
- synchronized state to update;
- tests needed;
- files that should not be touched.

### While coding

Prefer small named functions:

```ts
function isValidDrawCount(count: number): boolean {
  return Number.isInteger(count) && count >= 0;
}
```

Prefer explicit early returns for invalid input:

```ts
if (!isValidDrawCount(count)) {
  return { ok: false, reason: 'count must be a non-negative integer' };
}
```

Keep pure logic free from networking. If a function needs a Colyseus room, it probably belongs in an integration layer rather than `server/src/logic/`.

### After coding

Run the smallest relevant checks first:

```bash
cd server
npx vitest run src/__tests__/logic/deck.test.ts
npm run typecheck
npm test
```

Then inspect your change:

```bash
git diff --check
git diff
```

A green test suite does not prove that a feature is complete; it proves only that the existing checks pass. Compare your implementation with the acceptance criteria in the plan.

---

## 11. Project commands

From the repository root:

```bash
# Explore code structure
codegraph explore "your narrow question here"

# Server type checking
cd server
npm run typecheck

# Run all server tests
npm test

# Run one test file
npx vitest run src/__tests__/messages.test.ts

# Build the server
npm run build

# Start the development server
npm run dev
```

For the Godot client:

```bash
cd client
godot --path .
```

If the `godot` command is unavailable, open the `client/` directory in Godot 4. The client is not yet the best place to begin learning the game rules; start with server types, pure logic, and tests.

---

## 12. A practical learning path

Work through these in order. Each step should end with a small change or written explanation.

### Lesson 1 — Read the vocabulary

Open `server/src/shared/types.ts` and explain, without looking:

- the difference between `Card`, `Board`, and `PlayerState`;
- what `BaseDomain`, `Phase`, and `EffectType` restrict;
- why `hp10` is a number rather than a decimal HP field.

### Lesson 2 — Read a class and its tests

Read `server/src/logic/deck.ts` and its tests. Then add a test for one behavior you can predict, such as `peek()` not removing a card.

### Lesson 3 — Read a runtime validator

Read `server/src/shared/messages.ts` and `messages.test.ts`. Add a test for an invalid `end_turn` payload or a malformed `eval_function` payload. Predict whether it should pass before running the test.

### Lesson 4 — Understand state privacy

Read the `@filter()` fields in `server/src/state/schema.ts`. Write a paragraph explaining why the opponent receives `handCount` rather than the actual hand.

### Lesson 5 — Trace a math rule

Choose one rule in `server/src/math/validation.ts`, find its test, and make a table:

| Input | Expected result | Why |
|---|---|---|
| `x^2 + 1` | valid/invalid | your explanation |
| `x^6` | valid/invalid | your explanation |
| `x + y` | valid/invalid | your explanation |

### Lesson 6 — Make a pure feature

Implement a tiny helper in a suitable `logic/` module, test it first, and keep it independent of Colyseus. Examples:

- validate a requested draw count;
- count cards in a zone;
- reset a per-player composition tracker;
- format an HP display value from `hp10`.

Before adding a helper, search for an existing one. Duplicating a rule in two places creates future bugs.

### Lesson 7 — Read the plan as a dependency graph

Open `.sisyphus/plans/nerdicard-dev-plan.md`. For one task, identify:

- what it depends on;
- what files it will probably change;
- what tests prove it;
- which later task will call it.

Do not start a task until you can say what its inputs and outputs are.

---

## 13. Beginner debugging playbook

### TypeScript error: “Property X does not exist”

Ask:

1. Is the value possibly `undefined`?
2. Did I narrow a union with `if (value.type === ...)`?
3. Am I using the correct interface?
4. Did I spell the property exactly as the type defines it?

Do not immediately cast to `any`. A cast hides the clue that TypeScript is giving you.

### Test failure

Read the failure from the bottom upward:

1. Which expectation failed?
2. What actual value was produced?
3. What input reached the function?
4. Which branch produced that value?
5. Is the code wrong, or is the test assuming a different rule?

Add a temporary `console.log` only after you have narrowed the failing function, and remove it when done.

### Network or client failure

Separate the layers:

```text
Did Godot send anything?
  → Is the JSON/message shape valid?
    → Is a server room/handler registered?
      → Is the game phase legal?
        → Did state change?
          → Did the client render the change?
```

Do not debug UI labels when the server never received the message.

### “I cannot find the implementation”

Check all three possibilities:

- Search for the symbol with CodeGraph.
- Search for the message/type and its tests.
- Check the plan: it may be a future task.

A declared type or message is not proof that a working handler exists.

---

## 14. Common mistakes to avoid

1. **Starting with the entire codebase.** Start with one user action and trace it.
2. **Changing the client first.** The authoritative rule belongs on the server.
3. **Putting math.js nodes in state.** Store expression strings only.
4. **Using displayed HP in server calculations.** Use integer `hp10` and floored deltas.
5. **Putting Colyseus imports in pure logic.** Keep the logic layer testable.
6. **Trusting client-provided results.** Treat all client data as untrusted input.
7. **Changing a type without searching its callers.** Use CodeGraph to inspect blast radius.
8. **Writing a large function before writing examples/tests.** Examples expose unclear rules early.
9. **Assuming a plan is current code.** Verify every claim against the source tree.
10. **Using `any` to silence a compiler error.** Understand the type problem first.

---

## 15. Your repeatable “next time” checklist

When you receive a new coding task:

```text
[ ] Read the relevant section of docs/gameplay-flow.md.
[ ] Read the task's wave file or master-plan section.
[ ] State the feature in one plain-English sentence.
[ ] Ask CodeGraph one narrow question.
[ ] Locate the type, implementation, and nearest tests.
[ ] Draw the input → validation → logic → state → client path.
[ ] Check the project's locked constraints.
[ ] Make the smallest change that proves the behavior.
[ ] Add or update a focused test.
[ ] Run the focused test and typecheck.
[ ] Run the full test suite when the focused checks pass.
[ ] Inspect git diff and git diff --check.
[ ] Explain what is implemented and what remains planned.
```

### A good first sentence before every code change

Write this in your notes:

> “I am changing **[file/function]** so that **[behavior]**. It receives **[input]**, returns or updates **[output]**, and must preserve **[constraint]**.”

If you cannot fill in all four blanks, explore a little more before coding.

---

## 16. Final perspective

Coding is not mainly remembering syntax. It is learning to answer four questions:

1. **What data exists?** — types and state schemas.
2. **Who is allowed to change it?** — server authority and phase rules.
3. **What transformation should happen?** — pure logic and math functions.
4. **How do we know it works?** — tests and acceptance criteria.

For NERDICARD, practice following one card from its catalog JSON, through a typed object, into a deck, through a player intent, into validated server state, and finally to a client display. Once you can trace that journey, the repository will stop feeling like a wall of files and start feeling like a set of connected, understandable decisions.

When a section is confusing, ask for a small lesson on exactly that section—for example: “teach me `MapSchema`,” “walk me through `validatePolynomial`,” or “help me write the test for drawing a card.”
