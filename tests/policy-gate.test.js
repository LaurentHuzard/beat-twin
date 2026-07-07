import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  TOOL_SPECS,
  getToolDefinitions,
  handleToolCall,
} from "../index.js";

function parseToolText(response) {
  return JSON.parse(response.content[0].text);
}

async function readPolicyFixtures() {
  const fixturePath = fileURLToPath(new URL("./fixtures/policy-errors.json", import.meta.url));
  return JSON.parse(await readFile(fixturePath, "utf8"));
}

test("tool registry keeps bitwig_session_inspect read-only", () => {
  const inspector = TOOL_SPECS.find((tool) => tool.name === "bitwig_session_inspect");

  assert.ok(inspector);
  assert.equal(inspector.policy, "read");
});

test("default tool list exposes only read tools", () => {
  const tools = getToolDefinitions({ env: {} });

  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      "bitwig_session_inspect",
      "bitwig_arrangement_plan",
      "transport_get_tempo",
      "transport_get_position",
      "transport_playing_status",
      "track_bank_get_status",
      "scene_list",
      "clip_get_info",
      "track_selected_get_status",
      "device_get_status",
      "device_get_remote_controls",
      "device_list",
      "browser_get_status",
      "browser_list_results",
    ],
  );
  assert.ok(tools.every((tool) => tool.description.startsWith("[policy:read]")));
});

test("read tool stays callable by default", async () => {
  const calls = [];
  const response = await handleToolCall(
    {
      params: {
        name: "transport_get_tempo",
        arguments: {},
      },
    },
    {
      env: {},
      call: async (method, params) => {
        calls.push({ method, params });
        return 128.5;
      },
    },
  );

  assert.equal(response.isError, undefined);
  assert.equal(parseToolText(response), 128.5);
  assert.deepEqual(calls, [{ method: "transport.getTempo", params: [] }]);
});

test("mutating tool is blocked by default without calling Bitwig", async () => {
  let callCount = 0;
  const response = await handleToolCall(
    {
      params: {
        name: "track_bank_set_volume",
        arguments: { index: 2, value: 0.75 },
      },
    },
    {
      env: {},
      call: async () => {
        callCount += 1;
        return "should-not-run";
      },
    },
  );

  assert.equal(callCount, 0);
  assert.equal(response.isError, true);
  assert.deepEqual(parseToolText(response), {
    error: "policy_blocked",
    tool: "track_bank_set_volume",
    policy: "mixer_write",
    message:
      "Tool track_bank_set_volume requires the mixer_write write policy before it can call Bitwig.",
    required_config: {
      anyOf: [
        { env: "BITWIG_MCP_WRITE_POLICY", value: "mixer_write" },
        { env: "BITWIG_MCP_ENABLE_WRITES", value: "1" },
      ],
    },
  });
});

test("mutating tool is callable when its policy is explicitly enabled", async () => {
  const calls = [];
  const response = await handleToolCall(
    {
      params: {
        name: "track_bank_set_volume",
        arguments: { index: 2, value: 0.75 },
      },
    },
    {
      env: { BITWIG_MCP_WRITE_POLICY: "transport,mixer_write" },
      call: async (method, params) => {
        calls.push({ method, params });
        return "OK";
      },
    },
  );

  assert.equal(response.isError, undefined);
  assert.deepEqual(parseToolText(response), {
    tool: "track_bank_set_volume",
    policy: "mixer_write",
    method: "track.bank.volume",
    params: [2, 0.75],
    result: "OK",
  });
  assert.deepEqual(calls, [{ method: "track.bank.volume", params: [2, 0.75] }]);
});

test("tool list exposes only the enabled write classes plus reads", () => {
  const tools = getToolDefinitions({
    env: { BITWIG_MCP_WRITE_POLICY: "transport,mixer_write" },
  });
  const names = tools.map((tool) => tool.name);

  assert.ok(names.includes("bitwig_session_inspect"));
  assert.ok(names.includes("transport_play"));
  assert.ok(names.includes("track_bank_set_volume"));
  assert.ok(names.includes("track_selected_set_arm"));
  assert.ok(!names.includes("clip_launch"));
  assert.ok(!names.includes("clip_set_note"));
  assert.ok(!names.includes("device_browse_insert"));
  assert.ok(!names.includes("device_browse_start"));
  assert.ok(!names.includes("browser_commit"));
  assert.ok(!names.includes("application_create_audio_track"));
});

test("clip note tools are exposed and mapped only with clip_write policy", async () => {
  const tools = getToolDefinitions({
    env: { BITWIG_MCP_WRITE_POLICY: "clip_write" },
  });
  const names = tools.map((tool) => tool.name);

  assert.ok(names.includes("clip_get_info"));
  assert.ok(names.includes("clip_select_slot"));
  assert.ok(names.includes("clip_show_in_editor"));
  assert.ok(names.includes("clip_set_note"));
  assert.ok(names.includes("clip_clear_note"));
  assert.ok(names.includes("clip_toggle_note"));

  const calls = [];
  const response = await handleToolCall(
    {
      params: {
        name: "clip_set_note",
        arguments: { step: 3, pitch: 60, velocity: 108, duration: 1 },
      },
    },
    {
      env: { BITWIG_MCP_WRITE_POLICY: "clip_write" },
      call: async (method, params) => {
        calls.push({ method, params });
        return "OK";
      },
    },
  );

  assert.equal(response.isError, undefined);
  assert.deepEqual(parseToolText(response), {
    tool: "clip_set_note",
    policy: "clip_write",
    method: "clip.set_note",
    params: [3, 60, 108, 1],
    result: "OK",
  });
  assert.deepEqual(calls, [{ method: "clip.set_note", params: [3, 60, 108, 1] }]);
});

test("device browser tools are exposed and mapped only with device_write policy", async () => {
  const tools = getToolDefinitions({
    env: { BITWIG_MCP_WRITE_POLICY: "device_write" },
  });
  const names = tools.map((tool) => tool.name);

  assert.ok(names.includes("device_browse_insert"));
  assert.ok(names.includes("device_browse_start"));
  assert.ok(names.includes("device_browse_end"));
  assert.ok(names.includes("browser_select_result"));
  assert.ok(names.includes("browser_commit"));

  const calls = [];
  const invoke = (name, args) =>
    handleToolCall(
      {
        params: {
          name,
          arguments: args,
        },
      },
      {
        env: { BITWIG_MCP_WRITE_POLICY: "device_write" },
        call: async (method, params) => {
          calls.push({ method, params });
          return "OK";
        },
      },
    );

  const response = await invoke("device_browse_insert", { trackIndex: 2, position: 0 });
  assert.equal(response.isError, undefined);
  assert.deepEqual(parseToolText(response), {
    tool: "device_browse_insert",
    policy: "device_write",
    method: "device.browse_insert",
    params: [2, 0],
    result: "OK",
  });

  await invoke("device_browse_start", { trackIndex: 2 });
  await invoke("device_browse_end", { trackIndex: 2 });
  assert.deepEqual(calls, [
    { method: "device.browse_insert", params: [2, 0] },
    { method: "device.browse_start", params: [2] },
    { method: "device.browse_end", params: [2] },
  ]);
});

test("policy fixture scenarios match MCP tool responses", async () => {
  const fixtures = await readPolicyFixtures();

  for (const scenario of fixtures.scenarios) {
    const calls = [];
    const response = await handleToolCall(
      {
        params: {
          name: scenario.request.tool,
          arguments: scenario.request.arguments ?? {},
        },
      },
      {
        env: scenario.env ?? {},
        call: async (method, params) => {
          calls.push({ method, params });
          return scenario.bitwig_result;
        },
      },
    );

    assert.equal(response.isError === true, scenario.expected.is_error, scenario.name);
    assert.deepEqual(parseToolText(response), scenario.expected.payload, scenario.name);
    assert.equal(calls.length, scenario.expected.bitwig_call_count, scenario.name);
  }
});
