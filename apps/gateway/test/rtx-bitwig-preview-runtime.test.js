import assert from "node:assert/strict";
import test from "node:test";

import {
  readRtxBitwigPreviewConfig,
  startRtxBitwigPreviewRuntime,
} from "../src/rtx-bitwig-preview-runtime.js";

const OPERATOR_SECRET = "local preview operator secret";
const PATCH = Object.freeze({
  schemaVersion: 1,
  tempoBpm: 132,
  track: Object.freeze({
    kind: "instrument",
    name: "Electronic Loop",
    clip: Object.freeze({
      name: "Pulse",
      lengthBeats: 4,
      notes: Object.freeze([
        Object.freeze({ pitch: 60, velocity: 100, startBeat: 0.5, lengthBeats: 0.5 }),
      ]),
    }),
  }),
});

function emptyInspection() {
  return {
    protocolVersion: "beat-twin-bitwig-v2",
    controllerInstanceId: "controller-preview-1",
    projectName: "Disposable Preview",
    writeAuthenticated: false,
    target: {
      available: true,
      binding: {
        controllerInstanceId: "controller-preview-1",
        projectName: "Disposable Preview",
        trackPosition: 0,
        slotSceneIndex: 0,
        targetGeneration: 1,
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

function completion(step, toolCall) {
  return {
    id: `completion-${step}`,
    object: "chat.completion",
    created: step,
    model: "qwen3-8b",
    choices: [{
      index: 0,
      message: { role: "assistant", content: null, tool_calls: [toolCall] },
      finish_reason: "tool_calls",
    }],
  };
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  return { response, body: await response.json() };
}

test("RTX Bitwig runtime composes a real preview-only bounded agent loop", async () => {
  const requests = [];
  let chatStep = 0;
  const fakeFetch = async (input, init = {}) => {
    const url = String(input);
    if (url.endsWith("/v1/models")) {
      return Response.json({ object: "list", data: [{ id: "qwen3-8b", object: "model" }] });
    }
    assert.ok(url.endsWith("/v1/chat/completions"));
    const body = JSON.parse(init.body);
    requests.push(body);
    chatStep += 1;
    if (chatStep === 1) {
      return Response.json(completion(1, {
        id: "call-inspect",
        type: "function",
        function: { name: "inspect_session", arguments: JSON.stringify({ dawId: "bitwig" }) },
      }));
    }
    return Response.json(completion(2, {
      id: "call-propose",
      type: "function",
      function: { name: "propose_song_patch", arguments: JSON.stringify(PATCH) },
    }));
  };
  const bitwigCalls = [];
  const runtime = await startRtxBitwigPreviewRuntime({
    operatorSecret: OPERATOR_SECRET,
    providerBaseUrl: "http://rtx.test:8002/",
    model: "qwen3-8b",
    fetch: fakeFetch,
    gatewayPort: 0,
    bitwigCall: async (method, params) => {
      bitwigCalls.push({ method, params });
      return emptyInspection();
    },
  });

  try {
    const paired = await jsonFetch(`${runtime.baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorSecret: OPERATOR_SECRET }),
    });
    assert.equal(paired.response.status, 201);
    assert.deepEqual(paired.body.scopes, [
      "gateway.read",
      "daw.list",
      "daw.inspect",
      "agent.run",
      "plan.create",
      "song.write",
    ]);
    const authorization = { authorization: `Bearer ${paired.body.token}` };
    const run = await jsonFetch(`${runtime.baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        dawId: "bitwig",
        request: "Inspecte Bitwig puis propose une boucle minimale à 132 BPM.",
      }),
    });

    assert.equal(run.response.status, 201);
    assert.equal(run.body.model, "qwen3-8b");
    assert.equal(run.body.steps, 2);
    assert.equal(run.body.patch.tempoBpm, 132);
    assert.equal(run.body.plan.adapterId, "bitwig");
    assert.deepEqual(run.body.plan.requiredScopes, ["song.write"]);
    assert.deepEqual(run.body.preview.commands, run.body.plan.commands);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.parallel_tool_calls, false);
      assert.deepEqual(
        request.tools.map((tool) => tool.function.name),
        ["list_daw_targets", "inspect_session", "propose_song_patch"],
      );
    }
    assert.ok(bitwigCalls.length >= 1);
    assert.equal(bitwigCalls.every(({ method }) => method === "target.inspect"), true);

    for (const suffix of ["confirm", "execute", "status"]) {
      const blocked = await jsonFetch(`${runtime.baseUrl}/v1/plans/${run.body.plan.planId}/${suffix}`, {
        method: suffix === "status" ? "GET" : "POST",
        headers: authorization,
      });
      assert.equal(blocked.response.status, 404);
      assert.equal(blocked.body.error.code, "route_not_found");
    }
    assert.equal(bitwigCalls.every(({ method }) => method === "target.inspect"), true);
  } finally {
    await runtime.close();
  }
});

test("RTX Bitwig preview config fails closed and accepts loopback defaults", async () => {
  const config = readRtxBitwigPreviewConfig({
    BEAT_TWIN_OPERATOR_SECRET: OPERATOR_SECRET,
    LITERT_BASE_URL: "http://192.168.1.141:8002/",
    LITERT_MODEL: "qwen3-8b",
  });
  assert.equal(config.gatewayHost, "127.0.0.1");
  assert.equal(config.gatewayPort, 8788);
  assert.equal(config.bitwigHost, "127.0.0.1");
  assert.equal(config.bitwigPort, 8888);
  assert.equal(config.providerBaseUrl.href, "http://192.168.1.141:8002/");
  const runtime = await startRtxBitwigPreviewRuntime({
    operatorSecret: OPERATOR_SECRET,
    providerBaseUrl: config.providerBaseUrl,
    model: config.model,
    gatewayPort: 0,
    bitwigCall: async () => emptyInspection(),
  });
  await runtime.close();

  assert.throws(
    () => readRtxBitwigPreviewConfig({
      BEAT_TWIN_OPERATOR_SECRET: OPERATOR_SECRET,
      LITERT_BASE_URL: "http://rtx.test:8002/",
      LITERT_MODEL: "qwen3-8b",
      BEAT_TWIN_GATEWAY_HOST: "0.0.0.0",
    }),
    /non-loopback/i,
  );
  assert.throws(
    () => readRtxBitwigPreviewConfig({
      BEAT_TWIN_OPERATOR_SECRET: "short",
      LITERT_BASE_URL: "http://rtx.test:8002/",
      LITERT_MODEL: "qwen3-8b",
    }),
    /at least 16 characters/,
  );
});
