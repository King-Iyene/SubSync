import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKey, hashKey, looksLikeKey } from "../mcp/keys.ts";
import { handleRpc, type ToolDef } from "../mcp/protocol.ts";

const tools: ToolDef[] = [
  { name: "echo", description: "Echo", inputSchema: { type: "object", properties: { text: { type: "string" } } }, run: async (a) => ({ said: a.text }) },
  { name: "boom", description: "Fails", inputSchema: { type: "object" }, run: async () => { throw new Error("database is down"); } },
];

const rpc = (method: string, params?: Record<string, unknown>, id: number | undefined = 1) => ({ jsonrpc: "2.0", id, method, params });

test("initialize negotiates a supported protocol version", async () => {
  const r = (await handleRpc(rpc("initialize", { protocolVersion: "2024-11-05" }), tools)) as { result: { protocolVersion: string; serverInfo: { name: string }; capabilities: object } };
  assert.equal(r.result.protocolVersion, "2024-11-05");
  assert.equal(r.result.serverInfo.name, "subsync");
  assert.ok("tools" in r.result.capabilities);
  const odd = (await handleRpc(rpc("initialize", { protocolVersion: "1999-01-01" }), tools)) as { result: { protocolVersion: string } };
  assert.equal(odd.result.protocolVersion, "2025-03-26");
});

test("tools/list returns names, descriptions and schemas but never the run function", async () => {
  const r = (await handleRpc(rpc("tools/list"), tools)) as { result: { tools: Array<Record<string, unknown>> } };
  assert.deepEqual(r.result.tools.map((t) => t.name), ["echo", "boom"]);
  assert.ok(r.result.tools.every((t) => !("run" in t) && "inputSchema" in t));
});

test("tools/call runs a tool and returns text content", async () => {
  const r = (await handleRpc(rpc("tools/call", { name: "echo", arguments: { text: "hi" } }), tools)) as { result: { content: Array<{ type: string; text: string }> } };
  assert.equal(r.result.content[0].type, "text");
  assert.deepEqual(JSON.parse(r.result.content[0].text), { said: "hi" });
});

test("a failing tool is reported as a tool error, not a protocol error", async () => {
  const r = (await handleRpc(rpc("tools/call", { name: "boom" }), tools)) as { result: { isError: boolean; content: Array<{ text: string }> } };
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /database is down/);
});

test("unknown tools and methods get proper JSON-RPC errors", async () => {
  const t = (await handleRpc(rpc("tools/call", { name: "nope" }), tools)) as { error: { code: number } };
  assert.equal(t.error.code, -32602);
  const m = (await handleRpc(rpc("resources/list"), tools)) as { error: { code: number } };
  assert.equal(m.error.code, -32601);
});

test("notifications get no response and malformed requests are rejected", async () => {
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, tools), null);
  assert.equal(await handleRpc({ jsonrpc: "2.0", method: "something/else" }, tools), null);
  for (const bad of [null, "text", [], {}, { jsonrpc: "1.0", method: "ping", id: 1 }, { jsonrpc: "2.0", id: 1 }]) {
    const r = (await handleRpc(bad, tools)) as { error: { code: number } };
    assert.equal(r.error.code, -32600);
  }
  const ping = (await handleRpc(rpc("ping"), tools)) as { result: object };
  assert.deepEqual(ping.result, {});
});

test("generated keys have the right shape, are unique and verify by hash only", () => {
  const a = generateKey();
  const b = generateKey();
  assert.ok(looksLikeKey(a.key));
  assert.notEqual(a.key, b.key);
  assert.equal(a.hash, hashKey(a.key));
  assert.ok(a.key.startsWith(a.prefix));
  assert.ok(!a.hash.includes(a.key));
  assert.equal(a.hash.length, 64);
  assert.equal(looksLikeKey("sk_subsync_short"), false);
  assert.equal(looksLikeKey("Bearer abc"), false);
  assert.equal(looksLikeKey(null), false);
});
