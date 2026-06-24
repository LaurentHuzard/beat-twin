import test from "node:test";
import assert from "node:assert/strict";

import { inspectBitwigSession } from "../index.js";

test("session inspector reads the expected Bitwig surfaces without mutations", async () => {
  const calls = [];
  const responses = new Map([
    ["ping", "pong"],
    ["transport.getTempo", 128],
    ["transport.getPosition", 64],
    ["transport.getIsPlaying", true],
    ["transport.getIsRecording", false],
    ["track.bank.get_status", [{ index: 0, name: "Drums" }]],
    ["track.selected.get_status", { name: "Bass" }],
    ["scene.list", [{ index: 0, name: "Intro" }]],
    ["device.get_status", { name: "Polysynth" }],
    ["device.get_remote_controls", [{ index: 0, name: "Cutoff", value: 0.5 }]],
  ]);

  const result = await inspectBitwigSession(async (method, params) => {
    calls.push({ method, params });
    if (!responses.has(method)) {
      throw new Error(`Unexpected method ${method}`);
    }
    return responses.get(method);
  });

  assert.equal(result.connected, true);
  assert.equal(result.scope, "read-only");
  assert.equal(result.transport.tempo, 128);
  assert.equal(result.transport.position, 64);
  assert.deepEqual(result.trackBank, [{ index: 0, name: "Drums" }]);
  assert.deepEqual(result.selectedTrack, { name: "Bass" });
  assert.deepEqual(result.scenes, [{ index: 0, name: "Intro" }]);
  assert.deepEqual(result.selectedDevice, { name: "Polysynth" });
  assert.deepEqual(result.remoteControls, [{ index: 0, name: "Cutoff", value: 0.5 }]);

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

test("session inspector returns setup guidance when Bitwig is disconnected", async () => {
  const result = await inspectBitwigSession(async () => {
    throw new Error("Could not connect to Bitwig. Is it running?");
  });

  assert.equal(result.connected, false);
  assert.match(result.error, /Could not connect/);
  assert.match(result.setup_hint, /enable the BitwigPOC controller/);
});
