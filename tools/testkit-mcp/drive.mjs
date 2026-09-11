#!/usr/bin/env node
// Drive the testkit MCP server end-to-end without an MCP host:
//   node drive.mjs calls.jsonl
// Each line of calls.jsonl: {"tool": "...", "args": {...}}
// Spawns server.mjs, sends initialize + each tools/call, prints results.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file) {
  console.error("usage: node drive.mjs <calls.jsonl>");
  process.exit(2);
}
const calls = fs.readFileSync(file, "utf8")
  .split("\n").map((l) => l.trim()).filter(Boolean).map(JSON.parse);

const server = spawn("node", [path.join(HERE, "server.mjs")], {
  stdio: ["pipe", "pipe", "inherit"],
  env: { ...process.env },
});

let nextId = 1;
const pending = new Map();
const rl = readline.createInterface({ input: server.stdout });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  const p = pending.get(msg.id);
  if (p) { pending.delete(msg.id); p(msg); }
});

function rpc(method, params) {
  const id = nextId++;
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res) => pending.set(id, res));
}

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "drive", version: "0" } });
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

let failed = false;
for (const call of calls) {
  const started = Date.now();
  const res = await rpc("tools/call", { name: call.tool, arguments: call.args || {} });
  const text = res.result?.content?.[0]?.text ?? JSON.stringify(res);
  console.log(`\n=== ${call.tool} (${Date.now() - started}ms) ===`);
  console.log(text);
  if (res.result?.isError) failed = true;
}
server.kill();
process.exit(failed ? 1 : 0);
