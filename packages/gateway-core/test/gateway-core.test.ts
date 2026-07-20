import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExecutablePlan,
  ExecutionReport,
} from "@beat-twin/daw-contract";

import {
  GatewayCoreError,
  GatewayPlanStore,
  MAX_CONFIRMATION_TTL_MS,
  MAX_PLAN_TTL_MS,
  PairingAuthority,
  deriveRequiredCommandScopes,
  type GatewayAuditEvent,
  type UnsignedExecutablePlan,
} from "../src/index.ts";

const START = Date.parse("2026-07-10T05:00:00.000Z");

function fakeClock() {
  return {
    value: START,
    now() {
      return this.value;
    },
    advance(milliseconds: number) {
      this.value += milliseconds;
    },
  };
}

function tokenSequence(prefix: string) {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function unsignedPlan(overrides: Partial<UnsignedExecutablePlan> = {}): UnsignedExecutablePlan {
  return {
    planId: "plan-1",
    requestId: "request-1",
    adapterId: "nanodaw",
    capabilityVersion: "nanodaw-v1",
    baseRevision: 0,
    commands: Object.freeze([{ type: "CreateSong", id: "song-1", title: "Gateway" }] as const),
    requiredScopes: Object.freeze(["song.write"]),
    ...overrides,
  };
}

async function fixture(options: {
  maxRequests?: number;
  policy?: () => boolean;
  planRetention?: { readonly capacity: number; readonly ttlMs: number };
  confirmationRetention?: { readonly capacity: number; readonly ttlMs: number };
} = {}) {
  const clock = fakeClock();
  const audit: GatewayAuditEvent[] = [];
  const pairing = new PairingAuthority({
    clock,
    audit: (event) => audit.push(event),
    tokenGenerator: tokenSequence("pair"),
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "plan.confirm", "plan.execute", "song.write"],
    ttlMs: 60_000,
    maxRequests: options.maxRequests ?? 20,
  });
  const store = new GatewayPlanStore({
    pairing,
    clock,
    audit: (event) => audit.push(event),
    tokenGenerator: tokenSequence("confirm"),
    policy: options.policy ?? (() => true),
    planRetention: options.planRetention,
    confirmationRetention: options.confirmationRetention,
  });
  return { clock, audit, pairing, grant, store };
}

function successReport(plan: ExecutablePlan): ExecutionReport {
  const timestamp = "2026-07-10T05:00:01.000Z";
  return Object.freeze({
    ok: true,
    status: "succeeded",
    adapterId: plan.adapterId,
    planId: plan.planId,
    requestId: plan.requestId,
    baseRevision: plan.baseRevision,
    finalSnapshot: Object.freeze({ song: null, revision: plan.baseRevision + 1 }),
    startedAt: timestamp,
    completedAt: timestamp,
    results: Object.freeze(
      plan.commands.map((command, index) =>
        Object.freeze({ index, command, status: "succeeded" as const }),
      ),
    ),
  });
}

test("binds an immutable plan to target, commands, digest, scopes, and two-minute TTL", async () => {
  const { store, grant } = await fixture();
  const plan = await store.createPlan({
    token: grant.token,
    plan: unsignedPlan(),
    ttlMs: MAX_PLAN_TTL_MS,
  });

  assert.equal(plan.adapterId, "nanodaw");
  assert.equal(Date.parse(plan.expiresAt) - Date.parse(plan.createdAt), MAX_PLAN_TTL_MS);
  assert.match(plan.digest, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.commands));
  assert.throws(() => {
    (plan.commands as unknown as Array<unknown>).push({ type: "SetTempo", bpm: 140 });
  }, TypeError);
  assert.equal(store.getPlan(plan.planId), plan);

  await assert.rejects(
    store.createPlan({
      token: grant.token,
      plan: unsignedPlan({ adapterId: "bitwig" }),
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "conflict",
  );
});

test("confirmation is exact, expires in at most thirty seconds, and is single-use", async () => {
  const { store, grant } = await fixture();
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({
    token: grant.token,
    planId: plan.planId,
    ttlMs: MAX_CONFIRMATION_TTL_MS,
  });
  assert.equal(Date.parse(confirmation.expiresAt) - Date.parse(plan.createdAt), MAX_CONFIRMATION_TTL_MS);

  const consumed = await store.consumeExecution({
    token: grant.token,
    planId: plan.planId,
    confirmationToken: confirmation.confirmationToken,
  });
  assert.equal(consumed, plan);
  await assert.rejects(
    store.consumeExecution({
      token: grant.token,
      planId: plan.planId,
      confirmationToken: confirmation.confirmationToken,
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "confirmation_used",
  );

  const report = successReport(plan);
  const recorded = await store.recordExecution({ planId: plan.planId, report });
  assert.deepEqual(recorded, report);
  assert.equal(
    await store.recordExecution({ planId: plan.planId, report }),
    recorded,
  );
});

test("expired plans and confirmations fail closed", async () => {
  const first = await fixture();
  const plan = await first.store.createPlan({ token: first.grant.token, plan: unsignedPlan(), ttlMs: 1_000 });
  first.clock.advance(1_000);
  await assert.rejects(
    first.store.confirm({ token: first.grant.token, planId: plan.planId }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "plan_expired",
  );

  const second = await fixture();
  const secondPlan = await second.store.createPlan({ token: second.grant.token, plan: unsignedPlan() });
  const confirmation = await second.store.confirm({
    token: second.grant.token,
    planId: secondPlan.planId,
    ttlMs: 500,
  });
  second.clock.advance(500);
  await assert.rejects(
    second.store.consumeExecution({
      token: second.grant.token,
      planId: secondPlan.planId,
      confirmationToken: confirmation.confirmationToken,
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "confirmation_expired",
  );

  const replacement = await second.store.confirm({
    token: second.grant.token,
    planId: secondPlan.planId,
  });
  assert.notEqual(replacement.confirmationToken, confirmation.confirmationToken);
});

test("confirmation capacity cleans expired records without stranding their plans", async () => {
  const context = await fixture({
    confirmationRetention: { capacity: 1, ttlMs: MAX_CONFIRMATION_TTL_MS },
  });
  const firstPlan = await context.store.createPlan({
    token: context.grant.token,
    plan: unsignedPlan(),
  });
  await context.store.confirm({
    token: context.grant.token,
    planId: firstPlan.planId,
    ttlMs: 100,
  });
  const secondPlan = await context.store.createPlan({
    token: context.grant.token,
    plan: unsignedPlan({ planId: "plan-2", requestId: "request-2" }),
  });
  await assert.rejects(
    context.store.confirm({ token: context.grant.token, planId: secondPlan.planId }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "capacity_exceeded",
  );

  context.clock.advance(100);
  await context.store.confirm({
    token: context.grant.token,
    planId: secondPlan.planId,
    ttlMs: 100,
  });
  assert.equal(context.store.retentionStatus().confirmations, 1);

  context.clock.advance(100);
  const replacement = await context.store.confirm({
    token: context.grant.token,
    planId: firstPlan.planId,
    ttlMs: 100,
  });
  assert.match(replacement.confirmationToken, /^btc_/);
  assert.equal(context.store.retentionStatus().confirmations, 1);
});

test("pairing capacity fails closed until token expiry cleanup", async () => {
  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("bounded-pair"),
    retention: { capacity: 1, ttlMs: 1_000 },
  });
  await pairing.issue({ actorId: "one", scopes: ["gateway.read"], ttlMs: 100, maxRequests: 1 });
  await assert.rejects(
    pairing.issue({ actorId: "two", scopes: ["gateway.read"], ttlMs: 100, maxRequests: 1 }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "capacity_exceeded",
  );
  assert.deepEqual(pairing.retentionStatus(), { records: 1, capacity: 1, activeOperations: 0 });
  clock.advance(100);
  await pairing.issue({ actorId: "two", scopes: ["gateway.read"], ttlMs: 100, maxRequests: 1 });
  assert.equal(pairing.retentionStatus().records, 1);
});

test("completed plans clean up after terminal retention without replaying mutations", async () => {
  const context = await fixture({ planRetention: { capacity: 1, ttlMs: 10 } });
  const first = await context.store.createPlan({ token: context.grant.token, plan: unsignedPlan() });
  const confirmation = await context.store.confirm({ token: context.grant.token, planId: first.planId });
  await context.store.consumeExecution({
    token: context.grant.token,
    planId: first.planId,
    confirmationToken: confirmation.confirmationToken,
  });
  await context.store.recordExecution({ planId: first.planId, report: successReport(first) });
  await assert.rejects(
    context.store.createPlan({
      token: context.grant.token,
      plan: unsignedPlan({ planId: "plan-before-cleanup", requestId: "before-cleanup" }),
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "capacity_exceeded",
  );
  context.clock.advance(1_010);
  const second = await context.store.createPlan({
    token: context.grant.token,
    plan: unsignedPlan({ planId: "plan-after-cleanup", requestId: "after-cleanup" }),
  });
  assert.equal(second.planId, "plan-after-cleanup");
  assert.equal(context.store.getExecutionStatus(first.planId), null);
  assert.equal(context.store.retentionStatus().plans, 1);
});

test("uncertain plans stay pinned and block capacity even after every TTL", async () => {
  const context = await fixture({ planRetention: { capacity: 1, ttlMs: 10 } });
  const first = await context.store.createPlan({ token: context.grant.token, plan: unsignedPlan() });
  const confirmation = await context.store.confirm({ token: context.grant.token, planId: first.planId });
  await context.store.consumeExecution({
    token: context.grant.token,
    planId: first.planId,
    confirmationToken: confirmation.confirmationToken,
  });
  await context.store.recordExecutionUncertainty({
    planId: first.planId,
    message: "outcome unknown after dispatch",
  });
  context.clock.advance(1_000);
  await assert.rejects(
    context.store.createPlan({
      token: context.grant.token,
      plan: unsignedPlan({ planId: "unsafe-retry", requestId: "unsafe-retry" }),
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "capacity_exceeded",
  );
  assert.equal(context.store.getExecutionStatus(first.planId)?.state, "uncertain");
  assert.equal(context.store.retentionStatus().plans, 1);
});

test("a fresh process-lifetime store restores no terminal state and performs no replay", async () => {
  const context = await fixture();
  const plan = await context.store.createPlan({ token: context.grant.token, plan: unsignedPlan() });
  const restarted = new GatewayPlanStore({
    pairing: context.pairing,
    clock: context.clock,
    audit: () => undefined,
    policy: () => true,
  });
  assert.equal(restarted.getPlan(plan.planId), null);
  assert.equal(restarted.getExecutionStatus(plan.planId), null);
  assert.deepEqual(restarted.retentionStatus(), {
    plans: 0,
    planCapacity: 2_048,
    confirmations: 0,
    confirmationCapacity: 2_048,
    activeOperations: 0,
  });
});

test("pairing revocation, scopes, and quotas are enforced", async () => {
  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("quota"),
  });
  const grant = await pairing.issue({
    actorId: "limited",
    scopes: ["plan.create"],
    ttlMs: 10_000,
    maxRequests: 1,
  });
  await pairing.authorize(grant.token, "plan.create");
  await assert.rejects(
    pairing.authorize(grant.token, "plan.create"),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "quota_exceeded",
  );

  const revoked = await pairing.issue({
    actorId: "revoked",
    scopes: ["plan.create"],
    ttlMs: 10_000,
    maxRequests: 2,
  });
  await pairing.revoke(revoked.token);
  await assert.rejects(
    pairing.authorize(revoked.token, "plan.create"),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "unauthenticated",
  );
});

test("concurrent authorization cannot exceed the token quota", async () => {
  const clock = fakeClock();
  let releaseAudit: (() => void) | undefined;
  let enteredAudit: (() => void) | undefined;
  const auditEntered = new Promise<void>((resolve) => { enteredAudit = resolve; });
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  let holdAllowedAudit = false;
  const pairing = new PairingAuthority({
    clock,
    tokenGenerator: tokenSequence("concurrent-quota"),
    audit: async (event) => {
      if (holdAllowedAudit && event.type === "authorization.allowed") {
        holdAllowedAudit = false;
        enteredAudit?.();
        await auditGate;
      }
    },
  });
  const grant = await pairing.issue({
    actorId: "limited",
    scopes: ["plan.create"],
    ttlMs: 10_000,
    maxRequests: 1,
  });
  holdAllowedAudit = true;
  const first = pairing.authorize(grant.token, "plan.create");
  await auditEntered;
  const second = pairing.authorize(grant.token, "plan.create");
  releaseAudit?.();
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  assert.ok(settled.some(
    (result) => result.status === "rejected" &&
      result.reason instanceof GatewayCoreError && result.reason.code === "quota_exceeded",
  ));
});

test("authorization fails closed if the token expires during awaited audit", async () => {
  const clock = fakeClock();
  const audit: GatewayAuditEvent[] = [];
  let expireOnAuthorization = false;
  const pairing = new PairingAuthority({
    clock,
    tokenGenerator: tokenSequence("authorization-expiry"),
    audit: (event) => {
      audit.push(event);
      if (expireOnAuthorization && event.type === "authorization.allowed") {
        clock.advance(1_000);
      }
    },
  });
  const grant = await pairing.issue({
    actorId: "short-lived",
    scopes: ["plan.create"],
    ttlMs: 1_000,
    maxRequests: 1,
  });
  expireOnAuthorization = true;

  await assert.rejects(
    pairing.authorize(grant.token, "plan.create"),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "unauthenticated",
  );
  assert.deepEqual(
    audit.slice(-2).map(({ type, outcome }) => [type, outcome]),
    [
      ["authorization.allowed", "allowed"],
      ["authorization.rolled_back", "denied"],
    ],
  );
});

test("required write scopes are derived exactly from commands", async () => {
  assert.deepEqual(
    deriveRequiredCommandScopes([
      { type: "CreateSong", id: "song", title: "Scope" },
      { type: "StartPlayback" },
    ]),
    ["song.write", "transport.write"],
  );

  const { store, grant } = await fixture();
  await assert.rejects(
    store.createPlan({
      token: grant.token,
      plan: unsignedPlan({ requiredScopes: [] }),
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "invalid_request",
  );
  await assert.rejects(
    store.createPlan({
      token: grant.token,
      plan: unsignedPlan({ requiredScopes: ["song.write", "transport.write"] }),
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "invalid_request",
  );
  await assert.rejects(
    store.createPlan({
      token: grant.token,
      plan: unsignedPlan({
        commands: [{ foo: "bar" } as never],
        requiredScopes: [],
      }),
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "invalid_request",
  );
});

test("execution rechecks dynamic policy before consuming confirmation", async () => {
  let allowed = true;
  const { store, grant } = await fixture({ policy: () => allowed });
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  allowed = false;

  await assert.rejects(
    store.consumeExecution({
      token: grant.token,
      planId: plan.planId,
      confirmationToken: confirmation.confirmationToken,
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "policy_blocked",
  );

  allowed = true;
  assert.equal(
    await store.consumeExecution({
      token: grant.token,
      planId: plan.planId,
      confirmationToken: confirmation.confirmationToken,
    }),
    plan,
  );
});

test("execution rechecks plan and confirmation expiry after asynchronous policy", async () => {
  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("expiry-pair"),
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "plan.confirm", "plan.execute", "song.write"],
    ttlMs: 60_000,
    maxRequests: 20,
  });
  let expireDuringPolicy = false;
  const store = new GatewayPlanStore({
    pairing,
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("expiry-confirm"),
    policy: async () => {
      if (expireDuringPolicy) clock.advance(MAX_CONFIRMATION_TTL_MS);
      return true;
    },
  });
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  expireDuringPolicy = true;

  await assert.rejects(
    store.consumeExecution({
      token: grant.token,
      planId: plan.planId,
      confirmationToken: confirmation.confirmationToken,
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "confirmation_expired",
  );
});

test("execution rolls its claim back if confirmation expires during awaited audit", async () => {
  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("audit-expiry-pair"),
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "plan.confirm", "plan.execute", "song.write"],
    ttlMs: 60_000,
    maxRequests: 20,
  });
  let expireDuringConsumeAudit = false;
  const audit: GatewayAuditEvent[] = [];
  const store = new GatewayPlanStore({
    pairing,
    clock,
    tokenGenerator: tokenSequence("audit-expiry-confirm"),
    policy: () => true,
    audit: (event) => {
      audit.push(event);
      if (expireDuringConsumeAudit && event.type === "plan.execution_consumed") {
        expireDuringConsumeAudit = false;
        clock.advance(MAX_CONFIRMATION_TTL_MS);
      }
    },
  });
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  expireDuringConsumeAudit = true;

  await assert.rejects(
    store.consumeExecution({
      token: grant.token,
      planId: plan.planId,
      confirmationToken: confirmation.confirmationToken,
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "confirmation_expired",
  );
  assert.deepEqual(
    audit.slice(-2).map(({ type, outcome }) => [type, outcome]),
    [
      ["plan.execution_consumed", "allowed"],
      ["plan.execution_rolled_back", "denied"],
    ],
  );
});

test("concurrent pairing issuance rejects a generated token collision", async () => {
  let releaseAudit: (() => void) | undefined;
  let enteredAudit: (() => void) | undefined;
  const auditEntered = new Promise<void>((resolve) => { enteredAudit = resolve; });
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  let firstIssue = true;
  const pairing = new PairingAuthority({
    tokenGenerator: () => "same-token",
    audit: async (event) => {
      if (firstIssue && event.type === "pairing.issued") {
        firstIssue = false;
        enteredAudit?.();
        await auditGate;
      }
    },
  });
  const input = { actorId: "operator", scopes: ["plan.create"], ttlMs: 1_000, maxRequests: 1 };
  const first = pairing.issue(input);
  await auditEntered;
  const second = pairing.issue(input);
  releaseAudit?.();
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.ok(settled.some(
    (result) => result.status === "rejected" &&
      result.reason instanceof GatewayCoreError && result.reason.code === "conflict",
  ));
});

test("policy and audit fail closed and audit never contains raw secrets or commands", async () => {
  const denied = await fixture({ policy: () => false });
  await assert.rejects(
    denied.store.createPlan({ token: denied.grant.token, plan: unsignedPlan() }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "policy_blocked",
  );
  assert.equal(denied.store.getPlan("plan-1"), null);

  const accepted = await fixture();
  const plan = await accepted.store.createPlan({ token: accepted.grant.token, plan: unsignedPlan() });
  const confirmation = await accepted.store.confirm({ token: accepted.grant.token, planId: plan.planId });
  const serializedAudit = JSON.stringify(accepted.audit);
  assert.equal(serializedAudit.includes(accepted.grant.token), false);
  assert.equal(serializedAudit.includes(confirmation.confirmationToken), false);
  assert.equal(serializedAudit.includes("commands"), false);
  assert.equal(serializedAudit.includes("CreateSong"), false);

  const auditFailure = new PairingAuthority({
    clock: fakeClock(),
    tokenGenerator: () => "audit-failure",
    audit: async () => {
      await Promise.resolve();
      throw new Error("audit offline");
    },
  });
  await assert.rejects(
    auditFailure.issue({ actorId: "nobody", scopes: ["plan.create"], ttlMs: 1000, maxRequests: 1 }),
    /audit offline/,
  );

  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: () => "store-audit-pair",
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "song.write"],
    ttlMs: 10_000,
    maxRequests: 2,
  });
  const store = new GatewayPlanStore({
    pairing,
    clock,
    tokenGenerator: () => "store-audit-confirm",
    policy: () => true,
    audit: async () => {
      await Promise.resolve();
      throw new Error("store audit offline");
    },
  });
  await assert.rejects(
    store.createPlan({ token: grant.token, plan: unsignedPlan() }),
    /store audit offline/,
  );
  assert.equal(store.getPlan("plan-1"), null);
});

test("concurrent plan and confirmation creation cannot rebind human-visible state", async () => {
  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("race-pair"),
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "plan.confirm", "song.write"],
    ttlMs: 60_000,
    maxRequests: 20,
  });
  let releasePolicy: (() => void) | undefined;
  let markPolicyEntered: (() => void) | undefined;
  const policyEntered = new Promise<void>((resolve) => {
    markPolicyEntered = resolve;
  });
  const policyGate = new Promise<void>((resolve) => {
    releasePolicy = resolve;
  });
  let firstPolicy = true;
  const store = new GatewayPlanStore({
    pairing,
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("race-confirm"),
    policy: async () => {
      if (firstPolicy) {
        firstPolicy = false;
        markPolicyEntered?.();
        await policyGate;
      }
      return true;
    },
  });

  const first = store.createPlan({ token: grant.token, plan: unsignedPlan() });
  await policyEntered;
  const collision = store.createPlan({
    token: grant.token,
    plan: unsignedPlan({ adapterId: "bitwig" }),
  });
  releasePolicy?.();
  const settled = await Promise.allSettled([first, collision]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
  assert.equal(store.getPlan("plan-1")?.adapterId, "nanodaw");

  const confirmations = await Promise.allSettled([
    store.confirm({ token: grant.token, planId: "plan-1" }),
    store.confirm({ token: grant.token, planId: "plan-1" }),
  ]);
  assert.equal(confirmations.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(confirmations.filter((result) => result.status === "rejected").length, 1);
});

test("concurrent execution cannot consume one confirmation twice", async () => {
  const clock = fakeClock();
  let releaseAudit: (() => void) | undefined;
  let enteredAudit: (() => void) | undefined;
  const auditEntered = new Promise<void>((resolve) => { enteredAudit = resolve; });
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  let holdConsumeAudit = false;
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("consume-pair"),
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "plan.confirm", "plan.execute", "song.write"],
    ttlMs: 60_000,
    maxRequests: 20,
  });
  const store = new GatewayPlanStore({
    pairing,
    clock,
    tokenGenerator: tokenSequence("consume-confirm"),
    policy: () => true,
    audit: async (event) => {
      if (holdConsumeAudit && event.type === "plan.execution_consumed") {
        holdConsumeAudit = false;
        enteredAudit?.();
        await auditGate;
      }
    },
  });
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  holdConsumeAudit = true;
  const input = {
    token: grant.token,
    planId: plan.planId,
    confirmationToken: confirmation.confirmationToken,
  };
  const first = store.consumeExecution(input);
  await auditEntered;
  const second = store.consumeExecution(input);
  releaseAudit?.();
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
});

test("report identity and structure are validated before persistence", async () => {
  const { store, grant } = await fixture();
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  await store.consumeExecution({
    token: grant.token,
    planId: plan.planId,
    confirmationToken: confirmation.confirmationToken,
  });

  await assert.rejects(
    store.recordExecution({
      planId: plan.planId,
      report: null as never,
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "invalid_request",
  );
  await assert.rejects(
    store.recordExecution({
      planId: plan.planId,
      report: { ...successReport(plan), results: [] },
    }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "invalid_request",
  );
});

test("recording a report does not consume a second authorization after mutation", async () => {
  const { store, grant } = await fixture({ maxRequests: 3 });
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  await store.consumeExecution({
    token: grant.token,
    planId: plan.planId,
    confirmationToken: confirmation.confirmationToken,
  });

  assert.equal(
    await store.recordExecution({ planId: plan.planId, report: successReport(plan) }),
    await store.recordExecution({ planId: plan.planId, report: successReport(plan) }),
  );
});

test("persists an uncertain terminal outcome for post-mutation readback", async () => {
  const { store, grant } = await fixture();
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  await store.consumeExecution({
    token: grant.token,
    planId: plan.planId,
    confirmationToken: confirmation.confirmationToken,
  });

  const status = await store.recordExecutionUncertainty({
    planId: plan.planId,
    message: "adapter disconnected after dispatch",
  });
  assert.deepEqual(status, {
    planId: plan.planId,
    state: "uncertain",
    error: {
      code: "partial_execution",
      message: "adapter disconnected after dispatch",
    },
  });
  assert.deepEqual(store.getExecutionStatus(plan.planId), status);
  await assert.rejects(
    store.recordExecution({ planId: plan.planId, report: successReport(plan) }),
    (error: unknown) => error instanceof GatewayCoreError && error.code === "conflict",
  );
});

test("verified and uncertain terminal outcomes cannot race into mixed state", async () => {
  const clock = fakeClock();
  const pairing = new PairingAuthority({
    clock,
    audit: () => undefined,
    tokenGenerator: tokenSequence("outcome-race-pair"),
  });
  const grant = await pairing.issue({
    actorId: "operator",
    scopes: ["plan.create", "plan.confirm", "plan.execute", "song.write"],
    ttlMs: 60_000,
    maxRequests: 20,
  });
  let releaseAudit: (() => void) | undefined;
  let enteredAudit: (() => void) | undefined;
  const auditEntered = new Promise<void>((resolve) => { enteredAudit = resolve; });
  const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve; });
  const store = new GatewayPlanStore({
    pairing,
    clock,
    tokenGenerator: tokenSequence("outcome-race-confirm"),
    policy: () => true,
    audit: async (event) => {
      if (event.type === "plan.execution_recorded") {
        enteredAudit?.();
        await auditGate;
      }
    },
  });
  const plan = await store.createPlan({ token: grant.token, plan: unsignedPlan() });
  const confirmation = await store.confirm({ token: grant.token, planId: plan.planId });
  await store.consumeExecution({
    token: grant.token,
    planId: plan.planId,
    confirmationToken: confirmation.confirmationToken,
  });

  const verified = store.recordExecution({ planId: plan.planId, report: successReport(plan) });
  await auditEntered;
  const uncertain = store.recordExecutionUncertainty({
    planId: plan.planId,
    message: "must not race",
  });
  releaseAudit?.();
  const settled = await Promise.allSettled([verified, uncertain]);
  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  assert.deepEqual(store.getExecutionStatus(plan.planId), {
    planId: plan.planId,
    state: "completed",
    report: successReport(plan),
  });
});
