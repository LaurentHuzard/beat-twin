import assert from "node:assert/strict";
import test from "node:test";
import { createCommandRuntime, createCommandState } from "@beat-twin/commands";
import { WebSocket } from "ws";
import { createNanoDawMcpRuntime } from "../../../packages/mcp/src/runtime.ts";
import { nanoDawProviderOptions, runNanoDawMcp } from "../../../packages/mcp/src/cli.ts";
import { BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol } from "../src/index.js";

const ORIGIN = "http://127.0.0.1:5173";
const SECRET = "offline-nanodaw-operator";
const PATCH = {
  schemaVersion: 2, tempoBpm: 118,
  track: { kind: "instrument", name: "Night Bass", instrumentId: "bass",
    clip: { name: "Verse", lengthBeats: 4, notes: [{ pitch: 36, velocity: 100, startBeat: 0, lengthBeats: 1 }] } },
};

async function fixture(t, { agent = false, loseReply = false } = {}) {
  const requests = [];
  const runtime = await createNanoDawMcpRuntime({
    operatorSecret: SECRET, allowedOrigins: [ORIGIN], port: 0,
    ...(agent ? { provider: {
      baseUrl: "http://offline.invalid/", model: "offline-model",
      fetch: async (url, init) => {
        requests.push({ url: String(url), init });
        return Response.json(String(url).endsWith("/models")
          ? { object: "list", data: [{ id: "offline-model" }] }
          : { id: "test-completion", object: "chat.completion", created: 1, model: "offline-model", choices: [{ index: 0,
            message: { role: "assistant", content: null, tool_calls: [{ id: "proposal", type: "function",
              function: { name: "propose_song_patch", arguments: JSON.stringify(PATCH) } }] }, finish_reason: "tool_calls" }] });
      },
    } } : {}),
  });
  t.after(() => runtime.close());
  assert.equal(requests.length, 0, "startup must not access a provider");
  const call = async (path, body, headers = {}) => {
    const response = await fetch(`${runtime.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...headers },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  const paired = await call("/v1/pair", { operatorSecret: SECRET });
  assert.equal(paired.status, 201);
  const auth = { authorization: `Bearer ${paired.body.token}`, origin: ORIGIN };
  const browserState = createCommandRuntime(createCommandState());
  let dispatched = 0;
  const url = new URL("/v1/browser/nanodaw", runtime.baseUrl);
  url.protocol = "ws:";
  const browser = new WebSocket(url, [BROWSER_NANODAW_PROTOCOL, encodeBrowserPairingProtocol(paired.body.token)], { origin: ORIGIN });
  browser.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    let result;
    if (message.method === "inspect") result = browserState.inspect();
    else {
      assert.equal(message.method, "executeCommandBatch");
      dispatched += 1;
      result = browserState.executeCommandBatch(message.params.request);
      if (loseReply) { browser.close(); return; }
    }
    browser.send(JSON.stringify({ v: 1, id: message.id, ok: true, result }));
  });
  await new Promise((resolve, reject) => { browser.once("open", resolve); browser.once("error", reject); });
  return { runtime, call, auth, browserState, requests, dispatched: () => dispatched };
}

test("NanoDAW-only model composition previews V2, confirms once and verifies exact browser state", async (t) => {
  const f = await fixture(t, { agent: true });
  const inbox = await f.call("/v1/mcp/plans", undefined, f.auth);
  assert.deepEqual(inbox.body, { agentAvailable: true, plans: [] });
  const targets = await f.call("/v1/daws", undefined, f.auth);
  assert.equal(JSON.stringify(targets.body).includes("bitwig"), false);
  const generated = await f.call("/v1/agent/runs", { dawId: "nanodaw", request: "Create bass at 118 BPM" }, f.auth);
  assert.equal(generated.status, 201);
  assert.equal(generated.body.patch.track.instrumentId, "bass");
  assert.deepEqual(f.browserState.inspect(), { song: null, revision: 0 });
  assert.equal(f.dispatched(), 0);
  assert.equal(f.requests.length, 2);
  const prefix = `/v1/plans/${generated.body.plan.planId}`;
  assert.notEqual((await f.call(`${prefix}/execute`, { confirmationToken: "invented" }, f.auth)).status, 200);
  const confirmation = await f.call(`${prefix}/confirm`, null, f.auth);
  const execution = await f.call(`${prefix}/execute`, { confirmationToken: confirmation.body.confirmationToken }, f.auth);
  assert.equal(execution.status, 200, JSON.stringify(execution.body));
  assert.equal(execution.body.report.ok, true);
  assert.equal(f.dispatched(), 1);
  const snapshot = f.browserState.inspect();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.song.tracks[0].instrumentId, "bass");
  assert.equal(snapshot.song.tracks[0].clips[0].pattern.notes[0].pitch, 36);
  assert.notEqual((await f.call(`${prefix}/execute`, { confirmationToken: confirmation.body.confirmationToken }, f.auth)).status, 200);
  assert.equal(f.dispatched(), 1);
});

test("MCP discovery is authenticated, Origin-gated, bounded and never applies a plan", async (t) => {
  const f = await fixture(t);
  const review = await f.runtime.service.prepareInstrumentClip(PATCH);
  assert.equal((await f.call("/v1/mcp/plans")).status, 401);
  assert.equal((await f.call("/v1/mcp/plans", undefined, { ...f.auth, origin: "https://untrusted.invalid" })).status, 403);
  assert.equal((await f.call("/v1/mcp/plans?all=true", undefined, f.auth)).status, 400);
  const inbox = await f.call("/v1/mcp/plans", undefined, f.auth);
  assert.equal(inbox.body.agentAvailable, false);
  assert.equal(inbox.body.plans.length, 1);
  assert.equal(inbox.body.plans[0].planId, review.plan.planId);
  const loaded = await f.call(`/v1/mcp/plans/${review.plan.planId}`, undefined, f.auth);
  assert.deepEqual(loaded.body.plan, review.plan);
  assert.equal(f.dispatched(), 0);
  assert.equal(f.browserState.inspect().revision, 0);
  const prefix = `/v1/plans/${review.plan.planId}`;
  const confirmation = await f.call(`${prefix}/confirm`, null, f.auth);
  await f.call(`${prefix}/execute`, { confirmationToken: confirmation.body.confirmationToken }, f.auth);
  assert.equal((await f.call("/v1/mcp/plans", undefined, f.auth)).body.plans.length, 0);
  assert.equal(f.dispatched(), 1);
});

test("MCP exact plan is rejected after a concurrent browser edit", async (t) => {
  const f = await fixture(t);
  const { plan } = await f.runtime.service.prepareInstrumentClip(PATCH);
  const local = f.browserState.executeCommandBatch({ requestId: "local-edit", expectedRevision: 0, commands: plan.commands });
  assert.equal(local.ok, true);
  const confirmation = await f.call(`/v1/plans/${plan.planId}/confirm`, null, f.auth);
  const result = await f.call(`/v1/plans/${plan.planId}/execute`, { confirmationToken: confirmation.body.confirmationToken }, f.auth);
  assert.equal(result.body.report.ok, false);
  assert.equal(f.dispatched(), 0);
  assert.equal(f.browserState.inspect().revision, 1);
});

test("lost execution reply is uncertain and never redispatched", async (t) => {
  const f = await fixture(t, { loseReply: true });
  const { plan } = await f.runtime.service.prepareInstrumentClip(PATCH);
  const prefix = `/v1/plans/${plan.planId}`;
  const confirmation = await f.call(`${prefix}/confirm`, null, f.auth);
  const body = { confirmationToken: confirmation.body.confirmationToken };
  await f.call(`${prefix}/execute`, body, f.auth);
  await f.call(`${prefix}/execute`, body, f.auth);
  assert.equal(f.dispatched(), 1);
  assert.equal(f.browserState.inspect().revision, 1);
  const status = await f.call(`${prefix}/status`, undefined, f.auth);
  assert.equal(status.body.execution.report.ok, false);
  assert.equal(status.body.execution.report.error.code, "partial_execution");
});

test("NanoDAW entrypoint requires explicit provider config, no Bitwig secret, and loopback listening", async () => {
  assert.equal(nanoDawProviderOptions({}), undefined);
  assert.throws(() => nanoDawProviderOptions({ LITERT_MODEL: "model" }), /LITERT_BASE_URL/);
  assert.throws(() => nanoDawProviderOptions({ LITERT_BASE_URL: "http://offline.invalid/" }), /LITERT_MODEL/);
  assert.equal(nanoDawProviderOptions({ LITERT_BASE_URL: "http://offline.invalid/", LITERT_MODEL: "model" }).songPatchVersion, 2);
  await assert.rejects(runNanoDawMcp({ NANODAW_MCP_OPERATOR_SECRET: SECRET }, "agent"), /LITERT_BASE_URL/);
  await assert.rejects(createNanoDawMcpRuntime({ operatorSecret: SECRET, allowedOrigins: [ORIGIN], host: "0.0.0.0" }), /loopback/i);
});
