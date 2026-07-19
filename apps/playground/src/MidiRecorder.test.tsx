import { StrictMode } from "react";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MidiRecorder } from "./MidiRecorder";
import { usePlaygroundStore } from "./store";

beforeEach(() => {
  resetStore();
  createOneSlotSong();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  Reflect.deleteProperty(navigator, "requestMIDIAccess");
  vi.restoreAllMocks();
});

describe("MidiRecorder", () => {
  it("commits one quantized empty-slot take as one revision and undoes only that take", async () => {
    const clock = createClock();
    const before = usePlaygroundStore.getState();
    const revisionBefore = before.commandState.revision;
    const undoBefore = before.undoStack.length;
    render(<MidiRecorder isLive syncClock={clock.sync} />);

    fireEvent.click(screen.getByRole("button", { name: "Empty slot 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue recording" }));
    expect(screen.getByText(/Queued for bar 2/)).toBeInTheDocument();

    clock.set(4.01);
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(screen.getByText("Input is live.")).toBeInTheDocument());
    clock.set(4.31);
    fireEvent.keyUp(window, { key: "a" });
    clock.advance(8);

    await waitFor(() => expect(screen.getByText(/Recording committed: 1 note/)).toBeInTheDocument());
    const after = usePlaygroundStore.getState();
    expect(after.commandState.revision).toBe(revisionBefore + 1);
    expect(after.undoStack).toHaveLength(undoBefore + 1);
    const track = after.commandState.song!.tracks[0]!;
    expect(track.clips).toHaveLength(2);
    expect(track.clips[1]).toMatchObject({ startBeat: 4, lengthBeats: 4 });
    expect(track.clips[1]!.pattern.notes[0]).toMatchObject({
      pitch: 36,
      velocity: 100,
      startBeat: 0,
      lengthBeats: 0.3,
    });
    expect(track.clips[1]!.pattern.notes[0]!.id).toMatch(/^note-take-/);

    fireEvent.click(screen.getByRole("button", { name: "Undo last take" }));
    await waitFor(() => expect(screen.getByText("Last MIDI take undone.")).toBeInTheDocument());
    expect(usePlaygroundStore.getState().commandState.song!.tracks[0]!.clips).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Undo last take" })).toBeDisabled();
  });

  it("discards a focus-lost take without a document revision or stuck runtime owner", async () => {
    const clock = createClock();
    const revisionBefore = usePlaygroundStore.getState().commandState.revision;
    render(<MidiRecorder isLive syncClock={clock.sync} />);

    fireEvent.click(screen.getByRole("button", { name: "Empty slot 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue recording" }));
    clock.advance(4);
    await waitFor(() => expect(screen.getByText("Input is live.")).toBeInTheDocument());
    clock.set(4.1);
    fireEvent.keyDown(window, { key: "a" });
    fireEvent(window, new Event("blur"));

    await waitFor(() => expect(screen.getByText(/Take discarded: window focus was lost/)).toBeInTheDocument());
    const after = usePlaygroundStore.getState();
    expect(after.commandState.revision).toBe(revisionBefore);
    expect(after.commandState.song!.tracks[0]!.clips).toHaveLength(1);
    expect(after.performanceState.recording.phase).toBe("idle");
  });

  it("keeps keyboard and pads available when Web MIDI permission is denied", async () => {
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: vi.fn(async () => {
        throw new DOMException("Permission denied", "NotAllowedError");
      }),
    });
    const clock = createClock();
    render(<MidiRecorder isLive syncClock={clock.sync} />);

    fireEvent.click(screen.getByRole("button", { name: "Enable Web MIDI" }));
    await waitFor(() => expect(screen.getByText(/Permission denied.*Keyboard and pads remain available/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Empty slot 2" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "A pad, MIDI 36" })).toBeDisabled();
  });

  it("invalidates undo-last-take after any later document command", async () => {
    const clock = createClock();
    render(<MidiRecorder isLive syncClock={clock.sync} />);
    fireEvent.click(screen.getByRole("button", { name: "Empty slot 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue recording" }));
    clock.advance(4);
    clock.set(4.1);
    fireEvent.keyDown(window, { key: "a" });
    clock.set(4.4);
    fireEvent.keyUp(window, { key: "a" });
    clock.advance(8);
    await waitFor(() => expect(screen.getByRole("button", { name: "Undo last take" })).toBeEnabled());

    act(() => usePlaygroundStore.getState().setTempo(130));
    expect(screen.getByRole("button", { name: "Undo last take" })).toBeDisabled();
  });

  it("aligns a multi-bar overdub to the next active loop boundary", async () => {
    cleanup();
    resetStore();
    createOneSlotSong(16);
    activateClip("track-drums", "clip-one");
    const clock = createClock();
    clock.advance(5);
    const revisionBefore = usePlaygroundStore.getState().commandState.revision;
    render(
      <MidiRecorder
        isLive
        syncClock={clock.sync}
        getActiveLoopTiming={() => ({ startedAtBeat: 0, lengthBeats: 16 })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Queue overdub" }));
    expect(screen.getByText(/Queued for bar 5/)).toBeInTheDocument();
    clock.set(16.01);
    fireEvent.keyDown(window, { key: "a" });
    clock.set(16.31);
    fireEvent.keyUp(window, { key: "a" });
    clock.advance(32);

    await waitFor(() => expect(screen.getByText(/Overdub committed: 1 note/)).toBeInTheDocument());
    const after = usePlaygroundStore.getState();
    expect(after.commandState.revision).toBe(revisionBefore + 1);
    expect(after.commandState.song!.tracks[0]!.clips).toHaveLength(1);
    expect(after.commandState.song!.tracks[0]!.clips[0]!.pattern.notes[0]).toMatchObject({
      pitch: 36,
      startBeat: 0,
      lengthBeats: 0.3,
    });

    fireEvent.click(screen.getByRole("button", { name: "Queue overdub" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel take" }));
    expect(screen.getByRole("button", { name: "Undo last take" })).toBeEnabled();
  });

  it("survives React StrictMode effect replay and still queues a take", () => {
    const clock = createClock();
    render(
      <StrictMode>
        <MidiRecorder isLive syncClock={clock.sync} />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Empty slot 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Queue recording" }));
    expect(screen.getByText(/Queued for bar 2/)).toBeInTheDocument();
  });

  it("discards an overdub if its clip stops before the take completes", async () => {
    cleanup();
    resetStore();
    createOneSlotSong(16);
    activateClip("track-drums", "clip-one");
    const clock = createClock();
    clock.advance(5);
    const revisionBefore = usePlaygroundStore.getState().commandState.revision;
    render(
      <MidiRecorder
        isLive
        syncClock={clock.sync}
        getActiveLoopTiming={() => ({ startedAtBeat: 0, lengthBeats: 16 })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Queue overdub" }));
    clock.advance(16);
    await waitFor(() => expect(screen.getByText("Input is live.")).toBeInTheDocument());

    stopActiveClip("track-drums");

    await waitFor(() => expect(screen.getByText(/Take discarded: the selected clip is no longer active/)).toBeInTheDocument());
    expect(usePlaygroundStore.getState().commandState.revision).toBe(revisionBefore);
    expect(usePlaygroundStore.getState().commandState.song!.tracks[0]!.clips[0]!.pattern.notes)
      .toHaveLength(0);
    expect(usePlaygroundStore.getState().performanceState.recording.phase).toBe("idle");
  });
});

function resetStore() {
  localStorage.clear();
  const initial = usePlaygroundStore.getInitialState();
  usePlaygroundStore.setState({
    commandState: initial.commandState,
    performanceState: initial.performanceState,
    undoStack: [],
    redoStack: [],
    messages: [],
    draft: "",
    songJsonDraft: "",
    persistence: {
      phase: "idle",
      label: "No saved song",
      hasSavedSong: false,
    },
    noteDraft: initial.noteDraft,
    editingNoteId: null,
    selectedTrackId: null,
    selectedClipId: null,
    preview: initial.preview,
    lastError: null,
  });
}

function createOneSlotSong(lengthBeats = 4) {
  const store = usePlaygroundStore.getState();
  store.dispatch({ type: "CreateSong", id: "song-record", title: "Record test", bpm: 120 });
  store.dispatch({
    type: "CreateTrack",
    id: "track-drums",
    name: "Drums",
    kind: "instrument",
    instrumentId: "drums",
  });
  store.dispatch({
    type: "CreateClip",
    id: "clip-one",
    trackId: "track-drums",
    name: "First loop",
    startBeat: 0,
    lengthBeats,
  });
  usePlaygroundStore.getState().dispatchPerformance({ type: "StartTransport", atBeat: 0 });
}

function activateClip(trackId: string, clipId: string) {
  const store = usePlaygroundStore.getState();
  store.dispatchPerformance({
    type: "LaunchClip",
    transitionId: "activate-recording-clip",
    trackId,
    clipId,
    requestedAtBeat: store.performanceState.currentBeat,
    quantization: "immediate",
  });
  store.dispatchPerformance({
    type: "MarkTransitionScheduled",
    trackId,
    transitionId: "activate-recording-clip",
  });
  store.dispatchPerformance({
    type: "ObserveTransitionExecuted",
    trackId,
    transitionId: "activate-recording-clip",
    observedAtBeat: store.performanceState.currentBeat,
  });
}

function stopActiveClip(trackId: string) {
  const transitionId = "stop-recording-clip";
  const requestedAtBeat = usePlaygroundStore.getState().performanceState.currentBeat;
  act(() => {
    const store = usePlaygroundStore.getState();
    store.dispatchPerformance({
      type: "StopTrack",
      transitionId,
      trackId,
      requestedAtBeat,
      quantization: "immediate",
    });
    store.dispatchPerformance({
      type: "MarkTransitionScheduled",
      trackId,
      transitionId,
    });
    store.dispatchPerformance({
      type: "ObserveTransitionExecuted",
      trackId,
      transitionId,
      observedAtBeat: requestedAtBeat,
    });
  });
}

function createClock() {
  let beat = 0;
  const sync = vi.fn(() => {
    const current = usePlaygroundStore.getState().performanceState.currentBeat;
    if (beat > current) {
      usePlaygroundStore.getState().dispatchPerformance({ type: "AdvanceClock", beat });
    }
    return beat;
  });
  return {
    sync,
    set(nextBeat: number) {
      beat = nextBeat;
    },
    advance(nextBeat: number) {
      beat = nextBeat;
      act(() => {
        usePlaygroundStore.getState().dispatchPerformance({ type: "AdvanceClock", beat });
      });
    },
  };
}
