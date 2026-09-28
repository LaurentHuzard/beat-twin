import assert from "node:assert/strict";
import test from "node:test";
import { TRANSPORT_TOOL_SPECS, TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.ts";

const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const discovery = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
const allowed = { ...discovery, BITWIG_MCP_WRITE_POLICY: "transport,application_write" };
const noDaw = async () => { assert.fail("rejected inputs must not contact Bitwig"); };
const route = (name, args, generic) => generic ? request("call_tool", { name, arguments: args }) : request(name, args);
const cases = [
  ["transport_toggle_metronome", {}, "transport.toggle_metronome", [], "transport"],
  ["transport_set_time_signature", { numerator: 7, denominator: 8 }, "transport.time_signature", [7, 8], "transport"],
  ["transport_tap_tempo", {}, "transport.tap_tempo", [], "transport"],
  ["transport_toggle_punch_in", {}, "transport.toggle_punch_in", [], "transport"],
  ["transport_toggle_punch_out", {}, "transport.toggle_punch_out", [], "transport"],
  ["transport_set_punch_in", { state: true }, "transport.set_punch_in", [true], "transport"],
  ["transport_set_punch_out", { state: false }, "transport.set_punch_out", [false], "transport"],
  ["transport_get_punch_status", {}, "transport.get_punch_status", [], "read"],
  ["transport_toggle_arranger_overdub", {}, "transport.toggle_arranger_overdub", [], "transport"],
  ["transport_toggle_launcher_overdub", {}, "transport.toggle_launcher_overdub", [], "transport"],
  ["transport_get_overdub_status", {}, "transport.get_overdub_status", [], "read"],
  ["transport_continue_playback", {}, "transport.continue_playback", [], "transport"],
  ["transport_return_to_zero", {}, "transport.return_to_zero", [], "transport"],
  ["transport_fast_forward", {}, "transport.fast_forward", [], "transport"],
  ["transport_rewind", {}, "transport.rewind", [], "transport"],
  ["transport_nudge_forward", {}, "transport.nudge_forward", [], "transport"],
  ["transport_nudge_backward", {}, "transport.nudge_backward", [], "transport"],
  ["arranger_get_status", {}, "arranger.get_status", [], "read"],
  ["arranger_set_panel_visibility", { panel: "playback_follow", state: false }, "arranger.set_panel_visibility", ["playback_follow", false], "application_write"],
  ["arranger_cues_list", {}, "arranger.cues.list", [], "read"],
  ["arranger_cues_jump", { index: 31 }, "arranger.cues.jump", [31], "transport"],
];

test("transport tranche retains its 21 tools and four reads; later API15 additions stay outside that prefix", () => {
  assert.equal(TOOL_SPECS.length, 187);
  assert.equal(new Set(TOOL_SPECS.map((tool) => tool.name)).size, 187);
  assert.deepEqual(TOOL_SPECS.slice(83, 104), TRANSPORT_TOOL_SPECS);
  const definitions = getToolDefinitions({ env: {} });
  assert.equal(definitions.length, 42);
  assert.deepEqual(definitions.slice(22, 26).map((tool) => tool.name), [
    "transport_get_punch_status", "transport_get_overdub_status", "arranger_get_status", "arranger_cues_list",
  ]);
  for (const name of ["arranger_zoom", "transport_add_cue_marker", "arranger_cues_create", "arranger_cues_rename", "arranger_cues_color"]) {
    assert.ok(!TRANSPORT_TOOL_SPECS.some((tool) => tool.name === name));
  }
  const cueLaunch = TRANSPORT_TOOL_SPECS.find((tool) => tool.name === "arranger_cues_jump");
  assert.match(cueLaunch.description, /starts playback/);
  assert.match(cueLaunch.description, /quantized/);
  assert.equal(cueLaunch.policy, "transport");
  assert.match(TRANSPORT_TOOL_SPECS.find((tool) => tool.name === "transport_nudge_forward").description, /one beat \(one quarter-note\)/);
});

test("all 21 direct and discovery routes call the correct RPC exactly once", async () => {
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

test("transport and arranger display writes are hidden and blocked under default or unrelated policy", async () => {
  for (const [name, args, , , policy] of cases.filter((entry) => entry[4] !== "read")) {
    const unrelated = policy === "transport" ? "application_write,clip_write,mixer_write" : "transport,clip_write,mixer_write";
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

test("strict schemas reject unknown input, nonfinite values and invalid time signatures, booleans or cue indices", async () => {
  const invalidCases = [];
  for (const [name, args] of cases) {
    for (const bad of [null, [], "args", { ...args, extra: true }, { ...args, policy: "read" }, { ...args, extra: undefined }]) invalidCases.push([name, bad]);
    if (Object.keys(args).length) invalidCases.push([name, {}]);
  }
  for (const numerator of [0, -1, 33, 1.5, "4", NaN, Infinity]) invalidCases.push(["transport_set_time_signature", { numerator, denominator: 4 }]);
  for (const denominator of [0, 3, 64, 0.5, "4", NaN, Infinity]) invalidCases.push(["transport_set_time_signature", { numerator: 4, denominator }]);
  for (const state of [0, 1, "false", null, NaN]) {
    invalidCases.push(["transport_set_punch_in", { state }], ["transport_set_punch_out", { state }], ["arranger_set_panel_visibility", { panel: "timeline", state }]);
  }
  for (const panel of ["zoom", "Timeline", "", "__proto__", 0]) invalidCases.push(["arranger_set_panel_visibility", { panel, state: true }]);
  for (const index of [-1, 32, 1.5, "1", NaN, Infinity]) invalidCases.push(["arranger_cues_jump", { index }]);
  for (const [name, args] of invalidCases) {
    for (const generic of [false, true]) {
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: noDaw });
      assert.equal(payload(result).error, "invalid_arguments", `${name} generic=${generic}`);
    }
  }
  for (const numerator of [1, 32]) {
    for (const denominator of [1, 2, 4, 8, 16, 32]) {
      const result = await handleToolCall(request("transport_set_time_signature", { numerator, denominator }), { env: allowed, call: async () => "OK" });
      assert.equal(result.isError, undefined);
    }
  }
  for (const panel of ["timeline", "io", "clip_launcher", "effect_tracks", "double_row_height", "cue_markers", "playback_follow"]) {
    const result = await handleToolCall(request("arranger_set_panel_visibility", { panel, state: false }), { env: allowed, call: async (_method, params) => params });
    assert.deepEqual(payload(result).result, [panel, false]);
  }
});

test("input snapshots prevent time-signature and marker retargeting while validation awaits", async () => {
  for (const generic of [false, true]) {
    const args = { index: 0 };
    const calls = [];
    const pending = handleToolCall(route("arranger_cues_jump", args, generic), { env: allowed, call: async (...values) => { calls.push(values); return "OK"; } });
    args.index = 31;
    assert.equal((await pending).isError, undefined);
    assert.deepEqual(calls[0][1], [0]);

    const signature = { numerator: 3, denominator: 4 };
    const signatureCalls = [];
    const changing = handleToolCall(route("transport_set_time_signature", signature, generic), { env: allowed, call: async (...values) => { signatureCalls.push(values); return "OK"; } });
    signature.numerator = 100;
    assert.equal((await changing).isError, undefined);
    assert.deepEqual(signatureCalls[0][1], [3, 4]);
  }
});

test("revocation during validation blocks non-idempotent launches and toggles before dispatch", async () => {
  for (const name of ["arranger_cues_jump", "transport_toggle_metronome", "arranger_set_panel_visibility"]) {
    const args = cases.find((entry) => entry[0] === name)[1];
    for (const generic of [false, true]) {
      const env = { ...allowed };
      const pending = handleToolCall(route(name, args, generic), { env, call: noDaw });
      delete env.BITWIG_MCP_WRITE_POLICY;
      assert.equal(payload(await pending).error, "policy_blocked", name);
    }
  }
});

test("lost replies and controller errors are reported once without automatically replaying transport actions", async () => {
  for (const name of ["transport_toggle_metronome", "transport_tap_tempo", "transport_nudge_backward", "arranger_cues_jump"]) {
    const args = cases.find((entry) => entry[0] === name)[1];
    for (const generic of [false, true]) {
      let calls = 0;
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: async () => { calls++; throw new Error("Host state is unavailable or acknowledgement lost"); } });
      assert.equal(calls, 1);
      assert.equal(result.isError, true);
      assert.equal(payload(result).error, "tool_call_failed");
      assert.match(payload(result).message, /Host state is unavailable/);
    }
  }
  const partial = { status: "partial", verified: false, uncertain: true };
  const uncertain = await handleToolCall(request("transport_tap_tempo"), { env: allowed, call: async () => partial });
  assert.equal(uncertain.isError, true);
  assert.deepEqual(payload(uncertain).result, partial);
});

test("read results preserve bounded marker coverage and unavailable-state failures", async () => {
  const observation = { markers: [{ index: 0, absoluteIndex: 0, name: "Drop", positionBeats: 128, color: { r: 1, g: 0, b: 0 } }], coverage: { bankSize: 32, scrollPosition: 0, projectMarkerCount: 40, complete: false } };
  const result = await handleToolCall(request("arranger_cues_list"), { env: {}, call: async () => observation });
  assert.deepEqual(payload(result), observation);
  const unavailable = await handleToolCall(request("transport_get_punch_status"), { env: {}, call: async () => { throw new Error("Observation not settled"); } });
  assert.equal(unavailable.isError, true);
  assert.match(payload(unavailable).message, /not settled/);
});

test("MCP transport discovery uses the same strict cue-launch and arranger policy gates", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const calls = [];
  const env = { ...discovery, BITWIG_MCP_WRITE_POLICY: "transport" };
  const { server } = await createMcpServer({ env, call: async (...args) => { calls.push(args); return { status: "dispatched", verified: false }; } });
  const client = new Client({ name: "offline-transport-port", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const search = await client.callTool({ name: "search_tools", arguments: { query: "arranger_cues_jump" } });
  assert.equal(payload(search).tools[0].policy, "transport");
  const invalid = await client.callTool({ name: "arranger_cues_jump", arguments: { index: 32 } });
  assert.equal(payload(invalid).error, "invalid_arguments");
  assert.equal(calls.length, 0);
  const panel = await client.callTool({ name: "call_tool", arguments: { name: "arranger_set_panel_visibility", arguments: { panel: "timeline", state: true } } });
  assert.equal(payload(panel).error, "policy_blocked");
  assert.equal(calls.length, 0);
  const launch = await client.callTool({ name: "call_tool", arguments: { name: "arranger_cues_jump", arguments: { index: 0 } } });
  assert.equal(payload(launch).result.verified, false);
  assert.deepEqual(calls, [["arranger.cues.jump", [0], { requiresAuthentication: true }]]);
});
