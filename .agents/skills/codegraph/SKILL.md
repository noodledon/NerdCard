---
name: codegraph
description: Use CodeGraph for codebase exploration and symbol lookup. Reach for this BEFORE grep/find or reading files when you need to understand, locate, or navigate code. Provides verbatim source, call paths, and blast radius in one shot.
---

# CodeGraph

CodeGraph is a code intelligence index that builds a knowledge graph of your codebase — symbols, relationships, call paths, and blast radius. Use it as your **first resort** for understanding code.

## When to Use This Skill

Use CodeGraph when you need to:

- **Understand** what a symbol/function/type does
- **Locate** where something is defined or used
- **Trace** call paths and dependencies
- **Assess blast radius** before editing (what breaks if I change this?)
- **Explore** an area of the codebase quickly

## When NOT to Use This Skill

- The `.codegraph/` directory does **not exist** at the repo root → skip entirely
- You need raw text search across the whole repo (use `grep`/`rg` instead)
- You're reading a specific file you already know the path of

## Prerequisite Check

Before using CodeGraph, verify the index exists:

```bash
ls .codegraph/ 2>/dev/null && echo "Index exists" || echo "No index — skip CodeGraph"
```

If `.codegraph/` is missing, **do not use CodeGraph**. Proceed with grep/find/read as normal.

---

## How to Use CodeGraph

### Method 1: MCP Tool (Preferred, When Available)

If CodeGraph is available as an MCP tool in your environment:

```
codegraph_explore("<symbol names or question>")
```

This is a single function call that returns everything — source, call paths, blast radius.

### Method 2: Shell CLI (Always Works)

If no MCP tool is available, use the shell command:

```bash
codegraph explore "<symbol names or question>"
```

Both methods return the same structured output:
1. **Relevant symbols** — matched by name or semantic relevance
2. **Blast radius** — what depends on each symbol (callers, tests)
3. **Verbatim source** — current on-disk source of matched files, line-numbered

---

## Workflow Rules

### Rule 1: CodeGraph First for Understanding

When you need to understand code, **start with CodeGraph**:

```bash
# ✅ GOOD — ask a question, get source + relationships in one shot
codegraph explore "how does card evaluation work"
codegraph explore "PlayerSchema hp10"
codegraph explore "math engine derivative"

# ❌ BAD — defaulting to grep before trying CodeGraph
grep -r "evaluate" src/
```

### Rule 2: Trust the Verbatim Source

The source code returned by CodeGraph is **re-read from disk on every call** — it is byte-for-byte identical to what the Read tool returns. Treat it as if you already called Read on those files. **Do not re-Read files shown in CodeGraph output.**

### Rule 3: Check Blast Radius Before Editing

Before modifying any symbol, check what depends on it:

```bash
codegraph explore "functionName"
```

Look for:
- Callers you might break
- Tests that cover the symbol (or ⚠️ warnings about missing coverage)

### Rule 4: Fall Back to grep/find When Appropriate

CodeGraph is for **symbol-level exploration**. Use standard tools for:
- Raw text search across the entire codebase
- Finding files by name pattern
- Reading a specific known file

---

## Example Queries

| Goal | Query |
|------|-------|
| Understand a function | `codegraph explore "loadCatalog"` |
| Find all callers | `codegraph explore "mathjsEngine.derivative"` |
| Explore a concept | `codegraph explore "card evaluation win condition"` |
| Check type usage | `codegraph explore "PlayerSchema"` |
| Trace dependencies | `codegraph explore "EffectType prime eval"` |

---

## Tips

1. **Be specific but natural** — "how does X work" and "X" both work
2. **Multiple terms** — `"math engine derivative"` narrows to the right symbols
3. **Check test coverage** — CodeGraph flags symbols with no covering tests
4. **Rebuild if stale** — If results look wrong, run `codegraph sync` or `codegraph index`

---

## Commands Reference

```bash
codegraph init [path]       # Initialize index (first time)
codegraph index [path]      # Full rebuild from scratch
codegraph sync [path]       # Incremental sync since last index
codegraph status [path]     # Show index stats and freshness
codegraph query <search>    # Search for symbols by name
codegraph explore <query>   # Full exploration: source + call paths + blast radius
```
