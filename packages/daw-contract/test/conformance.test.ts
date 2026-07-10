import assert from "node:assert/strict";
import test from "node:test";

import {
  createCommandRuntime,
  createCommandState,
  type CommandBatchResult,
  type CommandSnapshot,
} from "../../commands/src/index.ts";
import { createSong } from "../../core/src/index.ts";
import {
  preflightExecutablePlan,
  runDawAdapterConformance,
  validateDawCapabilities,
  validateExecutionReport,
  type CommandExecutionResult,
  type DawAdapter,
  type DawCapabilities,
  type DawError,
  type DawSnapshot,
  type ExecutablePlan,
  type ExecutionReport,
} from "../src/index.ts";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();
const EXPIRES_ISO = new Date(NOW + 120_000).toISOString();

function createPlan(
  snapshot: DawSnapshot,
  overrides: Partial<ExecutablePlan> = {},
): ExecutablePlan {
  const planId = overrides.planId ?? "plan-valid";
  return Object.freeze({
    planId,
    requestId: overrides.requestId ?? "request-valid",
    adapterId: "nanodaw",
    capabilityVersion: "nanodaw-v1",
    baseRevision: snapshot.commandSnapshot.revision,
    commands: Object.freeze([{ type: "SetTempo", bpm: 132 }] as const),
    requiredScopes: Object.freeze(["song.write"]),
    digest: `digest:${planId}`,
    createdAt: NOW_ISO,
    expiresAt: EXPIRES_ISO,
    ...overrides,
  });
}

class FakeNanoDawAdapter implements DawAdapter {
  readonly id = "nanodaw" as const;
  readonly #runtime = createCommandRuntime(
    createCommandState(createSong({ id: "song-1", title: "Conformance", bpm: 120 })),
  );
  readonly #reports = new Map<string, ExecutionReport>();

  async health() {
    return Object.freeze({
      adapterId: this.id,
      status: "healthy" as const,
      checkedAt: NOW_ISO,
    });
  }

  async capabilities(): Promise<DawCapabilities> {
    return Object.freeze({
      adapterId: this.id,
      capabilityVersion: "nanodaw-v1",
      supportedCommands: Object.freeze(["SetTempo"] as const),
      scopes: Object.freeze(["song.write"]),
      limitations: Object.freeze([]),
    });
  }

  async inspect(): Promise<DawSnapshot> {
    return Object.freeze({
      adapterId: this.id,
      capabilityVersion: "nanodaw-v1",
      observedAt: NOW_ISO,
      commandSnapshot: this.#runtime.inspect(),
    });
  }

  async execute(plan: ExecutablePlan): Promise<ExecutionReport> {
    const cached = this.#reports.get(plan.requestId);
    if (cached) {
      return cached;
    }

    const capabilities = await this.capabilities();
    const snapshot = await this.inspect();
    const preflight = preflightExecutablePlan(plan, {
      adapterId: this.id,
      capabilities,
      snapshot,
      now: NOW,
      verifyDigest: (candidate) => candidate.digest === `digest:${candidate.planId}`,
    });

    if (!preflight.ok) {
      const report = rejectedReport(plan, snapshot.commandSnapshot, preflight.error);
      this.#reports.set(plan.requestId, report);
      return report;
    }

    const batch = this.#runtime.executeCommandBatch({
      requestId: plan.requestId,
      expectedRevision: plan.baseRevision,
      commands: plan.commands,
    });
    const report = batchReport(plan, batch);
    this.#reports.set(plan.requestId, report);
    return report;
  }
}

function rejectedReport(
  plan: ExecutablePlan,
  finalSnapshot: CommandSnapshot,
  error: DawError,
): ExecutionReport {
  return Object.freeze({
    ok: false,
    status: "failed",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot,
    startedAt: NOW_ISO,
    completedAt: NOW_ISO,
    results: Object.freeze(
      plan.commands.map((command, index) =>
        Object.freeze({ index, command, status: "not_attempted" as const, error }),
      ),
    ),
    error,
  });
}

function batchReport(plan: ExecutablePlan, batch: CommandBatchResult): ExecutionReport {
  if (!batch.ok) {
    const error: DawError = Object.freeze({ code: batch.errorCode, message: batch.error });
    return rejectedReport(plan, batch.snapshot, error);
  }

  const results: readonly CommandExecutionResult[] = Object.freeze(
    batch.results.map((result) =>
      Object.freeze({
        index: result.index,
        command: plan.commands[result.index],
        status: "succeeded" as const,
      }),
    ),
  );
  return Object.freeze({
    ok: true,
    status: "succeeded",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot: batch.snapshot,
    startedAt: NOW_ISO,
    completedAt: NOW_ISO,
    results,
  });
}

test("exported conformance suite proves adapter reads, preflight atomicity, and idempotence", async () => {
  const result = await runDawAdapterConformance({
    createAdapter: () => new FakeNanoDawAdapter(),
    createStalePlan: (snapshot) =>
      createPlan(snapshot, {
        planId: "plan-stale",
        requestId: "request-stale",
        baseRevision: snapshot.commandSnapshot.revision + 1,
        digest: "digest:plan-stale",
      }),
    createUnsupportedPlan: (snapshot) =>
      createPlan(snapshot, {
        planId: "plan-unsupported",
        requestId: "request-unsupported",
        commands: Object.freeze([{ type: "StartPlayback" }] as const),
        digest: "digest:plan-unsupported",
      }),
    createValidPlan: (snapshot) => createPlan(snapshot),
  });

  assert.equal(result.health.status, "healthy");
  assert.deepEqual(result.capabilities.supportedCommands, ["SetTempo"]);
  assert.equal(result.initialSnapshot.commandSnapshot.revision, 0);
  assert.equal(result.staleReport.ok, false);
  assert.equal(result.unsupportedReport.ok, false);
  assert.equal(result.executionReport.ok, true);
  assert.equal(result.finalSnapshot.commandSnapshot.revision, 1);
  assert.equal(result.idempotentReport, result.executionReport);
});

test("plan validation rejects an invalid digest and unavailable scopes before execution", async () => {
  const adapter = new FakeNanoDawAdapter();
  const snapshot = await adapter.inspect();
  const capabilities = await adapter.capabilities();
  const invalidDigest = createPlan(snapshot, { digest: "tampered" });
  const digestResult = preflightExecutablePlan(invalidDigest, {
    adapterId: adapter.id,
    capabilities,
    snapshot,
    now: NOW,
    verifyDigest: (candidate) => candidate.digest === `digest:${candidate.planId}`,
  });
  assert.deepEqual(digestResult, {
    ok: false,
    error: { code: "invalid_command", message: "plan digest verification failed" },
  });

  const unavailableScope = createPlan(snapshot, {
    requiredScopes: Object.freeze(["mixer.write"]),
  });
  const scopeResult = preflightExecutablePlan(unavailableScope, {
    adapterId: adapter.id,
    capabilities,
    snapshot,
    now: NOW,
    verifyDigest: () => true,
  });
  assert.equal(scopeResult.ok, false);
  assert.equal(scopeResult.ok ? null : scopeResult.error.code, "unsupported_capability");
  assert.equal((await adapter.inspect()).commandSnapshot.revision, 0);
});

test("capability and execution-report validators fail closed", async () => {
  assert.equal(
    validateDawCapabilities({
      adapterId: "nanodaw",
      capabilityVersion: "v1",
      supportedCommands: ["SetTempo", "UnknownCommand"],
      scopes: [],
      limitations: [],
    }).ok,
    false,
  );

  const adapter = new FakeNanoDawAdapter();
  const snapshot = await adapter.inspect();
  const plan = createPlan(snapshot);
  const report = await adapter.execute(plan);
  assert.equal(validateExecutionReport(report, plan).ok, true);
  assert.equal(
    validateExecutionReport({ ...report, results: [] }, plan).ok,
    false,
  );

  const invalidCommand = createPlan(snapshot, {
    commands: Object.freeze([{ type: "SetTempo" } as never]),
  });
  const preflight = preflightExecutablePlan(invalidCommand, {
    adapterId: adapter.id,
    capabilities: await adapter.capabilities(),
    snapshot,
    now: NOW,
    verifyDigest: () => true,
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.ok ? null : preflight.error.code, "invalid_command");

  const hiddenPartial = {
    ...report,
    ok: false,
    status: "failed",
    error: { code: "invalid_command", message: "late failure" },
    results: report.results.map((item, index) =>
      index === 0
        ? item
        : { ...item, status: "failed", error: { code: "invalid_command", message: "late failure" } },
    ),
  };
  assert.equal(validateExecutionReport(hiddenPartial, plan).ok, false);
});
