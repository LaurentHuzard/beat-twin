import assert from "node:assert/strict";
import test from "node:test";

import { PORTED_TOOL_SPECS, TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.ts";

const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const discoveryEnv = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
const writeEnv = { ...discoveryEnv, BITWIG_MCP_WRITE_POLICY: "mixer_write,scene_write" };
const noDaw = async () => { assert.fail("invalid or hidden tools must not contact Bitwig"); };
const routed = (name, args, generic) => generic
  ? request("call_tool", { name, arguments: args }) : request(name, args);

const cases = [
  ["project_get_summary", {}, "project.get_summary", [], "read"],
  ["track_list", {}, "track.list", [], "read"],
  ["track_get_info", { index: 7 }, "track.get_info", [7], "read"],
  ["clip_get_grid", {}, "clip.get_grid", [], "read"],
  ["clip_get_status", { trackIndex: 2, sceneIndex: 7 }, "clip.get_status", [2, 7], "read"],
  ["clip_get_notes", { trackIndex: 2, sceneIndex: 7 }, "clip.get_notes", [2, 7], "read"],
  ["track_bank_scroll_forward", {}, "track.bank.scroll_forward", [], "mixer_write"],
  ["track_bank_scroll_backward", {}, "track.bank.scroll_backward", [], "mixer_write"],
  ["track_bank_scroll_to_position", { position: 8 }, "track.bank.scroll_to_position", [8], "mixer_write"],
  ["track_scroll_into_view", { index: 7 }, "track.scroll_into_view", [7], "mixer_write"],
  ["track_rename", { index: 0, name: "Acid 303" }, "track.rename", [0, "Acid 303"], "mixer_write"],
  ["track_set_color", { index: 0, r: 0, g: 0.5, b: 1 }, "track.set_color", [0, 0, 0.5, 1], "mixer_write"],
  ["scene_rename", { sceneIndex: 7, name: "Drop" }, "scene.rename", [7, "Drop"], "scene_write"],
];

test("first port remains a stable additive prefix with six inspection reads", async () => {
  assert.equal(TOOL_SPECS.length, 187);
  assert.equal(new Set(TOOL_SPECS.map((tool) => tool.name)).size, 187);
  assert.equal(PORTED_TOOL_SPECS.length, 13);
  assert.deepEqual(TOOL_SPECS.slice(57, 70), PORTED_TOOL_SPECS);
  const visible = getToolDefinitions({ env: {} }).map((tool) => tool.name);
  assert.deepEqual(visible.slice(14, 20), cases.filter((entry) => entry[4] === "read").map((entry) => entry[0]));
  for (const [name, args, , , policy] of cases.filter((entry) => entry[4] !== "read")) {
    assert.ok(!visible.includes(name));
    for (const generic of [false, true]) {
      const result = await handleToolCall(routed(name, args, generic), { env: discoveryEnv, call: noDaw });
      assert.equal(payload(result).error, "policy_blocked");
      assert.equal(payload(result).policy, policy);
    }
  }
});

test("each ported direct and discovery call dispatches exactly once with matching authentication", async () => {
  for (const [name, args, method, params, policy] of cases) {
    let direct;
    for (const generic of [false, true]) {
      const calls = [];
      const result = await handleToolCall(routed(name, args, generic), {
        env: writeEnv,
        call: async (...values) => { calls.push(values); return { observed: true, partial: true }; },
      });
      assert.equal(result.isError, undefined, name);
      assert.deepEqual(calls, [[method, params, { requiresAuthentication: policy !== "read" }]], name);
      if (!generic) direct = result;
      else assert.deepEqual(result, direct, name);
    }
  }
});

test("all new schemas reject extra, missing, nonobject and nonfinite arguments before dispatch", async () => {
  for (const [name, args] of cases) {
    const malformed = [null, [], "args", { ...args, typo: true }, { ...args, extra: undefined }];
    if (Object.keys(args).length) malformed.push({});
    for (const invalid of malformed) {
      for (const generic of [false, true]) {
        const result = await handleToolCall(routed(name, invalid, generic), { env: writeEnv, call: noDaw });
        assert.equal(payload(result).error, "invalid_arguments", `${name}, generic=${generic}`);
      }
    }
  }
  const invalidCases = [
    ...[-1, 8, 1.5, "1", NaN, Infinity, -Infinity].map((index) => ["track_get_info", { index }]),
    ...[-1, 8, 1.5, "1", NaN, Infinity].flatMap((index) => [
      ["clip_get_status", { trackIndex: index, sceneIndex: 0 }],
      ["clip_get_notes", { trackIndex: 0, sceneIndex: index }],
    ]),
    ...[-1, 2147483648, 0.5, "8", NaN, Infinity].map((position) => ["track_bank_scroll_to_position", { position }]),
    ...["", "   ", "a".repeat(129), "acid\ntrack", "acid\u0000track", "acid\u007ftrack", "acid\u0085track"].flatMap((name) => [
      ["track_rename", { index: 0, name }], ["scene_rename", { sceneIndex: 0, name }],
    ]),
    ...[-0.1, 1.1, "0.5", NaN, Infinity, -Infinity].flatMap((value) =>
      ["r", "g", "b"].map((component) => ["track_set_color", { index: 0, r: 0, g: 0, b: 0, [component]: value }])),
  ];
  for (const [name, args] of invalidCases) {
    for (const generic of [false, true]) {
      const result = await handleToolCall(routed(name, args, generic), { env: writeEnv, call: noDaw });
      assert.equal(payload(result).error, "invalid_arguments", `${name}, generic=${generic}`);
    }
  }
});

test("bounded inputs are detached before asynchronous validation and policy is rechecked afterward", async () => {
  const args = { index: 0, name: "Acid" };
  const calls = [];
  const pending = handleToolCall(request("track_rename", args), {
    env: writeEnv, call: async (...values) => { calls.push(values); return "OK"; },
  });
  args.index = 999;
  args.name = "changed after call";
  assert.equal((await pending).isError, undefined);
  assert.deepEqual(calls[0][1], [0, "Acid"]);

  const env = { BITWIG_MCP_WRITE_POLICY: "mixer_write" };
  const revoked = handleToolCall(request("track_rename", { index: 0, name: "Acid" }), { env, call: noDaw });
  delete env.BITWIG_MCP_WRITE_POLICY;
  assert.equal(payload(await revoked).error, "policy_blocked");
});

test("published schema mutation cannot disable canonical argument validation", async () => {
  const info = getToolDefinitions({ env: {} }).find((tool) => tool.name === "track_get_info");
  info.inputSchema.properties.index.maximum = 100;
  info.inputSchema.additionalProperties = true;
  const result = await handleToolCall(request("track_get_info", { index: 8 }), { env: {}, call: noDaw });
  assert.equal(payload(result).error, "invalid_arguments");
});

test("discovery exposes bounded note coverage without selecting a clip and preserves controller errors", async () => {
  const search = await handleToolCall(request("search_tools", { query: "clip_get_notes" }), { env: discoveryEnv, call: noDaw });
  const [notes] = payload(search).tools;
  assert.equal(notes.name, "clip_get_notes");
  assert.match(notes.description, /already selected/);
  assert.match(notes.description, /64/);
  assert.match(notes.description, /channel 0/);
  assert.equal(notes.policy, "read");
  let count = 0;
  const result = await handleToolCall(request("clip_get_notes", { trackIndex: 1, sceneIndex: 0 }), {
    env: {}, call: async (method) => {
      count++;
      assert.equal(method, "clip.get_notes");
      throw new Error("Selected cursor does not match requested slot");
    },
  });
  assert.equal(count, 1);
  assert.equal(result.isError, true);
  assert.match(payload(result).message, /does not match/);
});

test("MCP transport validates direct port calls and routes discovery through the same gate", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const calls = [];
  const { server } = await createMcpServer({ env: discoveryEnv, call: async (...args) => { calls.push(args); return { slots: [] }; } });
  const client = new Client({ name: "offline-capability-port", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const definitions = (await client.listTools()).tools;
  assert.ok(definitions.some((tool) => tool.name === "clip_get_grid"));
  assert.ok(!definitions.some((tool) => tool.name === "track_rename"));
  const invalid = await client.callTool({ name: "clip_get_status", arguments: { trackIndex: 0, sceneIndex: 8 } });
  assert.equal(payload(invalid).error, "invalid_arguments");
  assert.equal(calls.length, 0);
  const read = await client.callTool({ name: "call_tool", arguments: { name: "clip_get_grid" } });
  assert.deepEqual(payload(read), { slots: [] });
  assert.deepEqual(calls, [["clip.get_grid", [], { requiresAuthentication: false }]]);
});
