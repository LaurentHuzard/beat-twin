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
  readonly pendingTransitions: Record<string, string> = {};
  readonly pendingMaterials: Record<string, string | null> = {};
  beat = 0;
  beforeScheduleResolution: (() => void) | null = null;
  scheduleGate: Promise<void> | null = null;
  unlockGate: Promise<void> | null = null;
  scheduleError: LiveAudioError | null = null;
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
      } else {
        delete this.activeMaterials[observation.trackId];
      }
    }
    for (const listener of this.listeners) listener(observation);
  }
}

function hostHarness() {
  let song = makeSong();
  let state = createPerformanceState({ materialVersion: 7 });
  const actions: PerformanceAction[] = [];
  return {
    song,
    actions,
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
    },
  };
}

describe("live audio controller", () => {
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
    expect(harness.state.tracks["track-a"].pendingTransition?.status).toBe("scheduled");
    expect(stub.scheduled[0]?.[0]).toMatchObject({
      transitionId: "launch-a",
      trackId: "track-a",
      material: {
        kind: "midi",
        materialId: "song-live:track-a:clip-a1@7",
        version: 7,
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
      materialId: "song-live:track-a:clip-a1@7",
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

    const partialStub = new StubEngine();
    const partialHarness = hostHarness();
    const partialController = createLiveAudioController({
      engine: partialStub.engine,
      host: partialHarness.host,
    });
    await partialController.start();
    partialHarness.host.dispatchPerformance({
      type: "LaunchScene",
      transitionId: "scene-partial",
      sceneId: "scene-c",
      requestedAtBeat: 0,
      slots: [
        { trackId: "track-a", clipId: "clip-a1" },
        { trackId: "track-b", clipId: "clip-b1" },
      ],
    });
    await partialController.syncPending();
    delete partialStub.pendingTransitions["track-a"];
    delete partialStub.pendingMaterials["track-a"];

    partialController.reconcileMaterial();

    expect(partialStub.cancelled).toContain("scene-partial:track-b");
    expect(
      Object.values(partialHarness.state.tracks).every(
        (track) => track.pendingTransition === null,
      ),
    ).toBe(true);
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

  it("fails closed when an active source belongs to an older material revision", async () => {
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
    stub.beat = 4;
    stub.emit({
      type: "transition-executed",
      transitionId: "active-old-material",
      groupId: null,
      trackId: "track-a",
      targetBeat: 4,
      observedAtBeat: 4,
      materialId: "song-live:track-a:clip-a1@7",
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

    expect(stub.engine.stop).toHaveBeenCalledOnce();
    expect(harness.state.phase).toBe("idle");
    expect(harness.state.materialVersion).toBe(8);
    expect(harness.state.tracks).toEqual({});
  });

  it("cancels scheduled material from an older revision and ignores stale observations", async () => {
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
    expect(stub.cancelled).toContain("scheduled-old-material");
    expect(harness.state.tracks["track-a"].pendingTransition).toBeNull();

    expect(() => {
      stub.emit({
        type: "transition-executed",
        transitionId: "stale-execution",
        groupId: null,
        trackId: "track-a",
        targetBeat: 4,
        observedAtBeat: 4,
        materialId: "song-live:track-a:clip-a1@7",
        materialKind: "midi",
      });
    }).not.toThrow();
    expect(stub.engine.stop).toHaveBeenCalledOnce();
    expect(harness.state.phase).toBe("idle");
    expect(harness.state.tracks).toEqual({});
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
