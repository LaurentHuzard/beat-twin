import assert from "node:assert/strict";
import test from "node:test";
import { MIX_TOOL_SPECS, TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.ts";

const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const discovery = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
const allowed = { ...discovery, BITWIG_MCP_WRITE_POLICY: "mixer_write,device_write,application_write" };
const noDaw = async () => { assert.fail("rejected input must not contact Bitwig"); };
const route = (name, args, generic) => generic ? request("call_tool", { name, arguments: args }) : request(name, args);
const cases = [
  ["track_delete", { index: 7 }, "track.delete", [7], "mixer_write"],
  ["track_duplicate", { index: 0 }, "track.duplicate", [0], "mixer_write"],
  ["cursor_track_get_status", {}, "cursor_track.get_status", [], "read"],
  ["cursor_device_get_status", {}, "cursor_device.get_status", [], "read"],
  ["cursor_clip_get_status", {}, "cursor_clip.get_status", [], "read"],
  ["application_create_effect_track", {}, "application.createEffectTrack", [], "application_write"],
  ["device_bypass", { trackIndex: 7, deviceIndex: 0, bypass: false }, "device.bypass", [7, 0, false], "device_write"],
  ["device_delete", { trackIndex: 0, deviceIndex: 7 }, "device.delete", [0, 7], "device_write"],
  ["device_select_next", {}, "device.select_next", [], "device_write"],
  ["device_select_previous", {}, "device.select_previous", [], "device_write"],
  ["device_select_first", {}, "device.select_first", [], "device_write"],
  ["device_select_last", {}, "device.select_last", [], "device_write"],
  ["device_browse_insert_before", {}, "device.browse_insert_before", [], "device_write"],
  ["device_browse_insert_after", {}, "device.browse_insert_after", [], "device_write"],
  ["device_browse_replace", {}, "device.browse_replace", [], "device_write"],
  ["mixer_get_master_volume", {}, "mixer.master.get_volume", [], "read"],
  ["mixer_set_master_volume", { value: 0 }, "mixer.master.set_volume", [0], "mixer_write"],
  ["mixer_get_send_level", { trackIndex: 0, sendIndex: 7 }, "mixer.track.get_send", [0, 7], "read"],
  ["mixer_set_send_level", { trackIndex: 7, sendIndex: 0, value: 1 }, "mixer.track.set_send", [7, 0, 1], "mixer_write"],
  ["mixer_return_list", {}, "mixer.return.list", [], "read"],
  ["mixer_return_set_volume", { index: 0, value: 0.5 }, "mixer.return.volume", [0, 0.5], "mixer_write"],
  ["mixer_return_set_pan", { index: 7, value: 0.5 }, "mixer.return.pan", [7, 0.5], "mixer_write"],
];

test("mix tranche appends 22 unique tools and six default reads without altering prior order", () => {
  assert.equal(TOOL_SPECS.length, 187);
  assert.equal(new Set(TOOL_SPECS.map((tool) => tool.name)).size, 187);
  assert.deepEqual(TOOL_SPECS.slice(104, 126), MIX_TOOL_SPECS);
  const definitions = getToolDefinitions({ env: {} });
  assert.equal(definitions.length, 42);
  assert.deepEqual(definitions.slice(26, 32).map((tool) => tool.name), [
    "cursor_track_get_status", "cursor_device_get_status", "cursor_clip_get_status",
    "mixer_get_master_volume", "mixer_get_send_level", "mixer_return_list",
  ]);
  const pan = MIX_TOOL_SPECS.find((tool) => tool.name === "mixer_return_set_pan");
  assert.match(pan.description, /0 left, 0.5 center, 1 right/);
  const bypass = MIX_TOOL_SPECS.find((tool) => tool.name === "device_bypass");
  assert.match(bypass.description, /bypass=true disables/);
});

test("all direct and discovery routes dispatch exactly once with matching authentication", async () => {
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

test("mix, device and structural application writes remain separately gated", async () => {
  for (const [name, args, , , policy] of cases.filter((entry) => entry[4] !== "read")) {
    const unrelated = ["mixer_write", "device_write", "application_write", "transport", "clip_write"].filter((candidate) => candidate !== policy).join(",");
    for (const env of [discovery, { ...discovery, BITWIG_MCP_WRITE_POLICY: unrelated }]) {
      assert.ok(!getToolDefinitions({ env }).some((tool) => tool.name === name));
      for (const generic of [false, true]) {
        const result = await handleToolCall(route(name, args, generic), { env, call: noDaw });
        assert.equal(payload(result).error, "policy_blocked", name);
        assert.equal(payload(result).policy, policy);
      }
    }
  }
});

test("strict mix schemas enforce finite normalized values, integer bank bounds and exact booleans", async () => {
  const invalidCases = [];
  for (const [name, args] of cases) {
    for (const malformed of [null, [], "args", { ...args, extra: true }, { ...args, policy: "read" }, { ...args, extra: undefined }]) invalidCases.push([name, malformed]);
    if (Object.keys(args).length) invalidCases.push([name, {}]);
    for (const key of ["index", "trackIndex", "deviceIndex", "sendIndex"].filter((key) => key in args)) {
      for (const bad of [-1, 8, 0.5, "1", NaN, Infinity]) invalidCases.push([name, { ...args, [key]: bad }]);
    }
    if ("value" in args) {
      for (const bad of [-0.01, 1.01, -Infinity, Infinity, NaN, "0.5", null]) invalidCases.push([name, { ...args, value: bad }]);
    }
  }
  for (const bypass of [0, 1, "false", null, NaN]) invalidCases.push(["device_bypass", { trackIndex: 0, deviceIndex: 0, bypass }]);
  for (const [name, args] of invalidCases) {
    for (const generic of [false, true]) {
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: noDaw });
      assert.equal(payload(result).error, "invalid_arguments", `${name}, generic=${generic}`);
    }
  }
  for (const [name, args] of cases.filter((entry) => "value" in entry[1])) {
    for (const value of [0, 0.5, 1]) {
      let sent;
      const result = await handleToolCall(request(name, { ...args, value }), { env: allowed, call: async (_method, params) => { sent = params; return "OK"; } });
      assert.equal(result.isError, undefined, name);
      assert.equal(sent.at(-1), value);
    }
  }
  for (const bypass of [false, true]) {
    const result = await handleToolCall(request("device_bypass", { trackIndex: 0, deviceIndex: 0, bypass }), { env: allowed, call: async (_method, params) => params });
    assert.deepEqual(payload(result).result, [0, 0, bypass]);
  }
});

test("arguments detach before asynchronous validation and policy is rechecked before writes", async () => {
  for (const generic of [false, true]) {
    const args = { trackIndex: 0, deviceIndex: 0, bypass: true };
    const calls = [];
    const pending = handleToolCall(route("device_bypass", args, generic), { env: allowed, call: async (...values) => { calls.push(values); return "OK"; } });
    args.deviceIndex = 7;
    args.bypass = false;
    assert.equal((await pending).isError, undefined);
    assert.deepEqual(calls[0][1], [0, 0, true]);
    for (const name of ["track_delete", "device_browse_replace", "application_create_effect_track", "mixer_set_master_volume"]) {
      const env = { ...allowed };
      const params = cases.find((entry) => entry[0] === name)[1];
      const revoked = handleToolCall(route(name, params, generic), { env, call: noDaw });
      delete env.BITWIG_MCP_WRITE_POLICY;
      assert.equal(payload(await revoked).error, "policy_blocked", name);
    }
  }
});

test("missing cursor browser errors never fall back to a different insertion target", async () => {
  for (const name of ["device_browse_insert_before", "device_browse_insert_after", "device_browse_replace"]) {
    for (const generic of [false, true]) {
      const methods = [];
      const result = await handleToolCall(route(name, {}, generic), {
        env: allowed, call: async (method) => { methods.push(method); throw new Error("Selected device is absent or unsettled"); },
      });
      assert.equal(result.isError, true);
      assert.equal(payload(result).error, "tool_call_failed");
      assert.deepEqual(methods, [cases.find((entry) => entry[0] === name)[2]]);
      assert.match(payload(result).message, /Selected device is absent/);
    }
  }
});

test("structural errors and uncertain results stay errors without automatic retries", async () => {
  for (const name of ["track_delete", "track_duplicate", "device_delete", "application_create_effect_track"]) {
    const args = cases.find((entry) => entry[0] === name)[1];
    for (const generic of [false, true]) {
      let calls = 0;
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: async () => { calls++; throw new Error("Structural state pending or acknowledgement lost"); } });
      assert.equal(result.isError, true);
      assert.equal(payload(result).error, "tool_call_failed");
      assert.equal(calls, 1);
    }
  }
  const partial = { status: "partial", uncertain: true, verified: false };
  const uncertain = await handleToolCall(request("track_duplicate", { index: 0 }), { env: allowed, call: async () => partial });
  assert.equal(uncertain.isError, true);
  assert.deepEqual(payload(uncertain).result, partial);
});

test("read responses retain explicit absence, zero levels and bounded return coverage", async () => {
  const fixtures = [
    ["cursor_device_get_status", {}, { exists: false, name: null, position: null, trackPosition: null, isEnabled: null, isWindowOpen: null, isExpanded: null }],
    ["cursor_clip_get_status", {}, { exists: true, scope: "selected_launcher", trackPosition: 10, slotSceneIndex: 7, loopLength: 16, loopStart: 0, playStart: 0, playStop: 16 }],
    ["mixer_get_master_volume", {}, 0],
    ["mixer_get_send_level", { trackIndex: 0, sendIndex: 7 }, 0],
    ["mixer_return_list", {}, { returns: [{ index: 0, exists: true, name: "Reverb", position: 0, volume: 0.5, pan: 0.5, mute: false, solo: false }], coverage: { bankSize: 8, scrollPosition: 0, projectReturnCount: 10, complete: false } }],
  ];
  for (const [name, args, observation] of fixtures) {
    const result = await handleToolCall(request(name, args), { env: {}, call: async () => observation });
    assert.deepEqual(payload(result), observation, name);
  }
  const unsettled = await handleToolCall(request("cursor_track_get_status"), { env: {}, call: async () => { throw new Error("Track selection is unsettled"); } });
  assert.equal(unsettled.isError, true);
  assert.match(payload(unsettled).message, /unsettled/);
});

test("MCP transport discovery retains finite schema and separate policy gates", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const calls = [];
  const env = { ...discovery, BITWIG_MCP_WRITE_POLICY: "mixer_write" };
  const { server } = await createMcpServer({ env, call: async (...args) => { calls.push(args); return { status: "dispatched", verified: false }; } });
  const client = new Client({ name: "offline-mix-port", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const search = await client.callTool({ name: "search_tools", arguments: { query: "mixer_return_set_pan" } });
  assert.equal(payload(search).tools[0].policy, "mixer_write");
  const invalid = await client.callTool({ name: "mixer_return_set_pan", arguments: { index: 0, value: -1 } });
  assert.equal(payload(invalid).error, "invalid_arguments");
  assert.equal(calls.length, 0);
  const bypass = await client.callTool({ name: "call_tool", arguments: { name: "device_bypass", arguments: { trackIndex: 0, deviceIndex: 0, bypass: true } } });
  assert.equal(payload(bypass).error, "policy_blocked");
  assert.equal(calls.length, 0);
  const pan = await client.callTool({ name: "call_tool", arguments: { name: "mixer_return_set_pan", arguments: { index: 7, value: 0.5 } } });
  assert.equal(payload(pan).result.verified, false);
  assert.deepEqual(calls, [["mixer.return.pan", [7, 0.5], { requiresAuthentication: true }]]);
});
