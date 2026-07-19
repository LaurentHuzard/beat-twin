import { describe, expect, it, vi } from "vitest";

import type {
  LiveAudioEngine,
  LiveAudioError,
  LiveAudioObservation,
  LiveTransitionRequest,
} from "@beat-twin/audio-tone";
import type { Song } from "@beat-twin/core";

import {
  createLiveAudioController,
  resolveSongLiveMaterial,
} from "./liveAudioController";
import {
  createPerformanceState,
  reconcilePerformanceMaterial,
  reducePerformanceState,
  type PerformanceAction,
  type PerformanceState,
} from "./performanceRuntime";

class StubEngine {
  readonly scheduled: LiveTransitionRequest[][] = [];
  readonly listeners = new Set<(observation: LiveAudioObservation) => void>();
  readonly cancelled: string[] = [];
  readonly activeMaterials: Record<string, string> = {};
  readonly activeStartedAtBeats: Record<string, number> = {};
  readonly activeLengthBeats: Record<string, number> = {};
  readonly pendingTransitions: Record<string, string> = {};
  readonly pendingMaterials: Record<string, string | null> = {};
  readonly cancelFailures = new Set<string>();
  beat = 0;
  beforeScheduleResolution: (() => void) | null = null;
  scheduleGate: Promise<void> | null = null;
  unlockGate: Promise<void> | null = null;
  scheduleError: LiveAudioError | null = null;
  afterCancel: ((transitionId: string) => void) | null = null;
  phase: ReturnType<LiveAudioEngine["getSnapshot"]>["phase"] = "new";

  readonly engine: LiveAudioEngine = {
    initialize: vi.fn(() => {
      this.phase = "initialized";
    }),
    unlock: vi.fn(async () => {
      if (this.unlockGate) await this.unlockGate;
      this.phase = "ready";
    }),
    start: vi.fn((atBeat = 0) => {
      this.beat = atBeat;
      this.phase = "running";
    }),
    suspend: vi.fn(),
    resume: vi.fn(),
    scheduleTransitions: vi.fn(async (requests: readonly LiveTransitionRequest[]) => {
      this.scheduled.push([...requests]);
      this.beforeScheduleResolution?.();
      if (this.scheduleGate) await this.scheduleGate;
      if (this.scheduleError) return { ok: false as const, error: this.scheduleError };
      for (const request of requests) {
        this.pendingTransitions[request.trackId] = request.transitionId;
        this.pendingMaterials[request.trackId] =
          request.kind === "launch" ? request.material.materialId : null;
      }
      return { ok: true as const, transitionIds: requests.map((request) => request.transitionId) };
    }),
    cancelTransition: vi.fn((transitionId) => {
      if (this.cancelFailures.has(transitionId)) return false;
      const request = this.scheduled.flat().find((candidate) => candidate.transitionId === transitionId);
      if (!request) return false;
      this.cancelled.push(transitionId);
      delete this.pendingTransitions[request.trackId];
      delete this.pendingMaterials[request.trackId];
      this.emit({
        type: "transition-cancelled",
        transitionId,
        groupId: request.groupId,
        trackId: request.trackId,
        observedAtBeat: this.beat,
      });
      this.afterCancel?.(transitionId);
      return true;
    }),
    scheduleTransportStop: vi.fn((request) => ({
      ok: true as const,
      transitionIds: [request.transitionId],
    })),
    cancelTransportStop: vi.fn((transitionId) => {
      this.emit({
        type: "transport-stop-cancelled",
        transitionId,
        observedAtBeat: this.beat,
      });
      return true;
    }),
    stop: vi.fn(() => {
      this.phase = "stopped";
      for (const key of Object.keys(this.activeMaterials)) delete this.activeMaterials[key];
      for (const key of Object.keys(this.activeStartedAtBeats)) delete this.activeStartedAtBeats[key];
      for (const key of Object.keys(this.activeLengthBeats)) delete this.activeLengthBeats[key];
      for (const key of Object.keys(this.pendingTransitions)) delete this.pendingTransitions[key];
      for (const key of Object.keys(this.pendingMaterials)) delete this.pendingMaterials[key];
    }),
    reset: vi.fn(),
    dispose: vi.fn(),
    getSnapshot: () => ({
      phase: this.phase,
      bpm: 120,
      currentBeat: this.beat,
      activeMaterialByTrack: { ...this.activeMaterials },
      activeStartedAtBeatByTrack: { ...this.activeStartedAtBeats },
      activeLengthBeatsByTrack: { ...this.activeLengthBeats },
      pendingTransitionByTrack: { ...this.pendingTransitions },
      pendingMaterialByTrack: { ...this.pendingMaterials },
      error: null,
    }),
    subscribe: (listener) => {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    },
  };

  emit(observation: LiveAudioObservation): void {
    if (observation.type === "transition-executed") {
      delete this.pendingTransitions[observation.trackId];
      delete this.pendingMaterials[observation.trackId];
      if (observation.materialId) {
        this.activeMaterials[observation.trackId] = observation.materialId;
        const request = this.scheduled
          .flat()
          .find((candidate) => candidate.transitionId === observation.transitionId);
        if (request?.kind === "launch") {
          this.activeStartedAtBeats[observation.trackId] = request.targetBeat;
          this.activeLengthBeats[observation.trackId] = request.material.lengthBeats;
        }
      } else {
        delete this.activeMaterials[observation.trackId];
        delete this.activeStartedAtBeats[observation.trackId];
        delete this.activeLengthBeats[observation.trackId];
      }
    }
    for (const listener of this.listeners) listener(observation);
  }
}

function hostHarness() {
  let song = makeSong();
  let state = createPerformanceState({ materialVersion: 7 });
  const actions: PerformanceAction[] = [];
  const errors: LiveAudioError[] = [];
  return {
    get song() {
      return song;
    },
    actions,
    errors,
    get state() {
      return state;
    },
    replaceState(next: PerformanceState) {
      state = next;
    },
    replaceSong(next: Song) {
      song = next;
    },
    host: {
      getSong: () => song,
      getPerformanceState: () => state,
      dispatchPerformance(action: PerformanceAction) {
        actions.push(action);
        state = reducePerformanceState(state, action);
      },
      reportError(error: LiveAudioError) {
        errors.push(error);
      },
    },
  };
}

describe("live audio controller", () => {
  it("exposes only valid engine-owned active loop timing for overdub alignment", () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    expect(controller.getActiveLoopTiming?.("track-a")).toBeNull();
    stub.activeStartedAtBeats["track-a"] = 8;
    stub.activeLengthBeats["track-a"] = 16;
    expect(controller.getActiveLoopTiming?.("track-a")).toEqual({
      startedAtBeat: 8,
      lengthBeats: 16,
    });
    stub.activeLengthBeats["track-a"] = 0;
    expect(controller.getActiveLoopTiming?.("track-a")).toBeNull();
  });

  it("fails closed on an in-session tempo edit and a fresh start uses the new BPM", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.replaceSong({
      ...harness.song,
      transport: { ...harness.song.transport, bpm: 140 },
    });

    controller.reconcileMaterial();

    expect(stub.engine.stop).toHaveBeenCalledOnce();
    expect(harness.state.phase).toBe("idle");
    expect(harness.errors.at(-1)).toMatchObject({
      code: "invalid_state",
      message: expect.stringContaining("tempo changed from 120 to 140 BPM"),
    });

    const freshStub = new StubEngine();
    const freshHarness = hostHarness();
    freshHarness.replaceSong({
      ...freshHarness.song,
      transport: { ...freshHarness.song.transport, bpm: 140 },
    });
    await createLiveAudioController({
      engine: freshStub.engine,
      host: freshHarness.host,
    }).start();
    expect(freshStub.engine.initialize).toHaveBeenCalledWith(140);
  });

  it("binds a clip request to schedule acknowledgement and matching execution", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "launch-a",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });

    await controller.syncPending();
    const material = resolveSongLiveMaterial(harness.song, 7, "track-a", "clip-a1");
    expect(harness.state.tracks["track-a"].pendingTransition?.status).toBe("scheduled");
    expect(stub.scheduled[0]?.[0]).toMatchObject({
      transitionId: "launch-a",
      trackId: "track-a",
      material: {
        kind: "midi",
        materialId: material.materialId,
        version: material.version,
      },
    });

    stub.beat = 4;
    stub.emit({
      type: "transition-executed",
      transitionId: "launch-a",
      groupId: null,
      trackId: "track-a",
      targetBeat: 4,
      observedAtBeat: 4,
      materialId: material.materialId,
      materialKind: "midi",
    });
    expect(harness.state.tracks["track-a"].activeClipId).toBe("clip-a1");
  });

  it("schedules a scene as one batch and acknowledges its group atomically", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchScene",
      transitionId: "scene-1",
      sceneId: "scene-a",
      requestedAtBeat: 0,
      slots: [
        { trackId: "track-a", clipId: "clip-a1" },
        { trackId: "track-b", clipId: "clip-b1" },
      ],
    });

    await controller.syncPending();
    expect(stub.scheduled).toHaveLength(1);
    expect(stub.scheduled[0]).toHaveLength(2);
    expect(
      Object.values(harness.state.tracks).map((track) => track.pendingTransition?.status),
    ).toEqual(["scheduled", "scheduled"]);

    controller.cancelScene("scene-1");
    expect(stub.cancelled).toEqual(["scene-1:track-a", "scene-1:track-b"]);
    expect(Object.values(harness.state.tracks).every((track) => !track.pendingTransition)).toBe(true);

    const failingStub = new StubEngine();
    const failingHarness = hostHarness();
    const failingController = createLiveAudioController({
      engine: failingStub.engine,
      host: failingHarness.host,
    });
    await failingController.start();
    failingHarness.host.dispatchPerformance({
      type: "LaunchScene",
      transitionId: "scene-failure",
      sceneId: "scene-b",
      requestedAtBeat: 0,
      slots: [
        { trackId: "track-a", clipId: "clip-a1" },
        { trackId: "track-b", clipId: "clip-b1" },
      ],
    });
    failingStub.scheduleError = {
      code: "material_not_ready",
      message: "fixture preparation failure",
    };
    failingStub.beforeScheduleResolution = () => {
      failingHarness.host.dispatchPerformance({ type: "AdvanceClock", beat: 2 });
    };
    await failingController.syncPending();
    expect(failingHarness.actions.at(-1)).toMatchObject({
      type: "ObserveSceneFailed",
      groupId: "scene-failure",
      observedAtBeat: 2,
    });

    const editedStub = new StubEngine();
    const editedHarness = hostHarness();
    const editedController = createLiveAudioController({
      engine: editedStub.engine,
      host: editedHarness.host,
    });
    await editedController.start();
    editedHarness.host.dispatchPerformance({
      type: "LaunchScene",
      transitionId: "scene-edited",
      sceneId: "scene-c",
      requestedAtBeat: 0,
      slots: [
        { trackId: "track-a", clipId: "clip-a1" },
        { trackId: "track-b", clipId: "clip-b1" },
      ],
    });
    await editedController.syncPending();
    const editedSong = songWithNoteVelocity(editedHarness.song, "track-a", 72);
    editedHarness.replaceSong(editedSong);
    editedHarness.replaceState(
      reconcilePerformanceMaterial(editedHarness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );

    editedController.reconcileMaterial();

    expect(editedStub.cancelled).toEqual([
      "scene-edited:track-a",
      "scene-edited:track-b",
    ]);
    expect(
      Object.values(editedHarness.state.tracks).every(
        (track) => track.pendingTransition?.status === "pending",
      ),
    ).toBe(true);
    await editedController.syncPending();
    expect(editedStub.scheduled).toHaveLength(2);
    expect(editedStub.scheduled[1]?.every((request) => request.targetBeat === 4)).toBe(true);
    expect(
      editedStub.scheduled[1]?.find((request) => request.trackId === "track-a"),
    ).toMatchObject({
      kind: "launch",
      material: { notes: [expect.objectContaining({ velocity: 72 })] },
    });
    expect(editedStub.engine.stop).not.toHaveBeenCalled();
  });

  it("keeps transport stop pending until the engine owns or cancels the matching ID", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "StopTransport",
      transitionId: "stop-clock",
      requestedAtBeat: 0,
    });
    await controller.syncPending();
    expect(harness.state.transportStop?.status).toBe("scheduled");
    controller.cancelTransportStop("stop-clock");
    expect(harness.state.transportStop).toBeNull();
    expect(harness.state.phase).toBe("playing");
  });

  it("fails safe if an edited scene can only be cancelled partially", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchScene",
      transitionId: "scene-partial-cancel",
      sceneId: "scene-a",
      requestedAtBeat: 0,
      slots: [
        { trackId: "track-a", clipId: "clip-a1" },
        { trackId: "track-b", clipId: "clip-b1" },
      ],
    });
    await controller.syncPending();
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );
    stub.cancelFailures.add("scene-partial-cancel:track-b");

    controller.reconcileMaterial();

    expect(stub.cancelled).toEqual(["scene-partial-cancel:track-a"]);
    expect(stub.engine.stop).toHaveBeenCalledOnce();
    expect(harness.state.phase).toBe("idle");
    expect(harness.state.tracks).toEqual({});
    expect(harness.errors.at(-1)).toMatchObject({
      code: "invalid_state",
      message: expect.stringContaining("atomically requeue edited scene"),
    });
  });

  it("fails safe with a visible reason when an edited individual cannot be cancelled", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "individual-cancel-failure",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });
    await controller.syncPending();
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );
    stub.cancelFailures.add("individual-cancel-failure");

    controller.reconcileMaterial();

    expect(stub.engine.stop).toHaveBeenCalledOnce();
    expect(harness.state.phase).toBe("idle");
    expect(harness.errors.at(-1)).toMatchObject({
      code: "invalid_state",
      message: expect.stringContaining("individual-cancel-failure"),
    });
  });

  it("fails an edited scene if its target is reached during atomic cancellation", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchScene",
      transitionId: "scene-target-race",
      sceneId: "scene-a",
      requestedAtBeat: 0,
      slots: [
        { trackId: "track-a", clipId: "clip-a1" },
        { trackId: "track-b", clipId: "clip-b1" },
      ],
    });
    await controller.syncPending();
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );
    stub.beat = 3.9;
    stub.afterCancel = (transitionId) => {
      if (transitionId === "scene-target-race:track-a") stub.beat = 4;
    };

    controller.reconcileMaterial();

    expect(stub.cancelled).toEqual([
      "scene-target-race:track-a",
      "scene-target-race:track-b",
    ]);
    expect(harness.actions.at(-1)).toMatchObject({
      type: "ObserveSceneFailed",
      groupId: "scene-target-race",
      observedAtBeat: 4,
    });
    expect(
      Object.values(harness.state.tracks).every((track) => track.pendingTransition === null),
    ).toBe(true);
    expect(stub.scheduled).toHaveLength(1);
    expect(stub.engine.stop).not.toHaveBeenCalled();
  });

  it("cancels prepared engine work when material changes during async preparation", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "stale-launch",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });
    stub.beforeScheduleResolution = () => {
      harness.replaceState(createPerformanceState({ materialVersion: 8 }));
    };

    await controller.syncPending();

    expect(stub.cancelled).toEqual(["stale-launch"]);
    expect(harness.state.materialVersion).toBe(8);
    expect(harness.actions).not.toContainEqual(
      expect.objectContaining({ type: "ObserveTransitionCancelled" }),
    );
  });

  it("coalesces concurrent pending-sync passes into one engine schedule", async () => {
    let releaseSchedule!: () => void;
    const stub = new StubEngine();
    stub.scheduleGate = new Promise<void>((resolve) => {
      releaseSchedule = resolve;
    });
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "single-sync",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });

    const first = controller.syncPending();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "wake-up-sync",
      trackId: "track-b",
      clipId: "clip-b1",
      requestedAtBeat: 0,
    });
    const concurrent = controller.syncPending();
    expect(concurrent).toBe(first);
    releaseSchedule();
    await Promise.all([first, concurrent]);

    expect(stub.scheduled).toHaveLength(2);
    expect(harness.state.tracks["track-a"].pendingTransition?.status).toBe("scheduled");
    expect(harness.state.tracks["track-b"].pendingTransition?.status).toBe("scheduled");

    const emptyStub = new StubEngine();
    const emptyHarness = hostHarness();
    const emptyController = createLiveAudioController({
      engine: emptyStub.engine,
      host: emptyHarness.host,
    });
    await emptyController.start();
    const emptyPass = emptyController.syncPending();
    emptyHarness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "sync-after-empty-call",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });
    const wakeUpPass = emptyController.syncPending();
    expect(wakeUpPass).toBe(emptyPass);
    await Promise.all([emptyPass, wakeUpPass]);
    expect(emptyStub.scheduled).toHaveLength(1);
    expect(emptyHarness.state.tracks["track-a"].pendingTransition?.status).toBe(
      "scheduled",
    );
  });

  it("reschedules latest content when a Song edit lands during material preparation", async () => {
    let releaseSchedule!: () => void;
    const stub = new StubEngine();
    stub.scheduleGate = new Promise<void>((resolve) => {
      releaseSchedule = resolve;
    });
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "edit-during-prepare",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });

    const firstSync = controller.syncPending();
    await vi.waitFor(() => expect(stub.scheduled).toHaveLength(1));
    const firstMaterial = stub.scheduled[0]?.[0];
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );
    const dirtySync = controller.syncPending();
    expect(dirtySync).toBe(firstSync);
    releaseSchedule();
    await firstSync;

    expect(stub.scheduled).toHaveLength(2);
    expect(stub.cancelled).toEqual(["edit-during-prepare"]);
    expect(firstMaterial).toMatchObject({
      transitionId: "edit-during-prepare",
      targetBeat: 4,
      kind: "launch",
      material: { notes: [expect.objectContaining({ velocity: 100 })] },
    });
    expect(stub.scheduled[1]?.[0]).toMatchObject({
      transitionId: "edit-during-prepare",
      targetBeat: 4,
      kind: "launch",
      material: { notes: [expect.objectContaining({ velocity: 72 })] },
    });
    expect(harness.state.tracks["track-a"].pendingTransition?.status).toBe("scheduled");
    expect(stub.engine.stop).not.toHaveBeenCalled();
  });

  it("cancels engine ownership when the host does not acknowledge MarkScheduled", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({
      engine: stub.engine,
      host: {
        ...harness.host,
        dispatchPerformance(action) {
          if (action.type !== "MarkTransitionScheduled") {
            harness.host.dispatchPerformance(action);
          }
        },
      },
    });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "unacknowledged-launch",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });

    await controller.syncPending();

    expect(stub.cancelled).toEqual(["unacknowledged-launch"]);
    expect(harness.state.tracks["track-a"].pendingTransition?.status).toBe("pending");
    expect(harness.actions).not.toContainEqual(
      expect.objectContaining({ type: "ObserveTransitionCancelled" }),
    );
  });

  it("reserves emergency stop for fail-safe runtime reconciliation", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "pending-before-emergency",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });

    controller.emergencyStop();

    expect(stub.engine.stop).toHaveBeenCalledOnce();
    expect(harness.state.phase).toBe("idle");
    expect(harness.state.materialVersion).toBe(7);
    expect(harness.state.tracks).toEqual({});
    expect(harness.actions.at(-1)).toEqual({ type: "ResetPerformance" });
  });

  it("does not dispose a shared engine when the controller subscription closes", () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({
      engine: stub.engine,
      host: harness.host,
      engineOwnership: "shared",
    });

    controller.dispose();

    expect(stub.engine.dispose).not.toHaveBeenCalled();
  });

  it("rejects start if controller, Song, or runtime changes while unlock awaits", async () => {
    for (const mutation of ["dispose", "song", "runtime"] as const) {
      let releaseUnlock!: () => void;
      const stub = new StubEngine();
      stub.unlockGate = new Promise<void>((resolve) => {
        releaseUnlock = resolve;
      });
      const harness = hostHarness();
      const controller = createLiveAudioController({
        engine: stub.engine,
        host: harness.host,
        engineOwnership: "shared",
      });

      const starting = controller.start();
      if (mutation === "dispose") controller.dispose();
      if (mutation === "song") {
        harness.replaceSong({ ...harness.song, title: "Changed while unlocking" });
      }
      if (mutation === "runtime") {
        harness.replaceState(createPerformanceState({ materialVersion: 8 }));
      }
      releaseUnlock();

      await expect(starting).rejects.toMatchObject({
        detail: expect.objectContaining({
          code: mutation === "dispose" ? "disposed" : "invalid_state",
        }),
      });
      expect(stub.engine.start).not.toHaveBeenCalled();
      expect(stub.engine.stop).toHaveBeenCalledOnce();
      expect(stub.engine.dispose).not.toHaveBeenCalled();
    }
  });

  it("keeps revision-only changes stable and refreshes audible edits at the next loop", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "active-old-material",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });
    await controller.syncPending();
    const originalMaterial = resolveSongLiveMaterial(harness.song, 7, "track-a", "clip-a1");
    stub.beat = 4;
    stub.emit({
      type: "transition-executed",
      transitionId: "active-old-material",
      groupId: null,
      trackId: "track-a",
      targetBeat: 4,
      observedAtBeat: 4,
      materialId: originalMaterial.materialId,
      materialKind: "midi",
    });
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );

    controller.reconcileMaterial();

    expect(stub.engine.stop).not.toHaveBeenCalled();
    expect(harness.state.tracks["track-a"].pendingTransition).toBeNull();
    expect(harness.state.materialVersion).toBe(8);

    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 9,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );
    const refreshSync = controller.syncPending();
    expect(harness.state.tracks["track-a"]).toMatchObject({
      activeClipId: "clip-a1",
      pendingTransition: {
        kind: "launch",
        clipId: "clip-a1",
        requestedAtBeat: 4,
        targetBeat: 8,
        status: "pending",
      },
    });
    await refreshSync;
    expect(stub.scheduled.at(-1)?.[0]).toMatchObject({
      transitionId: harness.state.tracks["track-a"].pendingTransition?.id,
      targetBeat: 8,
      material: { notes: [expect.objectContaining({ velocity: 72 })] },
    });
    const refreshId = harness.state.tracks["track-a"].pendingTransition?.id;
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 64));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 10,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );
    await controller.syncPending();
    expect(stub.cancelled).toContain(refreshId);
    expect(stub.scheduled.at(-1)?.[0]).toMatchObject({
      transitionId: refreshId,
      targetBeat: 8,
      material: { notes: [expect.objectContaining({ velocity: 64 })] },
    });
    expect(stub.engine.stop).not.toHaveBeenCalled();
  });

  it("lets an existing user transition win over automatic active-material refresh", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "active-before-user-stop",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });
    await controller.syncPending();
    const material = resolveSongLiveMaterial(harness.song, 7, "track-a", "clip-a1");
    stub.beat = 4;
    stub.emit({
      type: "transition-executed",
      transitionId: "active-before-user-stop",
      groupId: null,
      trackId: "track-a",
      targetBeat: 4,
      observedAtBeat: 4,
      materialId: material.materialId,
      materialKind: "midi",
    });
    harness.host.dispatchPerformance({
      type: "StopTrack",
      transitionId: "user-stop-wins",
      trackId: "track-a",
      requestedAtBeat: 4,
    });
    await controller.syncPending();
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );

    controller.reconcileMaterial();

    expect(harness.state.tracks["track-a"]).toMatchObject({
      activeClipId: "clip-a1",
      pendingTransition: {
        id: "user-stop-wins",
        kind: "stop",
        targetBeat: 8,
        status: "scheduled",
      },
    });
    expect(
      harness.actions.filter((action) => action.type === "RefreshActiveClip"),
    ).toEqual([]);
    expect(stub.engine.stop).not.toHaveBeenCalled();
  });

  it("requeues edited scheduled material with the same ID and target", async () => {
    const stub = new StubEngine();
    const harness = hostHarness();
    const controller = createLiveAudioController({ engine: stub.engine, host: harness.host });
    await controller.start();
    harness.host.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "scheduled-old-material",
      trackId: "track-a",
      clipId: "clip-a1",
      requestedAtBeat: 0,
    });
    await controller.syncPending();
    harness.replaceSong(songWithNoteVelocity(harness.song, "track-a", 72));
    harness.replaceState(
      reconcilePerformanceMaterial(harness.state, {
        version: 8,
        clipIdsByTrack: {
          "track-a": ["clip-a1"],
          "track-b": ["clip-b1"],
        },
      }),
    );

    controller.reconcileMaterial();
    expect(stub.cancelled).toEqual(["scheduled-old-material"]);
    expect(harness.state.tracks["track-a"].pendingTransition).toMatchObject({
      id: "scheduled-old-material",
      targetBeat: 4,
      status: "pending",
    });
    expect(stub.engine.stop).not.toHaveBeenCalled();

    await controller.syncPending();
    expect(stub.scheduled).toHaveLength(2);
    expect(stub.scheduled[1]?.[0]).toMatchObject({
      transitionId: "scheduled-old-material",
      targetBeat: 4,
      material: { notes: [expect.objectContaining({ velocity: 72 })] },
    });
    expect(harness.state.tracks["track-a"].pendingTransition?.status).toBe("scheduled");
  });

  it("rejects non-instrument tracks through a structured future-adapter boundary", () => {
    const song: Song = {
      ...makeSong(),
      tracks: [
        {
          id: "audio-track",
          name: "Audio",
          kind: "audio",
          color: "#000",
          clips: [clip("audio-track", "audio-clip", 48)],
        },
      ],
    };
    expect(() => resolveSongLiveMaterial(song, 1, "audio-track", "audio-clip")).toThrow(
      /no registered live material adapter/,
    );
  });

  it("keys material by canonical audible content, not revision, names, IDs, or note order", () => {
    const song = makeSong();
    const track = song.tracks[0]!;
    const clipA = track.clips[0]!;
    const noteA = clipA.pattern.notes[0]!;
    const secondNote = {
      ...noteA,
      id: "second-note",
      pitch: noteA.pitch + 7,
      startBeat: 2,
    };
    const withTwoNotes: Song = {
      ...song,
      title: "First title",
      tracks: [
        {
          ...track,
          name: "First track name",
          clips: [
            {
              ...clipA,
              name: "First clip name",
              pattern: { ...clipA.pattern, notes: [noteA, secondNote] },
            },
          ],
        },
        song.tracks[1]!,
      ],
    };
    const reordered: Song = {
      ...withTwoNotes,
      title: "Renamed song",
      tracks: [
        {
          ...withTwoNotes.tracks[0]!,
          name: "Renamed track",
          clips: [
            {
              ...withTwoNotes.tracks[0]!.clips[0]!,
              name: "Renamed clip",
              pattern: {
                ...withTwoNotes.tracks[0]!.clips[0]!.pattern,
                notes: [
                  { ...secondNote, id: "replacement-second-id" },
                  { ...noteA, id: "replacement-first-id" },
                ],
              },
            },
          ],
        },
        withTwoNotes.tracks[1]!,
      ],
    };

    const first = resolveSongLiveMaterial(withTwoNotes, 1, "track-a", "clip-a1");
    const equivalent = resolveSongLiveMaterial(reordered, 999, "track-a", "clip-a1");
    expect(equivalent.materialId).toBe(first.materialId);
    expect(equivalent.version).toBe(first.version);
    expect(equivalent.notes.map((note) => note.pitch)).toEqual([48, 55]);

    const relocated: Song = {
      ...withTwoNotes,
      id: "other-song",
      tracks: [
        {
          ...withTwoNotes.tracks[0]!,
          id: "other-track",
          clips: [
            {
              ...withTwoNotes.tracks[0]!.clips[0]!,
              id: "other-clip",
              trackId: "other-track",
            },
          ],
        },
        withTwoNotes.tracks[1]!,
      ],
    };
    const relocatedMaterial = resolveSongLiveMaterial(
      relocated,
      2_000,
      "other-track",
      "other-clip",
    );
    expect(relocatedMaterial.materialId).toBe(first.materialId);
    expect(relocatedMaterial.clipId).toBe("other-clip");

    const audibleEdit = resolveSongLiveMaterial(
      songWithNoteVelocity(reordered, "track-a", 72),
      1_000,
      "track-a",
      "clip-a1",
    );
    expect(audibleEdit.materialId).not.toBe(first.materialId);
  });
});

function makeSong(): Song {
  return {
    schemaVersion: 2,
    id: "song-live",
    title: "Live controller",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [
      {
        id: "track-a",
        name: "A",
        kind: "instrument",
        instrumentId: "bass",
        color: "#111",
        clips: [clip("track-a", "clip-a1", 48)],
      },
      {
        id: "track-b",
        name: "B",
        kind: "instrument",
        instrumentId: "lead",
        color: "#222",
        clips: [clip("track-b", "clip-b1", 60)],
      },
    ],
  };
}

function clip(trackId: string, clipId: string, pitch: number) {
  return {
    id: clipId,
    trackId,
    name: clipId,
    startBeat: 0,
    lengthBeats: 4,
    pattern: {
      lengthBeats: 4,
      notes: [{ id: `${clipId}-note`, pitch, velocity: 100, startBeat: 0, lengthBeats: 1 }],
    },
  };
}

function songWithNoteVelocity(song: Song, trackId: string, velocity: number): Song {
  return {
    ...song,
    tracks: song.tracks.map((track) =>
      track.id !== trackId
        ? track
        : {
            ...track,
            clips: track.clips.map((clip) => ({
              ...clip,
              pattern: {
                ...clip.pattern,
                notes: clip.pattern.notes.map((note) => ({ ...note, velocity })),
              },
            })),
          },
    ),
  };
}
