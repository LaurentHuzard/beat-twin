import test from "node:test";
import assert from "node:assert/strict";

import {
  createArrangementPlanFromInspection,
  handleToolCall,
  planBitwigArrangement,
} from "../index.js";

const readResponses = new Map([
  ["ping", "pong"],
  ["transport.getTempo", 124],
  ["transport.getPosition", 32],
  ["transport.getIsPlaying", false],
  ["transport.getIsRecording", false],
  [
    "track.bank.get_status",
    [
      { index: 0, name: "Drums", mute: false, solo: false, arm: false },
      { index: 1, name: "Bass", mute: false, solo: false, arm: false },
      { index: 2, name: "Lead", mute: false, solo: false, arm: false },
    ],
  ],
  ["track.selected.get_status", { name: "Lead", arm: false }],
  [
    "scene.list",
    [
      { index: 0, name: "Loop A" },
      { index: 1, name: "Break" },
    ],
  ],
  ["device.get_status", { name: "Polysynth", isWindowOpen: false }],
  ["device.get_remote_controls", [{ index: 0, name: "Cutoff", value: 0.42 }]],
]);

test("arrangement plan is derived from read-only Bitwig inspection", async () => {
  const calls = [];

  const plan = await planBitwigArrangement(
    { goal: "Make the loop build cleanly", style: "club", targetLengthBars: 48 },
    async (method, params) => {
      calls.push({ method, params });
      if (!readResponses.has(method)) {
        throw new Error(`Unexpected method ${method}`);
      }
      return readResponses.get(method);
    },
  );

  assert.equal(plan.connected, true);
  assert.equal(plan.scope, "plan-only");
  assert.equal(plan.goal, "Make the loop build cleanly");
  assert.equal(plan.style, "club");
  assert.equal(plan.target_length_bars, 48);
  assert.match(plan.musical_summary, /3 visible tracks/);
  assert.match(plan.musical_summary, /2 visible scenes/);
  assert.deepEqual(plan.observed_session.tracks.map((track) => track.name), [
    "Drums",
    "Bass",
    "Lead",
  ]);
  assert.ok(plan.permissions_summary.includes("read"));
  assert.ok(plan.permissions_summary.includes("clip_write"));
  assert.ok(plan.permissions_summary.includes("scene_write"));
  assert.ok(plan.missing_data.includes("clip content names and lengths"));
  assert.ok(plan.risks.some((risk) => risk.includes("visible 8-track")));
  assert.ok(plan.steps.some((step) => step.permissions_required.includes("clip_write")));

  assert.deepEqual(
    calls.map((call) => call.method),
    [
      "ping",
      "transport.getTempo",
      "transport.getPosition",
      "transport.getIsPlaying",
      "transport.getIsRecording",
      "track.bank.get_status",
      "track.selected.get_status",
      "scene.list",
      "device.get_status",
      "device.get_remote_controls",
    ],
  );
});

test("arrangement plan handles disconnected Bitwig without guessing", () => {
  const plan = createArrangementPlanFromInspection({
    connected: false,
    setup_hint: "Start Bitwig first.",
    error: "Could not connect",
  });

  assert.equal(plan.connected, false);
  assert.equal(plan.scope, "plan-only");
  assert.deepEqual(plan.permissions_summary, ["read"]);
  assert.deepEqual(plan.missing_data, ["connected Bitwig session snapshot"]);
  assert.match(plan.musical_summary, /No arrangement can be inferred/);
  assert.equal(plan.steps[0].permissions_required[0], "read");
});

test("arrangement MCP tool is callable by default and returns plan-only payload", async () => {
  let writeCallCount = 0;
  const response = await handleToolCall(
    {
      params: {
        name: "bitwig_arrangement_plan",
        arguments: { style: "minimal", targetLengthBars: 32 },
      },
    },
    {
      env: {},
      call: async (method) => {
        if (method.includes("set") || method.includes("create") || method.includes("launch")) {
          writeCallCount += 1;
        }
        return readResponses.get(method);
      },
    },
  );

  const plan = JSON.parse(response.content[0].text);

  assert.equal(response.isError, undefined);
  assert.equal(writeCallCount, 0);
  assert.equal(plan.scope, "plan-only");
  assert.equal(plan.style, "minimal");
  assert.equal(plan.target_length_bars, 32);
});
