import assert from "node:assert/strict";
import test from "node:test";
import { PARITY_TOOL_SPECS, TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.ts";

const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const discovery = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
const allowed = { ...discovery, BITWIG_MCP_WRITE_POLICY: "application_write,transport,device_write,mixer_write" };
const noDaw = async () => { assert.fail("invalid or unauthorized input must not contact Bitwig"); };
const route = (name, args, generic) => generic ? request("call_tool", { name, arguments: args }) : request(name, args);
const cases = [
  ...["undo", "redo", "cut", "copy", "paste", "delete", "duplicate", "select_all", "select_none", "arrow_key", "enter", "escape", "zoom_in", "zoom_out"].map((action) => [
    `application_${action}`, action === "arrow_key" ? { direction: "left" } : {}, `application.${action}`, action === "arrow_key" ? ["left"] : [], "application_write",
  ]),
  ["application_get_status", {}, "application.get_status", [], "read"],
  ["arranger_zoom", { action: "in_all" }, "arranger.zoom", ["in_all"], "application_write"],
  ["transport_add_cue_marker", {}, "transport.add_cue_marker", [], "application_write"],
  ["arranger_cues_create", {}, "arranger.cues.create", [], "application_write"],
  ["arranger_cues_rename", { index: 31, name: "Break" }, "arranger.cues.rename", [31, "Break"], "application_write"],
  ["arranger_get_cue_markers", {}, "arranger.cues.list", [], "read"],
  ["arranger_jump_to_cue_marker", { index: 0 }, "arranger.cues.jump", [0], "transport"],
  ["drumpad_get_status", {}, "drumpad.get_status", [], "read"],
  ["drumpad_select", { index: 15 }, "drumpad.select", [15], "device_write"],
  ["drumpad_scroll_forward", {}, "drumpad.scroll_forward", [], "device_write"],
  ["drumpad_scroll_backward", {}, "drumpad.scroll_backward", [], "device_write"],
  ["drumpad_set_volume", { index: 0, value: 0 }, "drumpad.set_volume", [0, 0], "device_write"],
  ["drumpad_set_mute", { index: 15, state: false }, "drumpad.set_mute", [15, false], "device_write"],
  ["drumpad_set_solo", { index: 0, state: true }, "drumpad.set_solo", [0, true], "device_write"],
  ["groove_get_status", {}, "groove.get_status", [], "read"],
  ["groove_set_enabled", { state: false }, "groove.set_enabled", [false], "transport"],
  ["groove_set_shuffle_amount", { value: 0 }, "groove.set_shuffle_amount", [0], "transport"],
  ["project_unsolo_all", {}, "project.unsolo_all", [], "mixer_write"],
  ["project_unmute_all", {}, "project.unmute_all", [], "mixer_write"],
  ["project_unarm_all", {}, "project.unarm_all", [], "mixer_write"],
  ["project_get_status", {}, "project.get_status", [], "read"],
];

test("parity tranche appends 35 unique tools and five ordered default reads", () => {
  assert.equal(PARITY_TOOL_SPECS.length, 35);
  assert.equal(TOOL_SPECS.length, 161);
  assert.equal(new Set(TOOL_SPECS.map((tool) => tool.name)).size, 161);
  assert.deepEqual(TOOL_SPECS.slice(126, 161), PARITY_TOOL_SPECS);
  assert.deepEqual(PARITY_TOOL_SPECS.map((tool) => tool.name), cases.map((entry) => entry[0]));
  const definitions = getToolDefinitions({ env: {} });
  assert.equal(definitions.length, 37);
  assert.deepEqual(definitions.slice(32, 37).map((tool) => tool.name), [
    "application_get_status", "arranger_get_cue_markers", "drumpad_get_status", "groove_get_status", "project_get_status",
  ]);
  for (const spec of PARITY_TOOL_SPECS) {
    assert.equal(spec.validateInput, true);
    assert.equal(spec.partialResultIsError, true);
    assert.equal(spec.inputSchema.additionalProperties, false);
  }
  assert.match(PARITY_TOOL_SPECS.find((tool) => tool.name === "application_delete").description, /Application.remove/);
  assert.match(PARITY_TOOL_SPECS.find((tool) => tool.name === "application_copy").description, /cannot verify/);
  assert.match(PARITY_TOOL_SPECS.find((tool) => tool.name === "arranger_jump_to_cue_marker").description, /starts playback/);
});

test("every parity direct and discovery route preserves ordered args and authentication", async () => {
  for (const [name, args, method, params, policy] of cases) {
    let direct;
    for (const generic of [false, true]) {
      const calls = [];
      const result = await handleToolCall(route(name, args, generic), {
        env: allowed, call: async (...values) => { calls.push(values); return { status: "dispatched", verified: false }; },
      });
      assert.equal(result.isError, undefined, name);
      assert.deepEqual(calls, [[method, params, { requiresAuthentication: policy !== "read" }]], name);
      if (generic) assert.deepEqual(result, direct, name);
      else direct = result;
    }
  }
});

test("parity writes require their precise policy through both entry points", async () => {
  for (const [name, args, , , policy] of cases.filter((entry) => entry[4] !== "read")) {
    const other = ["application_write", "transport", "device_write", "mixer_write", "clip_write", "scene_write"].filter((p) => p !== policy).join(",");
    for (const env of [discovery, { ...discovery, BITWIG_MCP_WRITE_POLICY: other }]) {
      assert.ok(!getToolDefinitions({ env }).some((tool) => tool.name === name));
      for (const generic of [false, true]) {
        const result = await handleToolCall(route(name, args, generic), { env, call: noDaw });
        assert.equal(payload(result).error, "policy_blocked", name);
        assert.equal(payload(result).policy, policy);
      }
    }
  }
});

test("strict parity schemas reject malformed input, invalid ranges, booleans and names before dispatch", async () => {
  const invalid = [];
  for (const [name, args] of cases) {
    for (const bad of [null, [], "args", { ...args, extra: true }, { ...args, extra: undefined }, { ...args, policy: "read" }]) invalid.push([name, bad]);
    if (Object.keys(args).length) invalid.push([name, {}]);
    if ("index" in args) {
      const max = name.startsWith("drumpad_") ? 15 : 31;
      for (const index of [-1, max + 1, 0.5, NaN, Infinity, "0", null]) invalid.push([name, { ...args, index }]);
    }
    if ("value" in args) for (const value of [-0.001, 1.001, NaN, Infinity, -Infinity, "0", null]) invalid.push([name, { ...args, value }]);
    if ("state" in args) for (const state of [0, 1, "true", null, undefined]) invalid.push([name, { ...args, state }]);
  }
  for (const name of ["", "   ", "x".repeat(129), "bad\nname", "bad\u007fname", "bad\u0085name", null, 4]) invalid.push(["arranger_cues_rename", { index: 0, name }]);
  for (const direction of ["LEFT", "forward", "", 0, null]) invalid.push(["application_arrow_key", { direction }]);
  for (const action of ["zoom_in", "horizontal", "", 0, null]) invalid.push(["arranger_zoom", { action }]);
  for (const [name, args] of invalid) {
    for (const generic of [false, true]) {
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: noDaw });
      assert.equal(payload(result).error, "invalid_arguments", `${name}, generic=${generic}`);
    }
  }
});

test("all supported enum values, zero/one levels, false states and 128-character cue names survive dispatch", async () => {
  const valid = [
    ...["left", "right", "up", "down"].map((direction) => ["application_arrow_key", { direction }, [direction]]),
    ...["in_all", "out_all", "in_selected", "out_selected"].map((action) => ["arranger_zoom", { action }, [action]]),
    ...[0, 0.5, 1].flatMap((value) => [["groove_set_shuffle_amount", { value }, [value]], ["drumpad_set_volume", { index: 15, value }, [15, value]]]),
    ...[false, true].flatMap((state) => [["groove_set_enabled", { state }, [state]], ["drumpad_set_mute", { index: 0, state }, [0, state]], ["drumpad_set_solo", { index: 15, state }, [15, state]]]),
    ["arranger_cues_rename", { index: 31, name: "x".repeat(128) }, [31, "x".repeat(128)]],
  ];
  for (const [name, args, expected] of valid) {
    let sent;
    const result = await handleToolCall(request(name, args), { env: allowed, call: async (_method, params) => { sent = params; return "OK"; } });
    assert.equal(result.isError, undefined, name);
    assert.deepEqual(sent, expected, name);
  }
});

test("parity aliases keep original cue methods, data and transport policy", async () => {
  for (const [alias, original, args] of [["arranger_get_cue_markers", "arranger_cues_list", {}], ["arranger_jump_to_cue_marker", "arranger_cues_jump", { index: 31 }]]) {
    const calls = [];
    for (const name of [original, alias]) await handleToolCall(request(name, args), { env: allowed, call: async (...args) => { calls.push(args); return { coverage: { complete: false, bankSize: 32 } }; } });
    assert.deepEqual(calls[0], calls[1]);
  }
});

test("read observations preserve unknown focus, bounded coverage and global false flags", async () => {
  const fixtures = [
    ["application_get_status", { canUndo: false, canRedo: true, focus: "unknown", clipboard: "unknown" }],
    ["arranger_get_cue_markers", { markers: [], coverage: { bankSize: 32, complete: false } }],
    ["drumpad_get_status", { pads: [], coverage: { bankSize: 16, complete: false } }],
    ["groove_get_status", { enabled: false, shuffleAmount: 0 }],
    ["project_get_status", { hasSoloedTracks: false, hasMutedTracks: false, hasArmedTracks: false }],
  ];
  for (const [name, fixture] of fixtures) {
    const result = await handleToolCall(request(name), { env: {}, call: async () => fixture });
    assert.deepEqual(payload(result), fixture, name);
  }
});

test("arguments detach and write policy revocation is rechecked before dispatch", async () => {
  for (const generic of [false, true]) {
    const args = { index: 0, state: false };
    const calls = [];
    const pending = handleToolCall(route("drumpad_set_mute", args, generic), { env: allowed, call: async (...values) => { calls.push(values); return "OK"; } });
    args.index = 15; args.state = true;
    assert.equal((await pending).isError, undefined);
    assert.deepEqual(calls[0][1], [0, false]);
    for (const [name, toolArgs] of cases.filter((entry) => entry[4] !== "read")) {
      const env = { ...allowed };
      const rejected = handleToolCall(route(name, toolArgs, generic), { env, call: noDaw });
      delete env.BITWIG_MCP_WRITE_POLICY;
      assert.equal(payload(await rejected).error, "policy_blocked", name);
    }
  }
});

test("unknown targets and partial effects stay errors without fallback or retries", async () => {
  for (const [name, args] of cases) {
    for (const generic of [false, true]) {
      for (const partial of [false, true]) {
        let calls = 0;
        const result = await handleToolCall(route(name, args, generic), { env: allowed, call: async () => {
          calls++;
          if (partial) return { status: "partial", uncertain: true, verified: false };
          throw new Error("Target unknown, unsettled or action result uncertain");
        } });
        assert.equal(result.isError, true, name);
        assert.equal(calls, 1, name);
        assert.equal(payload(result).error, partial ? "partial_mutation" : "tool_call_failed", name);
      }
    }
  }
});

test("MCP transport advertises strict parity schemas and preserves policy separation", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const calls = [];
  const env = { ...discovery, BITWIG_MCP_WRITE_POLICY: "transport" };
  const { server } = await createMcpServer({ env, call: async (...args) => { calls.push(args); return { status: "dispatched", verified: false }; } });
  const client = new Client({ name: "offline-parity-port", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const search = await client.callTool({ name: "search_tools", arguments: { query: "groove_set_enabled" } });
  assert.equal(payload(search).tools[0].policy, "transport");
  const invalid = await client.callTool({ name: "groove_set_enabled", arguments: { state: 1 } });
  assert.equal(payload(invalid).error, "invalid_arguments");
  const blocked = await client.callTool({ name: "call_tool", arguments: { name: "transport_add_cue_marker", arguments: {} } });
  assert.equal(payload(blocked).error, "policy_blocked");
  assert.equal(calls.length, 0);
  const result = await client.callTool({ name: "call_tool", arguments: { name: "groove_set_enabled", arguments: { state: false } } });
  assert.equal(payload(result).result.verified, false);
  assert.deepEqual(calls, [["groove.set_enabled", [false], { requiresAuthentication: true }]]);
});
