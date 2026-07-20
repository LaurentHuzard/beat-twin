import assert from "node:assert/strict";
import test from "node:test";

import {
  BITWIG_BRIDGE_PROTOCOL_VERSION,
  BITWIG_CAPABILITY_VERSION,
  BITWIG_MAX_STEPS,
  BITWIG_STEP_SIZE_BEATS,
  BitwigAdapter,
  createRpcBitwigBridgePort,
  type BitwigBridgePort,
  type BitwigMutationMethod,
  type BitwigTargetInspection,
} from "../src/index.ts";
import type { ExecutableBeatTwinCommand } from "@beat-twin/commands";
import type { ExecutablePlan } from "@beat-twin/daw-contract";

const NOW = Date.parse("2026-07-15T10:00:00.000Z");

function commands(): readonly ExecutableBeatTwinCommand[] {
  return Object.freeze([
    { type: "CreateSong", id: "song-1", title: "Bass sketch", bpm: 112 },
    { type: "CreateTrack", id: "track-1", name: "Bass", kind: "instrument" },
    {
      type: "CreateClip",
      id: "clip-1",
      trackId: "track-1",
      name: "Pulse",
      startBeat: 0,
      lengthBeats: 4,
    },
    {
      type: "AddNote",
      id: "note-1",
      trackId: "track-1",
      clipId: "clip-1",
      pitch: 36,
      velocity: 100,
      startBeat: 0,
      lengthBeats: 0.5,
    },
    {
      type: "AddNote",
      id: "note-2",
      trackId: "track-1",
      clipId: "clip-1",
      pitch: 43,
      velocity: 96,
      startBeat: 2,
      lengthBeats: 0.25,
    },
  ]);
}

function plan(baseRevision = 0, overrides: Partial<ExecutablePlan> = {}): ExecutablePlan {
  return Object.freeze({
    planId: "plan-bitwig-1",
    requestId: "request-bitwig-1",
    adapterId: "bitwig",
    capabilityVersion: BITWIG_CAPABILITY_VERSION,
    baseRevision,
    commands: commands(),
    requiredScopes: Object.freeze(["song.write"]),
    digest: "digest-bitwig-1",
    createdAt: "2026-07-15T09:59:00.000Z",
    expiresAt: "2026-07-15T10:01:00.000Z",
    ...overrides,
  });
}

function emptyInspection(): BitwigTargetInspection {
  return structuredClone({
    protocolVersion: BITWIG_BRIDGE_PROTOCOL_VERSION,
    controllerInstanceId: "controller-instance-1",
    projectName: "Disposable Beat Twin",
    writeAuthenticated: false,
    target: {
      available: true,
      binding: {
        controllerInstanceId: "controller-instance-1",
        projectName: "Disposable Beat Twin",
        trackPosition: 2,
        slotSceneIndex: 0,
        targetGeneration: 3,
      },
      trackName: "Instrument 3",
      slotName: "",
      hasContent: false,
      clipExists: false,
      clipLengthBeats: null,
    },
    transport: { tempoBpm: 120, positionBeats: 0, isPlaying: false },
    grid: { stepSizeBeats: BITWIG_STEP_SIZE_BEATS, maxSteps: BITWIG_MAX_STEPS },
    notes: [],
  });
}

class MemoryBitwigPort implements BitwigBridgePort {
  inspection = emptyInspection();
  readonly calls: Array<{ method: string; params: readonly unknown[] }> = [];
  authenticateCount = 0;
  failAuthentication = false;
  failMutationAt = -1;
  corruptReadback = false;
  replaceTargetOnAuthentication = false;
  failInspectionAfterAuthentication = false;
  clipReadyInspectionDelay = 0;
  inspectionCount = 0;
  pendingClipLength: number | null = null;

  async inspectTarget(): Promise<BitwigTargetInspection> {
    this.inspectionCount += 1;
    if (this.failInspectionAfterAuthentication && this.authenticateCount > 0) {
      throw new Error("target inspection unavailable");
    }
    if (this.pendingClipLength !== null) {
      if (this.clipReadyInspectionDelay > 0) {
        this.clipReadyInspectionDelay -= 1;
      } else {
        this.inspection.target.hasContent = true;
        this.inspection.target.clipExists = true;
        this.inspection.target.clipLengthBeats = this.pendingClipLength;
        this.pendingClipLength = null;
      }
    }
    const copy = structuredClone(this.inspection);
    if (this.corruptReadback && copy.target.hasContent) copy.notes = [];
    return copy;
  }

  async authenticate(): Promise<void> {
    this.authenticateCount += 1;
    if (this.failAuthentication) throw new Error("invalid bridge secret");
    this.inspection.writeAuthenticated = true;
    if (this.replaceTargetOnAuthentication) {
      this.inspection.target.binding.slotSceneIndex += 1;
      this.inspection.target.binding.targetGeneration += 1;
    }
  }

  async mutate(method: BitwigMutationMethod, params: readonly unknown[]): Promise<unknown> {
    const mutationIndex = this.calls.length;
    this.calls.push({ method, params });
    if (mutationIndex === this.failMutationAt) throw new Error("connection closed after dispatch");

    if (method === "target.set_tempo") {
      this.inspection.transport.tempoBpm = Number(params[1]);
    } else if (method === "target.set_track_name") {
      this.inspection.target.trackName = String(params[1]);
    } else if (method === "target.create_clip") {
      if (this.clipReadyInspectionDelay > 0) {
        this.pendingClipLength = Number(params[1]);
      } else {
        this.inspection.target.hasContent = true;
        this.inspection.target.clipExists = true;
        this.inspection.target.clipLengthBeats = Number(params[1]);
      }
    } else if (method === "target.set_note") {
      this.inspection.notes.push({
        channel: 0,
        step: Number(params[1]),
        pitch: Number(params[2]),
        velocity: Number(params[3]),
        durationBeats: Number(params[4]),
      });
    }
    return "OK";
  }
}

function adapter(
  port: MemoryBitwigPort,
  options: Partial<ConstructorParameters<typeof BitwigAdapter>[0]> = {},
): BitwigAdapter {
  return new BitwigAdapter({
    port,
    verifyDigest: () => true,
    now: () => NOW,
    wait: async () => {},
    clipReadyAttempts: 5,
    ...options,
  });
}

test("read health and target inspection remain available before write authentication", async () => {
  const port = new MemoryBitwigPort();
  const instance = adapter(port);
  const health = await instance.health();
  const capabilities = await instance.capabilities();
  const snapshot = await instance.inspect();

  assert.equal(health.status, "healthy");
  assert.deepEqual(capabilities.supportedCommands, [
    "CreateSong", "CreateTrack", "CreateClip", "AddNote",
  ]);
  assert.equal(snapshot.commandSnapshot.song, null);
  assert.equal(snapshot.commandSnapshot.revision, 0);
  assert.equal(port.authenticateCount, 0);
  assert.equal(port.calls.length, 0);
});

test("one bounded patch authenticates, stops relying on selection, and verifies exact notes", async () => {
  const port = new MemoryBitwigPort();
  const instance = adapter(port);
  const snapshot = await instance.inspect();
  const execution = await instance.execute(plan(snapshot.commandSnapshot.revision));

  assert.equal(execution.ok, true);
  assert.equal(execution.status, "succeeded");
  assert.equal(execution.finalSnapshot.revision, 1);
  assert.equal(port.authenticateCount, 1);
  assert.deepEqual(port.calls.map((entry) => entry.method), [
    "target.set_tempo",
    "target.set_track_name",
    "target.create_clip",
    "target.set_note",
    "target.set_note",
  ]);
  assert.equal(port.inspection.notes.length, 2);
  assert.equal(execution.finalSnapshot.song?.tracks[0]?.clips[0]?.pattern.notes.length, 2);

  const repeated = await instance.execute(plan(snapshot.commandSnapshot.revision));
  assert.strictEqual(repeated, execution);
  assert.equal(port.calls.length, 5);
});

test("clip readiness polling is read-only and never retries clip creation", async () => {
  const port = new MemoryBitwigPort();
  port.clipReadyInspectionDelay = 2;
  const instance = adapter(port);
  const snapshot = await instance.inspect();
  const execution = await instance.execute(plan(snapshot.commandSnapshot.revision));

  assert.equal(execution.ok, true);
  assert.equal(port.calls.filter((entry) => entry.method === "target.create_clip").length, 1);
  assert.equal(port.inspectionCount >= 6, true);
});

test("invalid names and notes beyond the clip are rejected before authentication", async () => {
  const longNamePort = new MemoryBitwigPort();
  const longNameAdapter = adapter(longNamePort);
  const longNameSnapshot = await longNameAdapter.inspect();
  const longNameCommands = commands().map((command) =>
    command.type === "CreateTrack" ? { ...command, name: "x".repeat(65) } : command);
  const longName = await longNameAdapter.execute(plan(longNameSnapshot.commandSnapshot.revision, {
    commands: longNameCommands,
  }));
  assert.equal(longName.ok, false);
  assert.equal(longNamePort.authenticateCount, 0);
  assert.equal(longNamePort.calls.length, 0);

  const overflowPort = new MemoryBitwigPort();
  const overflowAdapter = adapter(overflowPort);
  const overflowSnapshot = await overflowAdapter.inspect();
  const overflowCommands = commands().map((command) =>
    command.type === "AddNote" && command.id === "note-2"
      ? { ...command, startBeat: 3.75, lengthBeats: 0.5 }
      : command);
  const overflow = await overflowAdapter.execute(plan(overflowSnapshot.commandSnapshot.revision, {
    commands: overflowCommands,
  }));
  assert.equal(overflow.ok, false);
  assert.equal(overflowPort.authenticateCount, 0);
  assert.equal(overflowPort.calls.length, 0);
});

test("explicit NanoDAW instruments remain unsupported in Bitwig before authentication", async () => {
  const port = new MemoryBitwigPort();
  const instance = adapter(port);
  const snapshot = await instance.inspect();
  const explicitInstrument = commands().map((command) =>
    command.type === "CreateTrack"
      ? { ...command, instrumentId: "bass" as const }
      : command);

  const execution = await instance.execute(plan(snapshot.commandSnapshot.revision, {
    commands: explicitInstrument,
  }));
  assert.equal(execution.ok, false);
  assert.equal(execution.ok ? null : execution.error.code, "unsupported_capability");
  assert.match(execution.ok ? "" : execution.error.message, /not mapped/);
  assert.equal(port.authenticateCount, 0);
  assert.equal(port.calls.length, 0);
});

test("authentication and target replacement fail before the first mutation", async () => {
  const deniedPort = new MemoryBitwigPort();
  deniedPort.failAuthentication = true;
  const deniedAdapter = adapter(deniedPort);
  const deniedSnapshot = await deniedAdapter.inspect();
  const denied = await deniedAdapter.execute(plan(deniedSnapshot.commandSnapshot.revision));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "policy_blocked");
  assert.equal(deniedPort.calls.length, 0);

  const replacedPort = new MemoryBitwigPort();
  const replacedAdapter = adapter(replacedPort);
  const replacedSnapshot = await replacedAdapter.inspect();
  replacedPort.inspection.target.binding.slotSceneIndex = 1;
  const replaced = await replacedAdapter.execute(plan(replacedSnapshot.commandSnapshot.revision));
  assert.equal(replaced.ok, false);
  assert.equal(replaced.error.code, "stale_revision");
  assert.equal(replacedPort.authenticateCount, 0);
  assert.equal(replacedPort.calls.length, 0);

  const racedPort = new MemoryBitwigPort();
  racedPort.replaceTargetOnAuthentication = true;
  const racedAdapter = adapter(racedPort);
  const racedSnapshot = await racedAdapter.inspect();
  const raced = await racedAdapter.execute(plan(racedSnapshot.commandSnapshot.revision));
  assert.equal(raced.ok, false);
  assert.equal(raced.error.code, "stale_revision");
  assert.equal(racedPort.authenticateCount, 1);
  assert.equal(racedPort.calls.length, 0);

  const unavailablePort = new MemoryBitwigPort();
  unavailablePort.failInspectionAfterAuthentication = true;
  const unavailableAdapter = adapter(unavailablePort);
  const unavailableSnapshot = await unavailableAdapter.inspect();
  const unavailable = await unavailableAdapter.execute(
    plan(unavailableSnapshot.commandSnapshot.revision),
  );
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error.code, "policy_blocked");
  assert.equal(unavailablePort.calls.length, 0);
});

test("a post-dispatch failure stops once and reports the precise unknown boundary", async () => {
  const port = new MemoryBitwigPort();
  port.failMutationAt = 2;
  const instance = adapter(port);
  const snapshot = await instance.inspect();
  const execution = await instance.execute(plan(snapshot.commandSnapshot.revision));

  assert.equal(execution.ok, false);
  assert.equal(execution.status, "partial");
  assert.equal(execution.error.code, "partial_execution");
  assert.equal(execution.error.commandIndex, 2);
  assert.deepEqual(execution.results.map((result) => result.status), [
    "succeeded", "succeeded", "unknown", "not_attempted", "not_attempted",
  ]);
  assert.equal(port.calls.length, 3);

  const repeated = await instance.execute(plan(snapshot.commandSnapshot.revision));
  assert.strictEqual(repeated, execution);
  assert.equal(port.calls.length, 3);
});

test("bounds observation fingerprints and lazily cleans them after expiry", async () => {
  let now = NOW;
  const port = new MemoryBitwigPort();
  const instance = adapter(port, {
    now: () => now,
    observationRetention: { capacity: 1, ttlMs: 10 },
  });
  await instance.inspect();
  port.inspection.target.binding.targetGeneration += 1;
  await assert.rejects(instance.inspect(), /retention capacity/);
  assert.equal(instance.retentionStatus().observations, 1);
  now += 10;
  await instance.inspect();
  assert.equal(instance.retentionStatus().observations, 1);
});

test("frees terminal Bitwig request capacity only after its retention boundary", async () => {
  let now = NOW;
  const port = new MemoryBitwigPort();
  port.failAuthentication = true;
  const instance = adapter(port, {
    now: () => now,
    executionRetention: { capacity: 1, ttlMs: 10 },
  });
  const snapshot = await instance.inspect();
  const first = await instance.execute(plan(snapshot.commandSnapshot.revision, {
    planId: "terminal-retained",
    requestId: "terminal-retained",
  }));
  assert.equal(first.status, "failed");
  assert.equal(port.authenticateCount, 1);

  const nextPlan = plan(snapshot.commandSnapshot.revision, {
    planId: "terminal-next",
    requestId: "terminal-next",
  });
  const blocked = await instance.execute(nextPlan);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok ? null : blocked.error.code, "policy_blocked");
  assert.equal(port.authenticateCount, 1);

  now += 10;
  const admitted = await instance.execute(nextPlan);
  assert.equal(admitted.status, "failed");
  assert.equal(port.authenticateCount, 2);
  assert.equal(instance.retentionStatus().executions, 1);
});

test("pins uncertain Bitwig requests and refuses a second dispatch at capacity", async () => {
  let now = NOW;
  const port = new MemoryBitwigPort();
  port.failMutationAt = 2;
  const instance = adapter(port, {
    now: () => now,
    executionRetention: { capacity: 1, ttlMs: 10 },
  });
  const snapshot = await instance.inspect();
  const first = await instance.execute(plan(snapshot.commandSnapshot.revision, {
    planId: "retained-uncertain",
    requestId: "retained-uncertain",
  }));
  assert.equal(first.status, "partial");
  assert.equal(port.calls.length, 3);
  now += 1_000;
  const blocked = await instance.execute(plan(snapshot.commandSnapshot.revision, {
    planId: "blocked-after-uncertain",
    requestId: "blocked-after-uncertain",
  }));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok ? null : blocked.error.code, "policy_blocked");
  assert.equal(port.calls.length, 3);
  assert.equal(instance.retentionStatus().executions, 1);
});

test("divergent note readback is partial and never presented as complete", async () => {
  const port = new MemoryBitwigPort();
  port.corruptReadback = true;
  const instance = adapter(port);
  const snapshot = await instance.inspect();
  const execution = await instance.execute(plan(snapshot.commandSnapshot.revision));

  assert.equal(execution.ok, false);
  assert.equal(execution.status, "partial");
  assert.match(execution.error.message, /note readback/i);
  assert.equal(execution.results.every((result) => result.status === "unknown"), true);
  assert.equal(execution.finalSnapshot.song?.tracks[0]?.clips[0]?.pattern.notes.length, 0);
});

test("RPC port authenticates through one shared call primitive without exposing its secret", async () => {
  assert.throws(
    () => createRpcBitwigBridgePort({ call: async () => null, bridgeSecret: "" }),
    /secret is required/i,
  );
  const calls: Array<{
    method: string;
    params: readonly unknown[];
    options?: { readonly requiresAuthentication?: boolean; readonly bridgeSecret?: string };
  }> = [];
  const rpcPort = createRpcBitwigBridgePort({
    bridgeSecret: "bridge secret value",
    call: async (method, params = [], options) => {
      calls.push({ method, params, options });
      if (method === "target.inspect") {
        const inspection = emptyInspection();
        inspection.writeAuthenticated = options?.requiresAuthentication === true;
        return inspection;
      }
      return "OK";
    },
  });
  await rpcPort.authenticate();
  await rpcPort.mutate("target.set_tempo", [emptyInspection().target.binding, 112]);
  assert.deepEqual(calls.map((entry) => entry.method), [
    "target.inspect", "target.set_tempo",
  ]);
  assert.equal(calls.every((entry) => entry.options?.bridgeSecret === "bridge secret value"), true);
});
