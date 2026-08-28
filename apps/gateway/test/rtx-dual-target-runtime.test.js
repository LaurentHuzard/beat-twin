import assert from "node:assert/strict";
import test from "node:test";

import { createCommandRuntime, createCommandState } from "@beat-twin/commands";
import { WebSocket } from "ws";

import {
  BROWSER_NANODAW_PROTOCOL,
  encodeBrowserPairingProtocol,
} from "../src/index.js";
import { startRtxDualTargetRuntime } from "../src/rtx-dual-target-runtime.js";

const ORIGIN = "http://127.0.0.1:5173";
const OPERATOR_SECRET = "dual target operator secret";
const BRIDGE_SECRET = "dual target bridge secret";
const PATCH = Object.freeze({
  schemaVersion: 1,
  tempoBpm: 128,
  track: Object.freeze({
    kind: "instrument",
    name: "Shared Pulse",
    clip: Object.freeze({
      name: "Shared Loop",
      lengthBeats: 4,
      notes: Object.freeze([
        Object.freeze({ pitch: 48, velocity: 100, startBeat: 0, lengthBeats: 0.5 }),
      ]),
    }),
  }),
});

function emptyBitwigInspection() {
  return {
    protocolVersion: "beat-twin-bitwig-v2",
    controllerInstanceId: "controller-dual-1",
    projectName: "Dual Target",
    writeAuthenticated: false,
    target: {
      available: true,
      binding: {
        controllerInstanceId: "controller-dual-1",
        projectName: "Dual Target",
        trackPosition: 0,
        slotSceneIndex: 1,
        targetGeneration: 2,
      },
      trackName: "Instrument 1",
      slotName: "",
      hasContent: false,
      clipExists: false,
      clipLengthBeats: null,
    },
    transport: { tempoBpm: 120, positionBeats: 0, isPlaying: false },
    grid: { stepSizeBeats: 0.25, maxSteps: 64 },
    notes: [],
  };
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  return { response, body: await response.json() };
}

test("dual-target runtime reads the browser-owned NanoDAW and Bitwig before creating two previews", async () => {
  let providerRuns = 0;
  const provider = {
    listModels: async () => [{ id: "qwen3-8b" }],
    runAgent: async ({ handlers }) => {
      providerRuns += 1;
      assert.deepEqual(await handlers.list_daw_targets(), [
        { id: "nanodaw" },
        { id: "bitwig" },
      ]);
      const nanodaw = await handlers.inspect_session({ dawId: "nanodaw" });
      const bitwig = await handlers.inspect_session({ dawId: "bitwig" });
      assert.equal(nanodaw.adapterId, "nanodaw");
      assert.equal(bitwig.adapterId, "bitwig");
      await handlers.propose_song_patch(PATCH);
      return Object.freeze({ model: "qwen3-8b", steps: 3, patch: PATCH, toolCalls: [] });
    },
  };
  const bitwigCalls = [];
  const runtime = await startRtxDualTargetRuntime({
    operatorSecret: OPERATOR_SECRET,
    bridgeSecret: BRIDGE_SECRET,
    provider,
    allowedOrigins: [ORIGIN],
    gatewayPort: 0,
    bitwigCall: async (method, params, options) => {
      bitwigCalls.push({ method, params, options });
      assert.equal(method, "target.inspect");
      assert.equal(options, undefined);
      return emptyBitwigInspection();
    },
  });
  let browser;

  try {
    const paired = await jsonFetch(`${runtime.baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorSecret: OPERATOR_SECRET, actorId: "browser-test" }),
    });
    assert.equal(paired.response.status, 201);

    const browserRuntime = createCommandRuntime(createCommandState());
    const websocketUrl = new URL("/v1/browser/nanodaw", runtime.baseUrl);
    websocketUrl.protocol = "ws:";
    browser = new WebSocket(
      websocketUrl,
      [BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol(paired.body.token)],
      { origin: ORIGIN },
    );
    browser.on("message", (raw) => {
      const message = JSON.parse(raw.toString("utf8"));
      assert.equal(message.method, "inspect");
      browser.send(JSON.stringify({
        v: 1,
        id: message.id,
        ok: true,
        result: browserRuntime.inspect(),
      }));
    });
    await new Promise((resolve, reject) => {
      browser.once("open", resolve);
      browser.once("error", reject);
    });
    assert.equal(runtime.browserStatus().connected, true);

    const authorization = { authorization: `Bearer ${paired.body.token}` };
    const run = await jsonFetch(`${runtime.baseUrl}/v1/agent/dual-target-runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        dawIds: ["nanodaw", "bitwig"],
        request: "Prepare the same shared loop at 128 BPM",
      }),
    });
    assert.equal(run.response.status, 201);
    assert.equal(providerRuns, 1);
    assert.deepEqual(run.body.patch, PATCH);
    assert.deepEqual(run.body.targets.map(({ dawId }) => dawId), ["nanodaw", "bitwig"]);
    assert.notEqual(run.body.targets[0].plan.digest, run.body.targets[1].plan.digest);
    assert.equal(browserRuntime.inspect().song, null);
    assert.ok(bitwigCalls.length >= 1);
    assert.equal(bitwigCalls.every(({ method }) => method === "target.inspect"), true);
  } finally {
    browser?.close();
    await runtime.close();
  }
});
