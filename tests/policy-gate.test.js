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
      "track_selected_get_status",
      "device_get_status",
      "device_get_remote_controls",
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
  assert.ok(!names.includes("application_create_audio_track"));
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
