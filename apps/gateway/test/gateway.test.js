import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import test from "node:test";

import {
  GatewayPlanStore,
  PairingAuthority,
} from "@beat-twin/gateway-core";

import {
  GatewayHttpError,
  assertAllowedListenHost,
  listenGatewayHttp,
} from "../src/index.js";

const PATCH = Object.freeze({
  schemaVersion: 1,
  tempoBpm: 124,
  track: Object.freeze({
    kind: "instrument",
    name: "S25 Bass",
    clip: Object.freeze({
      name: "First bar",
      lengthBeats: 4,
      notes: Object.freeze([
        Object.freeze({ pitch: 48, velocity: 100, startBeat: 0, lengthBeats: 1 }),
        Object.freeze({ pitch: 50, velocity: 96, startBeat: 2, lengthBeats: 1 }),
      ]),
    }),
  }),
});

const INSTRUMENT_PATCH = Object.freeze({
  ...PATCH,
  schemaVersion: 2,
  track: Object.freeze({
    ...PATCH.track,
    instrumentId: "bass",
  }),
});

function tokenSequence(prefix) {
  let count = 0;
  return () => `${prefix}-${++count}`;
}

function createFakeAdapter(options = {}) {
  let revision = 0;
  let executeCount = 0;
  const reports = new Map();
  const snapshot = () => ({
    adapterId: "nanodaw",
    capabilityVersion: "nanodaw-v1",
    observedAt: new Date().toISOString(),
    commandSnapshot: { song: null, revision },
  });
  return {
    id: "nanodaw",
    get executeCount() {
      return executeCount;
    },
    health: async () => ({
      adapterId: "nanodaw",
      status: "healthy",
      checkedAt: new Date().toISOString(),
    }),
    capabilities: async () => ({
      adapterId: "nanodaw",
      capabilityVersion: "nanodaw-v1",
      supportedCommands: ["CreateSong", "CreateTrack", "CreateClip", "AddNote", "SetTempo"],
      scopes: ["song.write"],
      limitations: [],
    }),
    inspect: async () => snapshot(),
    execute: async (plan) => {
      executeCount += 1;
      if (options.throwOnExecute) throw new Error("fake transport offline");
      if (options.hangOnExecute) return new Promise(() => {});
      const existing = reports.get(plan.requestId);
      if (existing) return existing;
      revision += 1;
      if (options.invalidReport) return {};
      const timestamp = new Date().toISOString();
      const report = Object.freeze({
        ok: true,
        status: "succeeded",
        adapterId: "nanodaw",
        planId: plan.planId,
        requestId: plan.requestId,
        baseRevision: plan.baseRevision,
        finalSnapshot: Object.freeze({ song: null, revision }),
        startedAt: timestamp,
        completedAt: timestamp,
        results: Object.freeze(plan.commands.map((command, index) => Object.freeze({
          index,
          command,
          status: "succeeded",
        }))),
      });
      reports.set(plan.requestId, report);
      return report;
    },
  };
}

function createFakeProvider(options = {}) {
  return {
    listModels: async () => [{ id: "gemma-s25" }],
    runAgent: async ({ request, handlers }) => {
      const patch = options.patch ?? PATCH;
      assert.equal(request, options.expectedRequest ?? "Make a bass loop");
      if (options.inspectOtherTarget) {
        await handlers.inspect_session({ dawId: "bitwig" });
      } else {
        assert.deepEqual(await handlers.list_daw_targets(), [{ id: "nanodaw" }]);
        const inspected = await handlers.inspect_session({ dawId: "nanodaw" });
        assert.equal(inspected.commandSnapshot.revision, 0);
      }
      const proposalResult = await handlers.propose_song_patch(patch);
      return Object.freeze({
        model: "gemma-s25",
        patch,
        proposalResult,
        steps: 2,
        toolCalls: Object.freeze([]),
      });
    },
  };
}

function createFixture(options = {}) {
  const audit = [];
  const pairing = new PairingAuthority({
    audit: (event) => audit.push(event),
    tokenGenerator: tokenSequence("pair"),
  });
  const planStore = new GatewayPlanStore({
    pairing,
    audit: options.storeAudit ?? ((event) => audit.push(event)),
    tokenGenerator: tokenSequence("confirmation"),
    policy: options.policy ?? (() => true),
  });
  const adapter = options.adapter ?? createFakeAdapter();
  const provider = options.provider ?? createFakeProvider();
  let id = 0;
  return {
    audit,
    pairing,
    planStore,
    adapter,
    provider,
    gatewayOptions: {
      operatorSecret: "correct horse battery staple",
      pairing,
      planStore,
      provider,
      adapters: new Map([["nanodaw", adapter]]),
      idGenerator: () => `fixed-${++id}`,
      ...options.gatewayOptions,
    },
  };
}

async function withGateway(options, callback) {
  const server = await listenGatewayHttp(options, { host: "127.0.0.1", port: 0 });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

async function pair(baseUrl, secret = "correct horse battery staple", headers = {}) {
  return jsonFetch(`${baseUrl}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ operatorSecret: secret }),
  });
}

test("pairing protects every read route and health does not expose secrets", async () => {
  const fixture = createFixture();
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const denied = await pair(baseUrl, "wrong secret");
    assert.equal(denied.response.status, 401);
    assert.equal(denied.body.error.code, "unauthenticated");

    const unauthenticated = await jsonFetch(`${baseUrl}/v1/health`);
    assert.equal(unauthenticated.response.status, 401);

    const issued = await pair(baseUrl);
    assert.equal(issued.response.status, 201);
    assert.match(issued.body.token, /^btp_/);
    const authorization = { authorization: `Bearer ${issued.body.token}` };

    const health = await jsonFetch(`${baseUrl}/v1/health`, { headers: authorization });
    assert.equal(health.response.status, 200);
    assert.equal(health.body.status, "healthy");
    assert.equal(health.body.model.modelCount, 1);
    assert.equal(JSON.stringify(health.body).includes("correct horse"), false);

    const daws = await jsonFetch(`${baseUrl}/v1/daws`, { headers: authorization });
    assert.equal(daws.response.status, 200);
    assert.deepEqual(daws.body.daws.map(({ id }) => id), ["nanodaw"]);

    const session = await jsonFetch(`${baseUrl}/v1/sessions/nanodaw`, { headers: authorization });
    assert.equal(session.response.status, 200);
    assert.equal(session.body.session.commandSnapshot.revision, 0);
  });
});

test("agent run is preview-only, creates an immutable fixed-target plan, then executes once", async () => {
  const fixture = createFixture();
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const authorization = { authorization: `Bearer ${issued.body.token}` };
    const run = await jsonFetch(`${baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ dawId: "nanodaw", request: "Make a bass loop" }),
    });

    assert.equal(run.response.status, 201);
    assert.equal(fixture.adapter.executeCount, 0);
    assert.equal(run.body.dawId, "nanodaw");
    assert.equal(run.body.plan.adapterId, "nanodaw");
    assert.equal(run.body.plan.baseRevision, 0);
    assert.deepEqual(run.body.plan.requiredScopes, ["song.write"]);
    assert.equal(run.body.preview.commands.length, 5);
    assert.deepEqual(run.body.preview.commands, run.body.plan.commands);
    const stored = fixture.planStore.getPlan(run.body.plan.planId);
    assert.ok(Object.isFrozen(stored));
    assert.ok(Object.isFrozen(stored.commands));

    const nonEmptyConfirmation = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/confirm`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(nonEmptyConfirmation.response.status, 400);
    assert.equal(nonEmptyConfirmation.body.error.code, "invalid_request");

    const confirmation = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/confirm`,
      { method: "POST", headers: authorization },
    );
    assert.equal(confirmation.response.status, 200);

    const injected = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/execute`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({
          confirmationToken: confirmation.body.confirmationToken,
          dawId: "bitwig",
          commands: [],
        }),
      },
    );
    assert.equal(injected.response.status, 400);
    assert.equal(injected.body.error.code, "invalid_request");
    assert.equal(fixture.adapter.executeCount, 0);

    const executionBody = JSON.stringify({ confirmationToken: confirmation.body.confirmationToken });
    const executed = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/execute`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: executionBody,
      },
    );
    assert.equal(executed.response.status, 200);
    assert.equal(executed.body.report.ok, true);
    assert.equal(executed.body.report.adapterId, "nanodaw");
    assert.equal(fixture.adapter.executeCount, 1);

    const status = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/status`,
      { headers: authorization },
    );
    assert.equal(status.response.status, 200);
    assert.equal(status.body.execution.state, "completed");
    assert.equal(status.body.execution.report.planId, run.body.plan.planId);

    const replay = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/execute`,
      {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: executionBody,
      },
    );
    assert.equal(replay.response.status, 409);
    assert.equal(replay.body.error.code, "confirmation_used");
    assert.equal(fixture.adapter.executeCount, 1);
  });
});

test("an explicit SongPatchV2 instrument survives gateway preview and plan materialization", async () => {
  const fixture = createFixture({
    provider: createFakeProvider({ patch: INSTRUMENT_PATCH }),
  });
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const authorization = { authorization: `Bearer ${issued.body.token}` };
    const run = await jsonFetch(`${baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ dawId: "nanodaw", request: "Make a bass loop" }),
    });

    assert.equal(run.response.status, 201);
    const createTrack = run.body.plan.commands.find((command) => command.type === "CreateTrack");
    assert.equal(createTrack.instrumentId, "bass");
    assert.equal(run.body.preview.diff.instrumentId, "bass");
    assert.ok(run.body.preview.summary.includes("Instrument: Bass (bass)"));
    assert.equal(fixture.adapter.executeCount, 0);
  });
});

test("a consumed confirmation is never retried when adapter execution throws", async () => {
  const adapter = createFakeAdapter({ throwOnExecute: true });
  const fixture = createFixture({ adapter });
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const authorization = { authorization: `Bearer ${issued.body.token}` };
    const run = await jsonFetch(`${baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ dawId: "nanodaw", request: "Make a bass loop" }),
    });
    const confirmation = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/confirm`,
      { method: "POST", headers: authorization },
    );
    const body = JSON.stringify({ confirmationToken: confirmation.body.confirmationToken });
    const failed = await jsonFetch(`${baseUrl}/v1/plans/${run.body.plan.planId}/execute`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body,
    });
    assert.equal(failed.response.status, 502);
    assert.equal(failed.body.error.code, "partial_execution");
    assert.equal(adapter.executeCount, 1);

    const status = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/status`,
      { headers: authorization },
    );
    assert.equal(status.body.execution.state, "uncertain");
    assert.equal(status.body.execution.error.code, "partial_execution");

    const replay = await jsonFetch(`${baseUrl}/v1/plans/${run.body.plan.planId}/execute`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body,
    });
    assert.equal(replay.response.status, 409);
    assert.equal(replay.body.error.code, "confirmation_used");
    assert.equal(adapter.executeCount, 1);
  });
});

test("invalid adapter reports become durable uncertain outcomes after one dispatch", async () => {
  const adapter = createFakeAdapter({ invalidReport: true });
  const fixture = createFixture({ adapter });
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const authorization = { authorization: `Bearer ${issued.body.token}` };
    const run = await jsonFetch(`${baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ dawId: "nanodaw", request: "Make a bass loop" }),
    });
    const confirmation = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/confirm`,
      { method: "POST", headers: authorization },
    );
    const failed = await jsonFetch(`${baseUrl}/v1/plans/${run.body.plan.planId}/execute`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ confirmationToken: confirmation.body.confirmationToken }),
    });
    assert.equal(failed.response.status, 502);
    assert.equal(failed.body.error.code, "partial_execution");
    assert.equal(adapter.executeCount, 1);

    const status = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/status`,
      { headers: authorization },
    );
    assert.equal(status.response.status, 200);
    assert.equal(status.body.execution.state, "uncertain");
  });
});

test("an adapter execution deadline becomes uncertain and is never retried", async () => {
  const adapter = createFakeAdapter({ hangOnExecute: true });
  const fixture = createFixture({
    adapter,
    gatewayOptions: { adapterExecutionTimeoutMs: 10 },
  });
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const authorization = { authorization: `Bearer ${issued.body.token}` };
    const run = await jsonFetch(`${baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ dawId: "nanodaw", request: "Make a bass loop" }),
    });
    const confirmation = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/confirm`,
      { method: "POST", headers: authorization },
    );
    const failed = await jsonFetch(`${baseUrl}/v1/plans/${run.body.plan.planId}/execute`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({ confirmationToken: confirmation.body.confirmationToken }),
    });
    assert.equal(failed.response.status, 502);
    assert.equal(failed.body.error.code, "partial_execution");
    assert.equal(adapter.executeCount, 1);

    const status = await jsonFetch(
      `${baseUrl}/v1/plans/${run.body.plan.planId}/status`,
      { headers: authorization },
    );
    assert.equal(status.body.execution.state, "uncertain");
  });
});

test("all public DAW reads reject malformed adapter data", async () => {
  const invalidCapabilities = {
    ...createFakeAdapter(),
    capabilities: async () => ({
      adapterId: "nanodaw",
      capabilityVersion: "nanodaw-v1",
      supportedCommands: [7, 7],
      scopes: [null],
      limitations: "bad",
    }),
  };
  const first = createFixture({ adapter: invalidCapabilities });
  await withGateway(first.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const daws = await jsonFetch(`${baseUrl}/v1/daws`, {
      headers: { authorization: `Bearer ${issued.body.token}` },
    });
    assert.equal(daws.response.status, 502);
    assert.equal(daws.body.error.code, "invalid_adapter_response");
  });

  const corruptSnapshot = {
    ...createFakeAdapter(),
    inspect: async () => ({
      adapterId: "nanodaw",
      capabilityVersion: "nanodaw-v1",
      observedAt: new Date().toISOString(),
      commandSnapshot: { song: {}, revision: 0 },
    }),
  };
  const second = createFixture({ adapter: corruptSnapshot });
  await withGateway(second.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const session = await jsonFetch(`${baseUrl}/v1/sessions/nanodaw`, {
      headers: { authorization: `Bearer ${issued.body.token}` },
    });
    assert.equal(session.response.status, 502);
    assert.equal(session.body.error.code, "invalid_adapter_response");
  });
});

test("target selection is fixed for the entire model run", async () => {
  const fixture = createFixture({ provider: createFakeProvider({ inspectOtherTarget: true }) });
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const issued = await pair(baseUrl);
    const run = await jsonFetch(`${baseUrl}/v1/agent/runs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${issued.body.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ dawId: "nanodaw", request: "Make a bass loop" }),
    });
    assert.equal(run.response.status, 422);
    assert.equal(run.body.error.code, "target_mismatch");
    assert.equal(fixture.adapter.executeCount, 0);
    assert.equal(fixture.planStore.getPlan("plan-fixed-2"), null);
  });
});

test("strict JSON, body limits, CORS, and loopback policy fail closed", async () => {
  assert.throws(
    () => assertAllowedListenHost("0.0.0.0"),
    (error) => error instanceof GatewayHttpError && error.code === "non_loopback_forbidden",
  );
  assert.throws(
    () => assertAllowedListenHost("0.0.0.0", true),
    (error) => error instanceof GatewayHttpError && error.code === "non_loopback_forbidden",
  );
  assert.doesNotThrow(() => assertAllowedListenHost("127.0.0.1"));
  assert.doesNotThrow(() => assertAllowedListenHost("::1"));
  assert.throws(() => assertAllowedListenHost("localhost"));
  assert.throws(() => assertAllowedListenHost("127.999.999.999"));
  assert.throws(() => assertAllowedListenHost("127.0.0.256"));

  const fixture = createFixture({
    gatewayOptions: {
      bodyLimitBytes: 128,
      corsOrigins: ["http://127.0.0.1:4173"],
    },
  });
  await withGateway(fixture.gatewayOptions, async (baseUrl) => {
    const wrongType = await jsonFetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ operatorSecret: "correct horse battery staple" }),
    });
    assert.equal(wrongType.response.status, 415);

    const unknown = await jsonFetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorSecret: "correct horse battery staple", scopes: ["*"] }),
    });
    assert.equal(unknown.response.status, 400);

    const oversized = await jsonFetch(`${baseUrl}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorSecret: "x".repeat(256) }),
    });
    assert.equal(oversized.response.status, 413);

    const deniedOrigin = await pair(baseUrl, "correct horse battery staple", {
      origin: "https://evil.example",
    });
    assert.equal(deniedOrigin.response.status, 403);
    assert.equal(deniedOrigin.body.error.code, "cors_forbidden");

    const allowedOrigin = await pair(baseUrl, "correct horse battery staple", {
      origin: "http://127.0.0.1:4173",
    });
    assert.equal(allowedOrigin.response.status, 201);
    assert.equal(
      allowedOrigin.response.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:4173",
    );

    const address = new URL(baseUrl);
    const invalidHost = await rawJsonRequest({
      hostname: address.hostname,
      port: Number(address.port),
      path: "/v1/health",
      method: "GET",
      headers: { host: "gateway.example" },
    });
    assert.equal(invalidHost.status, 403);
    assert.equal(invalidHost.body.error.code, "non_loopback_forbidden");
  });
});

function rawJsonRequest(options) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}
