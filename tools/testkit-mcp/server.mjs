#!/usr/bin/env node
// NerdCard testkit MCP — stdio JSON-RPC (newline-delimited) + TCP hub.
//
// Inverts the godot-mcp-runtime topology: THIS process listens on a TCP
// port and every Godot client dials out with {hello: <id>}. One server
// hosts N clients — no per-client bridge ports, no godot/godot2 pair.
//
// Client side: client/testkit/TestKit.gd (env-gated autoload).
//
// Env: TESTKIT_PORT (default 9721), GODOT_PATH (default macOS location).

import net from "node:net";
import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const CLIENT_DIR = path.join(REPO, "client");
const SHOTS_DIR = path.join(CLIENT_DIR, "tools", "shots");
const PORT = Number(process.env.TESTKIT_PORT || 9721);
const GODOT = process.env.GODOT_PATH || "/Applications/Godot.app/Contents/MacOS/Godot";
const LAUNCH_TIMEOUT_MS = 20000;
const CMD_TIMEOUT_MS = 120000;

// ---------- client registry ----------

/** @type {Map<string, {sock: net.Socket, buf: string, pending: Map<number,{res:Function,rej:Function,t:NodeJS.Timeout}>, nextReq: number, child: import("node:child_process").ChildProcess|null, greetedAt: number}>} */
const clients = new Map();

function log(...a) {
  process.stderr.write(`[testkit] ${a.join(" ")}\n`);
}

const hub = net.createServer((sock) => {
  sock.setNoDelay(true);
  let buf = "";
  let boundId = null;
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (boundId == null) {
        if (typeof msg.hello === "string") {
          boundId = msg.hello;
          attach(boundId, sock);
        }
        continue;
      }
      const c = clients.get(boundId);
      if (c && typeof msg.id === "number") {
        const p = c.pending.get(msg.id);
        if (p) {
          c.pending.delete(msg.id);
          clearTimeout(p.t);
          msg.ok === false ? p.rej(new Error(msg.error || "client error")) : p.res(msg.result);
        }
      }
    }
  });
  const drop = () => {
    if (boundId != null) {
      const c = clients.get(boundId);
      if (c && c.sock === sock) {
        for (const [rid, p] of c.pending) {
          clearTimeout(p.t);
          p.rej(new Error("client disconnected"));
        }
        c.pending.clear();
        clients.delete(boundId);
        log(`client ${boundId} detached`);
      }
    }
  };
  sock.on("close", drop);
  sock.on("error", drop);
});

function attach(id, sock) {
  const prev = clients.get(id);
  if (prev && prev.sock && prev.sock !== sock) prev.sock.destroy();
  clients.set(id, {
    sock, buf: "", pending: new Map(), nextReq: 1,
    child: prev ? prev.child : null,
    greetedAt: Date.now(),
  });
  log(`client ${id} attached`);
}

function sendToClient(clientId, payload, timeoutMs = CMD_TIMEOUT_MS) {
  const c = clients.get(clientId);
  if (!c || !c.sock || c.greetedAt === 0) {
    const known = [...clients.entries()].filter(([, v]) => v.greetedAt > 0).map(([k]) => k);
    return Promise.reject(new Error(`client not ready: ${clientId} (connected: ${known.join(",") || "none"})`));
  }
  const id = c.nextReq++;
  return new Promise((res, rej) => {
    c.pending.set(id, {
      res, rej,
      t: setTimeout(() => { c.pending.delete(id); rej(new Error("client command timeout")); }, timeoutMs),
    });
    c.sock.write(JSON.stringify({ id, ...payload }) + "\n");
  });
}

hub.listen(PORT, "127.0.0.1", () => log(`hub listening 127.0.0.1:${PORT}`));

// ---------- godot spawn ----------

async function launchClient({ client_id, background = false, godot_path }) {
  const existing = clients.get(client_id);
  if (existing) return { client_id, status: "already_connected" };
  const godot = godot_path || GODOT;
  if (!fs.existsSync(godot)) throw new Error(`Godot binary not found: ${godot}`);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const child = spawn(godot, ["--path", CLIENT_DIR], {
      env: {
        ...process.env,
        NERDCARD_TESTKIT_PORT: String(PORT),
        NERDCARD_TESTKIT_ID: client_id,
        NERDCARD_BACKGROUND: background ? "1" : "",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
    let stderrTail = "";
    child.stderr.on("data", (d) => { stderrTail = (stderrTail + d).slice(-4000); });
    child.on("exit", (code) => {
      const c = clients.get(client_id);
      if (c) c.child = null;
      log(`client ${client_id} process exited (${code})`);
    });
    // keep handle so stop_client can kill even before hello arrives
    clients.set(client_id, {
      sock: null, buf: "", pending: new Map(), nextReq: 1,
      child, greetedAt: 0,
    });
    const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const c = clients.get(client_id);
      if (c && c.greetedAt > 0) return { client_id, status: "connected", attempt };
      if (child.exitCode != null) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    child.kill("SIGTERM");
    clients.delete(client_id);
    log(`launch attempt ${attempt} timed out; ${attempt === 2 ? "giving up" : "retrying"}; stderr tail: ${stderrTail.slice(-500)}`);
  }
  throw new Error(`client ${client_id} did not dial in within ${LAUNCH_TIMEOUT_MS / 1000}s (2 attempts)`);
}

async function stopClient({ client_id }) {
  const c = clients.get(client_id);
  if (!c) return { client_id, status: "not_connected" };
  try {
    if (c.greetedAt > 0) await sendToClient(client_id, { cmd: "quit" }, 3000);
  } catch { /* already gone */ }
  await new Promise((r) => setTimeout(r, 500));
  if (c.child && c.child.exitCode == null) c.child.kill("SIGTERM");
  clients.delete(client_id);
  return { client_id, status: "stopped" };
}

// ---------- tool handlers ----------

const TOOLS = [
  {
    name: "launch_client",
    description: "Spawn a Godot client that dials into this hub. Id is your label (e.g. 'p1'). Multiple clients share this one server — no per-client ports.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        background: { type: "boolean", description: "hide window offscreen" },
        godot_path: { type: "string" },
      },
      required: ["client_id"],
    },
  },
  {
    name: "list_clients",
    description: "List attached testkit client ids.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "eval",
    description: "Run a GDScript body inside a client. In scope: tree, gm (GameModel), cm (ConnectionManager), kit (TestKit), root (current scene). Use `return` for a value; `await` works.",
    inputSchema: {
      type: "object",
      properties: { client_id: { type: "string" }, code: { type: "string" } },
      required: ["client_id", "code"],
    },
  },
  {
    name: "send_intent",
    description: "Send a game intent (play_card, draw_cards, end_turn, set_trap, play_defense, force_eval, eval_function, build_function...) via the client's ConnectionManager.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        type: { type: "string" },
        payload: { type: "object" },
      },
      required: ["client_id", "type"],
    },
  },
  {
    name: "wait_state",
    description: "Poll a GDScript expression inside the client every frame until truthy or timeout. Evaluated with gm/cm/root in scope, e.g. \"gm.state.get('phase') == 'defense'\".",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        expr: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["client_id", "expr"],
    },
  },
  {
    name: "screenshot",
    description: "Capture the client's viewport to a PNG (absolute path; default goes to client/tools/shots/).",
    inputSchema: {
      type: "object",
      properties: { client_id: { type: "string" }, path: { type: "string" } },
      required: ["client_id"],
    },
  },
  {
    name: "scenario",
    description: "Run a sequential step list INSIDE the client — one round-trip for the whole sequence, so short windows (15s defense, trap triggers) are reliably caught. Steps: {do:'intent',type,payload} {do:'wait_state',expr,timeout_ms} {do:'wait',ms} {do:'screenshot',path} {do:'eval',code} {do:'expect',expr} {do:'ws_close'} {do:'connect_ws',url} {do:'dump_log',path} {do:'log',msg}. Aborts on first failure, returns per-step results.",
    inputSchema: {
      type: "object",
      properties: {
        client_id: { type: "string" },
        steps: { type: "array", items: { type: "object" } },
        timeout_ms: { type: "number" },
      },
      required: ["client_id", "steps"],
    },
  },
  {
    name: "get_messages",
    description: "Drain the client's ring buffer of every WS message received plus error/connected signals — nothing is lost to a transient banner. state_snapshot spam is excluded unless include_snapshots=true.",
    inputSchema: {
      type: "object",
      properties: { client_id: { type: "string" }, include_snapshots: { type: "boolean" } },
      required: ["client_id"],
    },
  },
  {
    name: "connect_game",
    description: "Tell a client to connect to the game bridge (default ws://localhost:2568).",
    inputSchema: {
      type: "object",
      properties: { client_id: { type: "string" }, url: { type: "string" } },
      required: ["client_id"],
    },
  },
  {
    name: "stop_client",
    description: "Quit a client gracefully, then SIGTERM if still alive.",
    inputSchema: {
      type: "object",
      properties: { client_id: { type: "string" } },
      required: ["client_id"],
    },
  },
];

const HANDLERS = {
  launch_client: launchClient,
  stop_client: stopClient,
  list_clients: () => ({
    clients: [...clients.entries()].map(([id, c]) => ({
      id, connected: c.greetedAt > 0, pid: c.child ? c.child.pid : null,
    })),
  }),
  eval: (a) => sendToClient(a.client_id, { cmd: "eval", code: a.code }),
  send_intent: (a) => sendToClient(a.client_id, { cmd: "intent", type: a.type, payload: a.payload || {} }),
  wait_state: (a) => sendToClient(a.client_id, { cmd: "wait_state", expr: a.expr, timeout_ms: a.timeout_ms || 15000 }, (a.timeout_ms || 15000) + 10000),
  screenshot: (a) => sendToClient(a.client_id, { cmd: "screenshot", path: a.path || path.join(SHOTS_DIR, `testkit-${Date.now()}.png`) }),
  scenario: (a) => sendToClient(a.client_id, { cmd: "scenario", steps: a.steps }, a.timeout_ms || CMD_TIMEOUT_MS),
  get_messages: (a) => sendToClient(a.client_id, { cmd: "get_log", include_snapshots: !!a.include_snapshots }),
  connect_game: (a) => sendToClient(a.client_id, { cmd: "connect_ws", url: a.url || "ws://localhost:2568" }),
};

// ---------- stdio MCP ----------

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function respondErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    switch (method) {
      case "initialize":
        respond(id, {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "nerdicard-testkit", version: "0.1.0" },
        });
        return;
      case "notifications/initialized":
      case "initialized":
        return;
      case "ping":
        respond(id, {});
        return;
      case "tools/list":
        respond(id, { tools: TOOLS });
        return;
      case "tools/call": {
        const h = HANDLERS[params?.name];
        if (!h) { respondErr(id, -32602, `unknown tool: ${params?.name}`); return; }
        const result = await h(params.arguments || {});
        respond(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
        return;
      }
      default:
        if (id !== undefined) respondErr(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    if (id !== undefined) {
      respond(id, { content: [{ type: "text", text: String(e?.message || e) }], isError: true });
    }
  }
});

function cleanup() {
  for (const [id, c] of clients) {
    try { if (c.child && c.child.exitCode == null) c.child.kill("SIGTERM"); } catch {}
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
