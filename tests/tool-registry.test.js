import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.js";

const snapshot = JSON.parse(
  await readFile(new URL("./fixtures/tool-specs.snapshot.json", import.meta.url), "utf8"),
);

test("keeps the historical 57-tool Bitwig MCP surface stable", () => {
  const tools = TOOL_SPECS.map(({ name, policy }) => [name, policy]);
  const schemas = TOOL_SPECS.map(({ name, policy, inputSchema }) => ({
    name,
    policy,
    inputSchema,
  }));
  const digest = createHash("sha256").update(JSON.stringify(schemas)).digest("hex");

  assert.equal(TOOL_SPECS.length, snapshot.count);
  assert.equal(new Set(TOOL_SPECS.map(({ name }) => name)).size, snapshot.count);
  assert.deepEqual(tools, snapshot.tools);
  assert.equal(digest, snapshot.schemaDigest);
});

const enabled = () => ({ BITWIG_MCP_TOOL_DISCOVERY: "1" });
const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const noDaw = () => { throw new Error("discovery/validation must not contact a DAW"); };

test("discovery is additive and explicitly opt-in; annotations do not imply safe writes", async () => {
  const legacy = getToolDefinitions({ env: {} });
  const tools = getToolDefinitions({ env: enabled() });
  assert.deepEqual(tools.slice(0, -2), legacy);
  assert.deepEqual(tools.slice(-2).map((tool) => tool.name), ["search_tools", "call_tool"]);
  assert.equal(tools.at(-1).annotations.readOnlyHint, false);
  assert.equal(tools.at(-1).annotations.destructiveHint, true);
  tools.at(-1).inputSchema.required.push("tampered");
  assert.deepEqual(getToolDefinitions({ env: enabled() }).at(-1).inputSchema.required, ["name"]);
  for (const name of ["search_tools", "call_tool"]) {
    const result = await handleToolCall(request(name), { env: {}, call: noDaw });
    assert.equal(result.isError, true);
    assert.equal(payload(result).error, "tool_unavailable");
  }
});

test("search pages only currently permitted definitions, preserving schemas and registry order", async () => {
  const env = enabled();
  const search = async (args) => payload(await handleToolCall(request("search_tools", args), { env, call: noDaw }));
  const first = await search({ limit: 3 });
  assert.equal(first.tools.length, 3);
  assert.equal(first.total, getToolDefinitions({ env: {} }).length);
  assert.equal(first.nextOffset, 3);
  const second = await search({ limit: 20, offset: first.nextOffset });
  assert.equal(second.nextOffset, null);
  assert.deepEqual([...first.tools, ...second.tools].map((tool) => tool.name),
    getToolDefinitions({ env: {} }).map((tool) => tool.name));
  for (const tool of first.tools) {
    assert.deepEqual(tool.inputSchema, TOOL_SPECS.find((spec) => spec.name === tool.name).inputSchema);
    assert.equal(tool.policy, "read");
  }
  assert.deepEqual((await search({ query: "TRANSPORT tempo" })).tools.map((t) => t.name), ["transport_get_tempo"]);
  assert.equal((await search({ query: ".*" })).total, 0);
  assert.deepEqual((await search({ offset: 10000 })).tools, []);
  assert.equal((await search({ query: "transport_play" })).tools.some((t) => t.name === "transport_play"), false);
  env.BITWIG_MCP_WRITE_POLICY = "transport";
  assert.ok((await search({ query: "transport_play" })).tools.some((t) => t.name === "transport_play"));
  delete env.BITWIG_MCP_WRITE_POLICY;
  assert.equal((await search({ query: "transport_play" })).tools.some((t) => t.name === "transport_play"), false);
});

test("rejects malformed wrapper arguments, recursion, unknown and hidden tools before dispatch", async () => {
  const cases = [
    ["search_tools", { limit: 0 }, "invalid_arguments"],
    ["search_tools", { limit: 21 }, "invalid_arguments"],
    ["search_tools", { limit: 1.5 }, "invalid_arguments"],
    ["search_tools", { offset: -1 }, "invalid_arguments"],
    ["search_tools", { offset: 10001 }, "invalid_arguments"],
    ["search_tools", { query: "x".repeat(201) }, "invalid_arguments"],
    ["search_tools", { query: ["tempo"] }, "invalid_arguments"],
    ["search_tools", { includeDisabled: true }, "invalid_arguments"],
    ["call_tool", { name: "search_tools" }, "recursive_tool_call"],
    ["call_tool", { name: "call_tool" }, "recursive_tool_call"],
    ["call_tool", { name: "__proto__" }, "unknown_tool"],
    ["call_tool", { name: "nanodaw_confirm" }, "unknown_tool"],
    ["call_tool", { name: "transport_play" }, "policy_blocked"],
    ["call_tool", { name: "transport_play", env: { BITWIG_MCP_ENABLE_WRITES: "1" } }, "invalid_arguments"],
    ["call_tool", { name: "transport_play", policy: "read" }, "invalid_arguments"],
    ["call_tool", { name: "transport_get_tempo", arguments: [] }, "invalid_arguments"],
    ["call_tool", { name: "transport_get_tempo", arguments: null }, "invalid_arguments"],
    ["call_tool", { name: "transport_get_tempo", arguments: { text: "x".repeat(65536) } }, "invalid_arguments"],
  ];
  for (const [name, args, error] of cases) {
    const result = await handleToolCall(request(name, args), { env: enabled(), call: noDaw });
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.equal(payload(result).error, error, JSON.stringify(args));
  }
});

test("validates target schema without coercion and preserves authenticated direct-call behavior", async () => {
  const env = { ...enabled(), BITWIG_MCP_WRITE_POLICY: "transport" };
  for (const args of [{}, { bpm: "120" }, { bpm: null }, { bpm: [] }, { bpm: Infinity }]) {
    const result = await handleToolCall(request("call_tool", { name: "transport_set_tempo", arguments: args }), { env, call: noDaw });
    assert.equal(payload(result).error, "invalid_arguments");
  }
  for (const [name, args, authenticated] of [
    ["transport_get_tempo", {}, false], ["transport_set_tempo", { bpm: 120 }, true],
  ]) {
    const calls = [];
    const call = async (...values) => { calls.push(values); return { ok: true }; };
    const direct = await handleToolCall(request(name, args), { env, call });
    const generic = await handleToolCall(request("call_tool", { name, arguments: args }), { env, call });
    assert.deepEqual(generic, direct);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[1][2].requiresAuthentication, authenticated);
  }
  const pending = handleToolCall(request("call_tool", { name: "transport_play" }), { env, call: noDaw });
  delete env.BITWIG_MCP_WRITE_POLICY;
  assert.equal(payload(await pending).error, "policy_blocked");

  // Revoke between the wrapper's policy check and the canonical dispatch,
  // after target-schema validation has introduced another async boundary.
  let policyReads = 0;
  Object.defineProperty(env, "BITWIG_MCP_WRITE_POLICY", {
    get: () => policyReads++ === 0 ? "transport" : "",
  });
  const revoked = await handleToolCall(request("call_tool", { name: "transport_play" }), { env, call: noDaw });
  assert.equal(payload(revoked).error, "policy_blocked");
  assert.equal(policyReads, 2);
});

test("a failed target dispatch is returned once without retry or result double-wrapping", async () => {
  let calls = 0;
  const result = await handleToolCall(request("call_tool", { name: "transport_play" }), {
    env: { ...enabled(), BITWIG_MCP_WRITE_POLICY: "transport" },
    call: async () => { calls += 1; throw new Error("synthetic lost reply"); },
  });
  assert.equal(calls, 1);
  assert.equal(result.isError, true);
  assert.equal(payload(result).error, "tool_call_failed");
});

test("MCP transport discovers and dispatches through the same policy gate", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const env = enabled();
  const calls = [];
  const { server } = await createMcpServer({ env, call: async (...args) => { calls.push(args); return 123; } });
  const client = new Client({ name: "offline-discovery-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.ok((await client.listTools()).tools.some((tool) => tool.name === "search_tools"));
  const search = await client.callTool({ name: "search_tools", arguments: { query: "tempo" } });
  assert.equal(payload(search).tools[0].name, "transport_get_tempo");
  assert.equal(calls.length, 0);
  const result = await client.callTool({ name: "call_tool", arguments: { name: "transport_get_tempo" } });
  assert.equal(payload(result), 123);
  assert.equal(calls.length, 1);
  const blocked = await client.callTool({ name: "call_tool", arguments: { name: "transport_play" } });
  assert.equal(blocked.isError, true);
  assert.equal(calls.length, 1);
});
