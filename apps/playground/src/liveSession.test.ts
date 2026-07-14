import { describe, expect, it } from "vitest";

import {
  beatAtTime,
  cancelPendingTransition,
  createLiveSessionState,
  createMusicalClock,
  getOpenTransition,
  getTransition,
  markTransitionScheduled,
  nextBarBeat,
  observeTransition,
  queueTransition,
  type LiveSessionState,
} from "./liveSession";

type TestAction =
  | { readonly kind: "activate"; readonly sourceId: string }
  | { readonly kind: "stop" }
  | {
      readonly kind: "transform";
      readonly operation: "transpose" | "rotate" | "restore";
    };

type TestObservation = {
  readonly sourceId: string | null;
  readonly variation: string;
};

function emptyState(): LiveSessionState<TestAction, TestObservation> {
  return createLiveSessionState<TestAction, TestObservation>();
}

describe("live session clock", () => {
  it("derives beat position from a stable clock without storing ticks", () => {
    const clock = createMusicalClock({
      bpm: 120,
      originBeat: 8,
      originTimeSeconds: 10,
    });

    expect(beatAtTime(clock, 10)).toBe(8);
    expect(beatAtTime(clock, 11.5)).toBe(11);
    expect(clock).toEqual({
      bpm: 120,
      beatsPerBar: 4,
      originBeat: 8,
      originTimeSeconds: 10,
    });
  });

  it("always resolves next-bar quantization to a strictly future boundary", () => {
    expect(nextBarBeat(0)).toBe(4);
    expect(nextBarBeat(3.999)).toBe(4);
    expect(nextBarBeat(4)).toBe(8);
    expect(nextBarBeat(7.5)).toBe(8);
    expect(() => nextBarBeat(-1)).toThrow(/currentBeat/);
  });
});

describe("live session transition ledger", () => {
  it("gives two tracks requested together the same concrete target beat", () => {
    let state = emptyState();
    state = queueTransition(state, {
      id: "a-1",
      trackId: "track-a",
      action: { kind: "activate", sourceId: "clip-a" },
      requestedAtBeat: 1.25,
    });
    state = queueTransition(state, {
      id: "b-1",
      trackId: "track-b",
      action: { kind: "transform", operation: "rotate" },
      requestedAtBeat: 1.25,
    });

    expect(getOpenTransition(state, "track-a")?.targetBeat).toBe(4);
    expect(getOpenTransition(state, "track-b")?.targetBeat).toBe(4);
  });

  it("keeps one pending transition per track and records replacement", () => {
    let state = emptyState();
    state = queueTransition(state, {
      id: "a-1",
      trackId: "track-a",
      action: { kind: "activate", sourceId: "clip-a" },
      requestedAtBeat: 1,
    });
    state = queueTransition(state, {
      id: "a-2",
      trackId: "track-a",
      action: { kind: "activate", sourceId: "clip-b" },
      requestedAtBeat: 2,
    });

    expect(getTransition(state, "a-1")).toMatchObject({
      status: "cancelled",
      reason: "replaced",
      cancelledAtBeat: 2,
    });
    expect(getOpenTransition(state, "track-a")).toMatchObject({
      id: "a-2",
      status: "pending",
      targetBeat: 4,
    });
  });

  it("cancels a player request before it reaches the engine", () => {
    let state = queueTransition(emptyState(), {
      id: "a-1",
      trackId: "track-a",
      action: { kind: "transform", operation: "transpose" },
      requestedAtBeat: 1,
    });

    state = cancelPendingTransition(state, "track-a", 2.5);

    expect(getOpenTransition(state, "track-a")).toBeUndefined();
    expect(getTransition(state, "a-1")).toMatchObject({
      status: "cancelled",
      reason: "player",
      cancelledAtBeat: 2.5,
    });
  });

  it("separates engine scheduling from observed execution", () => {
    let state = queueTransition(emptyState(), {
      id: "a-1",
      trackId: "track-a",
      action: { kind: "activate", sourceId: "clip-a" },
      requestedAtBeat: 1,
    });

    state = markTransitionScheduled(state, "a-1");
    expect(getTransition(state, "a-1")?.status).toBe("scheduled");
    expect(state.observedTrackState["track-a"]).toBeUndefined();

    state = observeTransition(state, {
      transitionId: "a-1",
      outcome: "executed",
      observedAtBeat: 4,
      trackState: { sourceId: "clip-a", variation: "anchor" },
    });

    expect(getTransition(state, "a-1")).toMatchObject({
      status: "executed",
      observedAtBeat: 4,
    });
    expect(state.observedTrackState["track-a"]).toEqual({
      sourceId: "clip-a",
      variation: "anchor",
    });
    expect(getOpenTransition(state, "track-a")).toBeUndefined();
  });

  it("does not let a failed transition claim a new audible state", () => {
    let state = queueTransition(emptyState(), {
      id: "a-1",
      trackId: "track-a",
      action: { kind: "activate", sourceId: "clip-a" },
      requestedAtBeat: 0,
    });
    state = markTransitionScheduled(state, "a-1");
    state = observeTransition(state, {
      transitionId: "a-1",
      outcome: "executed",
      observedAtBeat: 4,
      trackState: { sourceId: "clip-a", variation: "anchor" },
    });
    state = queueTransition(state, {
      id: "a-2",
      trackId: "track-a",
      action: { kind: "transform", operation: "rotate" },
      requestedAtBeat: 5,
    });
    state = markTransitionScheduled(state, "a-2");
    state = observeTransition(state, {
      transitionId: "a-2",
      outcome: "failed",
      observedAtBeat: 5.25,
      error: "engine rejected schedule",
    });

    expect(getTransition(state, "a-2")).toMatchObject({
      status: "failed",
      observedAtBeat: 5.25,
      error: "engine rejected schedule",
    });
    expect(state.observedTrackState["track-a"]).toEqual({
      sourceId: "clip-a",
      variation: "anchor",
    });
  });

  it("stops one observed track without changing another or the clock", () => {
    const clock = createMusicalClock({ bpm: 120 });
    let state = emptyState();
    for (const trackId of ["track-a", "track-b"]) {
      state = queueTransition(state, {
        id: `${trackId}-start`,
        trackId,
        action: { kind: "activate", sourceId: `${trackId}-anchor` },
        requestedAtBeat: 0,
      });
      state = markTransitionScheduled(state, `${trackId}-start`);
      state = observeTransition(state, {
        transitionId: `${trackId}-start`,
        outcome: "executed",
        observedAtBeat: 4,
        trackState: { sourceId: `${trackId}-anchor`, variation: "anchor" },
      });
    }

    state = queueTransition(state, {
      id: "a-stop",
      trackId: "track-a",
      action: { kind: "stop" },
      requestedAtBeat: 4,
    });
    state = markTransitionScheduled(state, "a-stop");
    state = observeTransition(state, {
      transitionId: "a-stop",
      outcome: "executed",
      observedAtBeat: 8,
      trackState: { sourceId: null, variation: "stopped" },
    });

    expect(state.observedTrackState["track-a"]?.sourceId).toBeNull();
    expect(state.observedTrackState["track-b"]?.sourceId).toBe("track-b-anchor");
    expect(beatAtTime(clock, 5)).toBe(10);
  });

  it("rejects optimistic execution and local replacement after engine scheduling", () => {
    let state = queueTransition(emptyState(), {
      id: "a-1",
      trackId: "track-a",
      action: { kind: "activate", sourceId: "clip-a" },
      requestedAtBeat: 1,
    });

    expect(() =>
      observeTransition(state, {
        transitionId: "a-1",
        outcome: "executed",
        observedAtBeat: 4,
        trackState: { sourceId: "clip-a", variation: "anchor" },
      }),
    ).toThrow(/must be scheduled/);

    state = markTransitionScheduled(state, "a-1");
    expect(() =>
      observeTransition(state, {
        transitionId: "a-1",
        outcome: "executed",
        observedAtBeat: 3.9,
        trackState: { sourceId: "clip-a", variation: "anchor" },
      }),
    ).toThrow(/before target beat 4/);
    expect(() =>
      queueTransition(state, {
        id: "a-2",
        trackId: "track-a",
        action: { kind: "activate", sourceId: "clip-b" },
        requestedAtBeat: 2,
      }),
    ).toThrow(/already scheduled/);
  });
});
