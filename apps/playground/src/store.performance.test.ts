import { beforeEach, describe, expect, it } from "vitest";

import { PLAYGROUND_SONG_STORAGE_KEY } from "./persistence";
import { reducePerformanceState } from "./performanceRuntime";
import { usePlaygroundStore } from "./store";

beforeEach(() => {
  localStorage.clear();
  const initial = usePlaygroundStore.getInitialState();
  usePlaygroundStore.setState({
    commandState: initial.commandState,
    performanceState: initial.performanceState,
    undoStack: [],
    redoStack: [],
    persistence: {
      phase: "idle",
      label: "No saved song",
      hasSavedSong: false,
    },
    lastError: null,
  });
});

describe("Playground performance-state boundary", () => {
  it("keeps performance-only actions out of Song revision, history, and autosave", () => {
    const store = usePlaygroundStore.getState();
    store.dispatch({
      type: "CreateSong",
      id: "song-runtime-boundary",
      title: "Persistent document",
      bpm: 120,
    });
    store.dispatch({
      type: "CreateTrack",
      id: "track-runtime-ref",
      name: "Runtime track",
    });
    store.dispatch({
      type: "CreateClip",
      id: "clip-runtime-ref",
      trackId: "track-runtime-ref",
      name: "Runtime clip",
      lengthBeats: 4,
    });

    const before = usePlaygroundStore.getState();
    const commandStateBefore = before.commandState;
    const undoBefore = before.undoStack;
    const redoBefore = before.redoStack;
    const persistenceBefore = before.persistence;
    const storageBefore = localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY);

    before.dispatchPerformance({ type: "StartTransport", atBeat: 0 });
    before.dispatchPerformance({
      type: "LaunchClip",
      transitionId: "runtime-launch",
      trackId: "track-runtime-ref",
      clipId: "clip-runtime-ref",
      requestedAtBeat: 0,
      quantization: "immediate",
    });
    before.dispatchPerformance({
      type: "MarkTransitionScheduled",
      trackId: "track-runtime-ref",
      transitionId: "runtime-launch",
    });
    before.dispatchPerformance({ type: "AdvanceClock", beat: 1 });

    const after = usePlaygroundStore.getState();
    expect(after.commandState).toBe(commandStateBefore);
    expect(after.commandState.revision).toBe(3);
    expect(after.commandState.song?.title).toBe("Persistent document");
    expect(after.undoStack).toBe(undoBefore);
    expect(after.redoStack).toBe(redoBefore);
    expect(after.persistence).toBe(persistenceBefore);
    expect(localStorage.getItem(PLAYGROUND_SONG_STORAGE_KEY)).toBe(storageBefore);
    expect(after.performanceState.tracks["track-runtime-ref"].activeClipId).toBeNull();
    expect(after.performanceState.tracks["track-runtime-ref"].pendingTransition).toMatchObject({
      id: "runtime-launch",
      status: "scheduled",
    });
    expect("song" in after.performanceState).toBe(false);
  });

  it("resets only the ephemeral runtime", () => {
    const before = usePlaygroundStore.getState();
    before.dispatch({
      type: "CreateSong",
      id: "song-reset-boundary",
      title: "Keep me",
    });
    before.dispatch({
      type: "CreateTrack",
      id: "track-a",
      name: "Keep track",
    });
    before.dispatchPerformance({ type: "SetTrackMute", trackId: "track-a", muted: true });
    const commandState = usePlaygroundStore.getState().commandState;

    usePlaygroundStore.getState().resetPerformance();

    const after = usePlaygroundStore.getState();
    expect(after.commandState).toBe(commandState);
    expect(after.commandState.song?.title).toBe("Keep me");
    expect(after.performanceState.tracks).toEqual({});
    expect(after.performanceState.materialVersion).toBe(after.commandState.revision);
  });

  it("resets stale runtime references after a remote full-song batch", () => {
    const initial = usePlaygroundStore.getInitialState();
    usePlaygroundStore.setState({
      performanceState: reducePerformanceState(initial.performanceState, {
        type: "SetTrackMute",
        trackId: "orphan-track",
        muted: true,
      }),
    });

    const result = usePlaygroundStore.getState().executeRemoteCommandBatch({
      requestId: "remote-material-replacement",
      expectedRevision: 0,
      commands: [
        {
          type: "CreateSong",
          id: "remote-song",
          title: "Remote replacement",
        },
      ],
    });
    expect(result.ok).toBe(true);
    const after = usePlaygroundStore.getState();
    expect(after.performanceState.tracks).toEqual({});
    expect(after.performanceState.materialVersion).toBe(after.commandState.revision);
  });

  it("resets the runtime on undo and load even when persistent IDs remain valid", () => {
    const store = usePlaygroundStore.getState();
    store.dispatch({ type: "CreateSong", id: "song-full-reset", title: "Full reset" });
    store.dispatch({ type: "CreateTrack", id: "track-a", name: "Track A" });
    store.dispatch({
      type: "CreateClip",
      id: "clip-a",
      trackId: "track-a",
      name: "Clip A",
      lengthBeats: 4,
    });
    store.saveSong();
    store.dispatchPerformance({ type: "SetTrackMute", trackId: "track-a", muted: true });
    expect(usePlaygroundStore.getState().performanceState.tracks["track-a"]?.muted).toBe(true);

    store.loadSavedSong();
    expect(usePlaygroundStore.getState().performanceState.tracks).toEqual({});

    usePlaygroundStore.getState().dispatchPerformance({
      type: "SetTrackSolo",
      trackId: "track-a",
      soloed: true,
    });
    usePlaygroundStore.getState().undo();
    const afterUndo = usePlaygroundStore.getState();
    expect(afterUndo.performanceState.tracks).toEqual({});
    expect(afterUndo.performanceState.materialVersion).toBe(afterUndo.commandState.revision);
  });
});
