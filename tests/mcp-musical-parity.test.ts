import assert from "node:assert/strict";
import test from "node:test";
import { MUSICAL_TOOL_SPECS, TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.ts";
import { EarClientError } from "../lib/ear-client.js";

const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const discovery = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
const allPolicies = ["transport", "mixer_write", "clip_write", "scene_write", "device_write", "application_write", "midi_write", "audio_capture"];
const allowed = { ...discovery, BITWIG_MCP_WRITE_POLICY: allPolicies.join(",") };
const noIo = async () => { assert.fail("rejected arguments must not contact Bitwig or Ear"); };
const routes = ["direct", "call_tool", "mcp_execute_advanced_tool"];
const route = (name, args, entry) => entry === "direct" ? request(name, args) : request(entry, entry === "call_tool" ? { name, arguments: args } : { tool_name: name, arguments: args });
const table = Array.from({ length: 128 }, (_, i) => i);
const cases = [
  ["midi_send_raw", { status: 144, data1: 36, data2: 100 }, "note_input.send_raw_midi", [144, 36, 100], "midi_write"],
  ["note_on", { channel: 0, pitch: 36, velocity: 100 }, "note_input.send_note_on", [0, 36, 100], "midi_write"],
  ["note_off", { channel: 0, pitch: 36, velocity: 0 }, "note_input.send_note_off", [0, 36, 0], "midi_write"],
  ["note_play", { channel: 0, pitch: 36, velocity: 127, duration: 10 }, "note_input.play_note", [0, 36, 127, 10], "midi_write"],
  ["note_input_assign_expression", { channel: 15, expression: "PITCH_UP", pitchRange: 24 }, "note_input.assign_poly_aftertouch_to_expression", [15, "PITCH_UP", 24], "midi_write"],
  ["note_input_set_mpe", { enabled: false, baseChannel: 15, pitchBendRange: 96 }, "note_input.set_use_expressive_midi", [false, 15, 96], "midi_write"],
  ["note_input_set_key_translation", { table }, "note_input.set_key_translation_table", [table], "midi_write"],
  ["note_input_set_velocity_translation", { table }, "note_input.set_velocity_translation_table", [table], "midi_write"],
  ["midi_get_status", {}, "note_input.get_status", [], "read"],
  ["midi_all_notes_off", {}, "note_input.all_notes_off", [], "midi_write"],
  ["clip_get_note_expressions", { trackIndex: 0, sceneIndex: 7, notes: [{ step: 0, pitch: 36 }] }, "clip.get_note_expressions", [0, 7, [{ step: 0, pitch: 36 }]], "read"],
  ["clip_set_note_expressions", { trackIndex: 0, sceneIndex: 7, snapshotId: "snap", notes: [{ step: 0, pitch: 36, velocity: 0, pan: -1, transpose: -96 }] }, "clip.set_note_expressions", [0, 7, "snap", [{ step: 0, pitch: 36, velocity: 0, pan: -1, transpose: -96 }]], "clip_write"],
  ["browser_get_filter_items", { column: "smartCollection" }, "browser.get_filter_items", ["smartCollection"], "read"],
  ["browser_set_filter", { column: "device", itemIndex: -1, snapshotId: "snap" }, "browser.set_filter", ["device", -1, "snap"], "device_write"],
  ["browser_scroll_filter_items", { column: "tag", direction: "backward", snapshotId: "snap" }, "browser.scroll_filter_items", ["tag", "backward", "snap"], "device_write"],
  ["device_remote_pages_get", {}, "device.remote_pages_get", [], "read"],
  ["device_remote_page_select", { index: 1023, snapshotId: "snap" }, "device.remote_page_select", [1023, "snap"], "device_write"],
  ["transport_get_arranger_loop", {}, "transport.get_arranger_loop", [], "read"],
  ["transport_set_arranger_loop", { enabled: false, startBeats: 0, durationBeats: 16, snapshotId: "snap" }, "transport.set_arranger_loop", [false, 0, 16, "snap"], "transport"],
  ["ear_status", {}, null, null, "audio_capture"],
  ["ear_get_levels", {}, null, null, "audio_capture"],
  ["ear_list_devices", {}, null, null, "audio_capture"],
  ["ear_set_device", { index: 0 }, null, null, "audio_capture"],
  ["ear_listen", { seconds: 5 }, null, null, "audio_capture"],
  ["ear_analyze", { seconds: 0.5 }, null, null, "audio_capture"],
  ["clip_slot_select", { trackIndex: 0, slotIndex: 7 }, "clip.select_slot", [0, 7], "clip_write"],
];

test("musical tranche appends 26 unique tools, five reads and two opt-in historical wrappers", () => {
  assert.equal(TOOL_SPECS.length, 187);
  assert.equal(new Set(TOOL_SPECS.map((tool) => tool.name)).size, 187);
  assert.deepEqual(TOOL_SPECS.slice(161, 187), MUSICAL_TOOL_SPECS);
  assert.deepEqual(MUSICAL_TOOL_SPECS.map((tool) => tool.name), cases.map((entry) => entry[0]));
  const reads = getToolDefinitions({ env: {} });
  assert.equal(reads.length, 42);
  assert.deepEqual(reads.slice(37).map((tool) => tool.name), ["midi_get_status", "clip_get_note_expressions", "browser_get_filter_items", "device_remote_pages_get", "transport_get_arranger_loop"]);
  assert.equal(reads.some((tool) => tool.name.startsWith("ear_")), false);
  assert.deepEqual(getToolDefinitions({ env: discovery }).slice(-4).map((tool) => tool.name), ["search_tools", "call_tool", "mcp_search_tools", "mcp_execute_advanced_tool"]);
  for (const tool of MUSICAL_TOOL_SPECS) {
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.validateInput, true);
    assert.equal(tool.partialResultIsError, true);
  }
});

test("all musical direct and both dispatcher routes preserve RPC mapping and Ear separation", async () => {
  for (const [name, args, method, params, policy] of cases) {
    let direct;
    for (const entry of routes) {
      const calls = [];
      const earCalls = [];
      const result = await handleToolCall(route(name, args, entry), {
        env: allowed,
        call: async (...values) => { calls.push(values); return { status: "dispatched", verified: false }; },
        earCall: async (toolName, toolArgs, options) => { earCalls.push([toolName, toolArgs, options.authorize()]); return { synthetic: true, payloadSchema: "external-unverified" }; },
      });
      assert.equal(result.isError, undefined, `${name}: ${entry}`);
      assert.deepEqual(calls, method ? [[method, params, { requiresAuthentication: policy !== "read" }]] : [], name);
      assert.deepEqual(earCalls, method ? [] : [[name, args, true]], name);
      if (entry !== "direct") assert.deepEqual(result, direct, name);
      else direct = result;
    }
  }
});

test("new MIDI and audio policies are independent and every mutation remains gated", async () => {
  for (const [name, args, , , policy] of cases.filter((entry) => entry[4] !== "read")) {
    for (const env of [discovery, { ...discovery, BITWIG_MCP_WRITE_POLICY: allPolicies.filter((candidate) => candidate !== policy).join(",") }]) {
      assert.equal(getToolDefinitions({ env }).some((tool) => tool.name === name), false);
      for (const entry of routes) {
        const result = await handleToolCall(route(name, args, entry), { env, call: noIo, earCall: noIo });
        assert.equal(payload(result).error, "policy_blocked", name);
        assert.equal(payload(result).policy, policy, name);
      }
    }
  }
});

test("musical strict schemas reject malformed args and impossible old contracts before any I/O", async () => {
  const invalid = [];
  for (const [name, args] of cases) {
    for (const bad of [null, [], "args", { ...args, extra: true }, { ...args, extra: undefined }]) invalid.push([name, bad]);
    if (Object.keys(args).length && !["ear_listen", "ear_analyze"].includes(name)) invalid.push([name, {}]);
    for (const key of ["trackIndex", "sceneIndex", "slotIndex"].filter((key) => key in args)) {
      for (const bad of [-1, 8, 0.5, "0", NaN, Infinity]) invalid.push([name, { ...args, [key]: bad }]);
    }
    if ("snapshotId" in args) for (const snapshotId of ["", "x".repeat(257), null, 3]) invalid.push([name, { ...args, snapshotId }]);
  }
  for (const name of ["note_on", "note_off", "note_play"]) {
    const args = cases.find((entry) => entry[0] === name)[1];
    for (const channel of [1, 15, -1, 0.5]) invalid.push([name, { ...args, channel }]);
    for (const pitch of [-1, 128, 0.5]) invalid.push([name, { ...args, pitch }]);
  }
  for (const name of ["note_on", "note_play"]) invalid.push([name, { ...cases.find((entry) => entry[0] === name)[1], velocity: 0 }]);
  for (const duration of [0, 10001, 1.5, Infinity]) invalid.push(["note_play", { channel: 0, pitch: 0, velocity: 1, duration }]);
  for (const status of [145, 129, 239, 240, 248, -1]) invalid.push(["midi_send_raw", { status, data1: 0, data2: 0 }]);
  for (const status of [192, 208]) invalid.push(["midi_send_raw", { status, data1: 0, data2: 1 }]);
  for (const expression of ["PITCH", "TIMBRE", "PRESSURE", "unknown"]) invalid.push(["note_input_assign_expression", { channel: 0, expression, pitchRange: 1 }]);
  for (const baseChannel of [1, 14, -1, 16]) invalid.push(["note_input_set_mpe", { enabled: true, baseChannel, pitchBendRange: 48 }]);
  for (const pitchBendRange of [0, 97, 1.5]) invalid.push(["note_input_set_mpe", { enabled: false, baseChannel: 0, pitchBendRange }]);
  for (const name of ["note_input_set_key_translation", "note_input_set_velocity_translation"]) for (const bad of [[], table.slice(1), [...table, 0], table.map(() => -2), table.map(() => 128), table.map(() => 0.5)]) invalid.push([name, { table: bad }]);
  for (const seconds of [0, 11, null, "1", NaN]) for (const name of ["ear_listen", "ear_analyze"]) invalid.push([name, { seconds }]);
  invalid.push(["ear_listen", { seconds: 1.5 }], ["ear_analyze", { seconds: 0.01 }], ["ear_set_device", { index: -1 }], ["ear_set_device", { index: 0.1 }]);
  invalid.push(["browser_set_filter", { text: "acid" }], ["browser_set_filter", { column: "device", itemIndex: 16, snapshotId: "snap" }], ["browser_set_filter", { column: "device", itemIndex: -2, snapshotId: "snap" }]);
  invalid.push(["browser_get_filter_items", { column: "search" }], ["browser_scroll_filter_items", { column: "tag", direction: "up", snapshotId: "snap" }], ["device_remote_page_select", { index: 1024, snapshotId: "snap" }]);
  for (const note of [{ step: 0, pitch: 36 }, { step: 0, pitch: 36, duration: 1 }, { step: 64, pitch: 36, velocity: 0.5 }, { step: 0, pitch: 128, gain: 0.5 }, { step: 0, pitch: 36, velocity: 1.01 }, { step: 0, pitch: 36, releaseVelocity: -0.1 }, { step: 0, pitch: 36, pan: -1.1 }, { step: 0, pitch: 36, timbre: 1.1 }, { step: 0, pitch: 36, pressure: 2 }, { step: 0, pitch: 36, gain: -1 }, { step: 0, pitch: 36, transpose: 97 }]) invalid.push(["clip_set_note_expressions", { trackIndex: 0, sceneIndex: 0, snapshotId: "snap", notes: [note] }]);
  for (const name of ["clip_get_note_expressions", "clip_set_note_expressions"]) {
    const args = cases.find((entry) => entry[0] === name)[1];
    for (const notes of [[], Array(257).fill(args.notes[0]), [args.notes[0], args.notes[0]]]) invalid.push([name, { ...args, notes }]);
  }
  for (const patch of [{ durationBeats: 0 }, { startBeats: -1 }, { startBeats: 1048576, durationBeats: 1 }, { enabled: 0 }]) invalid.push(["transport_set_arranger_loop", { enabled: true, startBeats: 0, durationBeats: 16, snapshotId: "snap", ...patch }]);
  for (const [name, args] of invalid) for (const entry of routes) {
    const result = await handleToolCall(route(name, args, entry), { env: allowed, call: noIo, earCall: noIo });
    assert.equal(payload(result).error, "invalid_arguments", `${name}: ${entry}`);
  }
});

test("musical supported enum and expression boundaries remain usable", async () => {
  const valid = [
    ...[128, 144, 160, 176, 192, 208, 224].map((status) => ["midi_send_raw", { status, data1: 0, data2: 0 }]),
    ...["NONE", "PITCH_DOWN", "PITCH_UP", "GAIN_DOWN", "GAIN_UP", "PAN_LEFT", "PAN_RIGHT", "TIMBRE_DOWN", "TIMBRE_UP"].map((expression) => ["note_input_assign_expression", { channel: 15, expression, pitchRange: 1 }]),
    ...["smartCollection", "location", "device", "category", "tag", "deviceType", "fileType", "creator"].map((column) => ["browser_get_filter_items", { column }]),
    ["clip_set_note_expressions", { trackIndex: 7, sceneIndex: 7, snapshotId: "snap", notes: [{ step: 63, pitch: 127, velocity: 0, releaseVelocity: 1, pan: -1, timbre: 1, pressure: 0, gain: 1, transpose: -96 }] }],
    ["transport_set_arranger_loop", { enabled: false, startBeats: 1048575, durationBeats: 1, snapshotId: "snap" }],
    ["note_input_set_key_translation", { table: table.map(() => -1) }],
    ["note_input_set_velocity_translation", { table: table.map(() => 0) }],
    ["note_input_set_velocity_translation", { table: table.map(() => 127) }],
  ];
  for (const [name, args] of valid) assert.equal((await handleToolCall(request(name, args), { env: allowed, call: async () => "OK", earCall: noIo })).isError, undefined, name);
});

test("velocity translation rejects unsupported -1 through every MCP route before I/O", async () => {
  const keyTool = MUSICAL_TOOL_SPECS.find((tool) => tool.name === "note_input_set_key_translation");
  const velocityTool = MUSICAL_TOOL_SPECS.find((tool) => tool.name === "note_input_set_velocity_translation");
  assert.equal(keyTool.inputSchema.properties.table.items.minimum, -1);
  assert.equal(velocityTool.inputSchema.properties.table.items.minimum, 0);
  assert.match(velocityTool.description, /Negative velocity filtering is unsupported and rejected/);
  for (const index of [0, 45, 127]) {
    const values = [...table]; values[index] = -1;
    for (const entry of routes) {
      const result = await handleToolCall(route("note_input_set_velocity_translation", { table: values }, entry), { env: allowed, call: noIo });
      assert.equal(payload(result).error, "invalid_arguments", `${entry}: negative entry ${index}`);
      const accepted = await handleToolCall(route("note_input_set_key_translation", { table: values }, entry), { env: allowed, call: async (_method, params) => {
        assert.deepEqual(params, [values]); return "OK";
      } });
      assert.equal(accepted.isError, undefined);
    }
  }
  for (const entry of routes) {
    const result = await handleToolCall(route("note_input_set_velocity_translation", { table: Array(128).fill(-1) }, entry), { env: allowed, call: noIo });
    assert.equal(payload(result).error, "invalid_arguments");
  }
});

test("historical discovery aliases retain pagination and forbid recursion among all four wrappers", async () => {
  const names = ["search_tools", "call_tool", "mcp_search_tools", "mcp_execute_advanced_tool"];
  for (const name of names) {
    const args = name.includes("search") ? { query: "midi" } : name === "call_tool" ? { name: "midi_get_status" } : { tool_name: "midi_get_status", arguments: {} };
    assert.equal(payload(await handleToolCall(request(name, args), { env: {}, call: noIo, earCall: noIo })).error, "tool_unavailable");
  }
  for (const entry of ["call_tool", "mcp_execute_advanced_tool"]) for (const target of names) {
    const args = entry === "call_tool" ? { name: target, arguments: {} } : { tool_name: target, arguments: {} };
    assert.equal(payload(await handleToolCall(request(entry, args), { env: allowed, call: noIo, earCall: noIo })).error, "recursive_tool_call");
  }
  const canonical = await handleToolCall(request("search_tools", { query: "midi", limit: 2 }), { env: allowed, call: noIo, earCall: noIo });
  const legacy = await handleToolCall(request("mcp_search_tools", { query: "midi", limit: 2 }), { env: allowed, call: noIo, earCall: noIo });
  assert.deepEqual(legacy, canonical);
  assert.equal(payload(legacy).tools.length, 2);
  assert.equal(payload(legacy).nextOffset, 2);
  for (const args of [{}, { query: "ear", limit: 21 }, { query: "ear", offset: -1 }, { query: "ear", extra: true }]) assert.equal(payload(await handleToolCall(request("mcp_search_tools", args), { env: allowed, call: noIo })).error, "invalid_arguments");
});

test("Ear never contacts Bitwig and is unavailable without explicit configuration", async () => {
  for (const entry of routes) {
    const status = await handleToolCall(route("ear_status", {}, entry), { env: allowed, call: noIo });
    assert.equal(payload(status).result.configured, false);
    const levels = await handleToolCall(route("ear_get_levels", {}, entry), { env: allowed, call: noIo });
    assert.equal(payload(levels).error, "ear_unconfigured");
    const timeout = await handleToolCall(route("ear_listen", { seconds: 1 }, entry), { env: allowed, call: noIo, earCall: async () => { throw new EarClientError("ear_timeout", "Bounded timeout"); } });
    assert.equal(payload(timeout).error, "ear_timeout");
  }
});

test("arguments detach before awaits, including nested expression arrays and Ear args", async () => {
  for (const entry of routes) {
    const args = { trackIndex: 0, sceneIndex: 0, snapshotId: "snap", notes: [{ step: 0, pitch: 36, gain: 0 }] };
    let sent;
    const pending = handleToolCall(route("clip_set_note_expressions", args, entry), { env: allowed, call: async (_method, params) => { sent = params; return "OK"; } });
    args.notes[0].gain = 1;
    args.notes.push({ step: 1, pitch: 36, gain: 1 });
    assert.equal((await pending).isError, undefined);
    assert.deepEqual(sent[3], [{ step: 0, pitch: 36, gain: 0 }]);
    const earArgs = { seconds: 1 };
    let captured;
    const earPending = handleToolCall(route("ear_listen", earArgs, entry), { env: allowed, call: noIo, earCall: async (_name, values) => { captured = values; return {}; } });
    earArgs.seconds = 10;
    await earPending;
    assert.deepEqual(captured, { seconds: 1 });
  }
});

test("policy revocation blocks every new mutation before either adapter dispatches", async () => {
  for (const [name, args] of cases.filter((entry) => entry[4] !== "read")) for (const entry of routes) {
    const env = { ...allowed };
    const pending = handleToolCall(route(name, args, entry), { env, call: noIo, earCall: noIo });
    delete env.BITWIG_MCP_WRITE_POLICY;
    assert.equal(payload(await pending).error, "policy_blocked", `${name}: ${entry}`);
  }
});

test("partial creative operations and missing MIDI profiles remain errors without automatic retry", async () => {
  for (const [name, args, method] of cases.filter((entry) => entry[2] !== null)) {
    for (const partial of [false, true]) {
      let calls = 0;
      const result = await handleToolCall(request(name, args), { env: allowed, call: async () => { calls++; if (partial) return { status: "partial", uncertain: true }; throw new Error("MIDI profile unavailable or stale snapshot"); }, earCall: noIo });
      assert.equal(result.isError, true, method);
      assert.equal(payload(result).error, partial ? "partial_mutation" : "tool_call_failed");
      assert.equal(calls, 1);
    }
  }
});

test("Ear adapter cannot return audio after policy is revoked during its await", async () => {
  for (const entry of routes) {
    const env = { ...allowed };
    const result = await handleToolCall(route("ear_listen", { seconds: 1 }, entry), { env, call: noIo, earCall: async () => {
      delete env.BITWIG_MCP_WRITE_POLICY;
      return { payload: "private-audio-must-not-escape" };
    } });
    assert.equal(payload(result).error, "policy_blocked");
    assert.equal(JSON.stringify(result).includes("private-audio"), false);
  }
});

test("MCP in-memory transport exposes aliases and routes Ear separately under audio_capture", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const calls = [];
  const { server } = await createMcpServer({ env: { ...discovery, BITWIG_MCP_WRITE_POLICY: "audio_capture" }, call: noIo, earCall: async (name, args) => { calls.push([name, args]); return { synthetic: true }; } });
  const client = new Client({ name: "offline-musical-port", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(b); await client.connect(a);
  const search = await client.callTool({ name: "mcp_search_tools", arguments: { query: "ear_listen" } });
  assert.equal(payload(search).tools[0].policy, "audio_capture");
  const invalid = await client.callTool({ name: "mcp_execute_advanced_tool", arguments: { tool_name: "ear_listen", arguments: { seconds: 0 } } });
  assert.equal(payload(invalid).error, "invalid_arguments");
  assert.equal(calls.length, 0);
  const accepted = await client.callTool({ name: "mcp_execute_advanced_tool", arguments: { tool_name: "ear_listen", arguments: { seconds: 1 } } });
  assert.equal(payload(accepted).result.synthetic, true);
  assert.deepEqual(calls, [["ear_listen", { seconds: 1 }]]);
});
