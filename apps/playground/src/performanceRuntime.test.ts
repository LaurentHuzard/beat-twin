import { describe, expect, it } from "vitest";

import {
  createPerformanceState,
  reconcilePerformanceMaterial,
  reducePerformanceState,
  resetPerformanceForMaterial,
  resolveLaunchTargetBeat,
  type PerformanceState,
} from "./performanceRuntime";

function reduce(
  state: PerformanceState,
  ...actions: Parameters<typeof reducePerformanceState>[1][]
): PerformanceState {
  return actions.reduce(reducePerformanceState, state);
}

function activeTrack(
  state: PerformanceState,
  trackId: string,
  clipId: string,
  transitionId = `${trackId}-launch`,
): PerformanceState {
  return reduce(
    state,
    {
      type: "LaunchClip",
      transitionId,
      trackId,
      clipId,
      requestedAtBeat: state.currentBeat,
      quantization: "immediate",
    },
    { type: "MarkTransitionScheduled", trackId, transitionId },
    {
      type: "ObserveTransitionExecuted",
      trackId,
      transitionId,
      observedAtBeat: state.currentBeat,
    },
  );
}

describe("performance launch quantization", () => {
  it("keeps immediate requests exact", () => {
    expect(resolveLaunchTargetBeat(0, "immediate")).toBe(0);
    expect(resolveLaunchTargetBeat(3.999_999, "immediate")).toBe(3.999_999);
    expect(resolveLaunchTargetBeat(4, "immediate")).toBe(4);
  });

  it("resolves beat quantization to a strictly future stable boundary", () => {
    expect(resolveLaunchTargetBeat(0, "beat")).toBe(1);
    expect(resolveLaunchTargetBeat(0.999_999, "beat")).toBe(1);
    expect(resolveLaunchTargetBeat(1, "beat")).toBe(2);
    expect(resolveLaunchTargetBeat(4.000_001, "beat")).toBe(5);
  });

  it("resolves bar quantization at and just before boundaries", () => {
    expect(resolveLaunchTargetBeat(0, "bar")).toBe(4);
    expect(resolveLaunchTargetBeat(3.999_999, "bar")).toBe(4);
    expect(resolveLaunchTargetBeat(4, "bar")).toBe(8);
    expect(resolveLaunchTargetBeat(7.999_999, "bar")).toBe(8);
    expect(resolveLaunchTargetBeat(6, "bar", 3)).toBe(9);
  });
});

describe("performance transport", () => {
  it("starts, queues stop, advances without optimistic stop, then observes stop", () => {
    let state = reducePerformanceState(createPerformanceState(), {
      type: "StartTransport",
      atBeat: 0,
    });
    expect(state.phase).toBe("playing");

    state = reducePerformanceState(state, {
      type: "StopTransport",
      transitionId: "transport-stop-1",
      requestedAtBeat: 1.25,
    });
    expect(state.phase).toBe("stopping");
    expect(state.transportStop).toEqual({
      id: "transport-stop-1",
      requestedAtBeat: 1.25,
      targetBeat: 4,
      status: "pending",
    });

    state = reducePerformanceState(state, { type: "AdvanceClock", beat: 4 });
    expect(state.phase).toBe("stopping");
    expect(() =>
      reducePerformanceState(state, {
        type: "ObserveTransportStopped",
        transitionId: "transport-stop-1",
        observedAtBeat: 3.99,
      }),
    ).toThrow(/must be scheduled/);

    state = reducePerformanceState(state, {
      type: "MarkTransportStopScheduled",
      transitionId: "transport-stop-1",
    });
    state = reducePerformanceState(state, {
      type: "ObserveTransportStopped",
      transitionId: "transport-stop-1",
      observedAtBeat: 4,
    });
    expect(state.phase).toBe("idle");
    expect(state.transportStop).toBeNull();
    expect(state.currentBar).toBe(2);
  });

  it("rejects a clock or request that moves behind the observed beat", () => {
    const state = reduce(createPerformanceState(), {
      type: "StartTransport",
      atBeat: 8,
    });
    expect(() =>
      reducePerformanceState(state, { type: "AdvanceClock", beat: 7.99 }),
    ).toThrow(/cannot move backward/);
    expect(() =>
      reducePerformanceState(state, { type: "StartTransport", atBeat: 7 }),
    ).toThrow(/cannot start behind/);
    expect(() =>
      reducePerformanceState(state, {
        type: "LaunchClip",
        transitionId: "late",
        trackId: "track-a",
        clipId: "clip-a",
        requestedAtBeat: 7,
      }),
    ).toThrow(/before current beat/);
  });

  it("keeps start idempotent while playing and preserves stopping until explicit cancellation", () => {
    let state = reduce(createPerformanceState(),
      { type: "StartTransport", atBeat: 4 },
      { type: "AdvanceClock", beat: 6 },
    );
    expect(reducePerformanceState(state, { type: "StartTransport", atBeat: 9 })).toBe(state);

    state = reducePerformanceState(state, {
      type: "StopTransport",
      transitionId: "transport-stop-cancel",
      requestedAtBeat: 6,
    });
    const stopping = state;
    expect(reducePerformanceState(state, { type: "StartTransport", atBeat: 7 })).toBe(stopping);
    state = reducePerformanceState(state, {
      type: "MarkTransportStopScheduled",
      transitionId: "transport-stop-cancel",
    });
    expect(() =>
      reducePerformanceState(state, {
        type: "CancelPendingTransportStop",
        transitionId: "transport-stop-cancel",
        cancelledAtBeat: 7,
      }),
    ).toThrow(/scheduled, expected pending/);
    expect(() =>
      reducePerformanceState(state, {
        type: "ObserveTransportStopCancelled",
        transitionId: "wrong-stop-id",
        observedAtBeat: 7,
      }),
    ).toThrow(/does not match/);
    state = reducePerformanceState(state, {
      type: "ObserveTransportStopCancelled",
      transitionId: "transport-stop-cancel",
      observedAtBeat: 7,
    });
    expect(state.phase).toBe("playing");
    expect(state.currentBeat).toBe(6);
  });

  it("cancels only a matching pending transport stop and reserves its ID", () => {
    let state = reduce(createPerformanceState(),
      { type: "StartTransport", atBeat: 0 },
      {
        type: "StopTransport",
        transitionId: "pending-stop",
        requestedAtBeat: 1,
      },
    );
    const retry = reducePerformanceState(state, {
      type: "StopTransport",
      transitionId: "pending-stop",
      requestedAtBeat: 1,
    });
    expect(retry).toBe(state);
    expect(state.transitionIds["pending-stop"]).toBe(true);
    expect(() =>
      reducePerformanceState(state, {
        type: "StopTransport",
        transitionId: "replacement-stop",
        requestedAtBeat: 1,
      }),
    ).toThrow(/already open/);
    state = reducePerformanceState(state, {
      type: "CancelPendingTransportStop",
      transitionId: "pending-stop",
      cancelledAtBeat: 1.5,
    });
    expect(state.phase).toBe("playing");
    expect(state.transportStop).toBeNull();
  });
});

describe("performance clip transitions", () => {
  it("does not claim a clip active until the matching engine observation", () => {
    let state = reduce(createPerformanceState(),
      { type: "StartTransport", atBeat: 0 },
      {
        type: "LaunchClip",
        transitionId: "launch-a",
        trackId: "track-a",
        clipId: "clip-a",
        requestedAtBeat: 1.25,
      },
    );
    expect(state.tracks["track-a"]).toMatchObject({
      activeClipId: null,
      pendingTransition: {
        id: "launch-a",
        status: "pending",
        targetBeat: 4,
      },
    });

    state = reducePerformanceState(state, { type: "AdvanceClock", beat: 4 });
    expect(state.tracks["track-a"].activeClipId).toBeNull();
    expect(() =>
      reducePerformanceState(state, {
        type: "ObserveTransitionExecuted",
        trackId: "track-a",
        transitionId: "launch-a",
        observedAtBeat: 4,
      }),
    ).toThrow(/must be scheduled/);

    state = reduce(state,
      {
        type: "MarkTransitionScheduled",
        trackId: "track-a",
        transitionId: "launch-a",
      },
      {
        type: "ObserveTransitionExecuted",
        trackId: "track-a",
        transitionId: "launch-a",
        observedAtBeat: 4,
      },
    );
    expect(state.tracks["track-a"]).toMatchObject({
      activeClipId: "clip-a",
      activeTransitionId: "launch-a",
      pendingTransition: null,
      lastResolvedTransition: {
        id: "launch-a",
        status: "executed",
        observedAtBeat: 4,
      },
    });
  });

  it("retries only the exact same ID and replaces a distinct pending request", () => {
    let state = reducePerformanceState(createPerformanceState(), {
      type: "LaunchClip",
      transitionId: "launch-a",
      trackId: "track-a",
      clipId: "clip-a",
      requestedAtBeat: 1,
    });
    const retry = reducePerformanceState(state, {
      type: "LaunchClip",
      transitionId: "launch-a",
      trackId: "track-a",
      clipId: "clip-a",
      requestedAtBeat: 1,
    });
    expect(retry).toBe(state);

    expect(() =>
      reducePerformanceState(state, {
        type: "LaunchClip",
        transitionId: "launch-a",
        trackId: "track-a",
        clipId: "clip-b",
        requestedAtBeat: 1,
      }),
    ).toThrow(/already in use/);

    state = reducePerformanceState(state, {
      type: "LaunchClip",
      transitionId: "duplicate-request",
      trackId: "track-a",
      clipId: "clip-a",
      requestedAtBeat: 1,
    });
    expect(state.tracks["track-a"]).toMatchObject({
      activeClipId: null,
      pendingTransition: { id: "duplicate-request", clipId: "clip-a", targetBeat: 4 },
      lastResolvedTransition: {
        id: "launch-a",
        status: "cancelled",
        reason: "replaced",
      },
    });
  });

  it("requires scheduled work to be acknowledged as cancelled before replacement", () => {
    let state = reduce(createPerformanceState(),
      {
        type: "LaunchClip",
        transitionId: "launch-a",
        trackId: "track-a",
        clipId: "clip-a",
        requestedAtBeat: 1,
      },
      {
        type: "MarkTransitionScheduled",
        trackId: "track-a",
        transitionId: "launch-a",
      },
    );
    expect(() =>
      reducePerformanceState(state, {
        type: "LaunchClip",
        transitionId: "launch-b",
        trackId: "track-a",
        clipId: "clip-b",
        requestedAtBeat: 2,
      }),
    ).toThrow(/requires engine cancellation observation/);

    expect(() =>
      reducePerformanceState(state, {
        type: "CancelPendingTransition",
        trackId: "track-a",
        transitionId: "launch-a",
        cancelledAtBeat: 2,
      }),
    ).toThrow(/scheduled, expected pending/);

    state = reduce(state,
      {
        type: "ObserveTransitionCancelled",
        trackId: "track-a",
        transitionId: "launch-a",
        observedAtBeat: 2,
      },
      {
        type: "LaunchClip",
        transitionId: "launch-b",
        trackId: "track-a",
        clipId: "clip-b",
        requestedAtBeat: 2,
      },
    );
    expect(state.tracks["track-a"].pendingTransition?.id).toBe("launch-b");
  });

  it("queues and observes a track stop without touching another active track", () => {
    let state = activeTrack(createPerformanceState(), "track-a", "clip-a");
    state = activeTrack(state, "track-b", "clip-b");
    const trackBBefore = state.tracks["track-b"];

    state = reduce(state,
      {
        type: "StopTrack",
        transitionId: "stop-a",
        trackId: "track-a",
        requestedAtBeat: 0.25,
      },
      {
        type: "MarkTransitionScheduled",
        trackId: "track-a",
        transitionId: "stop-a",
      },
    );
    expect(state.tracks["track-a"].activeClipId).toBe("clip-a");
    expect(state.tracks["track-a"].pendingTransition).toMatchObject({
      kind: "stop",
      status: "scheduled",
      targetBeat: 4,
    });

    state = reducePerformanceState(state, {
      type: "ObserveTransitionExecuted",
      trackId: "track-a",
      transitionId: "stop-a",
      observedAtBeat: 4,
    });
    expect(state.tracks["track-a"].activeClipId).toBeNull();
    expect(state.tracks["track-b"]).toBe(trackBBefore);
    expect(state.tracks["track-b"].activeClipId).toBe("clip-b");
  });

  it("keeps the old active clip when scheduling fails", () => {
    let state = activeTrack(createPerformanceState(), "track-a", "clip-a");
    state = reduce(state,
      {
        type: "LaunchClip",
        transitionId: "launch-b",
        trackId: "track-a",
        clipId: "clip-b",
        requestedAtBeat: 1,
      },
      {
        type: "ObserveTransitionFailed",
        trackId: "track-a",
        transitionId: "launch-b",
        observedAtBeat: 1.1,
        error: "engine rejected schedule",
      },
    );
    expect(state.tracks["track-a"].activeClipId).toBe("clip-a");
    expect(state.tracks["track-a"].lastResolvedTransition).toMatchObject({
      id: "launch-b",
      status: "failed",
      error: "engine rejected schedule",
    });
  });

  it("never lets two launches on one track become active together", () => {
    let state = activeTrack(createPerformanceState(), "track-a", "clip-a");
    state = reduce(state,
      {
        type: "LaunchClip",
        transitionId: "launch-b",
        trackId: "track-a",
        clipId: "clip-b",
        requestedAtBeat: 1,
      },
      {
        type: "MarkTransitionScheduled",
        trackId: "track-a",
        transitionId: "launch-b",
      },
      {
        type: "ObserveTransitionExecuted",
        trackId: "track-a",
        transitionId: "launch-b",
        observedAtBeat: 4,
      },
    );
    expect(state.tracks["track-a"].activeClipId).toBe("clip-b");
    expect(state.tracks["track-a"].activeTransitionId).toBe("launch-b");
    expect(state.tracks["track-a"].pendingTransition).toBeNull();
  });

  it("never rebinds a previously claimed transition ID", () => {
    let state = activeTrack(
      createPerformanceState(),
      "track-a",
      "clip-a",
      "stable-transition",
    );
    expect(() =>
      reducePerformanceState(state, {
        type: "LaunchClip",
        transitionId: "stable-transition",
        trackId: "track-b",
        clipId: "clip-b",
        requestedAtBeat: 1,
      }),
    ).toThrow(/already in use/);

    state = reducePerformanceState(state, { type: "ResetPerformance" });
    expect(state.transitionIds).toEqual({});
  });
});

describe("performance scenes, recording, and mix", () => {
  it("queues one shared scene boundary without cross-track interference", () => {
    let state = reducePerformanceState(createPerformanceState(), {
      type: "SetTrackLevel",
      trackId: "track-b",
      level: 0.7,
    });
    state = reducePerformanceState(state, {
      type: "LaunchScene",
      transitionId: "scene-transition",
      sceneId: "scene-2",
      requestedAtBeat: 1.5,
      slots: [
        { trackId: "track-a", clipId: "clip-a2" },
        { trackId: "track-b", clipId: "clip-b2" },
      ],
    });
    expect(state.tracks["track-a"].pendingTransition).toMatchObject({
      id: "scene-transition:track-a",
      sceneId: "scene-2",
      groupId: "scene-transition",
      targetBeat: 4,
    });
    expect(state.tracks["track-b"].pendingTransition).toMatchObject({
      id: "scene-transition:track-b",
      sceneId: "scene-2",
      groupId: "scene-transition",
      targetBeat: 4,
    });
    expect(state.tracks["track-b"].level).toBe(0.7);
    expect(state.transitionIds["scene-transition"]).toBe(true);
  });

  it("prevalidates scene groups atomically and prevents parent reuse on disjoint tracks", () => {
    const initial = createPerformanceState();
    expect(() =>
      reducePerformanceState(initial, {
        type: "LaunchScene",
        transitionId: "scene-group",
        sceneId: "scene-a",
        requestedAtBeat: 1,
        slots: [
          { trackId: "track-a", clipId: "clip-a" },
          { trackId: "", clipId: "clip-b" },
        ],
      }),
    ).toThrow(/trackId/);
    expect(initial.transitionIds).toEqual({});
    expect(initial.tracks).toEqual({});

    const state = reducePerformanceState(initial, {
      type: "LaunchScene",
      transitionId: "scene-group",
      sceneId: "scene-a",
      requestedAtBeat: 1,
      slots: [{ trackId: "track-a", clipId: "clip-a" }],
    });
    expect(() =>
      reducePerformanceState(state, {
        type: "LaunchScene",
        transitionId: "scene-group",
        sceneId: "scene-b",
        requestedAtBeat: 1,
        slots: [{ trackId: "track-b", clipId: "clip-b" }],
      }),
    ).toThrow(/groupId scene-group is already in use/);
  });

  it("schedules and cancels a scene only through atomic group acknowledgements", () => {
    let state = reducePerformanceState(createPerformanceState(), {
      type: "LaunchScene",
      transitionId: "scene-group",
      sceneId: "scene-a",
      requestedAtBeat: 1,
      slots: [
        { trackId: "track-a", clipId: "clip-a" },
        { trackId: "track-b", clipId: "clip-b" },
      ],
    });
    expect(() =>
      reducePerformanceState(state, {
        type: "MarkTransitionScheduled",
        trackId: "track-a",
        transitionId: "scene-group:track-a",
      }),
    ).toThrow(/use MarkSceneScheduled/);

    state = reducePerformanceState(state, {
      type: "MarkSceneScheduled",
      groupId: "scene-group",
    });
    expect(state.tracks["track-a"].pendingTransition?.status).toBe("scheduled");
    expect(state.tracks["track-b"].pendingTransition?.status).toBe("scheduled");
    expect(() =>
      reducePerformanceState(state, {
        type: "ObserveTransitionCancelled",
        trackId: "track-a",
        transitionId: "scene-group:track-a",
        observedAtBeat: 2,
      }),
    ).toThrow(/use ObserveSceneCancelled/);

    state = reducePerformanceState(state, {
      type: "ObserveSceneCancelled",
      groupId: "scene-group",
      observedAtBeat: 2,
    });
    expect(state.tracks["track-a"].pendingTransition).toBeNull();
    expect(state.tracks["track-b"].pendingTransition).toBeNull();
    expect(state.tracks["track-a"].lastResolvedTransition).toMatchObject({
      groupId: "scene-group",
      status: "cancelled",
      reason: "engine",
    });
  });

  it("moves recording and overdub state through explicit slot transitions", () => {
    let state = reduce(createPerformanceState(),
      {
        type: "ArmRecordSlot",
        trackId: "track-a",
        slotId: "slot-a1",
        clipId: null,
      },
      { type: "StartRecording", trackId: "track-a" },
    );
    expect(state.recording).toEqual({
      phase: "recording",
      trackId: "track-a",
      slotId: "slot-a1",
      clipId: null,
    });
    expect(() =>
      reducePerformanceState(state, {
        type: "ArmRecordSlot",
        trackId: "track-b",
        slotId: "slot-b1",
        clipId: null,
      }),
    ).toThrow(/while recording/);
    state = reducePerformanceState(state, { type: "StopRecording", trackId: "track-a" });
    expect(state.recording.phase).toBe("idle");

    state = activeTrack(state, "track-a", "clip-a");
    expect(() =>
      reducePerformanceState(state, {
        type: "StartOverdub",
        trackId: "track-a",
        slotId: "slot-a1",
        clipId: "clip-a",
      }),
    ).toThrow(/transport must be playing/);
    state = reduce(state,
      { type: "StartTransport", atBeat: state.currentBeat },
      {
        type: "StartOverdub",
        trackId: "track-a",
        slotId: "slot-a1",
        clipId: "clip-a",
      },
      { type: "StopOverdub", trackId: "track-a" },
    );
    expect(state.recording.phase).toBe("idle");
  });

  it("sets bounded mixer and macro values without changing another track", () => {
    let state = reducePerformanceState(createPerformanceState(), {
      type: "SetTrackLevel",
      trackId: "track-b",
      level: 0.8,
    });
    const trackBBefore = state.tracks["track-b"];
    state = reduce(state,
      { type: "SetTrackLevel", trackId: "track-a", level: 0.35 },
      { type: "SetTrackMute", trackId: "track-a", muted: true },
      { type: "SetTrackSolo", trackId: "track-a", soloed: true },
      { type: "SetMacro", macro: "echo", value: 0.6 },
    );
    expect(state.tracks["track-a"]).toMatchObject({
      level: 0.35,
      muted: true,
      soloed: true,
    });
    expect(state.tracks["track-b"]).toBe(trackBBefore);
    expect(state.macros.echo).toBe(0.6);
    expect(() =>
      reducePerformanceState(state, {
        type: "SetTrackLevel",
        trackId: "track-a",
        level: 1.1,
      }),
    ).toThrow(/between 0 and 1/);
    expect(() =>
      reducePerformanceState(state, { type: "SetMacro", macro: "tone", value: -0.1 }),
    ).toThrow(/between 0 and 1/);
    expect(() =>
      reducePerformanceState(state, {
        type: "SetTrackMute",
        trackId: "track-a",
        muted: "yes" as unknown as boolean,
      }),
    ).toThrow(/must be a boolean/);
    expect(() =>
      reducePerformanceState(state, {
        type: "SetTrackSolo",
        trackId: "track-a",
        soloed: 1 as unknown as boolean,
      }),
    ).toThrow(/must be a boolean/);
    expect(() =>
      reducePerformanceState(state, {
        type: "SetMacro",
        macro: "unknown" as "tone",
        value: 0.5,
      }),
    ).toThrow(/unknown performance macro/);
  });

  it("resets the runtime without retaining musical material", () => {
    const state = reduce(createPerformanceState({ launchQuantization: "beat" }),
      { type: "StartTransport", atBeat: 12 },
      { type: "SetTrackMute", trackId: "track-a", muted: true },
      { type: "SetMacro", macro: "tone", value: 0.9 },
      { type: "ResetPerformance" },
    );
    expect(state).toEqual(createPerformanceState({ launchQuantization: "beat" }));
    expect("song" in state).toBe(false);
  });

  it("reconciles material versions and removes every orphaned track or clip reference", () => {
    let state = activeTrack(createPerformanceState(), "track-a", "clip-a");
    state = activeTrack(state, "track-b", "clip-b");
    state = reduce(state,
      {
        type: "LaunchClip",
        transitionId: "replace-a",
        trackId: "track-a",
        clipId: "missing-clip",
        requestedAtBeat: 1,
      },
      {
        type: "ArmRecordSlot",
        trackId: "track-a",
        slotId: "slot-a1",
        clipId: "clip-a",
      },
    );

    state = reconcilePerformanceMaterial(state, {
      version: 7,
      clipIdsByTrack: { "track-a": ["clip-a"] },
    });
    expect(state.materialVersion).toBe(7);
    expect(state.tracks["track-b"]).toBeUndefined();
    expect(state.tracks["track-a"].activeClipId).toBe("clip-a");
    expect(state.tracks["track-a"].pendingTransition).toBeNull();
    expect(state.tracks["track-a"].lastResolvedTransition).toMatchObject({
      id: "track-a-launch",
      status: "executed",
    });
    expect(state.recording).toMatchObject({
      phase: "armed",
      trackId: "track-a",
      clipId: "clip-a",
    });

    state = resetPerformanceForMaterial(state, {
      version: 8,
      clipIdsByTrack: { "track-a": ["clip-a"] },
    });
    expect(state.materialVersion).toBe(8);
    expect(state.tracks).toEqual({});
    expect(state.recording.phase).toBe("idle");
  });
});
