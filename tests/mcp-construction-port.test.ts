import assert from "node:assert/strict";
import test from "node:test";
import { CONSTRUCTION_TOOL_SPECS, TOOL_SPECS, getToolDefinitions, handleToolCall, createMcpServer } from "../index.ts";

const request = (name, args = {}) => ({ params: { name, arguments: args } });
const payload = (result) => JSON.parse(result.content[0].text);
const discovery = { BITWIG_MCP_TOOL_DISCOVERY: "1" };
const allowed = { ...discovery, BITWIG_MCP_WRITE_POLICY: "clip_write,scene_write" };
const target = { trackIndex: 0, sceneIndex: 7 };
const note = { step: 0, pitch: 36, velocity: 100, durationBeats: 0.25 };
const noDaw = async () => { assert.fail("rejected arguments must not reach Bitwig"); };
const route = (name, args, generic) => generic ? request("call_tool", { name, arguments: args }) : request(name, args);
const cases = [
  ["clip_rename", { ...target, name: "Acid" }, "clip.rename", [0, 7, "Acid"], "clip_write"],
  ["clip_get_color", target, "clip.get_color", [0, 7], "read"],
  ["clip_set_color", { ...target, r: 0, g: 0.5, b: 1 }, "clip.set_color", [0, 7, 0, 0.5, 1], "clip_write"],
  ["clip_delete", target, "clip.delete", [0, 7], "clip_write"],
  ["clip_duplicate", { trackIndex: 0, sourceSceneIndex: 1, destinationSceneIndex: 7 }, "clip.duplicate", [0, 1, 7], "clip_write"],
  ["clip_browse_insert", target, "clip.browse_insert", [0, 7], "clip_write"],
  ["scene_select", { sceneIndex: 7 }, "scene.select", [7], "scene_write"],
  ["scene_delete", { sceneIndex: 7 }, "scene.delete", [7], "scene_write"],
  ["scene_create_from_playing", {}, "scene.create_from_playing", [], "scene_write"],
  ["clip_set_notes", { ...target, notes: [note] }, "clip.set_notes", [0, 7, [note]], "clip_write"],
  ["clip_clear_notes", { ...target, notes: [{ step: 63, pitch: 127 }] }, "clip.clear_notes", [0, 7, [{ step: 63, pitch: 127 }]], "clip_write"],
  ["clip_set_loop_length", { ...target, lengthBeats: 16 }, "clip.set_loop_length", [0, 7, 16], "clip_write"],
  ["transport_get_recording_status", {}, "transport.getIsRecording", [], "read"],
];

test("construction adds 13 unique tools and two default reads without enabling writes", async () => {
  assert.equal(TOOL_SPECS.length, 126);
  assert.equal(new Set(TOOL_SPECS.map((tool) => tool.name)).size, 126);
  assert.deepEqual(TOOL_SPECS.slice(70, 83), CONSTRUCTION_TOOL_SPECS);
  const definitions = getToolDefinitions({ env: {} });
  assert.equal(definitions.length, 32);
  assert.deepEqual(definitions.slice(20, 22).map((tool) => tool.name), ["clip_get_color", "transport_get_recording_status"]);
  for (const [name, args, , , policy] of cases.filter((entry) => entry[4] !== "read")) {
    for (const env of [discovery, { ...discovery, BITWIG_MCP_WRITE_POLICY: "mixer_write,device_write,transport" }]) {
      for (const generic of [false, true]) {
        const result = await handleToolCall(route(name, args, generic), { env, call: noDaw });
        assert.equal(payload(result).error, "policy_blocked", name);
        assert.equal(payload(result).policy, policy);
      }
    }
  }
});

test("every construction tool dispatches once with identical direct and discovery contracts", async () => {
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

test("construction schemas reject unknown, missing, fractional, unbounded and nonfinite input", async () => {
  const invalidCases = [];
  for (const [name, args] of cases) {
    for (const invalid of [null, [], "args", { ...args, extra: true }, { ...args, extra: undefined }]) invalidCases.push([name, invalid]);
    if (Object.keys(args).length) invalidCases.push([name, {}]);
    for (const key of ["trackIndex", "sceneIndex", "sourceSceneIndex", "destinationSceneIndex"].filter((key) => key in args)) {
      for (const bad of [-1, 8, 1.5, "1", Infinity, NaN]) invalidCases.push([name, { ...args, [key]: bad }]);
    }
  }
  for (const lengthBeats of [0, -1, 16.25, 0.1, Infinity, NaN, "4"]) invalidCases.push(["clip_set_loop_length", { ...target, lengthBeats }]);
  for (const name of ["", "  ", "a".repeat(129), "a\n", "a\u0085"]) invalidCases.push(["clip_rename", { ...target, name }]);
  for (const color of [-1, 1.01, Infinity, NaN, "0.5"]) invalidCases.push(["clip_set_color", { ...target, r: color, g: 0, b: 1 }]);
  invalidCases.push(["clip_duplicate", { trackIndex: 0, sourceSceneIndex: 1, destinationSceneIndex: 1 }]);
  for (const [name, args] of invalidCases) {
    for (const generic of [false, true]) {
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: noDaw });
      assert.equal(payload(result).error, "invalid_arguments", `${name} generic=${generic}`);
    }
  }
});

test("whole note batches validate before RPC including cardinality, duplicates, overlap and beat units", async () => {
  const invalidBatches = [
    [], Array.from({ length: 257 }, (_, index) => ({ ...note, step: index % 64, pitch: Math.floor(index / 64) })),
    [note, note], [note, { ...note, velocity: 101 }],
    [{ ...note, duration: 1 }], [{ ...note, durationBeats: 0 }], [{ ...note, durationBeats: 0.1 }],
    [{ ...note, durationBeats: Infinity }], [{ ...note, durationBeats: NaN }],
    [{ ...note, step: 63, durationBeats: 0.5 }],
    [{ ...note, step: 0, durationBeats: 1 }, { ...note, step: 3 }],
    [{ ...note, velocity: 0 }], [{ ...note, velocity: 128 }], [{ ...note, pitch: 128 }],
    [{ ...note, step: -1 }], [{ ...note, step: 64 }], [{ ...note, step: 0.5 }],
    [{ ...note, channel: 1 }], [note, { ...note, step: 2, pitch: "36" }],
  ];
  for (const notes of invalidBatches) {
    for (const generic of [false, true]) {
      const result = await handleToolCall(route("clip_set_notes", { ...target, notes }, generic), { env: allowed, call: noDaw });
      assert.equal(payload(result).error, "invalid_arguments");
    }
  }
  for (const notes of [[], [{ step: 0, pitch: 0 }, { step: 0, pitch: 0 }], [{ step: 0, pitch: 0, durationBeats: 1 }]]) {
    const result = await handleToolCall(request("clip_clear_notes", { ...target, notes }), { env: allowed, call: noDaw });
    assert.equal(payload(result).error, "invalid_arguments");
  }
  const notes = Array.from({ length: 256 }, (_, index) => ({ ...note, step: index % 64, pitch: Math.floor(index / 64) }));
  let calls = 0;
  const valid = await handleToolCall(request("clip_set_notes", { ...target, notes }), { env: allowed, call: async () => { calls++; return "OK"; } });
  assert.equal(valid.isError, undefined);
  assert.equal(calls, 1);
});

test("batch snapshots reject non-JSON tricks and detach nested data before async validation", async () => {
  let getterCalls = 0;
  const getter = Object.defineProperty({}, "step", { enumerable: true, get() { getterCalls++; return 0; } });
  const cyclic = { ...note };
  cyclic.self = cyclic;
  const sparse = new Array(1);
  const customArray = [note];
  customArray.extra = true;
  for (const notes of [[getter], [cyclic], sparse, customArray, [{ ...note, toJSON: () => note }], [Object.assign(Object.create({ inherited: true }), note)]]) {
    const result = await handleToolCall(request("clip_set_notes", { ...target, notes }), { env: allowed, call: noDaw });
    assert.equal(payload(result).error, "invalid_arguments");
  }
  assert.equal(getterCalls, 0);
  const args = { ...target, notes: [{ ...note }] };
  const calls = [];
  const pending = handleToolCall(request("clip_set_notes", args), { env: allowed, call: async (...values) => { calls.push(values); return "OK"; } });
  args.notes[0].pitch = 999;
  args.notes.push({ ...note });
  assert.equal((await pending).isError, undefined);
  assert.deepEqual(calls[0][1], [0, 7, [note]]);
  const oversized = await handleToolCall(request("clip_set_notes", { ...target, notes: [{ ...note, extra: "a".repeat(65536) }] }), { env: allowed, call: noDaw });
  assert.equal(payload(oversized).error, "invalid_arguments");
});

test("batch policy revoked during validation prevents direct and discovery dispatch", async () => {
  for (const generic of [false, true]) {
    const env = { ...allowed };
    const pending = handleToolCall(route("clip_set_notes", { ...target, notes: [note] }, generic), { env, call: noDaw });
    delete env.BITWIG_MCP_WRITE_POLICY;
    assert.equal(payload(await pending).error, "policy_blocked");
  }
});

test("partial host batch failures are MCP errors retaining uncertainty without retry", async () => {
  for (const name of ["clip_set_notes", "clip_clear_notes"]) {
    const args = { ...target, notes: name === "clip_set_notes" ? [note] : [{ step: 0, pitch: 36 }] };
    for (const generic of [false, true]) {
      let calls = 0;
      const partial = { status: "partial", dispatchedCount: 0, totalCount: 1, uncertain: true, verified: false, error: "Lost host acknowledgement" };
      const result = await handleToolCall(route(name, args, generic), { env: allowed, call: async () => { calls++; return partial; } });
      assert.equal(calls, 1);
      assert.equal(result.isError, true);
      assert.equal(payload(result).error, "partial_mutation");
      assert.deepEqual(payload(result).result, partial);
      assert.match(payload(result).message, /do not automatically replay/);
    }
  }
});

test("MCP transport enforces batch semantics and discovery keeps reads/write policies truthful", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const calls = [];
  const env = { ...allowed };
  const { server } = await createMcpServer({ env, call: async (...args) => { calls.push(args); return { status: "dispatched", dispatchedCount: 1, verified: false }; } });
  const client = new Client({ name: "offline-construction-port", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const invalid = await client.callTool({ name: "clip_set_notes", arguments: { ...target, notes: [note, note] } });
  assert.equal(payload(invalid).error, "invalid_arguments");
  assert.equal(calls.length, 0);
  const result = await client.callTool({ name: "call_tool", arguments: { name: "clip_set_notes", arguments: { ...target, notes: [note] } } });
  assert.equal(payload(result).result.verified, false);
  assert.equal(calls.length, 1);
  delete env.BITWIG_MCP_WRITE_POLICY;
  const search = await client.callTool({ name: "search_tools", arguments: { query: "clip_set_notes" } });
  assert.equal(payload(search).tools.length, 0);
});
