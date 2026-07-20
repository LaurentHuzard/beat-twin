import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommandRuntime,
  createCommandState,
  type CommandBatchResult,
  type CommandSnapshot,
  type ExecuteCommandBatchRequest,
} from "@beat-twin/commands";
import {
  runDawAdapterConformance,
  validateExecutionReport,
  type DawSnapshot,
  type ExecutablePlan,
} from "@beat-twin/daw-contract";

import {
  MemoryNanoDawPort,
  NanoDawAdapter,
  type BrowserNanoDawPort,
} from "../src/index.ts";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const EXPIRES_ISO = new Date(NOW + 120_000).toISOString();

function planFor(
  snapshot: DawSnapshot,
  overrides: Partial<ExecutablePlan> = {},
): ExecutablePlan {
  const planId = overrides.planId ?? "plan-create";
  return Object.freeze({
    planId,
    requestId: overrides.requestId ?? `request:${planId}`,
    adapterId: "nanodaw",
    capabilityVersion: "nanodaw-v2",
    baseRevision: snapshot.commandSnapshot.revision,
    commands: Object.freeze([{ type: "CreateSong", id: "song-1", title: "Port-owned" }] as const),
    requiredScopes: Object.freeze(["song.write"]),
    digest: `digest:${planId}`,
    createdAt: NOW_ISO,
    expiresAt: EXPIRES_ISO,
    ...overrides,
  });
}

function fixture() {
  const runtime = createCommandRuntime(createCommandState());
  const port = new MemoryNanoDawPort(runtime);
  const adapter = new NanoDawAdapter({
    port,
    now: () => NOW,
    verifyDigest: (plan) => plan.digest === `digest:${plan.planId}`,
  });
  return { runtime, port, adapter };
}

test("passes reusable DAW conformance without a second state owner", async () => {
  const { adapter, port } = fixture();
  const result = await runDawAdapterConformance({
    createAdapter: () => adapter,
    createStalePlan: (snapshot) =>
      planFor(snapshot, {
        planId: "plan-stale",
        baseRevision: snapshot.commandSnapshot.revision + 1,
      }),
    createUnsupportedPlan: (snapshot) =>
      planFor(snapshot, {
        planId: "plan-unsupported",
        requiredScopes: Object.freeze(["mixer.write"]),
      }),
    createValidPlan: (snapshot) => planFor(snapshot),
  });

  assert.equal(result.executionReport.ok, true);
  assert.equal(result.finalSnapshot.commandSnapshot.revision, 1);
  assert.equal(result.idempotentReport, result.executionReport);
  assert.equal(port.batchExecutionCount, 1);
});

test("inspection/preview and every invalid preflight leave the port untouched", async () => {
  const { adapter, port } = fixture();
  const initial = await adapter.inspect();

  await adapter.inspect();
  await adapter.capabilities();
  const cases: readonly Partial<ExecutablePlan>[] = [
    { planId: "bad-digest", requestId: "bad-digest", digest: "tampered" },
    {
      planId: "expired",
      requestId: "expired",
      digest: "digest:expired",
      expiresAt: NOW_ISO,
    },
    {
      planId: "bad-capability",
      requestId: "bad-capability",
      digest: "digest:bad-capability",
      capabilityVersion: "nanodaw-v1",
    },
    {
      planId: "bad-scope",
      requestId: "bad-scope",
      digest: "digest:bad-scope",
      requiredScopes: Object.freeze(["mixer.write"]),
    },
    {
      planId: "missing-scope",
      requestId: "missing-scope",
      digest: "digest:missing-scope",
      requiredScopes: Object.freeze([]),
    },
    {
      planId: "stale",
      requestId: "stale",
      digest: "digest:stale",
      baseRevision: initial.commandSnapshot.revision + 1,
    },
  ];

  for (const overrides of cases) {
    const report = await adapter.execute(planFor(initial, overrides));
    assert.equal(report.ok, false);
    assert.equal(report.results.every((result) => result.status === "not_attempted"), true);
  }

  assert.equal(port.batchExecutionCount, 0);
  assert.deepEqual((await adapter.inspect()).commandSnapshot, initial.commandSnapshot);
});

test("one valid multi-command plan makes exactly one atomic port mutation and one revision", async () => {
  const { adapter, port, runtime } = fixture();
  const snapshot = await adapter.inspect();
  const plan = planFor(snapshot, {
    planId: "arrangement",
    requestId: "request-arrangement",
    digest: "digest:arrangement",
    commands: Object.freeze([
      { type: "CreateSong", id: "song-1", title: "Arrangement", bpm: 126 },
      {
        type: "CreateTrack",
        id: "track-1",
        name: "Night Bass",
        kind: "instrument",
        instrumentId: "bass",
      },
      { type: "CreateClip", id: "clip-1", trackId: "track-1", name: "Hook", lengthBeats: 4 },
      {
        type: "AddNote",
        id: "note-1",
        trackId: "track-1",
        clipId: "clip-1",
        pitch: 60,
        velocity: 100,
        startBeat: 0,
        lengthBeats: 1,
      },
    ]),
  });

  const report = await adapter.execute(plan);
  assert.equal(report.ok, true);
  assert.equal(report.finalSnapshot.revision, 1);
  assert.equal(port.batchExecutionCount, 1);
  assert.equal(runtime.inspect().song?.tracks[0]?.clips[0]?.pattern.notes.length, 1);
  assert.equal(runtime.inspect().song?.tracks[0]?.instrumentId, "bass");

  const replay = await adapter.execute(plan);
  assert.equal(replay, report);
  assert.equal(port.batchExecutionCount, 1);
  assert.equal(runtime.inspect().revision, 1);
});

test("unknown instrument IDs fail preflight before the atomic port mutation", async () => {
  const { adapter, port, runtime } = fixture();
  const snapshot = await adapter.inspect();
  const plan = planFor(snapshot, {
    planId: "unknown-instrument",
    requestId: "unknown-instrument",
    digest: "digest:unknown-instrument",
    commands: Object.freeze([
      { type: "CreateSong", id: "song-1" },
      {
        type: "CreateTrack",
        id: "track-1",
        kind: "instrument",
        instrumentId: "organ",
      },
    ] as never),
  });

  const report = await adapter.execute(plan);
  assert.equal(report.ok, false);
  assert.equal(report.ok ? null : report.error.code, "invalid_command");
  assert.equal(port.batchExecutionCount, 0);
  assert.deepEqual(runtime.inspect(), { song: null, revision: 0 });
});

test("concurrent idempotent replays are coalesced before the mutating port call", async () => {
  const runtime = createCommandRuntime(createCommandState());
  let dispatches = 0;
  let releaseDispatch: (() => void) | undefined;
  const dispatchGate = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });
  const port: BrowserNanoDawPort = {
    kind: "browser-proxy",
    inspect: () => runtime.inspect(),
    executeCommandBatch: async (request) => {
      dispatches += 1;
      await dispatchGate;
      return runtime.executeCommandBatch(request);
    },
  };
  const adapter = new NanoDawAdapter({
    port,
    now: () => NOW,
    verifyDigest: (plan) => plan.digest === `digest:${plan.planId}`,
  });
  const plan = planFor(await adapter.inspect(), {
    planId: "concurrent",
    digest: "digest:concurrent",
  });

  const first = adapter.execute(plan);
  const replay = adapter.execute(plan);
  releaseDispatch?.();
  const [firstReport, replayReport] = await Promise.all([first, replay]);

  assert.equal(firstReport, replayReport);
  assert.equal(dispatches, 1);
  assert.equal(runtime.inspect().revision, 1);
});

test("bounds terminal executions and frees capacity only after retention expiry", async () => {
  let now = NOW;
  const runtime = createCommandRuntime(createCommandState());
  const port = new MemoryNanoDawPort(runtime);
  const adapter = new NanoDawAdapter({
    port,
    now: () => now,
    verifyDigest: (candidate) => candidate.digest === `digest:${candidate.planId}`,
    executionRetention: { capacity: 1, ttlMs: 10 },
  });
  const firstSnapshot = await adapter.inspect();
  assert.equal((await adapter.execute(planFor(firstSnapshot, {
    planId: "retention-first",
    requestId: "retention-first",
  }))).ok, true);
  const secondSnapshot = await adapter.inspect();
  const secondPlan = planFor(secondSnapshot, {
    planId: "retention-second",
    requestId: "retention-second",
  });
  const blocked = await adapter.execute(secondPlan);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok ? null : blocked.error.code, "policy_blocked");
  assert.equal(port.batchExecutionCount, 1);
  assert.deepEqual(adapter.retentionStatus(), { executions: 1, capacity: 1 });

  now += 10;
  assert.equal((await adapter.execute(secondPlan)).ok, true);
  assert.equal(port.batchExecutionCount, 2);
  assert.equal(adapter.retentionStatus().executions, 1);
});

test("never evicts an uncertain execution or retries it under capacity pressure", async () => {
  let now = NOW;
  const runtime = createCommandRuntime(createCommandState());
  let dispatches = 0;
  const adapter = new NanoDawAdapter({
    port: {
      inspect: () => runtime.inspect(),
      executeCommandBatch: () => {
        dispatches += 1;
        throw new Error("connection lost after dispatch");
      },
    },
    now: () => now,
    verifyDigest: (candidate) => candidate.digest === `digest:${candidate.planId}`,
    executionRetention: { capacity: 1, ttlMs: 10 },
  });
  const snapshot = await adapter.inspect();
  const uncertain = await adapter.execute(planFor(snapshot, {
    planId: "uncertain-retained",
    requestId: "uncertain-retained",
  }));
  assert.equal(uncertain.status, "partial");
  now += 1_000;
  const blocked = await adapter.execute(planFor(snapshot, {
    planId: "must-not-dispatch",
    requestId: "must-not-dispatch",
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok ? null : blocked.error.code, "policy_blocked");
  assert.equal(dispatches, 1);
  assert.equal(adapter.retentionStatus().executions, 1);
});

test("an invalid command inside a batch commits none of its earlier commands", async () => {
  const { adapter, port, runtime } = fixture();
  const snapshot = await adapter.inspect();
  const plan = planFor(snapshot, {
    planId: "atomic-reject",
    requestId: "atomic-reject",
    digest: "digest:atomic-reject",
    commands: Object.freeze([
      { type: "CreateSong", id: "song-transient" },
      {
        type: "AddNote",
        id: "note-orphan",
        trackId: "missing-track",
        clipId: "missing-clip",
        pitch: 64,
        startBeat: 0,
      },
    ]),
  });

  const report = await adapter.execute(plan);
  assert.equal(report.ok, false);
  assert.equal(report.ok ? null : report.error.code, "invalid_command");
  assert.equal(port.batchExecutionCount, 1);
  assert.deepEqual(runtime.inspect(), { song: null, revision: 0 });
  assert.equal(report.results.every((result) => result.status === "not_attempted"), true);
});

test("a request id cannot be rebound to another plan", async () => {
  const { adapter, port } = fixture();
  const snapshot = await adapter.inspect();
  const original = planFor(snapshot, { planId: "original", requestId: "same-request", digest: "digest:original" });
  const applied = await adapter.execute(original);
  assert.equal(applied.ok, true);

  const collision = planFor(await adapter.inspect(), {
    planId: "replacement",
    requestId: "same-request",
    digest: "digest:replacement",
    commands: Object.freeze([{ type: "SetTempo", bpm: 140 }] as const),
  });
  const rejected = await adapter.execute(collision);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok ? null : rejected.error.code, "invalid_command");
  assert.equal(port.batchExecutionCount, 1);
});

test("the abstract browser proxy is used directly and receives one CAS batch", async () => {
  const runtime = createCommandRuntime(createCommandState());
  let dispatches = 0;
  const browserPort: BrowserNanoDawPort = {
    kind: "browser-proxy",
    inspect: () => runtime.inspect(),
    executeCommandBatch: (request: ExecuteCommandBatchRequest): CommandBatchResult => {
      dispatches += 1;
      return runtime.executeCommandBatch(request);
    },
  };
  const adapter = new NanoDawAdapter({
    port: browserPort,
    now: () => NOW,
    verifyDigest: (plan) => plan.digest === `digest:${plan.planId}`,
  });
  const plan = planFor(await adapter.inspect(), { planId: "browser", digest: "digest:browser" });

  const report = await adapter.execute(plan);
  assert.equal(validateExecutionReport(report, plan).ok, true);
  assert.equal(report.ok, true);
  assert.equal(dispatches, 1);
  assert.equal(runtime.inspect().revision, 1);
});

test("a post-dispatch proxy failure is reported as uncertain and never retried", async () => {
  let dispatches = 0;
  const initial: CommandSnapshot = Object.freeze({ song: null, revision: 0 });
  const browserPort: BrowserNanoDawPort = {
    kind: "browser-proxy",
    inspect: () => initial,
    executeCommandBatch: async () => {
      dispatches += 1;
      throw new Error("connection closed");
    },
  };
  const adapter = new NanoDawAdapter({
    port: browserPort,
    now: () => NOW,
    verifyDigest: (plan) => plan.digest === `digest:${plan.planId}`,
  });
  const plan = planFor(await adapter.inspect(), { planId: "disconnect", digest: "digest:disconnect" });

  const report = await adapter.execute(plan);
  assert.equal(report.ok, false);
  assert.equal(report.status, "partial");
  assert.ok(report.results.every((result) => result.status === "unknown"));
  assert.equal(report.ok ? null : report.error.code, "partial_execution");
  assert.equal(validateExecutionReport(report, plan).ok, true);
  assert.equal(await adapter.execute(plan), report);
  assert.equal(dispatches, 1);
});

test("health reports a disconnected browser port as unavailable", async () => {
  const port: BrowserNanoDawPort = {
    kind: "browser-proxy",
    inspect: async () => {
      throw new Error("not connected");
    },
    executeCommandBatch: async () => {
      throw new Error("not connected");
    },
  };
  const adapter = new NanoDawAdapter({ port, now: () => NOW, verifyDigest: () => true });

  assert.deepEqual(await adapter.health(), {
    adapterId: "nanodaw",
    status: "unavailable",
    checkedAt: NOW_ISO,
    detail: "not connected",
  });
});

test("never turns a forged successful port response into adapter success", async () => {
  const initial: CommandSnapshot = Object.freeze({ song: null, revision: 0 });
  const forgedState = createCommandState(null, 1);
  const port: BrowserNanoDawPort = {
    kind: "browser-proxy",
    inspect: () => initial,
    executeCommandBatch: (request) => ({
      ok: true,
      requestId: request.requestId,
      state: forgedState,
      snapshot: { song: null, revision: 1 },
      commands: request.commands,
      results: request.commands.map((command, index) => ({ index, command, events: [] })),
      events: [],
    }),
  };
  const adapter = new NanoDawAdapter({
    port,
    now: () => NOW,
    verifyDigest: (plan) => plan.digest === `digest:${plan.planId}`,
  });
  const plan = planFor(await adapter.inspect(), { planId: "forged", digest: "digest:forged" });

  const report = await adapter.execute(plan);
  assert.equal(report.ok, false);
  assert.equal(report.status, "partial");
  assert.ok(report.results.every((result) => result.status === "unknown"));
  assert.equal(report.ok ? null : report.error.code, "partial_execution");
});

test("never trusts a forged failed-batch snapshot", async () => {
  const initial: CommandSnapshot = Object.freeze({ song: null, revision: 0 });
  const forgedState = createCommandState(null, 999);
  const port: BrowserNanoDawPort = {
    kind: "browser-proxy",
    inspect: () => initial,
    executeCommandBatch: (request) => ({
      ok: false,
      requestId: request.requestId,
      state: forgedState,
      snapshot: { song: null, revision: 999 },
      commands: [],
      results: [],
      events: [],
      errorCode: "invalid_command",
      error: "forged failure",
    }),
  };
  const adapter = new NanoDawAdapter({
    port,
    now: () => NOW,
    verifyDigest: (plan) => plan.digest === `digest:${plan.planId}`,
  });
  const plan = planFor(await adapter.inspect(), {
    planId: "forged-failure",
    digest: "digest:forged-failure",
  });

  const report = await adapter.execute(plan);
  assert.equal(report.ok, false);
  assert.equal(report.status, "partial");
  assert.ok(report.results.every((result) => result.status === "unknown"));
  assert.deepEqual(report.finalSnapshot, initial);
  assert.equal(report.ok ? null : report.error.code, "partial_execution");
});
