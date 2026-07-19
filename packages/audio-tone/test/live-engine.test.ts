import assert from "node:assert/strict";
import test from "node:test";

import {
  createLiveAudioEngine,
  LiveAudioEngineFault,
  midiMaterialEvents,
  type LiveAudioObservation,
  type LiveAudioPort,
  type LiveClipMaterial,
  type LiveMaterialPreparer,
  type LiveMidiClipMaterial,
  type LivePreparedMaterial,
  type LiveScheduleHandle,
  type LiveTrackBus,
} from "../src/index.ts";

type OneShotTask = {
  readonly kind: "once";
  readonly beat: number;
  readonly callback: (audioTime: number) => void;
};

type RepeatTask = {
  readonly kind: "repeat";
  readonly beat: number;
  readonly intervalBeats: number;
  readonly callback: (audioTime: number, occurrenceBeat: number) => void;
};

type ScheduledTask = OneShotTask | RepeatTask;

class FakeClockPort implements LiveAudioPort {
  beat = 0;
  bpm = 0;
  running = false;
  unlocked = false;
  unlockError: Error | null = null;
  unlockGate: Promise<void> | null = null;
  unlocks = 0;
  nextHandle = 0;
  readonly tasks = new Map<LiveScheduleHandle, ScheduledTask>();
  readonly buses: FakeBus[] = [];
  starts = 0;
  stops = 0;
  readonly stopTimes: Array<number | undefined> = [];
  resets = 0;
  disposed = 0;
  executingCallback = false;
  schedulesDuringCallback = 0;
  repeatSchedules = 0;

  async unlock(): Promise<void> {
    this.unlocks += 1;
    if (this.unlockGate) await this.unlockGate;
    if (this.unlockError) throw this.unlockError;
    this.unlocked = true;
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  currentBeat = (): number => this.beat;

  scheduleAtBeat = (beat: number, callback: (audioTime: number) => void): LiveScheduleHandle => {
    if (this.executingCallback) this.schedulesDuringCallback += 1;
    this.nextHandle += 1;
    this.tasks.set(this.nextHandle, { kind: "once", beat, callback });
    return this.nextHandle;
  };

  scheduleRepeatAtBeat = (
    firstBeat: number,
    intervalBeats: number,
    callback: (audioTime: number, occurrenceBeat: number) => void,
  ): LiveScheduleHandle => {
    if (this.executingCallback) this.schedulesDuringCallback += 1;
    this.nextHandle += 1;
    this.repeatSchedules += 1;
    this.tasks.set(this.nextHandle, {
      kind: "repeat",
      beat: firstBeat,
      intervalBeats,
      callback,
    });
    return this.nextHandle;
  };

  cancel = (handle: LiveScheduleHandle): void => {
    this.tasks.delete(handle);
  };

  start = (atBeat: number): void => {
    this.beat = atBeat;
    this.running = true;
    this.starts += 1;
  };

  suspend = (): void => {
    this.running = false;
  };

  resume = (): void => {
    this.running = true;
  };

  stop = (audioTime?: number): void => {
    this.running = false;
    this.stops += 1;
    this.stopTimes.push(audioTime);
  };

  reset = (): void => {
    this.running = false;
    this.beat = 0;
    this.tasks.clear();
    this.resets += 1;
  };

  createTrackBus = (trackId: string): LiveTrackBus => {
    const bus = new FakeBus(trackId);
    this.buses.push(bus);
    return bus;
  };

  dispose = (): void => {
    this.tasks.clear();
    this.disposed += 1;
  };

  advanceTo(targetBeat: number): void {
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.beat <= targetBeat)
        .sort((left, right) => left[1].beat - right[1].beat || Number(left[0]) - Number(right[0]))[0];
      if (!next) break;
      const [handle, task] = next;
      if (task.kind === "repeat") {
        this.tasks.set(handle, {
          ...task,
          beat: task.beat + task.intervalBeats,
        });
      } else {
        this.tasks.delete(handle);
      }
      this.beat = task.beat;
      this.executingCallback = true;
      try {
        if (task.kind === "repeat") {
          task.callback(task.beat * (60 / this.bpm), task.beat);
        } else {
          task.callback(task.beat * (60 / this.bpm));
        }
      } finally {
        this.executingCallback = false;
      }
    }
    this.beat = targetBeat;
  }
}

class FakeBus implements LiveTrackBus {
  readonly trackId: string;
  disposed = 0;
  constructor(trackId: string) {
    this.trackId = trackId;
  }
  dispose = (): void => {
    this.disposed += 1;
  };
}

type Trigger = {
  readonly materialId: string;
  readonly eventId: string;
  readonly beat: number;
};

function midiMaterial(
  clipId: string,
  version = 1,
  pitch = 48,
): LiveMidiClipMaterial {
  return {
    kind: "midi",
    materialId: `${clipId}@${version}`,
    version,
    clipId,
    instrumentId: "bass",
    lengthBeats: 4,
    notes: [
      { id: `${clipId}-note`, pitch, velocity: 100, startBeat: 0, lengthBeats: 0.5 },
    ],
  };
}

function harness(options: { readonly beforePrepare?: () => Promise<void> } = {}) {
  const port = new FakeClockPort();
  const triggers: Trigger[] = [];
  const prepared: Array<{
    materialId: string;
    released: number;
    disposed: number;
    releaseTimes: Array<number | undefined>;
    disposeTimes: Array<number | undefined>;
  }> = [];
  const prepareMaterial: LiveMaterialPreparer = async (material) => {
    await options.beforePrepare?.();
    if (material.kind !== "midi") {
      throw new LiveAudioEngineFault({
        code: "unsupported_material",
        message: `No preparer for ${material.kind}`,
      });
    }
    const midi = material as LiveMidiClipMaterial;
    const lifecycle = {
      materialId: midi.materialId,
      released: 0,
      disposed: 0,
      releaseTimes: [] as Array<number | undefined>,
      disposeTimes: [] as Array<number | undefined>,
    };
    prepared.push(lifecycle);
    const result: LivePreparedMaterial = {
      kind: midi.kind,
      materialId: midi.materialId,
      version: midi.version,
      clipId: midi.clipId,
      lengthBeats: midi.lengthBeats,
      events: midiMaterialEvents(midi),
      trigger(event) {
        triggers.push({ materialId: midi.materialId, eventId: event.id, beat: port.beat });
      },
      releaseAll(audioTime) {
        lifecycle.released += 1;
        lifecycle.releaseTimes.push(audioTime);
      },
      dispose(audioTime) {
        lifecycle.disposed += 1;
        lifecycle.disposeTimes.push(audioTime);
      },
    };
    return result;
  };
  const engine = createLiveAudioEngine({ port, prepareMaterial });
  const observations: LiveAudioObservation[] = [];
  engine.subscribe((observation) => observations.push(observation));
  engine.initialize(120);
  return { engine, observations, port, prepared, triggers };
}

test("loops two tracks for 32 beats on one persistent clock and stable buses", async () => {
  const { engine, observations, port, triggers } = harness();
  await engine.unlock();
  const result = await engine.scheduleTransitions([
    launch("a-start", "track-a", 0, midiMaterial("clip-a")),
    launch("b-start", "track-b", 0, midiMaterial("clip-b", 1, 60)),
  ]);
  assert.equal(result.ok, true);
  engine.start(0);
  port.advanceTo(32);

  assert.equal(port.starts, 1);
  assert.equal(port.repeatSchedules, 2);
  assert.equal(port.schedulesDuringCallback, 0);
  assert.deepEqual(port.buses.map((bus) => bus.trackId), ["track-a", "track-b"]);
  assert.equal(triggers.filter((call) => call.materialId === "clip-a@1").length, 9);
  assert.equal(triggers.filter((call) => call.materialId === "clip-b@1").length, 9);
  assert.deepEqual(
    observations.filter((entry) => entry.type === "transition-executed").map((entry) => entry.trackId),
    ["track-a", "track-b"],
  );
});

test("replaces and stops track A on exact boundaries while track B continues", async () => {
  const { engine, port, prepared, triggers } = harness();
  await engine.unlock();
  await engine.scheduleTransitions([
    launch("a-1", "track-a", 0, midiMaterial("clip-a1")),
    launch("b-1", "track-b", 0, midiMaterial("clip-b1")),
  ]);
  engine.start(0);
  port.advanceTo(4);

  await engine.scheduleTransitions([
    launch("a-2", "track-a", 8, midiMaterial("clip-a2")),
  ]);
  port.advanceTo(12);
  assert.equal(triggers.some((call) => call.materialId === "clip-a1@1" && call.beat >= 8), false);
  assert.equal(triggers.some((call) => call.materialId === "clip-a2@1" && call.beat === 8), true);
  assert.equal(triggers.some((call) => call.materialId === "clip-b1@1" && call.beat === 12), true);
  const firstA = prepared.find((item) => item.materialId === "clip-a1@1");
  assert.equal(firstA?.disposed, 1);
  assert.deepEqual(firstA?.releaseTimes, [4]);
  assert.deepEqual(firstA?.disposeTimes, [4]);

  await engine.scheduleTransitions([stop("a-stop", "track-a", 16)]);
  port.advanceTo(20);
  assert.equal(triggers.some((call) => call.materialId === "clip-a2@1" && call.beat >= 16), false);
  assert.equal(triggers.some((call) => call.materialId === "clip-b1@1" && call.beat === 20), true);
  const secondA = prepared.find((item) => item.materialId === "clip-a2@1");
  assert.deepEqual(secondA?.releaseTimes, [8]);
  assert.deepEqual(secondA?.disposeTimes, [8]);
  assert.deepEqual(engine.getSnapshot().activeMaterialByTrack, { "track-b": "clip-b1@1" });
  assert.deepEqual(engine.getSnapshot().activeStartedAtBeatByTrack, { "track-b": 0 });
  assert.deepEqual(engine.getSnapshot().activeLengthBeatsByTrack, { "track-b": 4 });
});

test("cancels future replacement, restores the old loop, and coalesces exact retries", async () => {
  const { engine, observations, port, prepared, triggers } = harness();
  await engine.unlock();
  await engine.scheduleTransitions([launch("a-1", "track-a", 0, midiMaterial("clip-a1"))]);
  engine.start(0);
  port.advanceTo(4);
  const request = launch("a-2", "track-a", 8, midiMaterial("clip-a2"));
  assert.equal((await engine.scheduleTransitions([request])).ok, true);
  assert.equal((await engine.scheduleTransitions([request])).ok, true);
  assert.equal(prepared.filter((item) => item.materialId === "clip-a2@1").length, 1);
  assert.equal(engine.cancelTransition("a-2"), true);
  port.advanceTo(12);

  assert.equal(triggers.some((call) => call.materialId === "clip-a1@1" && call.beat === 12), true);
  assert.equal(triggers.some((call) => call.materialId === "clip-a2@1"), false);
  assert.equal(observations.some((entry) => entry.type === "transition-cancelled"), true);
});

test("reserves a track atomically while asynchronous material preparation is in flight", async () => {
  let releasePreparation!: () => void;
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  const { engine, port, prepared, triggers } = harness({
    beforePrepare: () => preparationGate,
  });
  await engine.unlock();

  const first = engine.scheduleTransitions([
    launch("first", "track-a", 0, midiMaterial("clip-first")),
  ]);
  const concurrent = await engine.scheduleTransitions([
    launch("second", "track-a", 0, midiMaterial("clip-second")),
  ]);
  assert.equal(concurrent.ok, false);
  if (!concurrent.ok) assert.equal(concurrent.error.code, "invalid_state");

  releasePreparation();
  assert.equal((await first).ok, true);
  engine.start(0);
  port.advanceTo(4);

  assert.deepEqual(prepared.map((entry) => entry.materialId), ["clip-first@1"]);
  assert.equal(triggers.some((entry) => entry.materialId === "clip-second@1"), false);
  assert.deepEqual(engine.getSnapshot().activeMaterialByTrack, {
    "track-a": "clip-first@1",
  });
});

test("does not restart an already running clock and rejects initialize while running", async () => {
  const { engine, port } = harness();
  await engine.unlock();
  engine.start(0);
  engine.start(16);
  assert.equal(port.starts, 1);
  assert.equal(port.beat, 0);
  assert.throws(
    () => engine.initialize(96),
    (error: unknown) =>
      error instanceof LiveAudioEngineFault && error.detail.code === "invalid_state",
  );
  assert.equal(engine.getSnapshot().phase, "running");
  assert.equal(engine.getSnapshot().bpm, 120);
  await engine.unlock();
  assert.equal(port.unlocks, 1);
  assert.equal(engine.getSnapshot().phase, "running");
});

test("does not resurrect ready phase when lifecycle changes during unlock", async () => {
  for (const [operation, expectedCode, expectedPhase] of [
    ["stop", "invalid_state", "stopped"],
    ["reset", "invalid_state", "initialized"],
    ["dispose", "disposed", "disposed"],
  ] as const) {
    let releaseUnlock!: () => void;
    const unlockGate = new Promise<void>((resolve) => {
      releaseUnlock = resolve;
    });
    const { engine, port } = harness();
    port.unlockGate = unlockGate;

    const unlocking = engine.unlock();
    engine[operation]();
    releaseUnlock();

    await assert.rejects(
      () => unlocking,
      (error: unknown) =>
        error instanceof LiveAudioEngineFault && error.detail.code === expectedCode,
    );
    assert.equal(engine.getSnapshot().phase, expectedPhase);
  }
});

test("does not coalesce retries whose material kind, clip, or length differs", async () => {
  const { engine } = harness();
  await engine.unlock();
  const initial = launch("same-id", "track-a", 4, midiMaterial("clip-a"));
  assert.equal((await engine.scheduleTransitions([initial])).ok, true);

  for (const material of [
    { ...initial.material, kind: "future-midi", clipId: "clip-a" },
    { ...initial.material, clipId: "clip-b" },
    { ...initial.material, lengthBeats: 8 },
  ]) {
    const result = await engine.scheduleTransitions([{ ...initial, material }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid_state");
  }
});

test("invalidates prepared material when stop changes lifecycle during await", async () => {
  let releasePreparation!: () => void;
  const preparationGate = new Promise<void>((resolve) => {
    releasePreparation = resolve;
  });
  const { engine, port, prepared } = harness({
    beforePrepare: () => preparationGate,
  });
  await engine.unlock();
  const scheduling = engine.scheduleTransitions([
    launch("late", "track-a", 4, midiMaterial("clip-late")),
  ]);

  engine.stop();
  releasePreparation();
  const result = await scheduling;

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, "invalid_state");
  assert.equal(port.tasks.size, 0);
  assert.deepEqual(prepared.map((entry) => [entry.released, entry.disposed]), [[1, 1]]);
});

test("reports autoplay and unsupported material failures structurally", async () => {
  const { engine, port } = harness();
  port.unlockError = new Error("gesture required");
  await assert.rejects(
    () => engine.unlock(),
    (error: unknown) =>
      error instanceof LiveAudioEngineFault && error.detail.code === "autoplay_rejected",
  );
  assert.equal(engine.getSnapshot().phase, "blocked");

  port.unlockError = null;
  await engine.unlock();
  const unsupported: LiveClipMaterial = {
    kind: "future-adapter",
    materialId: "future@1",
    version: 1,
    clipId: "future",
    lengthBeats: 4,
  };
  const result = await engine.scheduleTransitions([
    launch("future", "track-a", 0, unsupported),
  ]);
  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "unsupported_material",
      message: "No preparer for future-adapter",
    },
  });
});

test("keeps the old active loop intact when replacement preparation fails", async () => {
  const { engine, port, triggers } = harness();
  await engine.unlock();
  await engine.scheduleTransitions([
    launch("stable", "track-a", 0, midiMaterial("clip-stable")),
  ]);
  engine.start(0);
  port.advanceTo(4);

  const unavailable: LiveClipMaterial = {
    kind: "future-adapter",
    materialId: "unavailable-content",
    version: 2,
    clipId: "clip-stable",
    lengthBeats: 4,
  };
  const result = await engine.scheduleTransitions([
    launch("failed-refresh", "track-a", 8, unavailable),
  ]);
  assert.equal(result.ok, false);
  port.advanceTo(12);

  assert.equal(
    triggers.some((entry) => entry.materialId === "clip-stable@1" && entry.beat === 12),
    true,
  );
  assert.deepEqual(engine.getSnapshot().activeMaterialByTrack, {
    "track-a": "clip-stable@1",
  });
});

test("cleans scheduled events, sources, buses, and transport idempotently", async () => {
  const { engine, port, prepared } = harness();
  await engine.unlock();
  await engine.scheduleTransitions([launch("a", "track-a", 0, midiMaterial("clip-a"))]);
  engine.start(0);
  port.advanceTo(0);
  engine.reset();
  assert.equal(port.tasks.size, 0);
  assert.equal(port.buses[0]?.disposed, 1);
  assert.equal(prepared[0]?.released, 1);
  assert.equal(prepared[0]?.disposed, 1);
  engine.dispose();
  engine.dispose();
  assert.equal(port.disposed, 1);
});

test("schedules and cancels transport stop through an identified engine acknowledgement", async () => {
  const { engine, observations, port, prepared } = harness();
  await engine.unlock();
  await engine.scheduleTransitions([launch("launch-a", "track-a", 0, midiMaterial("clip-a"))]);
  engine.start(0);
  port.advanceTo(0);
  assert.equal(engine.scheduleTransportStop({ transitionId: "stop-1", targetBeat: 4 }).ok, true);
  assert.equal(engine.cancelTransportStop("wrong"), false);
  assert.equal(engine.cancelTransportStop("stop-1"), true);
  assert.equal(
    observations.some((entry) => entry.type === "transport-stop-cancelled"),
    true,
  );
  assert.equal(engine.scheduleTransportStop({ transitionId: "stop-2", targetBeat: 8 }).ok, true);
  port.advanceTo(8);
  assert.equal(engine.getSnapshot().phase, "stopped");
  assert.equal(observations.some((entry) => entry.type === "transport-stopped"), true);
  assert.deepEqual(port.stopTimes, [4]);
  assert.deepEqual(prepared[0]?.releaseTimes, [4]);
  assert.deepEqual(prepared[0]?.disposeTimes, [4]);
});

function launch(
  transitionId: string,
  trackId: string,
  targetBeat: number,
  material: LiveClipMaterial,
) {
  return {
    kind: "launch" as const,
    transitionId,
    groupId: null,
    trackId,
    targetBeat,
    material,
  };
}

function stop(transitionId: string, trackId: string, targetBeat: number) {
  return {
    kind: "stop" as const,
    transitionId,
    groupId: null,
    trackId,
    targetBeat,
  };
}
