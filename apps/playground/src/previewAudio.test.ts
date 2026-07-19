import { describe, expect, it, vi } from "vitest";

import type {
  LiveAudioEngine,
  LiveAudioObservation,
  LiveTransitionRequest,
} from "@beat-twin/audio-tone";

import {
  buildPreviewAudition,
  createPreviewAudioEngineFromLiveRuntime,
} from "./previewAudio";
import { createBrowserAudioLeaseCoordinator } from "./browserAudioRuntime";

describe("preview live-audio compatibility", () => {
  it("schedules preview material through the shared live engine before transport start", async () => {
    const calls: string[] = [];
    let phase: ReturnType<LiveAudioEngine["getSnapshot"]>["phase"] = "new";
    const engine: LiveAudioEngine = {
      initialize: vi.fn(() => {
        calls.push("initialize");
        phase = "initialized";
      }),
      reset: vi.fn(() => calls.push("reset")),
      unlock: vi.fn(async () => {
        calls.push("unlock");
        phase = "ready";
      }),
      scheduleTransitions: vi.fn(async (requests: readonly LiveTransitionRequest[]) => {
        calls.push(`schedule:${requests.length}`);
        return { ok: true as const, transitionIds: requests.map((request) => request.transitionId) };
      }),
      start: vi.fn(() => {
        calls.push("start");
        phase = "running";
      }),
      suspend: vi.fn(),
      resume: vi.fn(),
      cancelTransition: vi.fn(() => false),
      scheduleTransportStop: vi.fn(() => ({ ok: true as const, transitionIds: ["stop"] })),
      cancelTransportStop: vi.fn(() => false),
      stop: vi.fn(() => {
        calls.push("stop");
        phase = "stopped";
      }),
      dispose: vi.fn(),
      getSnapshot: () => ({
        phase,
        bpm: 120,
        currentBeat: 0,
        activeMaterialByTrack: {},
        activeStartedAtBeatByTrack: {},
        activeLengthBeatsByTrack: {},
        pendingTransitionByTrack: {},
        pendingMaterialByTrack: {},
        error: null,
      }),
      subscribe: (_listener: (observation: LiveAudioObservation) => void) => () => undefined,
    };
    const coordinator = createBrowserAudioLeaseCoordinator(async () => engine);
    const preview = createPreviewAudioEngineFromLiveRuntime({
      acquireLease: () => coordinator.acquire("preview"),
    });
    const audition = buildPreviewAudition(song(), "track-a", "clip-a");
    expect(audition).not.toBeNull();

    await preview.play(audition!);

    expect(calls).toEqual(["initialize", "reset", "unlock", "schedule:1", "start"]);
    expect(engine.scheduleTransitions).toHaveBeenCalledWith([
      expect.objectContaining({
        kind: "launch",
        trackId: "preview:track-a",
        targetBeat: 0,
        material: expect.objectContaining({
          kind: "midi",
          clipId: "clip-a",
          instrumentId: "bass",
          version: 0,
        }),
      }),
    ]);
    expect(coordinator.getOwner()).toBe("preview");
    await expect(coordinator.acquire("live")).rejects.toMatchObject({
      detail: expect.objectContaining({ code: "invalid_state" }),
    });

    await preview.stop();
    expect(coordinator.getOwner()).toBeNull();
    const liveLease = await coordinator.acquire("live");
    expect(liveLease.engine).toBe(engine);
    liveLease.release();

    const firstRapidPlay = preview.play(audition!);
    const latestAudition = {
      ...audition!,
      song: { ...audition!.song, id: "latest-preview-song" },
    };
    const latestRapidPlay = preview.play(latestAudition);
    await Promise.all([firstRapidPlay, latestRapidPlay]);

    const lastBatch = vi.mocked(engine.scheduleTransitions).mock.calls.at(-1)?.[0];
    const lastRequest = lastBatch?.[0];
    expect(lastRequest?.kind).toBe("launch");
    if (lastRequest?.kind === "launch") {
      expect(lastRequest.material.materialId).toContain("latest-preview-song");
    }
    expect(coordinator.getOwner()).toBe("preview");
    await preview.stop();
  });
});

function song() {
  return {
    schemaVersion: 2 as const,
    id: "preview-song",
    title: "Preview",
    transport: {
      bpm: 120,
      positionBeats: 0,
      isPlaying: false,
      isRecording: false,
    },
    tracks: [{
      id: "track-a",
      name: "A",
      kind: "instrument" as const,
      instrumentId: "bass" as const,
      color: "#111",
      clips: [{
        id: "clip-a",
        trackId: "track-a",
        name: "Clip A",
        startBeat: 0,
        lengthBeats: 4,
        pattern: {
          lengthBeats: 4,
          notes: [{ id: "note-a", pitch: 48, velocity: 100, startBeat: 0, lengthBeats: 1 }],
        },
      }],
    }],
  };
}
