import { describe, expect, it, vi } from "vitest";

import {
  createLiveAudioEngine,
  type LiveAudioEngine,
  type LiveAudioEnginePhase,
  type LiveAudioPort,
} from "@beat-twin/audio-tone";
import type { Song } from "@beat-twin/core";

import { createBrowserLiveAudioController } from "./browserAudioRuntime";
import {
  createPerformanceState,
  reducePerformanceState,
  type PerformanceAction,
} from "./performanceRuntime";

describe("browser live audio controller", () => {
  it("preserves one timestamped scheduled stop when disposed after its observation", async () => {
    let beat = 0;
    let nextHandle = 0;
    let scheduledStop: ((audioTime: number) => void) | null = null;
    const stopTimes: Array<number | undefined> = [];
    const release = vi.fn();
    const port: LiveAudioPort = {
      unlock: vi.fn(async () => undefined),
      setBpm: vi.fn(),
      currentBeat: () => beat,
      scheduleAtBeat: (_targetBeat, callback) => {
        nextHandle += 1;
        scheduledStop = callback;
        return nextHandle;
      },
      scheduleRepeatAtBeat: () => {
        throw new Error("material scheduling is outside this transport-stop test");
      },
      cancel: vi.fn(),
      start: (atBeat) => {
        beat = atBeat;
      },
      suspend: vi.fn(),
      resume: vi.fn(),
      stop: (audioTime) => {
        stopTimes.push(audioTime);
      },
      reset: vi.fn(),
      createTrackBus: (trackId) => ({ trackId, dispose: vi.fn() }),
      dispose: vi.fn(),
    };
    const engine = createLiveAudioEngine({
      port,
      prepareMaterial: async () => {
        throw new Error("material preparation is outside this transport-stop test");
      },
    });
    const harness = hostHarness();
    const controller = await createBrowserLiveAudioController(
      harness.host,
      async () => ({ owner: "live", engine, release }),
    );
    await controller.start();
    harness.host.dispatchPerformance({
      type: "StopTransport",
      transitionId: "scheduled-stop",
      requestedAtBeat: 0,
      quantization: "beat",
    });
    await controller.syncPending();

    expect(harness.state.transportStop).toMatchObject({
      id: "scheduled-stop",
      status: "scheduled",
      targetBeat: 1,
    });
    beat = 1;
    expect(scheduledStop).not.toBeNull();
    requireScheduledStop(scheduledStop)(7.25);

    expect(engine.getSnapshot().phase).toBe("stopped");
    expect(harness.state.phase).toBe("idle");
    expect(stopTimes).toEqual([7.25]);

    controller.dispose();

    expect(stopTimes).toEqual([7.25]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("emergency-stops only phases that can still own runtime work", async () => {
    const activePhases: readonly LiveAudioEnginePhase[] = [
      "initialized",
      "blocked",
      "ready",
      "running",
      "suspended",
    ];
    const terminalPhases: readonly LiveAudioEnginePhase[] = [
      "new",
      "stopped",
      "disposed",
    ];

    for (const phase of [...activePhases, ...terminalPhases]) {
      const stop = vi.fn();
      const release = vi.fn();
      const engine = phaseEngine(phase, stop);
      const harness = hostHarness();
      const controller = await createBrowserLiveAudioController(
        harness.host,
        async () => ({ owner: "live", engine, release }),
      );

      controller.dispose();

      expect(stop, phase).toHaveBeenCalledTimes(activePhases.includes(phase) ? 1 : 0);
      expect(release, phase).toHaveBeenCalledOnce();
    }
  });
});

function hostHarness() {
  let state = createPerformanceState();
  const song: Song = {
    schemaVersion: 2,
    id: "browser-runtime-stop",
    title: "Browser runtime stop",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [],
  };
  return {
    get state() {
      return state;
    },
    host: {
      getSong: () => song,
      getPerformanceState: () => state,
      dispatchPerformance(action: PerformanceAction) {
        state = reducePerformanceState(state, action);
      },
    },
  };
}

function phaseEngine(
  phase: LiveAudioEnginePhase,
  stop: () => void,
): LiveAudioEngine {
  return {
    initialize: vi.fn(),
    unlock: vi.fn(async () => undefined),
    start: vi.fn(),
    suspend: vi.fn(),
    resume: vi.fn(),
    scheduleTransitions: vi.fn(async () => ({ ok: true as const, transitionIds: [] })),
    cancelTransition: vi.fn(() => false),
    scheduleTransportStop: vi.fn(() => ({ ok: true as const, transitionIds: [] })),
    cancelTransportStop: vi.fn(() => false),
    stop,
    reset: vi.fn(),
    dispose: vi.fn(),
    getSnapshot: () => ({
      phase,
      bpm: phase === "new" ? null : 120,
      currentBeat: 0,
      activeMaterialByTrack: {},
      pendingTransitionByTrack: {},
      pendingMaterialByTrack: {},
      error: null,
    }),
    subscribe: () => () => undefined,
  };
}

function requireScheduledStop(
  callback: ((audioTime: number) => void) | null,
): (audioTime: number) => void {
  if (!callback) throw new Error("expected scheduled transport stop callback");
  return callback;
}
